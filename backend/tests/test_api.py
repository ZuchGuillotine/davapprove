import asyncio
import io
import sys
import types
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from app.config import Settings
from app.main import create_app
from app.store import SQLiteStore
from app.worker import Worker

PARCEL={'parcel_number':'01220110052001','address':'Test parcel','jurisdiction':'kitsap_county','geometry':{'type':'Polygon','coordinates':[[[-122.6,47.7],[-122.599,47.7],[-122.599,47.701],[-122.6,47.701],[-122.6,47.7]]]}}

@pytest.fixture
def env(tmp_path,monkeypatch):
    calls=[]
    async def lookup_parcel(number):return {**PARCEL,'parcel_number':number}
    async def discover_records(parcel):return {'candidates':[{'id':'record-a','external_id':'record-a','title':'Septic record','source':'Fixture','access':'automated'},{'id':'record-b','external_id':'record-b','title':'Survey','source':'Fixture','access':'automated'}],'coverage':[{'source':'Fixture','status':'complete','detail':'Synthetic fixture only'}]}
    async def fetch_selected(candidate,max_bytes):
        calls.append(candidate['source_candidate_id']);writer=PdfWriter();writer.add_blank_page(width=100,height=100);out=io.BytesIO();writer.write(out)
        return {'content':out.getvalue(),'filename':'fixture.pdf','source_url':'https://example.test/source'}
    module=types.ModuleType('app.sources');module.lookup_parcel=lookup_parcel;module.discover_records=discover_records;module.fetch_selected=fetch_selected
    monkeypatch.setitem(sys.modules,'app.sources',module)
    settings=Settings(mode='demo',data_dir=tmp_path)
    db=SQLiteStore(tmp_path/'test.sqlite3');client=TestClient(create_app(settings,db));worker=Worker(settings,db)
    return client,db,worker,calls

def new_project(client,user='alice'):
    r=client.post('/api/v1/projects',headers={'X-Demo-User':user},json={'name':'Home','parcel_number':'01220110052001','intent':{'bedrooms':3}})
    assert r.status_code==201,r.text
    return r.json()

def test_cross_project_isolation_and_review_roles(env):
    client,db,worker,calls=env;p=new_project(client)
    assert client.get('/api/v1/projects/'+p['id'],headers={'X-Demo-User':'bob'}).status_code==404
    db.add_member(p['id'],'bob','reviewer')
    assert client.get('/api/v1/projects/'+p['id'],headers={'X-Demo-User':'bob'}).status_code==200
    assert client.post('/api/v1/projects/'+p['id']+'/discover',headers={'X-Demo-User':'bob'}).status_code==403
    assert client.post('/api/v1/projects/'+p['id']+'/comments',headers={'X-Demo-User':'bob'},json={'body':'Please check access.'}).status_code==201

def test_discovery_never_fetches_files_and_selection_only_imports_selected(env,monkeypatch):
    client,db,worker,calls=env;p=new_project(client);base='/api/v1/projects/'+p['id'];headers={'X-Demo-User':'alice'}
    r=client.post(base+'/discover',headers=headers);assert r.status_code==202
    asyncio.run(worker.once());assert calls==[]
    candidates=client.get(base+'/candidates',headers=headers).json()['candidates'];assert len(candidates)==2
    selected=candidates[0]['id']
    result=client.post(base+'/imports',headers=headers,json={'candidate_ids':[selected],'idempotency_key':'first'}).json()
    monkeypatch.setattr(worker,'ocr_page',lambda c,n:'SEPTIC APPROVED test fixture')
    asyncio.run(worker.once());assert calls==['record-a']
    again=client.post(base+'/imports',headers=headers,json={'candidate_ids':[selected],'idempotency_key':'first'}).json()
    assert again['jobs'][0]['id']==result['jobs'][0]['id']
    assert len(db.records(p['id'],'document'))==1
    assert client.get('/api/v1/jobs/'+result['jobs'][0]['id'],headers={'X-Demo-User':'bob'}).status_code==404

def test_revision_conflict_and_accepted_transcription_not_approval(env):
    client,db,worker,calls=env;p=new_project(client);base='/api/v1/projects/'+p['id'];headers={'X-Demo-User':'alice'}
    fid='a42c7df9-a672-4e1f-b005-e0ade03c15d8';db.save('fact',{'id':fid,'project_id':p['id'],'node_id':'E0','value':'Wetland report','review_status':'proposed'})
    body={'expected_revision':1,'intent':{'bedrooms':4},'facts':[{'id':fid,'review_status':'accepted'}]}
    updated=client.post(base+'/revisions',headers=headers,json=body);assert updated.status_code==200
    assert updated.json()['current_revision']==2
    assert client.post(base+'/revisions',headers=headers,json=body).status_code==409
    a=client.get(base+'/assessment',headers=headers).json()
    wetland=next(n for n in a['nodes'] if n['id']=='E0')
    assert wetland.get('decision','unknown')!='approved'
    assert a['envelope']['status'] in ('cannot_determine','partial')
    assert len(db.records(p['id'],'revision'))==2

