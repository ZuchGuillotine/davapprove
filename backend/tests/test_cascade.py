import copy
from types import SimpleNamespace
import pytest
from app import cascade as c
from app.store import SQLiteStore
from app.classification import classify_review


def setup(tmp_path):
    return SimpleNamespace(typesafe_api_key='test',openai_api_key='test',ai_monthly_usd=25),SQLiteStore(tmp_path/'db'),{'id':'doc','project_id':'project','sha256':'hash'}


def fake_client(monkeypatch,payload,fail=False):
    calls=[]
    class R:
        def raise_for_status(self): pass
        def json(self): return payload
    class C:
        def __init__(self,**kwargs): assert kwargs['follow_redirects'] is False
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,**kwargs):
            calls.append(kwargs['json'])
            if fail: raise c.httpx.ReadTimeout('unknown billing')
            return R()
    monkeypatch.setattr(c.httpx,'Client',C)
    return calls


def test_shared_budget_cache_and_reasoning_usage(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    calls=fake_client(monkeypatch,{'usage':{'input_tokens':100,'output_tokens':50},'model':c.SOL,'status':'completed'})
    req={'model':c.SOL,'max_output_tokens':100,'reasoning':{'effort':'low'}}
    _,row=c.billable_call(s,db,d,'sol','test',req)
    assert row['actual_microusd']==700
    c.billable_call(s,db,d,'sol','test',req)
    assert len(calls)==1
    req['reasoning']['effort']='medium'
    c.billable_call(s,db,d,'sol','test',req)
    assert len(calls)==2
    assert db.db.execute('select sum(amount) from ai_usage').fetchone()[0]==1400


def test_uncertain_call_not_repeated(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path);calls=fake_client(monkeypatch,{},True)
    for _ in range(2):
        with pytest.raises(c.Paused):c.billable_call(s,db,d,'sol','test',{'model':c.SOL,'max_output_tokens':100})
    assert len(calls)==1


def test_budget_exhaustion_no_provider_call(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path);s.ai_monthly_usd=0;calls=fake_client(monkeypatch,{})
    with pytest.raises(c.Paused,match='budget'):c.billable_call(s,db,d,'jev','test',{'model':c.JEV})
    assert calls==[]


def test_question_schema_fail_closed(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    fake_client(monkeypatch,{'answers':{'a':{'choice':'yes','probabilities':{'yes':float('nan')}}}})
    with pytest.raises(c.Paused):c.decisions(s,db,d,{}, {'a':c.choice('test',{'yes':'yes'})},'test')


def test_machine_resolution_and_human_override_and_old_versions():
    facts=[{'id':'a','document_id':'d','pipeline':c.VERSION,'value':'setback','machine_validation':{'status':'validated'}},
           {'id':'b','document_id':'d','value':'old setback','pipeline':'old'}]
    docs=[{'id':'d','active_extraction_pipeline':c.VERSION}]
    r={f['id']:f['classification'] for f in classify_review({},facts,docs)}
    assert r['a']['bucket']=='resolved' and r['a']['authority']=='unverified'
    assert r['b']['bucket']=='history'
    r=classify_review({'accepted_facts':{'b':{'review_status':'accepted'}}},facts,docs)
    assert next(f for f in r if f['id']=='b')['classification']['bucket']=='resolved'


def test_conflicts_scoped_to_entity_revision():
    f={'pipeline':c.VERSION,'entity':'House A','property':'width','scope':'layout','revision':'R1','temporal_role':'current_proposal','machine_validation':{'status':'validated'}}
    facts=[{**f,'id':'a','value':'20 ft'},{**f,'id':'b','value':'25 ft','entity':'House B'}]
    assert all(not x['classification']['conflict'] for x in classify_review({},facts,[]))
    facts[1]['entity']='House A'
    assert all(x['classification']['bucket']=='review_now' for x in classify_review({},facts,[]))


def test_verifier_cannot_promote_geometry(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    f={'value':{'sheet_geometry':{'type':'Polygon'}},'evidence_type':'visual_observation'}
    c.verify(s,db,d,{'page':1,'text':''},[f])
    assert f['use_eligibility']=='provisional_scenario'
    assert f['machine_validation']['status']=='needs_review'


def test_scoped_replacement_keeps_other_constraints_and_reviews():
    common={'entity':'building 1','property':'width','scope':'layout','permit_id':'P1','agency':'County','jurisdiction':'Kitsap','pipeline':c.VERSION}
    old={**common,'id':'old','revision':'A','issued_date':'2025-01-01','value':'20 ft'}
    new={**common,'id':'new','revision':'B','issued_date':'2025-02-01','value':'22 ft','supersedes_revision':'A','quote':'Replaces revision A','machine_validation':{'status':'validated'}}
    easement={**old,'id':'easement','property':'easement','value':'easement retained'}
    result={f['id']:f['classification'] for f in classify_review({},[old,new,easement],[])}
    assert result['old']['bucket']=='history'
    assert result['easement']['bucket']!='history'
    r=classify_review({'accepted_facts':{'old':{'review_status':'accepted'}}},[old,new],[])
    assert next(f for f in r if f['id']=='old')['classification']['bucket']=='resolved'
    new['issued_date']='2024-01-01'
    assert next(f for f in classify_review({},[old,new],[]) if f['id']=='old')['classification']['bucket']!='history'


def test_billed_cache_write_and_reasoning_are_included(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    fake_client(monkeypatch,{'usage':{'input_tokens':1000,'input_tokens_details':{'cache_write_tokens':800,'cached_tokens':100},'output_tokens':100,'output_tokens_details':{'reasoning_tokens':80}}})
    _,row=c.billable_call(s,db,d,'sol','test',{'model':c.SOL,'max_output_tokens':100})
    assert row['actual_microusd']==3210


def test_all_pages_accounted_and_activation_deferred_until_facts_saved(tmp_path,monkeypatch):
    import hashlib
    s,db,d=setup(tmp_path);d.update(sha256=hashlib.sha256(b'pdf').hexdigest(),page_count=2)
    def route(*args,**kwargs):
        return {'role':{'choice':'unknown','probabilities':{'unknown':1}}}, {'id':'routing'}
    monkeypatch.setattr(c,'decisions',route)
    monkeypatch.setattr(c,'extract_page',lambda *a,**k: ([],{'saturated':False,'rejected':0,'issues':[]},{'id':'extract'}))
    monkeypatch.setattr(c,'verify',lambda *a:None)
    facts,warning=c.extract_cascade(s,db,d,[{'page':1,'text':'some'},{'page':2,'text':'other'}],b'pdf')
    assert warning is None and d['ai_processing']['processed_pages']==2
    assert d['pending_extraction_pipeline']==c.VERSION and 'active_extraction_pipeline' not in d
    d.pop('pending_extraction_pipeline')
    facts,warning=c.extract_cascade(s,db,d,[{'page':1,'text':'some'}],b'pdf')
    assert warning and len(d['ai_processing']['page_manifest'])==2
    assert 'pending_extraction_pipeline' not in d


def test_reprocessing_cannot_bypass_prior_human_rejection():
    old={'id':'old','document_id':'d','page':1,'quote':'source','value':'old'}
    new={**old,'id':'new','value':'new','pipeline':c.VERSION,'machine_validation':{'status':'validated'}}
    result=classify_review({'accepted_facts':{'old':{'review_status':'rejected'}}},[old,new],[{'id':'d','active_extraction_pipeline':c.VERSION}])
    n=next(f for f in result if f['id']=='new')
    assert n['classification']['bucket']=='review_now'
    assert n['machine_validation']['status']=='human_override_exists'
    assert new['machine_validation']['status']=='validated'


def test_whitespace_citation_repair_does_not_change_numbers(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    candidate={'page':1,'quote':'20 ft','value':'Setback is 20 ft','node_id':'B0','evidence_type':'text_quote','region':None,'confidence':'high','drawing':None}
    def respond(*args,**kwargs):
        return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':c.json.dumps({'facts':[candidate],'issues':[],'saturated':False})}]}]}, {'id':'request'}
    monkeypatch.setattr(c,'billable_call',respond)
    facts,summary,_=c.extract_page(s,db,d,{'page':1,'text':'Setback 20\n ft'},b'pdf','text')
    assert facts[0]['quote']=='20\n ft' and summary['rejected']==0
    candidate['quote']='21 ft'
    facts,summary,_=c.extract_page(s,db,d,{'page':1,'text':'Setback 20\n ft'},b'pdf','text')
    assert not facts and summary['rejected']==1


def test_reasoning_verifier_requires_all_fields_and_exact_citation(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    verdict={'id':0,'claim_supported':True,'identity_supported':True,'lineage_supported':True,'source_readable':True,'confidence':'high','reason':'Explicit in source'}
    def respond(*args,**kwargs):
        return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':c.json.dumps({'verdicts':[verdict]})}]}]}, {'id':'verification'}
    monkeypatch.setattr(c,'billable_call',respond)
    original={'value':'Setback is 20 ft','quote':'20 ft','evidence_type':'text_quote','machine_validation':{'status':'needs_review'}}
    f=copy.deepcopy(original)
    c.verify_uncertain(s,db,d,{'page':1,'text':'20 ft'},[f])
    assert f['machine_validation']['status']=='validated' and f['machine_validation']['prior']['status']=='needs_review'
    for field in ('claim_supported','identity_supported','lineage_supported','source_readable'):
        verdict[field]=False;f=copy.deepcopy(original)
        c.verify_uncertain(s,db,d,{'page':1,'text':'20 ft'},[f])
        assert f['machine_validation']['status']=='needs_review'
        verdict[field]=True
    f=copy.deepcopy(original)
    c.verify_uncertain(s,db,d,{'page':1,'text':'21 ft'},[f])
    assert f['machine_validation']['status']=='needs_review'


def test_reasoning_verification_cannot_promote_geometry_or_lose_extraction(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path);calls=[]
    def fail(*a,**k):calls.append(1);raise c.Paused('budget unavailable')
    monkeypatch.setattr(c,'billable_call',fail)
    geometry={'value':{'sheet_geometry':{}},'evidence_type':'visual_observation','machine_validation':{'status':'needs_review'}}
    text={'value':'20 ft','quote':'20 ft','evidence_type':'text_quote','machine_validation':{'status':'needs_review'}}
    c.verify_uncertain(s,db,d,{'page':1,'text':'20 ft'},[geometry,text])
    assert calls==[1] and geometry['machine_validation']['status']=='needs_review'
    assert text['value']=='20 ft' and text['verification_exception']['reason']=='budget unavailable'


def test_reasoning_verifier_rejects_missing_or_duplicate_ids(tmp_path,monkeypatch):
    s,db,d=setup(tmp_path)
    monkeypatch.setattr(c,'billable_call',lambda *a,**k: ({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"verdicts":[]}'}]}]},{'id':'v'}))
    f={'value':'20 ft','quote':'20 ft','evidence_type':'text_quote','machine_validation':{'status':'needs_review'}}
    c.verify_uncertain(s,db,d,{'page':1,'text':'20 ft'},[f])
    assert f['machine_validation']['status']=='needs_review' and 'IDs' in f['verification_exception']['reason']


def test_partial_document_retires_only_completed_page_extractions():
    docs=[{'id':'d','active_extraction_pages':{'pipeline':c.VERSION,'pages':[1]}}]
    facts=[{'id':'old1','document_id':'d','page':1,'value':'old'},
           {'id':'old2','document_id':'d','page':2,'value':'old'},
           {'id':'new1','document_id':'d','page':1,'value':'new','pipeline':c.VERSION}]
    result={f['id']:f['classification'] for f in classify_review({},facts,docs)}
    assert result['old1']['bucket']=='history'
    assert result['old2']['bucket']!='history' and result['new1']['bucket']!='history'


def test_pending_automation_is_not_a_manual_review_or_resolution():
    f={'id':'f','document_id':'d','pipeline':c.VERSION,'value':'20 ft','machine_validation':{'status':'needs_review'},'verification_exception':{'reason':'Shared AI budget unavailable'}}
    result=classify_review({},[f],[])[0]
    assert result['classification']['bucket']=='processing_pending'
    result=classify_review({'accepted_facts':{'f':{'review_status':'accepted'}}},[f],[])[0]
    assert result['classification']['bucket']=='resolved'
