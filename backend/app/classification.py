"""Task-specific review triage. Never changes evidence or authorizes reliance."""
import json
import re
from datetime import date

VERSION = 'precheck-triage-v2'
SPATIAL = re.compile(r'\b(boundary|survey|setback|buffer|wetland|shoreline|easement|right.of.way|drainfield|reserve area|septic|slope|flood|access|footprint|lot coverage|site geometry)\b', re.I)
LATER = re.compile(r'\b(invoice|receipt|fee|electrical|energization|inspection|plumbing|mechanical)\b', re.I)


def classify_review(project, facts, documents):
    """Verified document lineage is optional; missing lineage never suppresses facts.

    decision_verification and supersession are curated metadata, not AI output.
    Supersession is explicit, task-scoped and requires matching permit identity.
    """
    docs = {d['id']: d for d in documents}
    merged = [{**f, **project.get('accepted_facts', {}).get(f['id'], {})} for f in facts]
    # A new extraction ID must not bypass an existing correction/rejection
    # attached to the same source span. Keep raw observations immutable.
    def source_key(f):
        quote=f.get('quote') or f.get('source_quote')
        return (f.get('document_id'),f.get('page'),quote) if quote else None
    human_sources={source_key(f) for f in merged if f.get('review_status') in ('accepted','rejected') and source_key(f)}
    for f in merged:
        if f.get('review_status') not in ('accepted','rejected') and source_key(f) in human_sources:
            f['machine_validation']={**f.get('machine_validation',{}),'status':'human_override_exists','reason':'A prior human decision covers this source span; reconcile changes before automated reliance.'}
    def conflict_key(f):
        if f.get('pipeline','').startswith('precheck-cascade'):
            if not f.get('entity') or not f.get('property'): return None
            return (f['entity'].casefold(),f['property'].casefold(),f.get('revision'),f.get('scope'),f.get('temporal_role'))
        return f.get('key')
    groups = {}
    for f in merged:
        key = conflict_key(f)
        if key and key not in ('document_excerpt', 'document_fact', 'site_geometry') and f.get('review_status') != 'rejected':
            groups.setdefault(key, set()).add(json.dumps(f.get('value'), sort_keys=True))
    lineage_fields=('entity','property','scope','permit_id','agency','jurisdiction')
    replacements={}
    for f in merged:
        if f.get('supersedes_revision') and all(f.get(k) for k in lineage_fields):
            replacements.setdefault(tuple(f[k] for k in lineage_fields)+(f['supersedes_revision'],),[]).append(f)
    result = []
    for f in merged:
        d = docs.get(f.get('document_id'), {})
        text = json.dumps([f.get('key'), f.get('value')], sort_keys=True)
        relevant = bool(SPATIAL.search(text)) or f.get('key') == 'site_geometry'
        relevance = 'direct' if relevant else 'later' if LATER.search(text) else 'unknown'
        bucket = 'review_now' if relevance != 'later' else 'later'
        reason = 'Resolve site-envelope evidence.' if relevant else 'Relevance is uncertain; keep visible for triage.' if relevance == 'unknown' else 'Likely needed at a later work stage.'
        authority = 'unverified'
        v = d.get('decision_verification', {})
        if (v.get('reviewer') and v.get('citation') and v.get('agency') and v.get('decision') == 'approved'
                and v.get('revision') and v.get('scope')):
            authority = 'agency_approved_scope'
        successor = None
        for candidate in documents:
            link = candidate.get('supersession', {})
            cv = candidate.get('decision_verification', {})
            identity = ('permit_id', 'agency', 'jurisdiction')
            if (candidate['id'] != d.get('id') and d.get('id') in link.get('document_ids', [])
                    and link.get('task') == 'site_envelope' and link.get('reviewer') and link.get('citation')
                    and all(d.get(k) and d.get(k) == candidate.get(k) for k in identity)
                    and cv.get('decision') == 'approved' and cv.get('reviewer') and cv.get('citation')
                    and cv.get('revision') and cv.get('scope') and cv.get('agency') == candidate.get('agency')):
                successor = candidate['id']
        conflict = len(groups.get(conflict_key(f), set())) > 1
        if conflict:
            bucket, reason = 'review_now', 'Conflicting extracted values; resolve applicability and source precedence.'
        validation=f.get('machine_validation',{})
        if validation.get('status')=='validated' and not conflict:
            bucket,reason='resolved','Source-supported extraction checked automatically; current applicability and agency decisions remain separate.'
        if f.get('verification_exception') and validation.get('status')!='validated':
            bucket,reason='processing_pending','Automated source verification is pending: '+f['verification_exception'].get('reason','Processing unavailable')
        if validation.get('status')=='human_override_exists':
            bucket,reason='review_now',validation['reason']
        active=d.get('active_extraction_pipeline')
        page_activation=d.get('active_extraction_pages',{})
        if f.get('page') in page_activation.get('pages',[]):active=page_activation.get('pipeline') or active
        if active and f.get('pipeline') != active and f.get('review_status') not in ('accepted','rejected'):
            bucket,reason='history','Earlier extraction retained; this source page has a complete newer processing version. This is not design supersession.'
        if f.get('review_status') in ('accepted', 'rejected'):
            bucket, reason = 'resolved', 'Review decision retained; this does not establish agency approval.'
        # Explicit source-supported replacement of an assertion scope; never a
        # document-wide deletion or an inferred agency decision.
        for candidate in replacements.get(tuple(f.get(k) for k in lineage_fields)+(f.get('revision'),),[]):
            identity=('entity','property','scope','permit_id','agency','jurisdiction')
            if (candidate['id']==f['id'] or not all(f.get(k) and f.get(k)==candidate.get(k) for k in identity)
                or not f.get('revision') or candidate.get('supersedes_revision')!=f['revision']
                or candidate.get('machine_validation',{}).get('status')!='validated'
                or candidate.get('review_status')=='rejected'
                or not re.search(r'\b(supersed\w*|replac\w*)\b',candidate.get('quote',''),re.I)
                or f['revision'] not in candidate.get('quote','')): continue
            try:
                if date.fromisoformat(candidate['issued_date'])<=date.fromisoformat(f['issued_date']):continue
            except (KeyError,ValueError,TypeError):continue
            if f.get('review_status') not in ('accepted','rejected'):
                successor=candidate['id']
                bucket,reason='history','Explicit source-supported replacement for this entity/property scope; historical source retained.'
        if successor and not conflict and f.get('review_status') not in ('accepted','rejected'):
            bucket, reason = 'history', 'Explicitly superseded for site-envelope review; original retained.'
        result.append({**f, 'classification': {
            'version': VERSION, 'task': 'site_envelope', 'project_revision': project.get('current_revision'),
            'relevance': relevance, 'bucket': bucket, 'reason': reason,
            'authority': authority, 'conflict': conflict, 'superseded_by': successor,
            'priority': 0 if conflict else 1 if relevant else 2,
        }})
    return sorted(result, key=lambda f: (f['classification']['priority'], f['id']))
