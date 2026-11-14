import copy
import pytest
from app.drawings import calibrate, scale_notations, TO_LOCAL, TO_WEB, reconcile
from app.evaluation import envelope

def drawing():
    x,y=TO_LOCAL.transform(-122.65,47.7)
    def control(a,b):
        return {'sheet':[a,b], 'lonlat':list(TO_WEB.transform(x+a*100,y+b*100)), 'notation':'Explicit WGS84 control'}
    return {'label':'Reserve A','entity_id':'RES-A','discipline':'septic','role':'exclusion',
        'vertices':[[0,0],[1,0],[1,1],[0,1]],'controls':[control(0,0),control(1,0),control(0,1)],
        'dimensions':[{'start':[0,0],'end':[1,0],'distance':100,'unit':'ft','notation':"100 ft"}]}

def test_control_fit_and_dimensions():
    r=calibrate(drawing())
    assert r['calibration']=='automatic_control_fit'
    assert r['control_residual_ft']<.001
    assert r['feet_per_sheet_unit']==pytest.approx(100)
    assert r['geometry']['type']=='Polygon'

def test_scale_only_never_places_site():
    d=drawing();d['controls']=[]
    r=calibrate(d)
    assert r['calibration']=='sheet_scaled' and r['geometry'] is None
    assert r['sheet_geometry'] and r['issues']

def test_conflicting_dimensions_and_mirrored_controls():
    d=drawing();d['dimensions'][0]['distance']=120
    assert calibrate(d)['calibration']=='needs_review'
    d=drawing();d['controls'][2]['sheet']=[0,-1]
    assert calibrate(d)['geometry'] is None

def test_collinear_and_nonfinite_rejected():
    d=drawing();d['controls'][2]['sheet']=[2,0]
    assert calibrate(d)['geometry'] is None
    d=drawing();d['vertices'][0]=[float('nan'),0]
    assert calibrate(d)['geometry'] is None

def test_printed_scales():
    assert scale_notations('SCALE: 1/4" = 1\'')[0]['ground_ft_per_paper_in']==4
    assert scale_notations('SCALE 1:100')[0]['ground_ft_per_paper_in']==pytest.approx(100/12)
    assert not scale_notations('NOT TO SCALE')

def test_reconcile_keeps_revisions_and_sources():
    a={**calibrate(drawing()),'id':'a','document_id':'a','page':1,'design_revision':'1'}
    b={**copy.deepcopy(a),'id':'b','document_id':'b','design_revision':'2'}
    assert reconcile([a,b])[0]['sources'][1]['document_id']=='b'
    b['entity_id']='OTHER'
    assert not reconcile([a,b])

def test_auto_fit_needs_distinct_review_for_subtraction():
    v=calibrate(drawing())
    p={'parcel':{'geometry':v['geometry']},'accepted_facts':{'f':{'review_status':'accepted'}}}
    f={'id':'f','key':'site_geometry','document_id':'doc','page':1,'value':v}
    r=envelope(p,[f])
    assert not r['constraints'] and r['layers'][0]['review_status']=='proposed'
    p['accepted_facts']['f']['value']={**v,'calibration':'reviewer_confirmed'}
    assert envelope(p,[f])['constraints']

def test_partial_road_and_point_can_calibrate_without_closed_area():
    d=drawing();d.update(geometry_type='LineString',vertices=[[0,0],[.5,.2]])
    r=calibrate(d)
    assert r['geometry']['type']=='LineString'
    d.update(geometry_type='Point',vertices=[[.5,.2]])
    assert calibrate(d)['geometry']['type']=='Point'
