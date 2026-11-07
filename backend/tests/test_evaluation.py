import copy
import pytest
from app.evaluation import assess, envelope, ordered_nodes, revision_impact

POLY={'type':'Polygon','coordinates':[[[-122.65,47.70],[-122.649,47.70],[-122.649,47.701],[-122.65,47.701],[-122.65,47.70]]]}
def project():
 return {'id':'p','jurisdiction':'poulsbo','current_revision':1,'parcel':{'geometry':POLY},'intent':{'bedrooms':3}}

def test_repeatable_and_unknown_not_approval():
 p=project(); first=assess(p,[],[],[],as_of='2026-11-07')
 assert first==assess(p,[],[],[],as_of='2026-11-07')
 assert first['envelope']['status']=='cannot_determine'
 assert all(n['decision']=='unknown' for n in first['nodes'])
 assert first['rule_version']=='2026-11-07.1'

def test_unsupported_does_not_inherit_county():
 p=project();p['jurisdiction']='bremerton'
 assert not assess(p,[],[],[])['nodes']

def test_reviewed_constraint_subtraction():
 p=project(); cut=copy.deepcopy(POLY)
 cut['coordinates'][0][1][0]=-122.6495;cut['coordinates'][0][2][0]=-122.6495
 p['constraints']=[{'id':'wet','geometry':cut,'review_status':'accepted','label':'Reviewed exclusion'}]
 result=envelope(p)
 assert result['status']=='partial' and result['area_sqft']>0
 assert result['code_checked'] is False
 assert result['gaps']

def test_unreviewed_exclusion_cannot_make_geometry():
 p=project();p['constraints']=[{'geometry':POLY,'review_status':'proposed'}]
 assert envelope(p)['geometry'] is None

def test_empty_remainder_is_conflict_not_legal_denial():
 p=project();p['constraints']=[{'geometry':POLY,'review_status':'accepted'}]
 result=envelope(p)
 assert result['status']=='conflict' and result['area_sqft']==0
 assert result['code_checked'] is False

def test_invalid_geometry_is_explicit():
 p=project();p['geometry']={'type':'Point','coordinates':[-122.65,47.7]}
 assert envelope(p)['status']=='cannot_determine'

def test_impact_does_not_change_original():
 p=project(); before=copy.deepcopy(p)
 assert set(revision_impact(p,{'intent':{'bedrooms':4}})) >= {'S0','W0','D0','C0','B1'}
 assert p==before

def test_projection_excludes_invalidation_cycles():
 pack={'nodes':[{'id':'a'},{'id':'b'}],'edges':[{'source':'a','target':'b','type':'INPUT'},{'source':'b','target':'a','type':'INVALIDATES'}]}
 assert [n['id'] for n in ordered_nodes(pack)]==['a','b']
 pack['edges'][1]['type']='HARD'
 with pytest.raises(ValueError):ordered_nodes(pack)

def test_not_applicable_requires_source_and_expiry_requires_review():
 p=project();p['node_reviews']={'E0':{'applicability':'not_applicable'}}
 result=assess(p,[],[],[],as_of='2026-11-07')
 assert next(n for n in result['nodes'] if n['id']=='E0')['applicability']=='unknown'
 p['accepted_facts']={'f':{'review_status':'accepted','expires_on':'2025-01-01'}}
 result=assess(p,[],[{'id':'f','node_id':'E0'}],[],as_of='2026-11-07')
 assert next(n for n in result['nodes'] if n['id']=='E0')['status']=='review_required'
