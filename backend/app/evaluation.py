"""Pure, conservative feasibility evaluation; no result authorizes construction."""
import json
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
    for key in ('geometry', 'constraints', 'setbacks', 'accepted_facts'):
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

def envelope(project):
    out = {'status': 'cannot_determine', 'geometry': None, 'area_sqft': None,
           'assumptions': [], 'gaps': [], 'conflicts': [], 'constraints': [],
           'code_checked': False}
    parcel = project.get('parcel', {}).get('geometry')
    if not parcel:
        out['gaps'].append('Parcel boundary unavailable.'); return out
    out['parcel_geometry'] = parcel
    try:
        boundary = polygon(parcel)
        projected = transform(TO_LOCAL, boundary)
        excluded = []
        for item in project.get('constraints', []):
            if item.get('review_status') != 'accepted':
                out['gaps'].append(f"Review constraint: {item.get('label', 'unnamed constraint')}"); continue
            if not item.get('geometry'):
                out['gaps'].append(f"Missing geometry: {item.get('label', 'constraint')}"); continue
            geom = polygon(item['geometry'])
            excluded.append(transform(TO_LOCAL, geom))
            out['constraints'].append(item)
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
    nodes = []
    impacts = set(project.get('review_required_nodes', []))
    for definition in ordered_nodes(pack):
        node_id = definition['id']
        accepted = [f for f in facts if f.get('node_id') == node_id and reviewed.get(f['id'], {}).get('review_status') == 'accepted']
        review = project.get('node_reviews', {}).get(node_id, {})
        applicability = review.get('applicability', 'unknown')
        if applicability not in ('required', 'not_applicable') or not review.get('source_url'):
            applicability = 'unknown'
        status = 'evidence_available' if accepted else 'unknown'
        if node_id == 'J0': status = 'identified'
        if applicability == 'not_applicable': status = 'not_applicable'
        if node_id in impacts: status = 'review_required'
        # Expiry only when a date is explicitly reviewed; never derive from generic age.
        expired = any(reviewed[f['id']].get('expires_on') and reviewed[f['id']]['expires_on'] < as_of for f in accepted)
        if expired: status = 'review_required'
        blockers = [e['source'] for e in pack['edges'] if e['target'] == node_id and e['type'] == 'HARD' and next((n['status'] for n in nodes if n['id'] == e['source']), 'unknown') != 'not_applicable']
        reason = 'Evidence or applicability still needs review.'
        if accepted: reason = 'Accepted transcription is available; confirm its relevance and agency acceptance for this proposal.'
        if status == 'review_required': reason = 'Changed inputs or an explicitly reviewed expiry date require impact review; historical agency decisions remain unchanged.'
        if status == 'not_applicable': reason = 'Reviewer-recorded non-applicability with supporting source; not an agency decision.'
        nodes.append({**definition, 'status': status, 'applicability': applicability,
                      'decision': 'unknown', 'freshness': 'revalidation_required' if status == 'review_required' else 'unknown',
                      'stage': 'feasibility', 'evidence_ids': [f['id'] for f in accepted],
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
            'nodes': nodes, 'edges': edges, 'actions': actions, 'envelope': envelope(project),
            'coverage_gaps': gaps, 'summary': 'Preliminary research and coordination only. Numeric code rules are not yet activated; unknown requirements remain unresolved. No result authorizes construction.',
            'documents_imported': len(documents)}
