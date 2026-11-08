"""Recover a timed-out extraction from an identical completed benchmark request.
No provider call or budget release; uncertain original billing stays reserved.
"""
import copy
import json
from app import cascade as c
from app.config import Settings
from app.store import SupabaseStore
from app.worker import Worker


def run(pid):
    settings=Settings();db=SupabaseStore(settings,worker=True);worker=Worker(settings,db)
    records=db.records(pid,'processing_chunk');recovered=[]
    for old in records:
        if old.get('pipeline')!=c.VERSION or old.get('status')!='failed_uncertain' or old.get('purpose')!='extract-page-1-low':continue
        candidates=[r for r in records if r.get('document_id')==old['document_id'] and r.get('status')=='completed'
            and r.get('pipeline')==old['pipeline'] and r.get('purpose')==old['purpose'] and r.get('response',{}).get('status')=='completed']
        if not candidates:continue
        doc=db.record(old['document_id'],'document');content=worker.load_file(doc)
        assert c.hashlib.sha256(content).hexdigest()==doc['sha256']==old['document_sha256']
        page=next(p for p in doc['pages'] if p['page']==1);captured={}
        class Capture(Exception):pass
        def capture(settings,store,doc,provider,purpose,request,image_tokens=0):
            captured.update(provider=provider,purpose=purpose,request=request);raise Capture()
        original=c.billable_call;c.billable_call=capture
        try:
            try:c.extract_page(settings,db,doc,page,content,'vision')
            except Capture:pass
        finally:c.billable_call=original
        def identity(variant):return c.digest([c.VERSION,captured['provider'],captured['purpose'],captured['request'],doc['sha256'],variant])
        assert identity(old['variant'])==old['input_hash']
        match=next((r for r in candidates if identity(r['variant'])==r['input_hash']),None)
        if not match:continue
        new={**old,'status':'completed','response':copy.deepcopy(match['response']),
            'recovery':{'kind':'identical_request_cache','from_request_id':match['id'],'at':c.stamp(),
                'original_status':old['status'],'original_error_type':old.get('error_type'),
                'billing':'Original attempt remains unreconciled; reservation retained. No retry charge.'}}
        db.save('processing_chunk',new);recovered.append(old['document_id'])
    print(json.dumps({'recovered_document_ids':recovered}),flush=True)

if __name__=='__main__':
    import sys
    run(sys.argv[1])
