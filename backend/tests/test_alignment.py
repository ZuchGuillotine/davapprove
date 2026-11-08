import copy
import math
import pytest
from app.alignment import alignment_state, fingerprint, registered_layers
from app.drawings import TO_LOCAL


def fixture():
 x,y=TO_LOCAL.transform(-122.65,47.7)
 # Known rotated, translated, scaled sheet with an independent fourth corner.
 coords=[[0,0],[1,0],[0,1],[1,1]]
 ref={'id':'ref','label':'Survey A','kind':'survey','crs':'EPSG:2285','document_id':'survey','document_sha256':'a'*64,'page':1,'source_revision':'A','accuracy_ft':.2,
      'points':[{'id':str(i),'label':str(i),'coordinates':[x+100*p[0]-20*p[1],y+20*p[0]+100*p[1]]} for i,p in enumerate(coords)]}
 reg={'id':'sheet','document_id':'civil','document_sha256':'b'*64,'page':1,'reference_id':'ref','reference_fingerprint':fingerprint(ref),
      'discipline':'civil','design_revision':'B','sheet_height':1,'tolerance_ft':1,'review_status':'proposed',
      'pairs':[{'point_id':str(i),'sheet':p,'use':'check' if i==3 else 'fit'} for i,p in enumerate(coords)]}
 docs=[{'id':'survey','sha256':'a'*64,'page_count':1},{'id':'civil','sha256':'b'*64,'page_count':1}]
 return {'reference':ref,'registrations':[reg]},docs


def test_exact_transform_and_holdout_errors():
 s,d=fixture();out=alignment_state(s,d)['registrations'][0]
 assert out['status']=='proposed'
 assert out['transform']['real']==pytest.approx(100)
 assert out['transform']['imag']==pytest.approx(20)
 assert out['fit_rms_ft']<1e-7 and out['check_max_ft']<1e-7
 assert len(out['image_corners'])==3


def test_independent_error_cannot_be_hidden_by_perfect_fit():
 s,d=fixture();s['registrations'][0]['pairs'][3]['sheet']=[1.1,1]
 out=alignment_state(s,d)['registrations'][0]
 assert out['status']=='needs_review' and out['check_max_ft']>10
 assert out['fit_rms_ft']<1e-7


def test_reference_and_document_change_invalidate_original_registration():
 s,d=fixture();before=copy.deepcopy(s)
 s['reference']['points'][0]['coordinates'][0]+=1
 assert alignment_state(s,d)['registrations'][0]['transform'] is None
 s=before;d[1]['sha256']='c'*64
 assert alignment_state(s,d)['registrations'][0]['transform'] is None


def test_geometry_is_derived_without_changing_original_or_accepting_features():
 s,d=fixture();layer={'document_id':'civil','page':1,'sheet_geometry':{'type':'LineString','coordinates':[[0,0],[.5,.5]]},'review_status':'proposed'}
 before=copy.deepcopy(layer)
 result=registered_layers([layer],alignment_state(s,d))[0]
 assert result['geometry']['type']=='LineString' and result['calibration']=='registered_proposal'
 assert layer==before and result['review_status']=='proposed'
 s['registrations'][0]['review_status']='accepted'
 assert registered_layers([layer],alignment_state(s,d))[0]['calibration']=='reviewer_confirmed'
 s['reference']['accuracy_ft']=None;s['registrations'][0]['reference_fingerprint']=fingerprint(s['reference'])
 assert registered_layers([layer],alignment_state(s,d))[0]['calibration']=='registered_proposal'


def test_no_stretch_to_fit_mirrored_or_collinear_controls():
 s,d=fixture();s['registrations'][0]['pairs'][2]['sheet']=[0,-1]
 assert alignment_state(s,d)['registrations'][0]['status']=='needs_review'
 s,d=fixture();s['registrations'][0]['pairs'][2]['sheet']=[2,0]
 assert alignment_state(s,d)['registrations'][0]['transform'] is None


def test_reference_validation_duplicates_crs_and_wrong_document():
 for key,val in [('crs','EPSG:9999'),('document_id','foreign'),('accuracy_ft',float('nan'))]:
  s,d=fixture();s['reference'][key]=val
  with pytest.raises(ValueError):alignment_state(s,d)
 s,d=fixture();s['registrations'].append(copy.deepcopy(s['registrations'][0]))
 with pytest.raises(ValueError):alignment_state(s,d)


def test_invalid_feature_does_not_break_other_registered_layers():
 s,d=fixture()
 result=registered_layers([{'document_id':'civil','page':1,'sheet_geometry':{'type':'Bogus'}}],alignment_state(s,d))
 assert result[0]['geometry'] is None
 assert result[0]['calibration']=='needs_review'


def test_envelope_requires_both_alignment_and_feature_acceptance():
 from app.evaluation import envelope
 from app.drawings import TO_WEB
 s,d=fixture();x,y=TO_LOCAL.transform(-122.65,47.7)
 boundary={'type':'Polygon','coordinates':[[TO_WEB.transform(x+u,y+v) for u,v in [(-50,-50),(200,-50),(200,200),(-50,200),(-50,-50)]]]}
 fact={'id':'f','key':'site_geometry','document_id':'civil','page':1,'value':{'label':'Septic','role':'exclusion','sheet_geometry':{'type':'Polygon','coordinates':[[[0,0],[.2,0],[.2,.2],[0,.2],[0,0]]]}}}
 p={'alignment':s,'parcel':{'geometry':boundary},'accepted_facts':{'f':{'review_status':'accepted'}}}
 out=envelope(p,[fact],d)
 assert len(out['layers'])==1 and not out['constraints']
 s['registrations'][0]['review_status']='accepted'
 assert len(envelope(p,[fact],d)['constraints'])==1
 p['accepted_facts']={}
 assert not envelope(p,[fact],d)['constraints']
 s['reference']['points'][0]['coordinates'][0]+=10
 assert not envelope(p,[fact],d)['layers']
