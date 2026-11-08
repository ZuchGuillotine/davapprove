"""Pure, conservative feasibility evaluation; no result authorizes construction."""
import json
import re
from datetime import date
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union
from pyproj import Transformer

PACK_DIR = Path(__file__).resolve().parent.parent / 'rules'
TO_LOCAL = Transformer.from_crs(4326, 2285, always_xy=True).transform
TO_WEB = Transformer.from_crs(2285, 4326, always_xy=True).transform

def load_pack(jurisdiction):
    if jurisdiction not in ('kitsap_county', 'poulsbo'):
        return {'version': 'unsupported', 'nodes': [], 'edges': [], 'source_url': None}
    return json.loads((PACK_DIR / f'{jurisdiction}.json').read_text())

def ordered_nodes(pack):
    """Only prerequisite relationships participate in ordering, never INVALIDATES."""
    nodes = {n['id']: n for n in pack['nodes']}
    incoming = {n: set() for n in nodes}
    for edge in pack['edges']:
        if edge['type'] == 'INVALIDATES':
            continue
        if edge['source'] not in nodes or edge['target'] not in nodes:
            raise ValueError('Dependency references an unknown node')
        incoming[edge['target']].add(edge['source'])
    result = []
    while incoming:
        ready = [n for n, deps in incoming.items() if not deps]
        if not ready:
            raise ValueError('Prerequisite cycle in jurisdiction pack')
        for n in ready:
            result.append(nodes[n]); del incoming[n]
        for deps in incoming.values():
            deps.difference_update(ready)
    return result

def revision_impact(old, changes):
    pack = load_pack(old.get('jurisdiction'))
    impacted = set()
    for key, value in changes.get('intent', {}).items():
        if old.get('intent', {}).get(key) != value:
            impacted.update(pack.get('change_impacts', {}).get(key, ['D0', 'B1']))
    for key in ('geometry', 'constraints', 'setbacks', 'accepted_facts', 'alignment'):
        if key in changes and old.get(key) != changes[key]:
            impacted.update(pack.get('change_impacts', {}).get(key, ['D0', 'C0', 'B1']))
    # Propagate impact without assuming the full relationship graph is acyclic.
    pending = list(impacted)
    while pending:
        current = pending.pop()
        for edge in pack.get('edges', []):
            if edge['source'] == current and edge['target'] not in impacted:
                impacted.add(edge['target']); pending.append(edge['target'])
    return sorted(impacted)

def polygon(value):
    geom = shape(value)
    if geom.is_empty or not geom.is_valid or geom.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('Expected a valid nonempty polygon or multipolygon')
    if not all(-180 <= x <= 180 for x in (geom.bounds[0], geom.bounds[2])) or not all(-90 <= y <= 90 for y in (geom.bounds[1], geom.bounds[3])):
        raise ValueError('Geometry must use longitude/latitude coordinates')
    return geom

def site_layers(project, facts=()):
    """Explicit geometry only. Text or visual observations never imply coordinates."""
    layers = []
    for i, item in enumerate(project.get('constraints', [])):
        layers.append({**item, 'id': item.get('id', f'constraint-{i}'),
                       'role': item.get('role', 'exclusion'),
                       'discipline': item.get('discipline', 'unassigned')})
    for fact in facts:
        review = project.get('accepted_facts', {}).get(fact['id'], {})
        value = review.get('value', fact.get('value'))
        if fact.get('key') != 'site_geometry' or not isinstance(value, dict):
            continue
        layers.append({**value, 'id': 'fact-' + fact['id'],
                       'review_status': review.get('review_status', 'proposed'),
                       'document_id': fact.get('document_id'), 'page': fact.get('page'),
                       'reviewer': review.get('reviewer'), 'reviewed_at': review.get('reviewed_at'),
                       'fact_id': fact['id']})
    return layers

