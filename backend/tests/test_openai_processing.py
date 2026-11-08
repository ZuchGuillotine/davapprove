import json
import re
from types import SimpleNamespace

import httpx
import pytest

from app import openai_processing as ai
from app.store import SQLiteStore


def setup(tmp_path):
    settings = SimpleNamespace(openai_api_key='test-only', ai_model='gpt-4.1-mini-2025-04-14',
        ai_input_per_million=.4, ai_output_per_million=1.6, ai_monthly_usd=5, max_pdf_pages=500)
    db = SQLiteStore(tmp_path / 'db.sqlite')
    document = {'id': 'doc', 'project_id': 'project', 'page_count': 1}
    return settings, db, document


def fact(page=1, quote='REAL', **extra):
    return dict(page=page, quote=quote, value='Observed evidence', node_id='E0',
                evidence_type='text_quote', region=None, confidence='medium') | extra


def client(monkeypatch, responder):
    calls = []
    class Response:
        def __init__(self, payload): self.payload = payload
        def raise_for_status(self): pass
        def json(self): return self.payload
    class Client:
        def __init__(self, **kwargs): assert kwargs['follow_redirects'] is False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, **kwargs):
            assert url == 'https://api.openai.com/v1/responses'
            request = kwargs['json']; calls.append(request)
            assert request['store'] is False and request['text']['format']['strict'] is True
            facts = responder(request)
            return Response({'id': 'response', 'status': 'completed',
                'usage': {'input_tokens': 10, 'output_tokens': 20},
                'output': [{'type': 'message', 'content': [{'type': 'output_text',
                   'text': json.dumps({'facts': facts})}]}]})
    monkeypatch.setattr(ai.httpx, 'Client', Client)
    return calls


def test_unicode_chunks_cover_every_character():
    text = '漢字é🙂 abc' * 7000
    chunks = list(ai._text_segments(text))
    covered = set()
    for start, end, segment in chunks:
        assert segment == text[start:end]
        assert len(segment.encode()) <= ai.CHUNK_BYTES
        covered.update(range(start, end))
    assert covered == set(range(len(text)))


def test_full_document_last_page_and_resumable_cache(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    doc['page_count'] = 3
    pages = [{'page': 1, 'text': 'x' * 25000}, {'page': 2, 'text': 'middle'}, {'page': 3, 'text': 'REAL last page'}]
    def respond(request):
        prompt = request['input'][0]['content'][0]['text']
        return [fact(page=3)] if prompt.startswith('Original page 3.') else []
    calls = client(monkeypatch, respond)
    facts, warning = ai.extract_openai(settings, db, doc, pages)
    assert len(calls) == 5 and facts[0]['page'] == 3 and warning is None
    assert doc['ai_processing']['processed_pages'] == 3
    cost = db.db.execute('select sum(amount) from ai_usage').fetchone()[0]
    again, warning = ai.extract_openai(settings, db, doc, pages)
    assert again == facts and len(calls) == 5
    assert db.db.execute('select sum(amount) from ai_usage').fetchone()[0] == cost
    assert all(f['review_status'] == 'proposed' for f in facts)


def test_citations_and_visual_evidence_are_distinct(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    monkeypatch.setattr(ai, '_render_image', lambda *args: ('data:image/jpeg;base64,/9g=', 'imagehash'))
    def respond(request):
        if len(request['input'][0]['content']) == 2:
            return [fact(quote='', evidence_type='visual_observation', region='upper right handwritten note'),
                    fact(quote='', evidence_type='visual_observation', region=None)]
        return [fact(), fact(quote='invented'), fact(page=2)]
    calls = client(monkeypatch, respond)
    facts, warning = ai.extract_openai(settings, db, doc, [{'page': 1, 'text': 'REAL', 'needs_vision': True}])
    assert len(calls) == 2 and len(facts) == 2
    visual = next(f for f in facts if f['evidence_type'] == 'visual_observation')
    assert visual['quote'] == '' and visual['source_region']['image_sha256'] == 'imagehash'
    assert visual['source_region']['geometry_calibrated'] is False
    assert 'unsupported' in warning
    assert doc['ai_processing']['status'] == 'complete'


def test_uncertain_failure_never_repeats_charge(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    def fail(request): raise httpx.ReadTimeout('uncertain')
    calls = client(monkeypatch, fail)
    pages = [{'page': 1, 'text': 'REAL'}]
    assert ai.extract_openai(settings, db, doc, pages)[0] == []
    assert doc['ai_processing']['failed_chunks'] == 1
    ai.extract_openai(settings, db, doc, pages)
    assert len(calls) == 1
    assert db.db.execute('select count(*) from ai_usage').fetchone()[0] == 1


def test_budget_pause_can_resume_without_skipping_pages(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    settings.ai_monthly_usd = 0
    calls = client(monkeypatch, lambda request: [fact()])
    pages = [{'page': 1, 'text': 'REAL'}]
    ai.extract_openai(settings, db, doc, pages)
    assert not calls and doc['ai_processing']['status'] == 'budget_paused'
    settings.ai_monthly_usd = 5
    facts, warning = ai.extract_openai(settings, db, doc, pages)
    assert len(calls) == len(facts) == 1 and warning is None


def test_missing_page_and_render_failure_are_not_complete(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    doc['page_count'] = 3
    def fail(*args): raise ValueError('bad PDF')
    monkeypatch.setattr(ai, '_render_image', fail)
    client(monkeypatch, lambda request: [fact()])
    ai.extract_openai(settings, db, doc, [{'page': 1, 'text': 'REAL'}, {'page': 2, 'needs_vision': True}])
    coverage = doc['ai_processing']
    assert coverage['processed_pages'] == 1 and coverage['unreadable_pages'] == 1
    assert coverage['failed_chunks'] == 1 and coverage['status'] == 'partial'


def test_checksum_mismatch_prevents_inference(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    doc['sha256'] = 'wrong'
    calls = client(monkeypatch, lambda request: [])
    with pytest.raises(ValueError, match='checksum'):
        ai.extract_openai(settings, db, doc, [{'page': 1, 'text': 'REAL'}], b'pdf')
    assert not calls


def test_short_remaining_deadline_leaves_resumable_pending(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    settings.openai_max_run_seconds = 1
    calls = client(monkeypatch, lambda request: [])
    ai.extract_openai(settings, db, doc, [{'page': 1, 'text': 'REAL'}])
    assert not calls and doc['ai_processing']['pending_pages'] == 1
    assert db.db.execute('select count(*) from ai_usage').fetchone()[0] == 0


def test_cancelled_before_chunk_makes_no_paid_call(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    calls = client(monkeypatch, lambda request: [fact()])
    facts, warning = ai.extract_openai(settings, db, doc, [{'page': 1, 'text': 'REAL'}], is_active=lambda: False)
    assert not calls and not facts and warning
    assert doc['ai_processing']['status'] == 'partial'
    assert 'cancelled' in doc['ai_processing']['page_manifest'][0]['issues'][0]


def test_cancellation_during_render_prevents_reservation(tmp_path, monkeypatch):
    settings, db, doc = setup(tmp_path)
    active = [True]
    def render(*args):
        active[0] = False
        return 'data:image/jpeg;base64,/9g=', 'imagehash'
    monkeypatch.setattr(ai, '_render_image', render)
    calls = client(monkeypatch, lambda request: [])
    ai.extract_openai(settings, db, doc, [{'page': 1, 'needs_vision': True}], is_active=lambda: active[0])
    assert not calls and db.db.execute('select count(*) from ai_usage').fetchone()[0] == 0
