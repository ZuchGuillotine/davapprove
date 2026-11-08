import asyncio
import hashlib
import re
import uuid
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, Depends, Header, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from .config import Settings
from .store import SQLiteStore,SupabaseStore,NotFound,Conflict,now,ident
from .evaluation import assess, revision_impact

class ProjectInput(BaseModel):
    name:str=Field(default='Untitled project',min_length=1,max_length=160)
    parcel_number:str
    intent:dict[str,Any]=Field(default_factory=dict)
    parcel:dict[str,Any]|None=None
class LookupInput(BaseModel):parcel_number:str
class ImportInput(BaseModel):
    candidate_ids:list[str]=Field(max_length=100)
    idempotency_key:str=Field(min_length=1,max_length=128)
class RevisionInput(BaseModel):
    expected_revision:int=Field(ge=1)
    intent:dict[str,Any]|None=None
    facts:list[dict[str,Any]]=Field(default_factory=list)
    geometry:dict[str,Any]|None=None
    notes:str=Field(default='',max_length=5000)
    constraints:list[dict[str,Any]]|None=None
    setbacks:list[dict[str,Any]]|None=None
    boundary_reviewed:bool|None=None
    node_reviews:dict[str,Any]|None=None
class CommentInput(BaseModel):
    body:str=Field(min_length=1,max_length=10000)
    revision:int|None=None
    node_id:str|None=None
    document_id:str|None=None
class MemberInput(BaseModel):
    user_id:uuid.UUID
    role:str=Field(pattern='^(editor|reviewer)$')
class UploadInput(BaseModel):
    filename:str=Field(min_length=1,max_length=255)
    size:int=Field(gt=0)


