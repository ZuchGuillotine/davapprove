"""Display-first sheet geometry and provisional assessor-GIS registration.

A shape match proposes placement; it does not establish survey control, feature
identity, source precedence, or eligibility for envelope subtraction.
"""
from collections import defaultdict
import math
import re
import numpy as np
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely.errors import ShapelyError
from .drawings import TO_LOCAL, TO_WEB

POLICY = 'provisional-parcel-shape-v1'
BOUNDARY = re.compile(r'\b(parcel|property)\s*(boundary|perimeter|outline)|\bparcel\s+[\d-]+',re.I)
OTHER = re.compile(r'\b(adjacent|neighbor|neighbour|off.site|vicinity|inset)\b',re.I)


def boundary_fit(sheet, ground):
    """Orientation-preserving similarity; cyclic perimeter correspondence search.
    Non-unique rotations and poor shape agreement remain sheet-only.
    """
    if sheet.geom_type!='Polygon' or ground.geom_type!='Polygon' or sheet.interiors or ground.interiors:
        return None,'A single parcel outline is required.'
    if any(g.is_empty or not g.is_valid or g.area<=0 for g in (sheet,ground)):
        return None,'Invalid parcel outline.'
    def samples(g,n):
        line=g.exterior
        values=np.array([complex(*line.interpolate(i/n,normalized=True).coords[0]) for i in range(n)])
        return values if line.is_ccw else values[(-np.arange(n)) % n]
    n=128;phases=512
    src=samples(sheet,n);dst=samples(ground,phases)
    center=src.mean();a=src-center
    targets=dst[(np.arange(phases)[:,None]+4*np.arange(n)[None,:])%phases]
    centers=targets.mean(axis=1);b=targets-centers[:,None]
    ratios=(b*a.conjugate()).sum(axis=1)/(abs(a)**2).sum()
    origins=centers-ratios*center
    rms=np.sqrt(np.mean(abs(origins[:,None]+ratios[:,None]*src-targets)**2,axis=1))
    best=int(np.argmin(rms));ratio=complex(ratios[best]);origin=complex(origins[best])
    diagonal=math.hypot(ground.bounds[2]-ground.bounds[0],ground.bounds[3]-ground.bounds[1])
    if not math.isfinite(abs(ratio)) or abs(ratio)<1e-8 or rms[best]/diagonal>.03:
        return None,'Parcel shape does not agree closely enough with GIS.'
    angle=np.abs(np.angle(ratios/ratio))
    if np.any((angle>math.radians(20)) & (rms <= rms[best]+diagonal*.015)):
        return None,'Parcel shape has multiple plausible orientations; choose controls before site placement.'
    def project(x,y,z=None):return origin.real+ratio.real*x-ratio.imag*y,origin.imag+ratio.imag*x+ratio.real*y
    fitted=transform(project,sheet)
    iou=fitted.intersection(ground).area/fitted.union(ground).area
    hausdorff=fitted.hausdorff_distance(ground)
    if iou<.85 or hausdorff/diagonal>.07:
        return None,'Parcel perimeter mismatch is too large for automatic placement.'
    return {'real':ratio.real,'imag':ratio.imag,'x':origin.real,'y':origin.imag,
        'crs':'EPSG:2285','feet_per_sheet_unit':abs(ratio),'fit_rms_ft':float(rms[best]),
        'perimeter_error_ft':hausdorff,'overlap_ratio':iou,'rotation_degrees':math.degrees(math.atan2(ratio.imag,ratio.real))},None


