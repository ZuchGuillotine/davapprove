"""Revision-bound sheet registration to a shared reference. No AI or code authority."""
import hashlib
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import transform
from shapely.errors import ShapelyError
from .drawings import point, TO_LOCAL, TO_WEB


def fingerprint(reference):
    return hashlib.sha256(json.dumps({k:v for k,v in reference.items() if k not in ('reviewer','reviewed_at')},sort_keys=True).encode()).hexdigest()


def validate_reference(ref, documents):
    if not isinstance(ref,dict) or not ref.get('id') or not ref.get('label'):
        raise ValueError('Name the shared reference.')
    if ref.get('crs') not in ('EPSG:4326','EPSG:2285') or ref.get('kind') not in ('survey','screening'):
        raise ValueError('Choose WGS84 longitude/latitude or Washington North State Plane US feet and a reference type.')
    if ref['kind']=='survey':
        document=documents.get(ref.get('document_id'))
        if not document or not ref.get('source_revision') or not 1 <= int(ref.get('page',0)) <= document.get('page_count',0):
            raise ValueError('Survey reference needs an imported source, page and source revision.')
        if ref.get('document_sha256') != document.get('sha256') or not document.get('sha256'):
            raise ValueError('Survey reference source changed; review its new version.')
    if ref.get('accuracy_ft') is not None:
        accuracy=float(ref['accuracy_ft'])
        if not math.isfinite(accuracy) or not 0 <= accuracy <= 10000:
            raise ValueError('Reference accuracy must be finite nonnegative feet, or unknown.')
    points=ref.get('points',[])
    if not 4 <= len(points) <= 40 or len({p.get('id') for p in points})!=len(points):
        raise ValueError('Provide 4–40 uniquely named shared control points.')
    for p in points:
        if not p.get('id') or not p.get('label'):raise ValueError('Each reference point needs an ID and description.')
        xy=point(p['coordinates'])
        ll=xy if ref['crs']=='EPSG:4326' else TO_WEB.transform(*xy)
        if not (-123.5 < ll[0] < -122 and 47 < ll[1] < 48.5):
            raise ValueError('Reference coordinates must be in the supported Kitsap region.')
    return ref


def fit_registration(reg, ref, documents):
    """Least-squares similarity on fitting controls; independent held-out checks."""
    out={**reg,'status':'unlocated','transform':None,'issues':[]}
    try:
        doc=documents.get(reg.get('document_id'))
        if not doc or not doc.get('sha256') or reg.get('document_sha256')!=doc['sha256']:
            raise ValueError('Source document version is missing or changed.')
        if type(reg.get('page')) is not int or not 1 <= reg['page'] <= doc.get('page_count',0):raise ValueError('Invalid source page.')
        if reg.get('discipline') not in ('survey','septic','ecology','civil','utilities','architecture') or not str(reg.get('design_revision','')).strip():
            raise ValueError('Name the drawing revision and choose its discipline.')
        if reg.get('reference_id')!=ref.get('id') or reg.get('reference_fingerprint')!=fingerprint(ref):
            raise ValueError('Shared reference changed. Match and review this sheet again.')
        points={p['id']:p for p in ref['points']}
        pairs=reg.get('pairs',[])
        if not 4 <= len(pairs) <= 40 or len({p.get('point_id') for p in pairs})!=len(pairs):
            raise ValueError('Use at least four distinct controls: three fitting points and one independent check.')
        controls=[]
        for pair in pairs:
            source=point(pair['sheet']);target=point(points[pair['point_id']]['coordinates'])
            if pair.get('use') not in ('fit','check'):raise ValueError('Mark controls as fit or check.')
            if ref['crs']=='EPSG:4326':target=TO_LOCAL.transform(*target)
            controls.append((complex(*source),complex(*target),pair))
        fit=[c for c in controls if c[2]['use']=='fit'];checks=[c for c in controls if c[2]['use']=='check']
        if len(fit)<3 or not checks:raise ValueError('Need three fitting controls and an independent check.')
        src=sum(c[0] for c in fit)/len(fit);dst=sum(c[1] for c in fit)/len(fit)
        xx=sum((c[0].real-src.real)**2 for c in fit);yy=sum((c[0].imag-src.imag)**2 for c in fit)
        xy=sum((c[0].real-src.real)*(c[0].imag-src.imag) for c in fit)
        if xx+yy < 1e-12 or (xx*yy-xy*xy)/(xx+yy)**2 < .0001:
            raise ValueError('Fitting controls are coincident or nearly collinear; spread them across the sheet.')
        ratio=sum((c[0]-src).conjugate()*(c[1]-dst) for c in fit)/(xx+yy)
        if abs(ratio)<1e-8 or not math.isfinite(abs(ratio)):raise ValueError('Degenerate alignment.')
        origin=dst-ratio*src
        residuals=[{'point_id':c[2]['point_id'],'use':c[2]['use'],'error_ft':abs(origin+ratio*c[0]-c[1])} for c in controls]
        rms=math.sqrt(sum(r['error_ft']**2 for r in residuals if r['use']=='fit')/len(fit))
        check=max(r['error_ft'] for r in residuals if r['use']=='check')
        tolerance=float(reg.get('tolerance_ft',1))
        aspect=float(reg.get('sheet_height',0))
        if not math.isfinite(tolerance) or not 0 < tolerance <= 100:raise ValueError('Choose a check tolerance between 0 and 100 ft.')
        if not math.isfinite(aspect) or not .05 <= aspect <= 20:raise ValueError('Missing sheet image dimensions.')
        def web(x,y):
            z=origin+ratio*complex(x,y)
            return list(TO_WEB.transform(z.real,z.imag))
        out.update(transform={'real':ratio.real,'imag':ratio.imag,'x':origin.real,'y':origin.imag,'crs':'EPSG:2285'},
            fit_rms_ft=rms,check_max_ft=check,residuals=residuals,
            image_corners=[web(0,aspect),web(1,aspect),web(0,0)],
            accuracy_ft=ref.get('accuracy_ft'),
            status='reviewed' if reg.get('review_status')=='accepted' else 'proposed')
        if max(r['error_ft'] for r in residuals)>tolerance:
            out['status']='needs_review';out['issues'].append('Control error exceeds your stated tolerance.')
        if ref.get('accuracy_ft') is None:out['issues'].append('Absolute reference accuracy is unknown; fitting error is not survey accuracy.')
        if ref.get('kind')=='screening':out['issues'].append('Aligned to screening geometry, not survey control.')
    except (ValueError,TypeError,KeyError,OverflowError,ZeroDivisionError) as exc:
        out.update(status='unlocated',transform=None);out['issues'].append(str(exc))
    return out


