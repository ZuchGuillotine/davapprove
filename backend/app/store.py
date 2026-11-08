"""Two persistence implementations. Demo SQLite is never selected implicitly."""
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
import httpx


def now(): return datetime.now(timezone.utc).isoformat()
def ident(): return str(uuid.uuid4())

class Conflict(Exception): pass
class NotFound(Exception): pass

class SQLiteStore:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db=sqlite3.connect(path,check_same_thread=False)
        self.db.row_factory=sqlite3.Row
        self.lock=threading.RLock()
        self.db.executescript('''CREATE TABLE IF NOT EXISTS ai_usage(job_key TEXT PRIMARY KEY,month TEXT,amount INTEGER);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(project_id TEXT,user_id TEXT,role TEXT,PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_project_kind ON records(project_id,kind);''')
        self.db.commit()
    def project(self,pid,user=None):
        with self.lock:
            row=self.db.execute('select * from projects where id=?',(pid,)).fetchone()
            if not row: raise NotFound()
            data=json.loads(row['data'])
            if user and not self.role(pid,user): raise NotFound()
            return data
    def role(self,pid,user):
        with self.lock:
            row=self.db.execute('select owner_id from projects where id=?',(pid,)).fetchone()
            if row and row[0]==user:return 'owner'
            member=self.db.execute('select role from memberships where project_id=? and user_id=?',(pid,user)).fetchone()
            return member[0] if member else None
    def projects(self,user):
        with self.lock:
            rows=self.db.execute('select data from projects where owner_id=? or id in (select project_id from memberships where user_id=?)',(user,user)).fetchall()
            return [json.loads(r[0]) for r in rows]
    def create_project(self,data,user):
        with self.lock,self.db:
            self.db.execute('insert into projects values(?,?,?)',(data['id'],user,json.dumps(data)))
            self._save('revision',{'id':ident(),'project_id':data['id'],'revision':1,'snapshot':data,'created_at':now()})
        return data
    def _save(self,kind,data):
        self.db.execute('insert into records values(?,?,?,?) on conflict(id) do update set data=excluded.data',(data['id'],data['project_id'],kind,json.dumps(data)))
        return data
    def save(self,kind,data):
        with self.lock,self.db:return self._save(kind,data)
    def save_many(self,kind,items):
        with self.lock,self.db:
            for item in items:self._save(kind,item)

    def records(self,pid,kind):
        with self.lock:return [json.loads(r[0]) for r in self.db.execute('select data from records where project_id=? and kind=?',(pid,kind)).fetchall()]
    def record(self,id,kind=None):
        with self.lock:
            row=self.db.execute('select kind,data from records where id=?',(id,)).fetchone()
            if not row or kind and kind!=row[0]:raise NotFound()
            return json.loads(row[1])
    def revision(self,pid,expected,changes,user):
        with self.lock,self.db:
            p=self.project(pid,user)
            if p['current_revision']!=expected:raise Conflict()
            p.update(changes);p['current_revision']+=1;p['updated_at']=now()
            self.db.execute('update projects set data=? where id=?',(json.dumps(p),pid))
            self._save('revision',{'id':ident(),'project_id':pid,'revision':p['current_revision'],'snapshot':p,'created_at':now(),'author':user})
            return p
    def add_member(self,pid,user,role):
        with self.lock,self.db:self.db.execute('insert into memberships values(?,?,?) on conflict(project_id,user_id) do update set role=excluded.role',(pid,user,role))
    def claim(self):
        with self.lock,self.db:
            for row in self.db.execute("select data from records where kind='job'").fetchall():
                j=json.loads(row[0]);t=time.time()
                if (j['status']=='queued' and j.get('run_after',0)<=t) or (j['status']=='running' and j.get('lease_until',0)<t):
                    if j.get('attempts',0)>=3:
                        j.update(status='failed',error='Retry limit reached');self._save('job',j);continue
                    j.update(status='running',attempts=j.get('attempts',0)+1,lease_until=t+1200,updated_at=now())
                    self._save('job',j);return j
        return None

    def renew_job(self,jid,attempt):
        with self.lock,self.db:
            j=self.record(jid,'job')
            if j.get('status')!='running' or j.get('attempts')!=attempt:return False
            j['lease_until']=time.time()+1200;self._save('job',j);return True

    def hydrate(self,pid,parcel):
        with self.lock,self.db:
            p=self.project(pid);p.update(parcel=parcel,jurisdiction=parcel.get('jurisdiction','unknown'),source_verified=True)
            self.db.execute('update projects set data=? where id=?',(json.dumps(p),pid));return p
    def cancel(self,jid):
        with self.lock,self.db:
            j=self.record(jid,'job')
            if j['status'] in ('queued','running'):j.update(status='cancelled',updated_at=now());self._save('job',j)
            return j
    def reserve_ai(self,key,month,amount,limit):
        with self.lock,self.db:
            if self.db.execute('select 1 from ai_usage where job_key=?',(key,)).fetchone():return False
            total=self.db.execute('select coalesce(sum(amount),0) from ai_usage where month=?',(month,)).fetchone()[0]
            if total+amount>min(limit,5000000):return False
            self.db.execute('insert into ai_usage values(?,?,?)',(key,month,amount));return True
    def reconcile_ai(self,key,amount):
        with self.lock,self.db:self.db.execute('update ai_usage set amount=min(amount,?) where job_key=?',(max(0,amount),key))

