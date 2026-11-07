from app.ai import extract
from app.config import Settings
from app.store import SQLiteStore

def test_budget_reservations_are_idempotent_and_bounded(tmp_path):
    db=SQLiteStore(tmp_path/'test.db')
    assert db.reserve_ai('a','2026-11',3000000,5000000)
    assert not db.reserve_ai('a','2026-11',3000000,5000000)
    assert not db.reserve_ai('b','2026-11',3000000,5000000)
    db.reconcile_ai('a',1000000)
    assert db.reserve_ai('b','2026-11',3000000,5000000)
    assert not db.reserve_ai('c','2026-11',2000000,999999999)

def test_no_ai_key_means_no_call_and_clear_warning(tmp_path):
    db=SQLiteStore(tmp_path/'test.db')
    facts,warning=extract(Settings(mode='demo'),db,{'id':'doc'},[{'page':1,'text':'approved'}])
    assert not facts and 'disabled' in warning

def test_invalid_citations_rejected_and_cost_reconciled(tmp_path,monkeypatch):
    from app import ai
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':'{"facts":[{"page":1,"quote":"REAL","value":"REAL","node_id":"E0"},{"page":2,"quote":"invented","value":"approved","node_id":"E0"}]}'}}],'usage':{'prompt_tokens':100,'completion_tokens':100}}
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,*args,**kwargs):return Response()
    monkeypatch.setattr(ai.httpx,'Client',Client)
    settings=Settings(mode='demo',ai_api_key='test',ai_model='fixture',ai_input_per_million=1,ai_output_per_million=2)
    db=SQLiteStore(tmp_path/'test.db')
    facts,warning=extract(settings,db,{'id':'d'},[{'page':1,'text':'REAL text'}])
    assert len(facts)==1 and facts[0]['quote']=='REAL' and not warning
    assert db.db.execute('select amount from ai_usage').fetchone()[0]==300