def test_wrong_project_candidate_and_fake_review_rejected(env):
    client,db,worker,calls=env;p=new_project(client);q=new_project(client);headers={'X-Demo-User':'alice'}
    db.save('candidate',{'id':'foreign','project_id':q['id'],'title':'Foreign'})
    base='/api/v1/projects/'+p['id']
    assert client.post(base+'/imports',headers=headers,json={'candidate_ids':['foreign'],'idempotency_key':'x'}).status_code==400
    assert client.post(base+'/revisions',headers=headers,json={'expected_revision':1,'facts':[{'id':'foreign','review_status':'accepted'}]}).status_code==400

def test_upload_validation_and_private_files(env):
    client,db,worker,calls=env;p=new_project(client);headers={'X-Demo-User':'alice'};base='/api/v1/projects/'+p['id']
    bad=client.post(base+'/uploads',headers=headers,files={'file':('bad.pdf',b'not a PDF','application/pdf')});assert bad.status_code==415
    writer=PdfWriter();writer.add_blank_page(width=100,height=100);out=io.BytesIO();writer.write(out)
    r=client.post(base+'/uploads',headers=headers,files={'file':('good.pdf',out.getvalue(),'application/pdf')});assert r.status_code==201
    did=r.json()['id'];assert client.get(base+'/documents/'+did+'/file',headers={'X-Demo-User':'bob'}).status_code==404
    assert client.get(base+'/documents/'+did+'/file',headers=headers).content.startswith(b'%PDF-')

def test_production_rejects_demo_identity(tmp_path):
    settings=Settings(mode='supabase',data_dir=tmp_path)
    client=TestClient(create_app(settings))
    assert client.get('/api/v1/projects',headers={'X-Demo-User':'alice'}).status_code==401

def test_document_path_traversal_rejected_in_api_and_worker(env):
    client,db,worker,calls=env;p=new_project(client);did='2589dca4-dd60-4325-9fc3-f3fe86140d7d'
    d={'id':did,'project_id':p['id'],'title':'forged.pdf','storage_path':p['id']+'/../other/'+did+'.pdf'}
    db.save('document',d)
    assert client.get('/api/v1/projects/'+p['id']+'/documents/'+did+'/file',headers={'X-Demo-User':'alice'}).status_code==404
    with pytest.raises(ValueError,match='canonical'):worker.load_file(d)

def test_upload_completion_is_idempotent(env):
    client,db,worker,calls=env;p=new_project(client);headers={'X-Demo-User':'alice'};base='/api/v1/projects/'+p['id'];did='b142df25-9e1b-426c-ac96-25c0649dff2d'
    body={'id':did,'filename':'record.pdf'}
    assert client.post(base+'/upload-complete',headers=headers,json=body).status_code==201
    jobs=db.records(p['id'],'job');assert len(jobs)==1
    jobs[0]['status']='completed';db.save('job',jobs[0])
    assert client.post(base+'/upload-complete',headers=headers,json=body).status_code==201
    again=db.records(p['id'],'job');assert len(again)==1 and again[0]['status']=='completed'

def test_email_delivery_requires_explicit_configuration(tmp_path):
    client=TestClient(create_app(Settings(mode='demo',data_dir=tmp_path,email_delivery_enabled=False)))
    assert client.get('/api/v1/config').json()['email_delivery_enabled'] is False
    configured=TestClient(create_app(Settings(mode='demo',data_dir=tmp_path,email_delivery_enabled=True)))
    assert configured.get('/api/v1/config').json()['email_delivery_enabled'] is True

def test_missing_production_configuration_reports_degraded(tmp_path):
    client=TestClient(create_app(Settings(mode='supabase',data_dir=tmp_path,supabase_url='',publishable_key='')))
    assert client.get('/health').json()['status']=='degraded'


def test_document_processing_resume_requires_project_access(env):
    client,db,worker,_=env;p=new_project(client);pid=p['id'];did='6dac491e-d535-401b-90bc-95c34ab86edc'
    db.save('document',{'id':did,'project_id':pid,'status':'needs_review'})
    path=f'/api/v1/projects/{pid}/documents/{did}/process'
    assert client.post(path,headers={'X-Demo-User':'bob'}).status_code==404
    db.add_member(pid,'bob','reviewer')
    assert client.post(path,headers={'X-Demo-User':'bob'}).status_code==403
    a=client.post(path,headers={'X-Demo-User':'alice'});b=client.post(path,headers={'X-Demo-User':'alice'})
    assert a.status_code==202 and a.json()['id']==b.json()['id']


def test_review_retroactively_classifies_540_existing_facts_without_writes(env):
    client, db, worker, calls = env
    p = new_project(client)
    for i in range(540):
        db.save('fact', {'id': f'legacy-{i}', 'project_id': p['id'],
                         'value': 'Wetland buffer' if i < 100 else 'Electrical invoice',
                         'review_status': 'proposed'})
    before = db.records(p['id'], 'fact')
    url = '/api/v1/projects/' + p['id'] + '/review'
    first = client.get(url, headers={'X-Demo-User': 'alice'})
    assert first.status_code == 200
    facts = first.json()['facts']
    assert len(facts) == 540
    assert sum(f['classification']['bucket'] == 'review_now' for f in facts) == 100
    assert sum(f['classification']['bucket'] == 'later' for f in facts) == 440
    assert client.get(url, headers={'X-Demo-User': 'alice'}).json() == first.json()
    assert db.records(p['id'], 'fact') == before
    assert calls == []


