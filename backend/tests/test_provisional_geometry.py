from shapely.geometry import Polygon
from shapely.ops import transform
from app.provisional_geometry import boundary_fit,propose_placements,sheet_groups
from app.drawings import TO_WEB
from app.evaluation import envelope

L=Polygon([(0,0),(4,0),(4,1),(2,1),(1,3),(0,3)])
def ground():return transform(lambda x,y,z=None:(1200000+100*x,300000+100*y),L)
def inputs():
    parcel={'type':'Polygon','coordinates':[[list(TO_WEB.transform(x,y)) for x,y in ground().exterior.coords]]}
    boundary={'id':'b','fact_id':'b','document_id':'doc','page':1,'label':'Parcel boundary','sheet_geometry':L.__geo_interface__,'role':'reference','geometry':None}
    feature={'id':'f','fact_id':'f','document_id':'doc','page':1,'label':'Drainfield','sheet_geometry':Polygon([(.2,.2),(.4,.2),(.4,.4),(.2,.4)]).__geo_interface__,'role':'exclusion','geometry':None}
    return {'parcel':{'geometry':parcel}},[boundary,feature]

def test_unique_rotated_parcel_match_is_display_only():
    fit,error=boundary_fit(L,ground())
    assert not error and fit['overlap_ratio']>.99
    p,layers=inputs();placed,regs=propose_placements(p,layers,[])
    assert len(placed)==2 and all(l['geometry'] for l in placed)
    assert placed[1]['calibration']=='gis_proposal' and placed[1]['computational_eligible'] is False
    facts=[{'id':l['id'],'key':'site_geometry','document_id':'doc','page':1,'value':l} for l in layers]
    p['accepted_facts']={'f':{'review_status':'accepted'}}
    result=envelope(p,facts)
    assert len(result['layers'])==2 and not result['constraints'] and result['geometry'] is None

def test_ambiguous_rectangle_remains_visible_on_sheet():
    rect=Polygon([(0,0),(2,0),(2,1),(0,1)])
    fit,error=boundary_fit(rect,transform(lambda x,y,z=None:(100.0*x,100.0*y),rect))
    assert fit is None and 'orientations' in error
    _,layers=inputs();groups=sheet_groups(layers,[])
    assert len(groups)==1 and len(groups[0]['features'])==2

def test_manual_registration_and_rejected_anchor_not_overridden():
    p,layers=inputs();placed,regs=propose_placements(p,layers,[],{('doc',1)})
    assert not regs and all(l.get('geometry') is None for l in placed)
    p['accepted_facts']={'b':{'review_status':'rejected'}}
    facts=[{'id':l['id'],'key':'site_geometry','document_id':'doc','page':1,'value':l} for l in layers]
    assert not envelope(p,facts)['layers']

def test_inset_different_scale_and_other_parcel_not_auto_placed():
    p,layers=inputs();layers[1]['feet_per_sheet_unit']=20
    placed,_=propose_placements(p,layers,[])
    assert placed[0]['geometry'] and not placed[1]['geometry']
    p['parcel']['id']='12345678901234';layers[0]['entity_id']='99999999999999'
    assert not propose_placements(p,layers,[])[0][0]['geometry']

def test_mismatched_outline_does_not_get_stretched_to_fit():
    fit,error=boundary_fit(L,Polygon([(0,0),(100,0),(100,100),(0,100)]))
    assert fit is None


def test_rotation_and_reversed_winding_preserve_feature_location():
    from shapely.affinity import rotate
    rotated=rotate(ground(),37,origin=(1200000,300000))
    fit,error=boundary_fit(Polygon(list(L.exterior.coords)[::-1]),rotated)
    assert not error and fit['overlap_ratio']>.99
    assert abs(fit['rotation_degrees']-37)<.1


def test_invalid_manual_reference_does_not_trigger_automatic_replacement():
    p,layers=inputs();p['alignment']={'reference':{'kind':'invalid'},'registrations':[]}
    facts=[{'id':l['id'],'key':'site_geometry','document_id':'doc','page':1,'value':l} for l in layers]
    result=envelope(p,facts)
    assert not result['layers'] and len(result['drawing_sheets'][0]['features'])==2


def test_unlocated_geometry_warnings_are_grouped_without_hiding_outlines():
    p,layers=inputs();p['alignment']={'reference':{'kind':'invalid'},'registrations':[]}
    facts=[{'id':l['id'],'key':'site_geometry','document_id':'doc','page':1,'value':l} for l in layers]
    result=envelope(p,facts)
    assert any('2 features on 1 source pages' in g for g in result['gaps'])
    assert not any('Missing geometry:' in g for g in result['gaps'])
