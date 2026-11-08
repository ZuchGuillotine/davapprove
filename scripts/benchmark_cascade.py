"""Small operational comparison, not an expert-labeled accuracy benchmark.
Run server-side with protected environment, within the shared AI ledger.
"""
import json
import time
from pathlib import Path
from app.config import Settings
from app.store import SupabaseStore
from app.worker import Worker
from app.cascade import extract_page,decisions,ROUTING,verify,verify_uncertain,confident,VERSION


def run(pid,output):
    s=Settings(ai_monthly_usd=25);db=SupabaseStore(s,worker=True);worker=Worker(s,db)
    docs=sorted([d for d in db.records(pid,'document') if d.get('pages')],key=lambda d:(d.get('page_count',999),d['id']))
    # One short document, one scan, one larger package; distinct originals.
    chosen=[]
    for predicate in [lambda d:d.get('page_count',999)<=2,lambda d:any(p.get('was_scanned') for p in d['pages']),lambda d:d.get('page_count',0)>=10]:
        d=next((d for d in docs if d['id'] not in [x['id'] for x in chosen] and predicate(d)),None)
        if d:chosen.append(d)
    rows=[]
    for original in chosen:
        content=worker.load_file(original);page=original['pages'][0]
        for variant in ('cascade','sol_only'):
            d={**original,'processing_variant':'benchmark-'+variant};start=time.monotonic();route='vision'
            if variant=='cascade':
                answers,_=decisions(s,db,d,{'title':d.get('title',''),'page':page['page'],'text':page.get('text','')[:30000]},ROUTING,'benchmark-route')
                if not page.get('was_scanned') and not page.get('text_truncated') and len(page.get('text',''))>150 and confident(answers['role'],'narrative',.95):route='text'
            facts,summary,row=extract_page(s,db,d,page,content,route)
            if variant=='cascade':
                verify(s,db,d,page,facts)
                verify_uncertain(s,db,d,page,facts,content)
            rows.append({'document_id':d['id'],'page':page['page'],'variant':variant,'route':route,'facts':len(facts),'validated':sum(f.get('machine_validation',{}).get('status')=='validated' for f in facts),'rejected':summary['rejected'],'saturated':summary['saturated'],'elapsed_seconds':round(time.monotonic()-start,2),'extraction_request_id':row['id'],'claims':[{'quote':f.get('quote'),'value':f.get('value')} for f in facts]})
            Path(output).write_text(json.dumps({'pipeline':VERSION,'kind':'operational comparison; no expert ground truth','rows':rows},indent=2))
            print(json.dumps({k:v for k,v in rows[-1].items() if k!='claims'}),flush=True)

if __name__=='__main__':
    import argparse
    a=argparse.ArgumentParser();a.add_argument('project');a.add_argument('output');args=a.parse_args();run(args.project,args.output)