def envelope(project, facts=(), documents=()):
    out = {'status': 'cannot_determine', 'geometry': None, 'area_sqft': None,
           'assumptions': [], 'gaps': [], 'conflicts': [], 'constraints': [],
           'code_checked': False, 'layers': [], 'spatial_conflicts': [], 'drawing_previews': [], 'reconciliation': []}
    out['document_geometry'] = [{'document_id':d['id'], 'title':d.get('title','Source document'),
        'geometry_facts':sum(1 for f in facts if f.get('document_id')==d['id'] and f.get('key')=='site_geometry'),
        'processing_warning':d.get('ai_warning'),
        'reason':'Reviewing text facts does not create drawing geometry. Reprocessing, extraction or sheet registration may still be needed.'}
        for d in documents]
    from .drawings import reconcile
    from .alignment import alignment_state, registered_layers
    try:
        alignment=alignment_state(project.get('alignment'),documents)
    except (ValueError,TypeError,KeyError):
        alignment={'reference':None,'registrations':[]}
        out['gaps'].append('Shared reference is invalid or its source changed; registered geometry needs review.')
    out['alignment']=alignment
    observations = registered_layers([l for l in site_layers(project, facts) if l.get('review_status') != 'rejected'],alignment)
    if project.get('alignment') and not alignment.get('reference'):
        observations=[{**l,'geometry':None} if l.get('sheet_geometry') else l for l in observations]
    from .provisional_geometry import propose_placements, sheet_groups
    manual_pages={(r.get('document_id'),r.get('page')) for r in alignment.get('registrations',[])}
    if project.get('alignment') and not alignment.get('reference'):
        manual_pages.update((l.get('document_id'),l.get('page')) for l in observations)
    observations,placements=propose_placements(project,observations,documents,manual_pages)
    out['automatic_placements']=placements
    out['drawing_sheets']=sheet_groups(observations,documents)
    # Approximate GIS fits cannot establish foot-level disagreement between sources.
    out['reconciliation'] = reconcile([{**l,'geometry':None} if l.get('calibration')=='gis_proposal' else l for l in observations])
    out['conflicts'].extend(i['message'] for i in out['reconciliation'])
    out['drawing_previews'] = [l for l in observations if l.get('sheet_geometry')]
    out['rendering_summary']={'sheet_features':len(out['drawing_previews']),'sheets':len(out['drawing_sheets']),
        'provisional_site_features':sum(l.get('calibration')=='gis_proposal' for l in observations),
        'located_features':sum(bool(l.get('geometry')) for l in observations)}
    parcel = project.get('parcel', {}).get('geometry')
    if not parcel:
        out['gaps'].append('Parcel boundary unavailable.'); return out
    out['parcel_geometry'] = parcel
    try:
        boundary = polygon(parcel)
        projected = transform(TO_LOCAL, boundary)
        excluded = []
        spatial = []
        unlocated_sheets = set()
        unlocated_features = 0
        for item in observations:
            if item.get('review_status') == 'rejected':
                continue
            label = item.get('label', 'Unnamed site feature')
            if not item.get('geometry'):
                if item.get('sheet_geometry'):
                    unlocated_features += 1
                    unlocated_sheets.add((item.get('document_id'),item.get('page')))
                else:
                    out['gaps'].append(f'Missing geometry: {label}')
                continue
            try:
                raw=shape(item['geometry'])
                if raw.geom_type not in ('Polygon','MultiPolygon','LineString','MultiLineString','Point','MultiPoint') or raw.is_empty or not raw.is_valid:
                    raise ValueError('Invalid site feature')
                if not (-180 <= raw.bounds[0] <= raw.bounds[2] <= 180 and -90 <= raw.bounds[1] <= raw.bounds[3] <= 90):
                    raise ValueError('Invalid longitude/latitude')
                geom = transform(TO_LOCAL, raw)
            except (ValueError, TypeError, KeyError):
                out['gaps'].append(f'Invalid geometry: {label}'); continue
            # Extracted geometry requires explicit calibration and source provenance.
            calibrated = not item.get('fact_id') or (
                item.get('crs') == 'EPSG:4326' and item.get('calibration') in ('reviewer_confirmed', 'automatic_control_fit', 'registered_proposal', 'gis_proposal')
                and item.get('document_id') and item.get('page'))
            if not calibrated:
                out['gaps'].append(f'Location needs source calibration: {label}'); continue
            accepted = item.get('review_status') == 'accepted' and (not item.get('fact_id') or item.get('calibration') == 'reviewer_confirmed')
            layer = {**item, 'discipline': item.get('discipline', 'unassigned'),
                     'role': item.get('role', 'reference'), 'label': label,
                     'review_status': 'accepted' if accepted else 'proposed'}
            out['layers'].append(layer)
            spatial.append((layer, geom))
            if not accepted:
                out['gaps'].append(f'Review proposed geometry: {label}')
            if accepted and layer['role'] == 'exclusion' and geom.geom_type in ('Polygon','MultiPolygon'):
                excluded.append(geom)
                out['constraints'].append(layer)
        if unlocated_features:
            out['gaps'].append(f'{unlocated_features} features on {len(unlocated_sheets)} source pages render in drawing coordinates; site alignment remains unresolved. Review their shared drawing frames rather than locating each feature separately.')
        for i, (left, lg) in enumerate(spatial):
            for right, rg in spatial[i + 1:]:
                # Exclusions may legitimately overlap one another. Check design vs exclusion.
                if {left['role'], right['role']} != {'design', 'exclusion'}:
                    continue
                overlap = lg.intersection(rg)
                if not overlap.is_empty and (overlap.area > 0.01 or lg.geom_type not in ('Polygon','MultiPolygon') or rg.geom_type not in ('Polygon','MultiPolygon')):
                    message = f"{left['label']} overlaps {right['label']}; coordination review required."
                    out['conflicts'].append(message)
                    out['spatial_conflicts'].append({'id': f"{left['id']}:{right['id']}",
                        'layer_ids': [left['id'], right['id']], 'message': message,
                        'geometry': mapping(transform(TO_WEB, overlap)),
                        'status': 'coordination_review', 'area_sqft': round(overlap.area, 1)})
        for setback in project.get('setbacks', []):
            if setback.get('review_status') != 'accepted':
                out['gaps'].append('Parcel-edge setback awaits review.'); continue
            distance = float(setback.get('distance_ft', -1))
            edge = shape(setback['edge_geometry'])
            if not edge.is_valid or edge.geom_type not in ('LineString', 'MultiLineString') or not 0 <= distance <= 10000:
                raise ValueError('Invalid parcel-edge setback')
            excluded.append(transform(TO_LOCAL, edge).buffer(distance))
        if not project.get('boundary_reviewed'):
            out['gaps'].append('GIS parcel boundary has not been verified against survey evidence.')
        if not project.get('setbacks'):
            out['gaps'].append('Applicable front, rear and side setbacks have not been established.')
        out['gaps'].append('Environmental, easement, utility, access and other unmapped constraints may remain unresolved.')
        out['assumptions'].append('Reviewer-supplied exclusions and setback distances; numerical code compliance has not been evaluated.')
        if excluded:
            result = projected.difference(unary_union(excluded))
            out.update(status='partial' if not result.is_empty else 'conflict',
                       geometry=mapping(transform(TO_WEB, result)), area_sqft=round(result.area, 1))
            if result.is_empty:
                out['conflicts'].append('No remaining area under the supplied constraints; review assumptions and lawful alternatives.')
        sketch = project.get('geometry')
        if sketch:
            sketch_geom = polygon(sketch)
            if not boundary.covers(sketch_geom):
                out['conflicts'].append('Proposed sketch extends outside the mapped parcel.')
            if excluded and transform(TO_LOCAL, sketch_geom).intersection(unary_union(excluded)).area > 0.01:
                out['conflicts'].append('Proposed sketch overlaps a reviewed exclusion or setback.')
            out['proposed_geometry'] = sketch
            if not excluded:
                out.update(status='partial', geometry=sketch, area_sqft=round(transform(TO_LOCAL, sketch_geom).area, 1))
                out['assumptions'].append('Displayed area is a reviewer sketch, not a calculated building envelope.')
        if not excluded and not sketch:
            out['gaps'].insert(0, 'Add reviewed constraint geometry to calculate a partial preliminary envelope.')
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        out.update(status='cannot_determine', geometry=None, area_sqft=None)
        out['gaps'].insert(0, str(exc))
    return out

