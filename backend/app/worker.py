"""One durable job at a time; source selection precedes all file fetches."""
import asyncio
import hashlib
import io
import json
import logging
import multiprocessing
import os
import signal
import sys
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
import httpx
from pypdf import PdfReader
from .config import Settings
from .store import SQLiteStore,SupabaseStore,ident,now

log=logging.getLogger('davapprove.worker')

def stable_id(project_id,kind,external):return str(uuid.uuid5(uuid.NAMESPACE_URL,project_id+':'+kind+':'+str(external)))

def _extract_child(content,max_pages,connection):
    try:
        if hasattr(os,'setsid'):os.setsid()
        if sys.platform.startswith('linux'):
            import resource
            resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
        reader=PdfReader(io.BytesIO(content))
        if reader.is_encrypted:raise ValueError('Encrypted PDF: upload an unlocked copy')
        if len(reader.pages)>max_pages:raise ValueError('PDF exceeds pilot page limit')
        pages=[];missing=False;remaining=2_000_000
        for number,page in enumerate(reader.pages,1):
            text=page.extract_text() or ''
            was_scanned=len(text.strip())<30
            if len(text.strip())<30:
                try:
                    with tempfile.TemporaryDirectory(prefix='davapprove-ocr-') as tmp:
                        src=Path(tmp)/'source.pdf';src.write_bytes(content);out=Path(tmp)/'page'
                        subprocess.run(['pdftoppm','-f',str(number),'-l',str(number),'-singlefile','-scale-to','2400','-png',str(src),str(out)],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                        text=subprocess.run(['tesseract',str(out)+'.png','stdout'],check=True,timeout=30,capture_output=True,text=True).stdout
                except (FileNotFoundError,subprocess.SubprocessError):missing=True
            truncated=len(text)>min(100000,remaining)
            text=text[:min(100000,remaining)];remaining-=len(text)
            pages.append({'page':number,'text':text,'text_truncated':truncated,'was_scanned':was_scanned,'needs_vision':True})
        connection.send({'pages':pages,'missing':missing})
    except Exception as exc:connection.send({'error':str(exc)[:300]})
    finally:connection.close()

def extract_in_process(content,settings):
    # Spawn a fresh parser process; timeout kills it before any DB writes can happen.
    ctx=multiprocessing.get_context('spawn');parent,child=ctx.Pipe(duplex=False)
    process=ctx.Process(target=_extract_child,args=(content,settings.max_pdf_pages,child),daemon=True)
    process.start();child.close()
    try:
        if not parent.poll(max(1,settings.job_timeout_seconds-(700 if getattr(settings,'ai_provider','legacy')=='openai' else 180))):
            raise ValueError('PDF processing timed out; split the document and retry')
        result=parent.recv()
        if 'error' in result:raise ValueError(result['error'])
        return result['pages'],result['missing']
    finally:
        parent.close()
        if process.is_alive():
            try:os.killpg(process.pid,signal.SIGTERM)
            except (AttributeError,ProcessLookupError,PermissionError):process.terminate()
        process.join(timeout=5)
        if process.is_alive():
            try:os.killpg(process.pid,signal.SIGKILL)
            except (AttributeError,ProcessLookupError,PermissionError):process.kill()
            process.join()

class Worker:
    def __init__(self,settings,store=None):
        self.settings=settings
        self.db=store or (SQLiteStore(settings.data_dir/'demo.sqlite3') if settings.mode=='demo' else SupabaseStore(settings,worker=True))
    def save_file(self,pid,did,content):
        if len(content)>self.settings.max_pdf_bytes:raise ValueError('File exceeds configured PDF limit')
        if not content.startswith(b'%PDF-'):raise ValueError('Downloaded file is not a PDF')
        key=str(uuid.UUID(pid))+'/'+str(uuid.UUID(did))+'.pdf'
        if self.settings.mode=='demo':
            path=self.settings.data_dir/'files'/key;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
        else:
            with httpx.Client(timeout=120) as client:
                r=client.post(self.settings.supabase_url+'/storage/v1/object/'+self.settings.bucket+'/'+key,headers={'apikey':self.settings.worker_key,'Authorization':'Bearer '+self.settings.worker_key,'Content-Type':'application/pdf','x-upsert':'false'},content=content)
            if r.status_code not in (200,201):
                if r.status_code==400 and 'Duplicate' in r.text:
                    existing=self.load_file({'project_id':pid,'id':did,'storage_path':key})
                    if hashlib.sha256(existing).digest()!=hashlib.sha256(content).digest():raise ValueError('Existing immutable object differs from selected document')
                else:raise ValueError('Unable to save private document')
        return key
    def load_file(self,d):
        expected=str(uuid.UUID(d['project_id']))+'/'+str(uuid.UUID(d['id']))+'.pdf'
        if d.get('storage_path')!=expected:raise ValueError('Invalid canonical document path')
        if self.settings.mode=='demo':
            path=self.settings.data_dir/'files'/d['storage_path']
            if path.stat().st_size>self.settings.max_pdf_bytes:raise ValueError('File exceeds configured PDF limit')
            return path.read_bytes()
        with httpx.Client(timeout=120) as client:
            with client.stream('GET',self.settings.supabase_url+'/storage/v1/object/authenticated/'+self.settings.bucket+'/'+d['storage_path'],headers={'apikey':self.settings.worker_key,'Authorization':'Bearer '+self.settings.worker_key}) as r:
                r.raise_for_status();parts=[];size=0
                for chunk in r.iter_bytes():
                    size+=len(chunk)
                    if size>self.settings.max_pdf_bytes:raise ValueError('File exceeds configured PDF limit')
                    parts.append(chunk)
                return b''.join(parts)
    async def process(self,j):
        db=self.db;pid=j['project_id'];p=db.project(pid)
        def active():
            current=db.record(j['id'],'job')
            return current.get('status')=='running' and current.get('attempts')==j.get('attempts')
        if j['type']=='discover':
            from .sources import discover_records,lookup_parcel
            if not p.get('source_verified'):
                parcel=await lookup_parcel(p['parcel_number']);p=db.hydrate(pid,parcel)
            result=await discover_records(p['parcel'])
            for c in result.get('candidates',[]):
                external=c.get('external_id',c['id']);cid=stable_id(pid,c.get('source','source'),external)
                item={**c,'id':cid,'project_id':pid,'source_candidate_id':c['id'],'source_url':c.get('source_url',c.get('url')),'url':c.get('url',c.get('source_url')),'record_date':c.get('record_date',c.get('date')),'access_method':c.get('access_method',c.get('access','manual')),'created_at':now()}
                db.save('candidate',item)
            for c in result.get('coverage',[]):
                db.save('coverage',{'screening':result.get('screening') if c['source']=='County PREP' else None,**c,'id':stable_id(pid,'coverage',c['source']),'project_id':pid,'detail':c.get('detail',c.get('message','')),'checked_at':now()})
            j.update(status='completed',stage='discovered',result={'candidate_count':len(result.get('candidates',[]))})
        elif j['type']=='import':
            c=db.record(j['candidate_id'],'candidate')
            if c['project_id']!=pid:raise ValueError('Candidate project mismatch')
            if c.get('access',c.get('access_method')) not in ('automated','direct','api'):
                current=db.record(j['id'],'job')
                if current['status']=='cancelled':return current
                j.update(status='manual_access',stage='manual_access',error='Open the source portal and upload the chosen document.');return db.save('job',j)
            from .sources import fetch_selected
            result=await fetch_selected(c,max_bytes=self.settings.max_pdf_bytes)
            content=result['content'];digest=hashlib.sha256(content).hexdigest()
            did=stable_id(pid,'document',digest)
            existing=next((d for d in db.records(pid,'document') if d.get('sha256')==digest),None)
            if existing:
                if existing.get('status') not in ('needs_review','reviewed'):
                    await asyncio.to_thread(self.parse,existing,content,active)
                j.update(status='completed',stage='imported',result={'document_id':existing['id'],'duplicate':True})
            else:
                key=self.save_file(pid,did,content)
                d={'id':did,'project_id':pid,'title':c.get('title',result.get('filename','Imported PDF')),'source':c.get('source'),'source_url':result.get('source_url',c.get('url')),'source_record_id':c.get('external_id'),'candidate_id':c['id'],'record_date':c.get('record_date'),'storage_path':key,'sha256':digest,'size':len(content),'status':'imported','created_at':now()}
                db.save('document',d)
                await asyncio.to_thread(self.parse,d,content,active)
                j.update(status='completed',stage='imported',result={'document_id':did})
        elif j['type']=='parse':
            d=db.record(j['document_id'],'document')
            if d['project_id']!=pid:raise ValueError('Document project mismatch')
            content=await asyncio.to_thread(self.load_file,d)
            await asyncio.to_thread(self.parse,d,content,active)
            j.update(status='completed',stage='parsed',result={'document_id':d['id']})
        else:raise ValueError('Unknown job type')
        current=db.record(j['id'],'job')
        if current['status']=='cancelled':return current
        j.update(updated_at=now(),lease_until=0);db.save('job',j)
        return j
    def parse(self,d,content,is_active=None):
        if not content.startswith(b'%PDF-'):raise ValueError('File is not a PDF')
        digest=hashlib.sha256(content).hexdigest()
        if d.get('sha256')==digest and d.get('pages') and d.get('extractor_version') in ('native-text-and-tesseract-v1','native-text-and-tesseract-v2'):
            pages=[{**entry,'needs_vision':True} for entry in d['pages']];ocr_missing=bool(d.get('parse_warning'))
        else:
            pages,ocr_missing=extract_in_process(content,self.settings)
        d.update(sha256=digest,pages=pages,page_count=len(pages),size=len(content),extractor_version='native-text-and-tesseract-v2')
        self.db.save('document',d)
        existing_fact_ids={f['id'] for f in self.db.records(d['project_id'],'fact')}
        excerpt_count=0
        for entry in pages:
            if excerpt_count>=100:break
            num,text=entry['page'],entry['text']
            # Deterministic candidate facts, every value remains unreviewed.
            lowered=text.lower();node='E0' if 'wetland' in lowered else 'S0' if any(s in lowered for s in ('septic','drainfield','sewage')) else 'B0' if 'survey' in lowered else 'C0' if 'stormwater' in lowered else 'L0'
            for match in re.finditer(r'\b(?:approved|permit|expiration|expires|wetland|septic|drainfield|survey|setback)[^\n]{0,160}',text,re.I):
                if excerpt_count>=100:break
                excerpt_count+=1
                quote=match.group(0).strip()
                fid=stable_id(d['project_id'],d['id']+':'+str(num),quote)
                if fid in existing_fact_ids:continue
                self.db.save('fact',{'id':fid,'project_id':d['project_id'],'document_id':d['id'],'page':num,'field':'document_excerpt','value':quote,'quote':quote,'node_id':node,'review_status':'proposed','extractor':'text-pattern-v1','confidence':None,'created_at':now()})
        if self.settings.ai_provider=='openai':
            from .openai_processing import extract_openai
            ai_facts,ai_warning=extract_openai(self.settings,self.db,d,pages,content=content,is_active=is_active)
        else:
            from .ai import extract
            ai_facts,ai_warning=extract(self.settings,self.db,d,pages)
        new_facts=[]
        for f in ai_facts:
            version='openai-pages-v2' if self.settings.ai_provider=='openai' else 'ai-extract-v1'
            fid=stable_id(d['project_id'],d['id']+':'+version+':'+self.settings.ai_model+':'+str(f['page']),json.dumps([f.get('quote'),f['value'],f['node_id'],f.get('evidence_type'),f.get('source_region',{}).get('region')],sort_keys=True))
            if fid in existing_fact_ids:continue
            new_facts.append({**f,'id':fid,'project_id':d['project_id'],'document_id':d['id'],'field':'document_fact','review_status':'proposed','extractor':version,'model':self.settings.ai_model,'created_at':now()})
        self.db.save_many('fact',new_facts)
        digest=hashlib.sha256(content).hexdigest()
        d.update(ai_warning=ai_warning,ai_fact_count=len(ai_facts),sha256=digest,size=len(content),page_count=len(pages),pages=pages,status='needs_review',parse_warning='Some scanned pages need OCR; install poppler-utils and tesseract-ocr or upload searchable PDF.' if ocr_missing else None,extractor_version='native-text-and-tesseract-v2')
        self.db.save('document',d)
    def ocr_page(self,content,num):
        with tempfile.TemporaryDirectory(prefix='davapprove-ocr-') as tmp:
            src=Path(tmp)/'source.pdf';src.write_bytes(content);out=Path(tmp)/'page'
            subprocess.run(['pdftoppm','-f',str(num),'-l',str(num),'-singlefile','-scale-to','2400','-png',str(src),str(out)],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            result=subprocess.run(['tesseract',str(out)+'.png','stdout'],check=True,timeout=30,capture_output=True,text=True)
            return result.stdout
    async def once(self):
        j=self.db.claim()
        if not j:return False
        async def keep_lease():
            while True:
                await asyncio.sleep(30)
                if not await asyncio.to_thread(self.db.renew_job,j['id'],j.get('attempts')):return
        heartbeat=asyncio.create_task(keep_lease())
        try:await self.process(j)
        except Exception as exc:
            if self.db.record(j['id'],'job')['status']=='cancelled':return True
            transient=isinstance(exc,(httpx.TransportError,asyncio.TimeoutError)) or bool(getattr(exc,'retryable',False))
            j.update(status='queued' if transient and j.get('attempts',0)<3 else 'failed',stage='error',error=str(exc)[:300],run_after=time.time()+min(60,10*j.get('attempts',1)),updated_at=now(),lease_until=0)
            self.db.save('job',j);log.warning('job %s failed: %s',j['id'],type(exc).__name__)
        finally:
            heartbeat.cancel()
            try:await heartbeat
            except asyncio.CancelledError:pass
        return True

async def run():
    worker=Worker(Settings())
    while True:
        if not await worker.once():await asyncio.sleep(2)

if __name__=='__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
