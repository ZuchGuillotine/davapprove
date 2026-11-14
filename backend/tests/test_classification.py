from app.classification import classify_review


def test_relevance_unknowns_and_retention():
    facts = [{'id': 'a', 'value': 'Wetland buffer'}, {'id': 'b', 'value': 'Electrical invoice'}, {'id': 'c', 'value': 'Unrecognized information'}]
    result = {f['id']: f for f in classify_review({}, facts, [])}
    assert result['a']['classification']['bucket'] == 'review_now'
    assert result['b']['classification']['bucket'] == 'later'
    assert result['c']['classification']['bucket'] == 'review_now'
    assert all('classification' not in f for f in facts)


def test_approval_text_and_newer_date_do_not_supersede():
    facts = [{'id': 'a', 'document_id': 'old', 'value': 'Survey approved'}]
    docs = [{'id': 'old'}, {'id': 'new', 'status': 'approved', 'record_date': '2026-11-07'}]
    c = classify_review({}, facts, docs)[0]['classification']
    assert c['bucket'] == 'review_now'
    assert c['authority'] == 'unverified'


def test_explicit_scoped_supersession_and_cross_agency_guard():
    identity = {'permit_id': 'P1', 'agency': 'A', 'jurisdiction': 'J'}
    old = {'id': 'old', **identity}
    new = {'id': 'new', **identity, 'supersession': {'task': 'site_envelope', 'document_ids': ['old'], 'reviewer': 'R', 'citation': 'page 1'}, 'decision_verification': {'decision': 'approved', 'reviewer': 'R', 'citation': 'page 1', 'agency': 'A', 'revision': '2', 'scope': 'site plan'}}
    facts = [{'id': 'a', 'document_id': 'old', 'value': 'Survey'}]
    assert classify_review({}, facts, [old, new])[0]['classification']['bucket'] == 'history'
    new['agency'] = 'B'
    assert classify_review({}, facts, [old, new])[0]['classification']['bucket'] == 'review_now'


def test_conflict_precedes_later_stage_and_review_overlay_is_preserved():
    facts = [{'id': 'a', 'key': 'capacity', 'value': 'Electrical 100'}, {'id': 'b', 'key': 'capacity', 'value': 'Electrical 200'}]
    result = classify_review({'current_revision': 3}, facts, [])
    assert all(f['classification']['conflict'] and f['classification']['bucket'] == 'review_now' for f in result)
    result = classify_review({'accepted_facts': {'a': {'review_status': 'rejected'}}}, facts, [])
    assert next(f for f in result if f['id'] == 'a')['classification']['bucket'] == 'resolved'


def test_spatial_relevance_wins_over_administrative_words():
    f = classify_review({}, [{'id': 'a', 'value': 'Inspection identified septic reserve area conflict'}], [])[0]
    assert f['classification']['relevance'] == 'direct'
    assert f['classification']['bucket'] == 'review_now'