def assess(project, documents, facts, coverage, as_of=None):
    as_of = as_of or date.today().isoformat()
    date.fromisoformat(as_of)
    pack = load_pack(project.get('jurisdiction'))
    reviewed = project.get('accepted_facts', {})
    from .classification import classify_review
    classified=classify_review(project,facts,documents)
    active_ids={f['id'] for f in classified if f['classification']['bucket']!='history'}
    machine_ids={f['id'] for f in classified if f['id'] in active_ids and f.get('machine_validation',{}).get('status')=='validated' and not f['classification']['conflict'] and f.get('review_status')!='rejected'}
    facts=[f for f in facts if f['id'] in active_ids]
    nodes = []
    impacts = set(project.get('review_required_nodes', []))
    for definition in ordered_nodes(pack):
        node_id = definition['id']
        related = [f for f in facts if f.get('node_id') == node_id or (node_id == 'X0' and re.search(r'\b(pse|puget sound energy|electrical|electric service|power lines?|energization)\b', json.dumps([f.get('value'), f.get('quote'), f.get('source_quote')]), re.I))]
        accepted = [f for f in facts if f.get('node_id') == node_id and reviewed.get(f['id'], {}).get('review_status') == 'accepted']
        review = project.get('node_reviews', {}).get(node_id, {})
        applicability = review.get('applicability', 'unknown')
        if applicability not in ('required', 'not_applicable') or not review.get('source_url'):
            applicability = 'unknown'
        automated=[f for f in related if f['id'] in machine_ids]
        status = 'evidence_available' if accepted or automated else 'unknown'
        if node_id == 'J0': status = 'identified'
        if applicability == 'not_applicable': status = 'not_applicable'
        if node_id in impacts: status = 'review_required'
        # Expiry only when a date is explicitly reviewed; never derive from generic age.
        expired = any(reviewed[f['id']].get('expires_on') and reviewed[f['id']]['expires_on'] < as_of for f in accepted)
        if expired: status = 'review_required'
        blockers = [e['source'] for e in pack['edges'] if e['target'] == node_id and e['type'] == 'HARD' and next((n['status'] for n in nodes if n['id'] == e['source']), 'unknown') != 'not_applicable']
        reason = 'Evidence or applicability still needs review.'
        if automated: reason='Source-supported evidence extracted and checked automatically; applicability and agency decisions remain separate.'
        if accepted: reason = 'Accepted transcription is available; confirm its relevance and agency acceptance for this proposal.'
        if status == 'review_required': reason = 'Changed inputs or an explicitly reviewed expiry date require impact review; historical agency decisions remain unchanged.'
        if status == 'not_applicable': reason = 'Reviewer-recorded non-applicability with supporting source; not an agency decision.'
        nodes.append({**definition, 'status': status, 'applicability': applicability,
                      'decision': 'unknown', 'freshness': 'revalidation_required' if status == 'review_required' else 'unknown',
                      'stage': 'feasibility', 'evidence_ids': sorted({f['id'] for f in accepted+automated}), 'machine_evidence_ids':[f['id'] for f in automated],
                      'related_evidence_ids': [f['id'] for f in related],
                      'document_ids': sorted({f['document_id'] for f in related if f.get('document_id')}),
                      'source_url': review.get('source_url') or pack['source_url'], 'reason': reason,
                      'blockers': blockers, 'evidence_class': 'model'})
    edges = [{**e, 'id': f"{e['source']}-{e['target']}-{e['type']}"} for e in pack['edges']]
    gaps = [c.get('detail', c.get('message', 'Source coverage incomplete')) for c in coverage if c.get('status') not in ('complete', 'complete-for-query')]
    if not nodes:
        gaps.insert(0, 'Jurisdiction unsupported or unresolved. No county rules have been substituted.')
    actions = [{'id': 'action-' + n['id'], 'node_id': n['id'], 'title': n['title'],
                'status': n['status'], 'reason': n['reason'], 'discipline': n['discipline'],
                'milestone': 'Feasibility', 'source_url': n['source_url'], 'priority': i + 1,
                'dependencies': [e['source'] for e in edges if e['target'] == n['id'] and e['type'] != 'INVALIDATES']}
               for i, n in enumerate(nodes) if n['status'] not in ('identified', 'not_applicable')]
    return {'revision': project['current_revision'], 'rule_version': pack['version'], 'as_of': as_of,
            'nodes': nodes, 'edges': edges, 'actions': actions, 'envelope': envelope(project, facts, documents),
            'coverage_gaps': gaps, 'summary': 'Preliminary research and coordination only. Numeric code rules are not yet activated; unknown requirements remain unresolved. No result authorizes construction.',
            'documents_imported': len(documents)}