def alignment_state(state, documents):
    if not state:return {'reference':None,'registrations':[]}
    docs={d['id']:d for d in documents}
    ref=validate_reference(state.get('reference'),docs)
    regs=state.get('registrations',[])
    if len(regs)>100 or len({r.get('id') for r in regs})!=len(regs):raise ValueError('Sheet registrations need unique IDs (maximum 100).')
    # One active transform per immutable source page avoids duplicate geometry application.
    if len({(r.get('document_id'),r.get('page')) for r in regs})!=len(regs):raise ValueError('Keep one alignment per document page; prior versions remain in project history.')
    return {'reference':ref,'reference_fingerprint':fingerprint(ref),
            'reference_points':[{'id':p['id'],'label':p['label'],'lonlat':list(p['coordinates']) if ref['crs']=='EPSG:4326' else list(TO_WEB.transform(*p['coordinates']))} for p in ref['points']],
            'registrations':[fit_registration(r,ref,docs) for r in regs]}


def registered_layers(layers, state):
    regs={(r.get('document_id'),r.get('page')):r for r in state.get('registrations',[])}
    ref=state.get('reference') or {}
    result=[]
    for layer in layers:
        r=regs.get((layer.get('document_id'),layer.get('page')))
        if not r or not layer.get('sheet_geometry'):
            result.append(layer);continue
        item={**layer,'registration_id':r['id'],'alignment_status':r['status'],'alignment_issues':r['issues'],
              'fit_rms_ft':r.get('fit_rms_ft'),'check_max_ft':r.get('check_max_ft'),'reference_accuracy_ft':ref.get('accuracy_ft')}
        if not r.get('transform'):
            item.update(geometry=None,calibration='needs_review');result.append(item);continue
        t=r['transform']
        def project(x,y,z=None):
            return TO_WEB.transform(t['x']+t['real']*x-t['imag']*y,t['y']+t['imag']*x+t['real']*y)
        try:
            geom=shape(layer['sheet_geometry'])
            if geom.is_empty or not geom.is_valid or geom.geom_type not in ('Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'):
                raise ValueError('Invalid sheet geometry')
            item['geometry']=mapping(transform(project,geom))
        except (ValueError,TypeError,KeyError,AttributeError,IndexError,ShapelyError):
            item.update(geometry=None,calibration='needs_review',alignment_issues=[*r['issues'],'Invalid sheet feature geometry; source review needed.'])
            result.append(item);continue
        trusted=r['status']=='reviewed' and ref.get('kind')=='survey' and ref.get('accuracy_ft') is not None
        item.update(calibration='reviewer_confirmed' if trusted else 'registered_proposal',crs='EPSG:4326',
                    discipline=r.get('discipline') or layer.get('discipline'),design_revision=r.get('design_revision'))
        result.append(item)
    return result