def test_project_rename_preserves_design_and_requires_editor(env):
    client,db,_,_=env;p=new_project(client);url='/api/v1/projects/'+p['id'];headers={'X-Demo-User':'alice'}
    renamed=client.patch(url,headers=headers,json={'name':'  Smith residence  '})
    assert renamed.status_code==200
    assert renamed.json()['name']=='Smith residence'
    assert renamed.json()['current_revision']==p['current_revision']
    assert client.get(url,headers=headers).json()['name']=='Smith residence'
    assert len(db.records(p['id'],'revision'))==1
    for name in ('','   ','x'*161):
        assert client.patch(url,headers=headers,json={'name':name}).status_code==422
    assert client.patch(url,headers={'X-Demo-User':'bob'},json={'name':'Other'}).status_code==404
    db.add_member(p['id'],'bob','reviewer')
    assert client.patch(url,headers={'X-Demo-User':'bob'},json={'name':'Other'}).status_code==403
    db.add_member(p['id'],'bob','editor')
    assert client.patch(url,headers={'X-Demo-User':'bob'},json={'name':'Builder project'}).status_code==200


def test_project_rename_browser_preflight(env):
    client,_,_,_=env
    origin=Settings().cors_origins.split(',')[0]
    response=client.options('/api/v1/projects/example',headers={
        'Origin':origin,
        'Access-Control-Request-Method':'PATCH',
        'Access-Control-Request-Headers':'authorization,content-type',
    })
    assert response.status_code==200
    assert response.headers['access-control-allow-origin']==origin
    assert 'PATCH' in response.headers['access-control-allow-methods']

def test_sheet_alignment_preview_save_isolation_and_stale_revision(env):
 from test_alignment import fixture
 client,db,worker,calls=env;p=new_project(client);state,docs=fixture()
 for d in docs:db.save('document',{**d,'project_id':p['id']})
 base='/api/v1/projects/'+p['id'];headers={'X-Demo-User':'alice'}
 body={'expected_revision':1,'alignment':state}
 assert client.post(base+'/alignment/preview',headers={'X-Demo-User':'bob'},json=body).status_code==404
 db.add_member(p['id'],'bob','reviewer')
 assert client.post(base+'/alignment',headers={'X-Demo-User':'bob'},json=body).status_code==403
 result=client.post(base+'/alignment/preview',headers=headers,json=body)
 assert result.status_code==200,result.text
 assert db.project(p['id'])['current_revision']==1
 result=client.post(base+'/alignment',headers=headers,json=body)
 assert result.status_code==200,result.text
 assert result.json()['current_revision']==2
 assert result.json()['alignment']['registrations'][0]['reviewer']=='alice'
 assert client.post(base+'/alignment',headers=headers,json=body).status_code==409
 assert db.records(p['id'],'revision')[-1]['snapshot']['alignment']


def test_page_preview_cross_project_and_cache(env):
 client,db,worker,calls=env;p=new_project(client);did='2589dca4-dd60-4325-9fc3-f3fe86140d7d'
 db.save('document',{'id':did,'project_id':p['id'],'sha256':'a'*64,'page_count':1,'storage_path':p['id']+'/'+did+'.pdf'})
 url='/api/v1/projects/'+p['id']+'/documents/'+did+'/pages/1/image'
 assert client.get(url,headers={'X-Demo-User':'bob'}).status_code==404
 cache=worker.settings.data_dir/'page-previews'/('a'*64+'-1-1600-v1.png');cache.parent.mkdir();cache.write_bytes(b'PNG fixture')
 assert client.get(url,headers={'X-Demo-User':'alice'}).content==b'PNG fixture'
 assert client.get(url.replace('/pages/1/','/pages/2/'),headers={'X-Demo-User':'alice'}).status_code==422


def test_page_preview_renders_and_reuses_pdf_cache(env):
 import shutil,hashlib
 if not shutil.which('pdftoppm'):pytest.skip('Poppler unavailable')
 client,db,worker,calls=env;p=new_project(client)
 did='4589dca4-dd60-4325-9fc3-f3fe86140d7d';key=p['id']+'/'+did+'.pdf'
 writer=PdfWriter();writer.add_blank_page(width=200,height=100);out=io.BytesIO();writer.write(out);data=out.getvalue()
 path=worker.settings.data_dir/'files'/key;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
 db.save('document',{'id':did,'project_id':p['id'],'storage_path':key,'page_count':1,'sha256':hashlib.sha256(data).hexdigest()})
 url='/api/v1/projects/'+p['id']+'/documents/'+did+'/pages/1/image'
 first=client.get(url,headers={'X-Demo-User':'alice'})
 assert first.status_code==200 and first.content.startswith(b'\x89PNG')
 path.unlink()
 assert client.get(url,headers={'X-Demo-User':'alice'}).content==first.content