class SupabaseStore:
    def __init__(self,settings,token=None,worker=False):
        self.settings=settings
        self.worker=worker
        key=settings.worker_key if worker else settings.publishable_key
        if not settings.supabase_url or not key: raise RuntimeError('Supabase URL and appropriate key required')
        self.headers={'apikey':key,'Authorization':f'Bearer {key if worker else token}','Content-Type':'application/json','Prefer':'return=representation'}
        self.client=httpx.Client(base_url=settings.supabase_url+'/rest/v1/',headers=self.headers,timeout=30)
    def req(self,method,path,**kwargs):
        r=self.client.request(method,path,**kwargs)
        if r.status_code>=400:
            if r.status_code==409 or 'revision_conflict' in r.text:raise Conflict()
            raise RuntimeError(f'Database request failed ({r.status_code})')
        return r.json() if r.content else None
    def project(self,pid,user=None):
        rows=self.req('GET','projects',params={'id':f'eq.{pid}','select':'data'})
        if not rows:raise NotFound()
        return rows[0]['data']
    def role(self,pid,user):
        p=self.project(pid)
        if p['owner_id']==user:return 'owner'
        rows=self.req('GET','project_memberships',params={'project_id':f'eq.{pid}','user_id':f'eq.{user}'})
        return rows[0]['role'] if rows else None
    def projects(self,user):return [r['data'] for r in self.req('GET','projects',params={'select':'data','order':'created_at.desc'})]
    def create_project(self,data,user):
        return self.req('POST','rpc/create_project',json={'payload':data})
    def save(self,kind,data):
        if not self.worker: return self.req('POST','rpc/save_record',json={'record_kind':kind,'payload':data})
        self.req('POST','project_records',headers={**self.headers,'Prefer':'resolution=merge-duplicates,return=representation'},json={'id':data['id'],'project_id':data['project_id'],'kind':kind,'data':data})
        return data
    def save_many(self,kind,items):
        if not self.worker:raise PermissionError('Batch extraction writes require worker credentials')
        for start in range(0,len(items),100):
            self.req('POST','project_records',headers={**self.headers,'Prefer':'resolution=ignore-duplicates,return=minimal'},json=[{'id':d['id'],'project_id':d['project_id'],'kind':kind,'data':d} for d in items[start:start+100]])
    def records(self,pid,kind):
        result=[]
        while True:
            rows=self.req('GET','project_records',params={'project_id':f'eq.{pid}','kind':f'eq.{kind}','select':'data','order':'id','limit':1000,'offset':len(result)})
            result.extend(r['data'] for r in rows)
            if len(rows)<1000:return result

    def record(self,id,kind=None):
        params={'id':f'eq.{id}','select':'data,kind'}
        if kind:params['kind']=f'eq.{kind}'
        rows=self.req('GET','project_records',params=params)
        if not rows:raise NotFound()
        return rows[0]['data']
    def revision(self,pid,expected,changes,user):return self.req('POST','rpc/save_revision',json={'target_project':pid,'expected_revision':expected,'changes':changes})
    def add_member(self,pid,user,role):self.req('POST','project_memberships',json={'project_id':pid,'user_id':user,'role':role})
    def claim(self):return self.req('POST','rpc/claim_job',json={})

    def renew_job(self,jid,attempt):return self.req('POST','rpc/renew_processing_job',json={'job_id':jid,'attempt':attempt})
    def reserve_ai(self,key,month,amount,limit):return self.req('POST','rpc/reserve_ai_budget',json={'job_key':key,'month':month,'amount_microusd':amount,'limit_microusd':limit})
    def reconcile_ai(self,key,amount):self.req('POST','rpc/reconcile_ai_budget',json={'job_key':key,'actual_microusd':amount})

    def cancel(self,jid):return self.req('POST','rpc/cancel_job',json={'job_id':jid})

    def hydrate(self,pid,parcel):
        return self.req('POST','rpc/hydrate_project',json={'target_project':pid,'parcel':parcel})
