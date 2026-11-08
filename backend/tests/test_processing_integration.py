import hashlib
from app.config import Settings
from app.store import SQLiteStore
from app.worker import Worker


def test_reprocessing_reuses_ocr_and_preserves_existing_facts(tmp_path,monkeypatch):
    from app import openai_processing,worker
    db=SQLiteStore(tmp_path/'processing.db')
    content=b'%PDF-fixture'
    d={'id':'d','project_id':'p','sha256':hashlib.sha256(content).hexdigest(),'pages':[{'page':1,'text':'verified text'}],'extractor_version':'native-text-and-tesseract-v1'}
    def no_repeat(*args):raise AssertionError('Cached OCR was repeated')
    monkeypatch.setattr(worker,'extract_in_process',no_repeat)
    def extract(settings,store,document,pages,content=None,is_active=None):
        assert pages[0]['needs_vision']
        return [{'page':1,'quote':'verified text','value':'new proposal','node_id':'B0','evidence_type':'text'}],None
    monkeypatch.setattr(openai_processing,'extract_openai',extract)
    w=Worker(Settings(mode='demo',data_dir=tmp_path,ai_provider='openai'),db)
    w.parse(d,content)
    f=db.records('p','fact')[0];f.update(value='reviewer correction',review_status='accepted');db.save('fact',f)
    w.parse(d,content)
    assert len(db.records('p','fact'))==1
    assert db.records('p','fact')[0]['value']=='reviewer correction'


def test_same_quote_conflicting_values_remain_separate(tmp_path,monkeypatch):
    from app import openai_processing
    db=SQLiteStore(tmp_path/'conflicts.db');content=b'%PDF-fixture'
    d={'id':'d','project_id':'p','sha256':hashlib.sha256(content).hexdigest(),'pages':[{'page':1,'text':'same source'}],'extractor_version':'native-text-and-tesseract-v1'}
    def extract(*args,**kwargs):
        return [{'page':1,'quote':'same source','value':v,'node_id':'B0','evidence_type':'text_quote'} for v in ['interpretation one','interpretation two']],None
    monkeypatch.setattr(openai_processing,'extract_openai',extract)
    Worker(Settings(mode='demo',data_dir=tmp_path,ai_provider='openai'),db).parse(d,content)
    assert len(db.records('p','fact'))==2


def test_lease_renewal_does_not_resurrect_cancelled_job(tmp_path):
    db=SQLiteStore(tmp_path/'lease.db')
    db.save('job',{'id':'j','project_id':'p','status':'running','attempts':1,'lease_until':0})
    assert db.renew_job('j',1)
    assert not db.renew_job('j',2)
    db.cancel('j')
    assert not db.renew_job('j',1)
    assert db.record('j')['status']=='cancelled'