def create_app(settings=None,store=None):
    settings=settings or Settings()
    if settings.mode not in ('demo','supabase'):raise RuntimeError('DAVAPPROVE_MODE must be demo or supabase')
    demo_store=store or (SQLiteStore(settings.data_dir/'demo.sqlite3') if settings.mode=='demo' else None)
    app=FastAPI(title='Davapprove API',version='0.1.0')
    app.state.settings=settings;app.state.store=demo_store
    app.add_middleware(CORSMiddleware,allow_origins=settings.cors_origins.split(','),allow_credentials=False,allow_methods=['GET','POST','OPTIONS'],allow_headers=['Authorization','Content-Type','X-Demo-User'])
    @app.exception_handler(NotFound)
    async def missing(request,exc):return JSONResponse(status_code=404,content={'detail':'Not found or not authorized'})
    @app.exception_handler(Conflict)
    async def conflict(request,exc):return JSONResponse(status_code=409,content={'detail':'Project changed. Reload the current revision before saving.'})
    @app.get('/health')
    def health():
        configured=settings.mode=='demo' or bool(settings.supabase_url and settings.publishable_key)
        return {'status':'ok' if configured else 'degraded','mode':settings.mode,'configured':configured}
    @app.get('/api/v1/config')
    def config():return {'mode':settings.mode,'supabase_url':settings.supabase_url,'publishable_key':settings.publishable_key,'max_pdf_bytes':settings.max_pdf_bytes,'email_delivery_enabled':settings.email_delivery_enabled,'notice':'Synthetic demo accounts; do not upload private records.' if settings.mode=='demo' else None}
    async def session(authorization:str|None=Header(default=None),x_demo_user:str|None=Header(default=None)):
        if settings.mode=='demo':
            user=x_demo_user or 'demo-user'
            if not re.fullmatch('[A-Za-z0-9_-]{1,80}',user):raise HTTPException(400,'Invalid demo user')
            yield (user,demo_store,None)
            return
        if not authorization or not authorization.startswith('Bearer '):raise HTTPException(401,'Sign in required')
        token=authorization[7:]
        async with httpx.AsyncClient(timeout=15) as client:
            r=await client.get(settings.supabase_url+'/auth/v1/user',headers={'apikey':settings.publishable_key,'Authorization':authorization})
        if r.status_code!=200:raise HTTPException(401,'Session expired or invalid')
        db=SupabaseStore(settings,token)
        try: yield (r.json()['id'],db,token)
        finally: db.client.close()
    def project_for(pid,ctx,write=False):
        user,db,_=ctx;p=db.project(pid,user)
        if write and db.role(pid,user) not in ('owner','editor'):raise HTTPException(403,'Editor access required')
        return p
    def new_job(db,pid,type,**kwargs):
        j={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,pid+':'+kwargs['idempotency_key'])) if kwargs.get('idempotency_key') else ident(),'project_id':pid,'type':type,'status':'queued','stage':'queued','attempts':0,'created_at':now(),**kwargs}
        if kwargs.get('idempotency_key'):
            try:return db.record(j['id'],'job')
            except NotFound:pass
        return db.save('job',j)
    async def lookup(number):
        number=re.sub(r'[\s-]','',number)
        if not re.fullmatch(r'\d{14}',number):raise HTTPException(422,'Enter a 14-digit Kitsap parcel number (dashes allowed).')
        from .sources import lookup_parcel
        try:return await lookup_parcel(number)
        except Exception as exc:
            raise HTTPException(502,'Parcel source unavailable or no matching parcel found. Check the number and retry.') from exc
    @app.post('/api/v1/parcels/lookup')
    async def lookup_route(body:LookupInput,ctx=Depends(session)):return await lookup(body.parcel_number)
    @app.get('/api/v1/projects')
    def projects(ctx=Depends(session)):return {'projects':ctx[1].projects(ctx[0])}
    @app.post('/api/v1/projects',status_code=201)
    async def create_project(body:ProjectInput,ctx=Depends(session)):
        # Resolve from authoritative connector; never trust browser-supplied jurisdiction/geometry.
        parcel=await lookup(body.parcel_number)
        p={'id':ident(),'owner_id':ctx[0],'name':body.name,'parcel_number':re.sub(r'[\s-]','',body.parcel_number),'parcel':parcel,'jurisdiction':parcel.get('jurisdiction','unknown'),'intent':body.intent,'current_revision':1,'accepted_facts':{},'created_at':now()}
        saved=ctx[1].create_project(p,ctx[0])
        if settings.mode=='supabase':new_job(ctx[1],p['id'],'discover')
        return saved
    @app.get('/api/v1/projects/{pid}')
    def project(pid:str,ctx=Depends(session)):return project_for(pid,ctx)
    @app.post('/api/v1/projects/{pid}/members')
    def member(pid:str,body:MemberInput,ctx=Depends(session)):
        project_for(pid,ctx)
        if ctx[1].role(pid,ctx[0])!='owner':raise HTTPException(403,'Owner access required')
        ctx[1].add_member(pid,str(body.user_id),body.role)
        return {'user_id':str(body.user_id),'role':body.role}
    @app.post('/api/v1/projects/{pid}/discover',status_code=202)
    def discover(pid:str,ctx=Depends(session)):
        project_for(pid,ctx,True);db=ctx[1]
        active=[j for j in db.records(pid,'job') if j['type']=='discover' and j['status'] in ('queued','running')]
        return active[0] if active else new_job(db,pid,'discover')
    @app.get('/api/v1/projects/{pid}/candidates')
    def candidates(pid:str,ctx=Depends(session)):
        project_for(pid,ctx);db=ctx[1]
        coverage=db.records(pid,'coverage')
        return {'candidates':db.records(pid,'candidate'),'coverage':coverage,'screening':next((c.get('screening') for c in coverage if c.get('screening')),None)}
    @app.post('/api/v1/projects/{pid}/imports',status_code=202)
    def imports(pid:str,body:ImportInput,ctx=Depends(session)):
        project_for(pid,ctx,True);db=ctx[1]
        available={c['id']:c for c in db.records(pid,'candidate')}
        if any(id not in available for id in body.candidate_ids):raise HTTPException(400,'Candidate is not part of this project')
        existing=db.records(pid,'job');jobs=[]
        for cid in dict.fromkeys(body.candidate_ids):
            key=body.idempotency_key+':'+cid
            prior=next((j for j in existing if j.get('idempotency_key')==key),None)
            jobs.append(prior or new_job(db,pid,'import',candidate_id=cid,idempotency_key=key))
        return {'jobs':jobs}
    @app.get('/api/v1/jobs/{jid}')
    def job(jid:str,ctx=Depends(session)):
        j=ctx[1].record(jid,'job');project_for(j['project_id'],ctx);return j
    @app.post('/api/v1/jobs/{jid}/retry',status_code=202)
    def retry(jid:str,ctx=Depends(session)):
        j=ctx[1].record(jid,'job');project_for(j['project_id'],ctx,True)
        if j['status'] not in ('failed','manual_access'):raise HTTPException(409,'Only failed jobs can be retried')
        return new_job(ctx[1],j['project_id'],j['type'],candidate_id=j.get('candidate_id'),document_id=j.get('document_id'))
    @app.post('/api/v1/jobs/{jid}/cancel')
    def cancel(jid:str,ctx=Depends(session)):
        j=ctx[1].record(jid,'job');project_for(j['project_id'],ctx,True)
        return ctx[1].cancel(jid)
    @app.get('/api/v1/projects/{pid}/documents')
    def documents(pid:str,ctx=Depends(session)):
        project_for(pid,ctx);return {'documents':ctx[1].records(pid,'document')}
    @app.post('/api/v1/projects/{pid}/uploads',status_code=201)
    async def upload(pid:str,file:UploadFile=File(...),ctx=Depends(session)):
        project_for(pid,ctx,True)
        if settings.mode!='demo':raise HTTPException(400,'Use upload-init and resumable direct Storage upload')
        did=ident(); folder=settings.data_dir/'files'/pid;folder.mkdir(parents=True,exist_ok=True)
        path=folder/(did+'.pdf');size=0;digest=hashlib.sha256()
        try:
            with path.open('wb') as out:
                while chunk:=await file.read(1024*1024):
                    size+=len(chunk)
                    if size>settings.max_pdf_bytes:raise HTTPException(413,f'PDF exceeds {settings.max_pdf_bytes // (1024*1024)} MiB upload limit')
                    if size==len(chunk) and not chunk.startswith(b'%PDF-'):raise HTTPException(415,'File must be a PDF')
                    digest.update(chunk);out.write(chunk)
            if not size:raise HTTPException(415,'Empty file')
            d={'id':did,'project_id':pid,'title':Path(file.filename or 'Uploaded document.pdf').name,'storage_path':pid+'/'+did+'.pdf','sha256':digest.hexdigest(),'size':size,'status':'uploaded','created_at':now()}
            for old in ctx[1].records(pid,'document'):
                if old.get('sha256')==d['sha256']:path.unlink();return old
            ctx[1].save('document',d);new_job(ctx[1],pid,'parse',document_id=did,idempotency_key='parse:'+did+':extract-v1');return d
        except Exception:path.unlink(missing_ok=True);raise
    @app.post('/api/v1/projects/{pid}/upload-init')
    def upload_init(pid:str,body:UploadInput,ctx=Depends(session)):
        project_for(pid,ctx,True)
        if body.size>settings.max_pdf_bytes:raise HTTPException(413,'PDF exceeds size limit')
        did=ident();return {'id':did,'bucket':settings.bucket,'path':pid+'/'+did+'.pdf','resumable_endpoint':settings.supabase_url+'/storage/v1/upload/resumable','max_bytes':settings.max_pdf_bytes,'filename':Path(body.filename).name}
    @app.post('/api/v1/projects/{pid}/upload-complete',status_code=201)
    async def upload_complete(pid:str,body:dict,ctx=Depends(session)):
        project_for(pid,ctx,True)
        try:did=str(uuid.UUID(body['id']))
        except (ValueError,KeyError):raise HTTPException(400,'Invalid upload identifier')
        path=pid+'/'+did+'.pdf'
        # Worker verifies bytes/signature/size from private storage before accepting extraction.
        d={'id':did,'project_id':pid,'title':Path(body.get('filename','Uploaded PDF')).name,'storage_path':path,'status':'uploaded','created_at':now()}
        ctx[1].save('document',d);new_job(ctx[1],pid,'parse',document_id=did,idempotency_key='parse:'+did+':extract-v1');return d
    @app.post('/api/v1/projects/{pid}/documents/{did}/process',status_code=202)
    def process_document(pid:str,did:str,ctx=Depends(session)):
        project_for(pid,ctx,True)
        d=ctx[1].record(did,'document')
        if d['project_id']!=pid:raise NotFound()
        for job in ctx[1].records(pid,'job'):
            if job.get('document_id')==did and job.get('type')=='parse' and job.get('status') in ('queued','running'):return job
        return new_job(ctx[1],pid,'parse',document_id=did)
    @app.get('/api/v1/projects/{pid}/documents/{did}/file')
    async def document_file(pid:str,did:str,ctx=Depends(session)):
        project_for(pid,ctx);d=ctx[1].record(did,'document')
        if d['project_id']!=pid:raise NotFound()
        try:expected=str(uuid.UUID(pid))+'/'+str(uuid.UUID(did))+'.pdf'
        except ValueError:raise NotFound()
        if d.get('storage_path')!=expected:raise NotFound()
        if settings.mode=='demo':
            p=settings.data_dir/'files'/d['storage_path']
            if not p.exists():raise NotFound()
            return FileResponse(p,media_type='application/pdf',filename=d['title'])
        async with httpx.AsyncClient(timeout=15) as client:
            r=await client.post(settings.supabase_url+'/storage/v1/object/sign/'+settings.bucket+'/'+d['storage_path'],headers={'apikey':settings.publishable_key,'Authorization':'Bearer '+ctx[2]},json={'expiresIn':300})
        if r.status_code!=200:raise HTTPException(502,'Document not available')
        return {'url':settings.supabase_url+'/storage/v1'+r.json()['signedURL']}
    @app.get('/api/v1/projects/{pid}/review')
    def review(pid:str,ctx=Depends(session)):
        p=project_for(pid,ctx);facts=ctx[1].records(pid,'fact')
        return {'facts':[{**f,**p.get('accepted_facts',{}).get(f['id'],{})} for f in facts]}
    @app.post('/api/v1/projects/{pid}/revisions')
    def revision(pid:str,body:RevisionInput,ctx=Depends(session)):
        p=project_for(pid,ctx,True);db=ctx[1];changes={'notes':body.notes};accepted=dict(p.get('accepted_facts',{}))
        available={f['id']:f for f in db.records(pid,'fact')}
        for f in body.facts:
            if f.get('id') not in available or f.get('review_status') not in ('accepted','rejected'):raise HTTPException(400,'Invalid fact review')
            accepted[f['id']]={'value':f.get('value',available[f['id']].get('value')),'review_status':f['review_status'],'reviewer':ctx[0],'reviewed_at':now(),'expires_on':f.get('expires_on')}
        changes['accepted_facts']=accepted
        for key in ('constraints','setbacks','boundary_reviewed','node_reviews'):
            if getattr(body,key) is not None: changes[key]=getattr(body,key)
        if body.intent is not None:changes['intent']=body.intent
        if body.geometry is not None:
            from shapely.geometry import shape
            try:
                g=shape(body.geometry)
                if not g.is_valid or g.geom_type not in ('Polygon','MultiPolygon'):raise ValueError()
                if p.get('parcel',{}).get('geometry') and not shape(p['parcel']['geometry']).covers(g):raise ValueError()
            except Exception:raise HTTPException(422,'Provide valid polygon geometry contained within the parcel')
            changes['geometry']=body.geometry
        changes['review_required_nodes']=revision_impact(p,changes)
        return db.revision(pid,body.expected_revision,changes,ctx[0])
    @app.get('/api/v1/projects/{pid}/revisions')
    def revisions(pid:str,ctx=Depends(session)):
        project_for(pid,ctx);return {'revisions':ctx[1].records(pid,'revision')}
    @app.get('/api/v1/projects/{pid}/assessment')
    def assessment(pid:str,ctx=Depends(session)):
        p=project_for(pid,ctx);db=ctx[1];result=assess(p,db.records(pid,'document'),db.records(pid,'fact'),db.records(pid,'coverage'))
        for n in result['nodes']:
            if n['id'] in p.get('review_required_nodes',[]):n.update(status='review_required',reason='Project inputs changed; review continued reliance. Historical approvals are preserved.')
        return result
    @app.get('/api/v1/projects/{pid}/comments')
    def comments(pid:str,ctx=Depends(session)):
        project_for(pid,ctx);return {'comments':ctx[1].records(pid,'comment')}
    @app.post('/api/v1/projects/{pid}/comments',status_code=201)
    def comment(pid:str,body:CommentInput,ctx=Depends(session)):
        p=project_for(pid,ctx)
        if body.document_id:
            d=ctx[1].record(body.document_id,'document')
            if d['project_id']!=pid:raise HTTPException(400,'Document is outside project')
        return ctx[1].save('comment',{'id':ident(),'project_id':pid,**body.model_dump(),'revision':body.revision or p['current_revision'],'author':ctx[0],'created_at':now()})
    return app

app=create_app()
