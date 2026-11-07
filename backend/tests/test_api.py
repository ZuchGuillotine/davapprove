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