def propose_placements(project,layers,documents,manual_pages=()):
    groups=defaultdict(list);docs={d['id']:d for d in documents};result=[];placements=[]
    for layer in layers:groups[(layer.get('document_id'),layer.get('page'))].append(layer)
    parcel=project.get('parcel',{});geometry=parcel.get('geometry')
    try:
        if geometry and geometry.get('type')=='Feature':geometry=geometry['geometry']
        ground=transform(TO_LOCAL.transform,shape(geometry)) if geometry else None
    except (ValueError,TypeError,KeyError,AttributeError,ShapelyError):ground=None
    parcel_id=re.sub(r'\D','',str(parcel.get('id') or parcel.get('parcel_number') or ''))
    for (did,page),items in groups.items():
        candidates=[];issues=[]
        if ground is not None and (did,page) not in manual_pages:
            for item in items:
                label=str(item.get('label',''))
                if not item.get('sheet_geometry') or not BOUNDARY.search(label) or OTHER.search(label):continue
                # Explicit different full-length parcel identifiers cannot anchor this parcel.
                ids=re.findall(r'\b\d[\d-]{11,}\d\b',label+' '+str(item.get('entity_id','')))
                if parcel_id and any(len(re.sub(r'\D','',i))==len(parcel_id) and re.sub(r'\D','',i)!=parcel_id for i in ids):continue
                try:
                    boundary=shape(item['sheet_geometry'])
                    fit,reason=boundary_fit(boundary,ground)
                    if not fit:
                        issues.append(reason);continue
                    scale=item.get('feet_per_sheet_unit')
                    if scale and abs(scale/fit['feet_per_sheet_unit']-1)>.15:
                        issues.append('Written dimensions disagree with the proposed GIS scale.');continue
                    candidates.append((item,boundary,fit))
                except (ValueError,TypeError,KeyError,ArithmeticError,ShapelyError):continue
        candidates.sort(key=lambda c:c[2]['fit_rms_ft'])
        chosen=candidates[0] if candidates else None
        # Multiple full parcel drawings on one page may be distinct details/frames.
        if len(candidates)>1:
            a,b=candidates[0][1],candidates[1][1]
            if a.intersection(b).area/a.union(b).area<.9:
                issues.append('Multiple parcel details on this page need separate drawing frames.');chosen=None
        placed=0
        for item in items:
            current={**item}
            if chosen and item.get('sheet_geometry') and not item.get('geometry'):
                anchor,boundary,t=chosen
                try:
                    feature=shape(item['sheet_geometry']);scale=item.get('feet_per_sheet_unit')
                    if feature.is_empty or not feature.is_valid:raise ValueError('Invalid source outline.')
                    if scale and abs(scale/t['feet_per_sheet_unit']-1)>.15:raise ValueError('Feature appears to use a different detail scale.')
                    margin=max(boundary.bounds[2]-boundary.bounds[0],boundary.bounds[3]-boundary.bounds[1])*.05
                    if not boundary.buffer(margin).covers(feature.representative_point()):raise ValueError('Feature is outside the matched parcel drawing frame.')
                    def web(x,y,z=None):return TO_WEB.transform(t['x']+t['real']*x-t['imag']*y,t['y']+t['imag']*x+t['real']*y)
                    current.update(geometry=mapping(transform(web,feature)),calibration='gis_proposal',
                        crs='EPSG:4326',review_status='proposed',computational_eligible=False,
                        placement={'policy':POLICY,'method':'parcel_outline_match','anchor_fact_id':anchor.get('fact_id'),
                            'document_sha256':docs.get(did,{}).get('sha256'),'parcel_id':parcel_id,
                            'fit':t,'accuracy_ft':None,'status':'needs_review',
                            'warning':'Approximate GIS shape alignment, not survey control. Verify orientation and drawing frame; excluded from envelope calculations.'})
                    placed+=1
                except (ValueError,TypeError,KeyError,AttributeError,ShapelyError):pass
            result.append(current)
        if chosen:
            placements.append({'document_id':did,'page':page,'anchor_fact_id':chosen[0].get('fact_id'),
                'fit':chosen[2],'features_placed':placed,'status':'needs_review','policy':POLICY})
        elif issues:
            placements.append({'document_id':did,'page':page,'features_placed':0,'status':'sheet_only',
                'issues':list(dict.fromkeys(issues)),'policy':POLICY})
    return result,placements


def sheet_groups(layers,documents):
    docs={d['id']:d for d in documents};groups={}
    for l in layers:
        if not l.get('sheet_geometry'):continue
        key=(l.get('document_id'),l.get('page'))
        d=docs.get(key[0],{})
        group=groups.setdefault(key,{'id':str(key[0])+':'+str(key[1]),'document_id':key[0],'page':key[1],
            'document_sha256':d.get('sha256'),'title':d.get('title') or d.get('filename') or 'Imported drawing',
            'features':[],'located_features':0})
        group['features'].append(l)
        group['located_features']+=bool(l.get('geometry'))
    return sorted(groups.values(),key=lambda g:(-g['located_features'],-len(g['features']),g['id']))
