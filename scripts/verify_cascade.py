"""Resume source verification over persisted cascade facts, retaining human overlays."""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from app.config import Settings
from app.store import SupabaseStore
from app.worker import Worker
from app.cascade import VERSION, VERIFICATION_POLICY, verify_uncertain


def run(pid):
    s=Settings(ai_provider='cascade',ai_model='gpt-6.1-sol')
    db=SupabaseStore(s,worker=True)
    grouped=defaultdict(list)
    for f in db.records(pid,'fact'):
        if f.get('pipeline')==VERSION:grouped[f['document_id']].append(f)
    def process(did,facts):
        local=SupabaseStore(s,worker=True);w=Worker(s,local);doc=local.record(did,'document')
        assert doc['project_id']==pid
        processing=doc.get('ai_processing',{})
        if processing.get('status')=='running' or any(p.get('status')=='awaiting_time' for p in processing.get('page_manifest',[])):return
        if all(not isinstance(f.get('value'),str) or f.get('machine_validation',{}).get('policy')==VERIFICATION_POLICY or f.get('machine_validation',{}).get('status')=='validated' for f in facts):return
        content=None;pages={p['page']:p for p in doc.get('pages',[])};by_page=defaultdict(list)
        for f in facts:by_page[f['page']].append(f)
        for number,fs in sorted(by_page.items()):
            if number not in pages:continue
            if any(isinstance(f.get('value'),str) and f.get('evidence_type')=='visual_observation'
                   and f.get('machine_validation',{}).get('policy')!=VERIFICATION_POLICY for f in fs):
                if content is None:content=w.load_file(doc)
            verify_uncertain(s,local,doc,pages[number],fs,content)
            # Existing observations retain IDs and source values; update validation metadata.
            # save_many intentionally ignores duplicates and cannot persist this update.
            for start in range(0,len(fs),100):
                local.req('POST','project_records',headers={**local.headers,'Prefer':'resolution=merge-duplicates,return=minimal'},
                    json=[{'id':f['id'],'project_id':pid,'kind':'fact','data':f} for f in fs[start:start+100]])
        doc=local.record(did,'document')
        p=doc.get('ai_processing',{})
        p.update(verification_policy=VERIFICATION_POLICY,
            verification_pending_facts=sum(bool(f.get('verification_exception')) for f in facts),
            machine_validated_facts=sum(f.get('machine_validation',{}).get('status')=='validated' for f in facts),
            exception_facts=sum(f.get('machine_validation',{}).get('status')!='validated' for f in facts))
        doc['active_extraction_pages']={'pipeline':VERSION,'pages':[entry['page'] for entry in p.get('page_manifest',[]) if entry.get('status')=='processed' and not entry.get('coverage_incomplete')]}
        local.save('document',doc)
        print(json.dumps({'document_id':did,'facts':len(facts),'validated':p['machine_validated_facts'],'exceptions':p['exception_facts']}),flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for f in as_completed([pool.submit(process,did,fs) for did,fs in grouped.items()]):f.result()
    print('VERIFICATION_FINISHED',flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('project');run(a.parse_args().project)
