"""Drawing observations -> proposed geometry. Never grants review or approval.
Sheet coordinates use x right, y up, in a single isotropic frame (not independent
0..1 normalization of each axis). Controls must be explicitly printed coordinates.
"""
import math
import re
from shapely.geometry import Polygon, LineString, Point, mapping, shape
from pyproj import Transformer

TO_LOCAL = Transformer.from_crs(4326, 2285, always_xy=True)
TO_WEB = Transformer.from_crs(2285, 4326, always_xy=True)
UNITS = {'ft': 1., 'm': 3.280839895013123, 'in': 1/12}

def distance(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

def point(p):
    if len(p) != 2 or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in p):
        raise ValueError('Invalid numeric coordinate')
    return tuple(p)

def scale_notations(text):
    """Capture source text; printed scale alone never locates or calibrates pixels."""
    matches = []
    pattern = r'''(?i)(?:scale\s*[:=]?\s*)?(\d+(?:\.\d+)?(?:/\d+)?)\s*(?:"|″|in(?:ch(?:es)?)?)\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)'''
    for m in re.finditer(pattern, text):
        parts = m[1].split('/')
        if len(parts) == 2 and float(parts[1]) == 0:
            continue
        inches = float(parts[0]) / (float(parts[1]) if len(parts) == 2 else 1)
        if inches > 0 and float(m[2]) > 0:
            matches.append({'quote': m[0], 'ground_ft_per_paper_in': float(m[2])/inches})
    for m in re.finditer(r'(?i)\bscale\s*[:=]?\s*1\s*:\s*(\d+(?:\.\d+)?)', text):
        if float(m[1]) > 0:
            matches.append({'quote': m[0], 'ground_ft_per_paper_in': float(m[1])/12})
    return matches

def calibrate(drawing):
    """Fit similarity from first two controls; independently check remaining controls.
    Thresholds are pilot QA limits, not survey/code accuracy specifications.
    """
    out = {**drawing, 'calibration': 'unlocated', 'geometry': None, 'issues': [], 'crs': 'EPSG:4326'}
    try:
        vertices = [point(p) for p in drawing['vertices']]
        geometry_type=drawing.get('geometry_type','Polygon')
        constructor={'Polygon':Polygon,'LineString':LineString,'Point':lambda v:Point(v[0])}.get(geometry_type)
        minimum={'Polygon':3,'LineString':2,'Point':1}.get(geometry_type,201)
        if not minimum <= len(vertices) <= 200 or (geometry_type=='Point' and len(vertices)!=1):
            raise ValueError('Invalid number of feature vertices')
        poly = constructor(vertices)
        if not poly.is_valid or poly.is_empty or (geometry_type=='Polygon' and poly.area <= 0):
            raise ValueError('Invalid sheet outline')
        out['sheet_geometry'] = mapping(poly)
        controls = drawing.get('controls', [])
        dimensions = drawing.get('dimensions', [])
        if len(controls) > 12 or len(dimensions) > 20:
            raise ValueError('Too many controls or dimensions')
        scales = []
        for dim in dimensions:
            a, b = point(dim['start']), point(dim['end'])
            length = float(dim['distance']) * UNITS[dim['unit']]
            if not dim.get('notation') or not math.isfinite(length) or length <= 0 or distance(a,b) <= 0:
                raise ValueError('Dimension needs a positive distance, units and source notation')
            scales.append(length / distance(a,b))
        if scales:
            scale = sum(scales)/len(scales)
            out['feet_per_sheet_unit'] = scale
            if max(abs(s/scale-1) for s in scales) > .02:
                raise ValueError('Written dimensions disagree by more than 2%; check detail scales or scan distortion')
            out['calibration'] = 'sheet_scaled'
        if len(controls) < 3:
            out['issues'].append('Need at least three explicit geographic control points for site placement. Scale alone is insufficient.')
            return out
        sheet, ground = [], []
        for c in controls:
            xy, ll = point(c['sheet']), point(c['lonlat'])
            if not c.get('notation') or not (-123.5 < ll[0] < -122 and 47 < ll[1] < 48.5):
                raise ValueError('Control lacks source notation or is outside the supported Kitsap region')
            sheet.append(xy); ground.append(TO_LOCAL.transform(*ll))
        # Require a noncollinear check point: two points cannot detect mirroring.
        v = complex(sheet[1][0]-sheet[0][0], sheet[1][1]-sheet[0][1])
        if abs(v) < 1e-8 or max(abs((p[0]-sheet[0][0])*v.imag-(p[1]-sheet[0][1])*v.real) for p in sheet[2:]) < abs(v)**2*.01:
            raise ValueError('Control points are coincident or nearly collinear')
        w = complex(ground[1][0]-ground[0][0], ground[1][1]-ground[0][1])
        if abs(w) < 1:
            raise ValueError('Control baseline is too short')
        ratio = w/v
        def project(p):
            z = complex(p[0]-sheet[0][0],p[1]-sheet[0][1])*ratio
            return ground[0][0]+z.real,ground[0][1]+z.imag
        residual = max(distance(project(p), g) for p,g in zip(sheet[2:], ground[2:]))
        out['control_residual_ft'] = residual
        if residual > 1:
            raise ValueError('Independent control residual exceeds 1 ft; check orientation, units or distortion')
        if scales and any(abs(s/abs(ratio)-1) > .02 for s in scales):
            raise ValueError('Written dimensions disagree with geographic controls by more than 2%')
        out.update(calibration='automatic_control_fit', feet_per_sheet_unit=abs(ratio),
                   transform={'real':ratio.real,'imag':ratio.imag,'sheet_origin':sheet[0],'ground_origin':ground[0],'ground_crs':'EPSG:2285'},
                   geometry=mapping(constructor([TO_WEB.transform(*project(p)) for p in vertices])))
    except (KeyError, TypeError, ValueError, ZeroDivisionError, OverflowError) as exc:
        out.update(calibration='needs_review', geometry=None)
        out['issues'].append(str(exc))
    return out

