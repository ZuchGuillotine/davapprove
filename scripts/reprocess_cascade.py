"""Resume a fixed selected-document manifest; never discover or fetch new records."""
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from app.config import Settings
from app.store import SupabaseStore
from app.worker import Worker
from app.cascade import VERSION


def main(pid,manifest_path):
    s=Settings(ai_provider='cascade',ai_model='gpt-6.1-sol')
    db=SupabaseStore(s,worker=True)
    manifest=Path(manifest_path)
    if manifest.exists(): ids=json.loads(manifest.read_text())['document_ids']
    else:
        ids=[d['id'] for d in sorted(db.records(pid,'document'),key=lambda d:d.get('page_count',999))]
        manifest.write_text(json.dumps({'project_id':pid,'document_ids':ids,'pipeline':VERSION},indent=2))
    assert json.loads(manifest.read_text())['project_id']==pid
    def process(did):
        w=Worker(s,SupabaseStore(s,worker=True));last=-1
        for attempt in range(8):
            d=w.db.record(did,'document');assert d['project_id']==pid
            w.parse(d,w.load_file(d))
            p=d.get('ai_processing',{});done=p.get('processed_pages',0)
            print(json.dumps({'document_id':did,'attempt':attempt+1,'status':p.get('status'),'pages':done,'total':p.get('total_pages')}),flush=True)
            if p.get('status')=='complete' or done<=last or not any(x['status']=='awaiting_time' for x in p.get('page_manifest',[])):break
            last=done
        return did
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(process,did) for did in ids]
        for future in as_completed(futures):
            try:future.result()
            except Exception as e: print(json.dumps({'error_type':type(e).__name__,'message':str(e)[:150]}),flush=True)
    print('REPROCESS_FINISHED',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('project');p.add_argument('manifest');a=p.parse_args();main(a.project,a.manifest)
