"""Record a source/version-bound pre-check run snapshot and metered costs."""
from collections import Counter,defaultdict
from pathlib import Path
import json
import uuid
from app.config import Settings
from app.store import SupabaseStore
from app.cascade import VERSION, VERIFICATION_POLICY,digest,stamp
from app.classification import classify_review
from app.evaluation import assess,load_pack


def report(pid,path):
    db=SupabaseStore(Settings(),worker=True)
    project=db.project(pid);docs=db.records(pid,'document');facts=db.records(pid,'fact')
    calls=db.records(pid,'processing_chunk');coverage=db.records(pid,'coverage')
    for d in docs:
        fs=[f for f in facts if f.get('document_id')==d['id'] and f.get('pipeline')==VERSION]
        d.setdefault('ai_processing',{})['verification_pending_facts']=sum(bool(f.get('verification_exception')) for f in fs)
        db.save('document',d)
    classified=classify_review(project,facts,docs)
    current=[f for f in classified if f.get('pipeline')==VERSION]
    costs=defaultdict(lambda:{'calls':0,'metered_microusd':0,'unreconciled_reserved_microusd':0,'statuses':Counter()})
    for c in calls:
        if c.get('pipeline')!=VERSION:continue
        k=c.get('variant','unknown')+'/'+c.get('provider','unknown');v=costs[k]
        v['calls']+=1;v['metered_microusd']+=c.get('actual_microusd',0);v['statuses'][c['status']]+=1
        if 'actual_microusd' not in c:v['unreconciled_reserved_microusd']+=c.get('reserved_microusd',0)
    pages=[p for d in docs for p in d.get('ai_processing',{}).get('page_manifest',[])]
    summary={'project_id':pid,'pipeline':VERSION,'verification_policy':VERIFICATION_POLICY,'as_of':stamp(),
        'documents':len(docs),'pages':sum(d.get('page_count',0) for d in docs),
        'document_statuses':dict(Counter(d.get('ai_processing',{}).get('status') for d in docs)),
        'page_statuses':dict(Counter(p.get('status') for p in pages)),
        'coverage_incomplete_pages':sum(bool(p.get('coverage_incomplete')) for p in pages),
        'pages_with_source_issues':sum(bool(p.get('issues')) for p in pages),
        'new_facts':len(current),'raw_validation':dict(Counter(f.get('machine_validation',{}).get('status','unverified') for f in facts if f.get('pipeline')==VERSION)),
        'new_fact_buckets':dict(Counter(f['classification']['bucket'] for f in current)),
        'all_fact_buckets':dict(Counter(f['classification']['bucket'] for f in classified)),
        'verification_pending_facts':sum(bool(f.get('verification_exception')) for f in current),
        'geometry_facts':sum(isinstance(f.get('value'),dict) for f in current),
        'costs':dict(costs),'pricing_note':'API-reported usage at published rates; not a reconciled provider invoice.'}
    pack=load_pack(project.get('jurisdiction'))
    evaluation=assess(project,docs,facts,coverage)
    snapshot={'project_revision':project['current_revision'],'project_hash':digest(project),
        'pipeline':VERSION,'verification_policy':VERIFICATION_POLICY,'as_of':summary['as_of'],
        'jurisdiction':project.get('jurisdiction'),'rule_version':pack['version'],'rule_hash':digest(pack),
        'documents':[{'id':d['id'],'sha256':d.get('sha256'),'processing_hash':digest(d.get('ai_processing')),'processing':{k:d.get('ai_processing',{}).get(k) for k in ('pipeline','status','total_pages','processed_pages','verification_pending_facts')},
            'active_extraction_pages':d.get('active_extraction_pages')} for d in docs],
        'facts':[{'id':f['id'],'hash':digest(f),'validation':{k:f.get('machine_validation',{}).get(k) for k in ('status','policy','verification_id')},'classification':f['classification']} for f in classified],
        'evaluation_hash':digest(evaluation),'evaluation_summary':{'summary':evaluation.get('summary'),'rule_version':evaluation.get('rule_version'),'nodes':[{'id':n['id'],'status':n['status'],'evidence_ids':n.get('evidence_ids',[])} for n in evaluation.get('nodes',[])]},'summary':summary,'limitation':'Extraction snapshot, not agency approval. Numeric rules and uncalibrated geometry remain gated.'}
    event={'id':str(uuid.uuid4()),'project_id':pid,'type':'precheck_processing_snapshot','created_at':summary['as_of'],
        'snapshot_hash':digest(snapshot),'snapshot':snapshot}
    Path(path+'.snapshot.json').write_text(json.dumps(event))
    response=db.client.post('project_records',headers={**db.headers,'Prefer':'return=minimal'},
        json={'id':event['id'],'project_id':pid,'kind':'event','data':event})
    if response.status_code>=400:
        error=response.json()
        raise RuntimeError(str({'status':response.status_code,'code':error.get('code'),'message':str(error.get('message',''))[:300]}))
    summary.update(snapshot_event_id=event['id'],snapshot_hash=event['snapshot_hash'])
    Path(path).write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary),flush=True)

if __name__=='__main__':
    import sys
    report(sys.argv[1],sys.argv[2])