def reconcile(layers):
    """Explicit entity IDs only; never guess that similarly named features are identical."""
    issues = []
    for i,a in enumerate(layers):
        for b in layers[i+1:]:
            if not a.get('entity_id') or a['entity_id'] != b.get('entity_id'):
                continue
            if a.get('document_id') == b.get('document_id') and a.get('page') == b.get('page'):
                continue
            reasons = []
            if a.get('design_revision') != b.get('design_revision'):
                reasons.append('Different source revisions; confirm which applies (no automatic supersession).')
            if a.get('geometry') and b.get('geometry'):
                from shapely.ops import transform
                try:
                    ga,gb = [transform(TO_LOCAL.transform, shape(x['geometry'])) for x in (a,b)]
                    if any(not g.is_valid or g.is_empty for g in (ga,gb)):
                        raise ValueError('Invalid geometry')
                    delta = ga.hausdorff_distance(gb)
                    if delta > 1:
                        reasons.append(f'Locations differ by up to {delta:.1f} ft (outline distance).')
                except (ValueError, TypeError, KeyError):
                    reasons.append('Geometry could not be compared; verify both source outlines.')
            for key in ('source_decision','installation_status'):
                if a.get(key) not in (None,'unknown','') and b.get(key) not in (None,'unknown','') and a[key] != b[key]:
                    reasons.append(f'{key.replace("_", " ")} differs; verify scope and chronology.')
            if reasons:
                issues.append({'layer_ids':[a['id'],b['id']], 'entity_id':a['entity_id'],
                    'message':f"{a.get('label',a['entity_id'])}: " + ' '.join(reasons),
                    'sources':[{'document_id':x.get('document_id'),'page':x.get('page'),'revision':x.get('design_revision')} for x in (a,b)]})
    return issues
