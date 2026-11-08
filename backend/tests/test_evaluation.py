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
 assert first['rule_version']=='2026-11-07.2'

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

def test_discipline_conflicts_preserve_proposals():
 p=project()
 p['constraints']=[{'id':'s','label':'Septic reserve','discipline':'septic','geometry':POLY,'review_status':'accepted','role':'exclusion'}, {'id':'c','label':'Civil layout','discipline':'civil','geometry':POLY,'review_status':'proposed','role':'design'}]
 result=envelope(p)
 assert len(result['layers'])==2
 assert len(result['constraints'])==1
 assert result['spatial_conflicts'][0]['layer_ids']==['s','c']
 assert result['spatial_conflicts'][0]['area_sqft']>0
 # Hiding layers is presentation only; overlapping exclusions are not contradictions.
 p['constraints'][1]['role']='exclusion'
 assert not envelope(p)['spatial_conflicts']

def test_fact_geometry_requires_calibration_and_acceptance():
 p=project()
 fact={'id':'f','key':'site_geometry','document_id':'doc','page':2,'value':{'label':'Drainfield','geometry':POLY,'role':'exclusion','discipline':'septic'}}
 p['accepted_facts']={'f':{'review_status':'accepted'}}
 assert envelope(p,[fact])['geometry'] is None
 fact['value'].update(crs='EPSG:4326',calibration='reviewer_confirmed')
 assert envelope(p,[fact])['status']=='conflict'
 p['accepted_facts']['f']['review_status']='proposed'
 result=envelope(p,[fact])
 assert result['geometry'] is None and len(result['layers'])==1
 p['accepted_facts']['f']['review_status']='rejected'
 assert not envelope(p,[fact])['layers']

def test_utility_evidence_is_inspectable_without_promoting_legacy_or_proposed_facts():
 p=project()
 facts=[{'id':'legacy','node_id':'C0','document_id':'d','value':'PSE installed electrical lines'},
        {'id':'new','node_id':'X0','document_id':'d','value':'Service application'}]
 p['accepted_facts']={'legacy':{'review_status':'accepted'}}
 result=assess(p,[{'id':'d'}],facts,[])
 node=next(n for n in result['nodes'] if n['id']=='X0')
 assert node['related_evidence_ids']==['legacy','new']
 assert node['document_ids']==['d']
 assert node['evidence_ids']==[]
 assert node['status']=='unknown' and node['decision']=='unknown'
 assert any(e['source']=='X0' and e['target']=='D0' and e['type']=='RECOMMENDED' for e in result['edges'])

def test_draft_road_visible_without_changing_envelope():
 p=project()
 p['constraints']=[{'id':'road','label':'Partial road','role':'design','discipline':'civil',
  'review_status':'proposed','geometry':{'type':'LineString','coordinates':[[-122.65,47.7],[-122.6495,47.7005]]}}]
 r=envelope(p)
 assert len(r['layers'])==1 and r['geometry'] is None and not r['constraints']
