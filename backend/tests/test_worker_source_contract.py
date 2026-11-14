"""Regression checks for public-source import retries and immutable object integrity."""
import asyncio
import multiprocessing
import time
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import pytest

from app import worker as worker_module
from app.config import Settings
from app.sources import SourceError
from app.store import SQLiteStore
from app.worker import Worker, extract_in_process


def stalled_parser(content, max_pages, connection):
    """Spawn-safe stand-in for a malicious or pathological parser input."""
    time.sleep(30)


def test_parser_timeout_reaps_process_before_return(monkeypatch):
    before = {p.pid for p in multiprocessing.active_children()}
    monkeypatch.setattr(worker_module, "_extract_child", stalled_parser)
    started = time.monotonic()
    with pytest.raises(ValueError, match="timed out"):
        extract_in_process(b"%PDF-1.6", SimpleNamespace(max_pdf_pages=500, job_timeout_seconds=181))
    assert time.monotonic() - started < 10
    assert {p.pid for p in multiprocessing.active_children()} <= before


@pytest.mark.parametrize("retryable,expected", [(True,"queued"),(False,"failed")])
def test_worker_honors_source_retryability(tmp_path, monkeypatch, retryable, expected):
    db = SQLiteStore(tmp_path / "jobs.sqlite3")
    pid, jid = str(uuid4()), str(uuid4())
    db.create_project({"id":pid,"owner_id":"test","current_revision":1}, "test")
    db.save("job", {"id":jid,"project_id":pid,"type":"import","status":"queued","attempts":0})
    worker = Worker(Settings(mode="demo", data_dir=tmp_path), db)
    async def fails(job):
        raise SourceError("source temporarily unreachable", retryable=retryable)
    monkeypatch.setattr(worker, "process", fails)
    asyncio.run(worker.once())
    result = db.record(jid,"job")
    assert result["status"] == expected
    assert result["attempts"] == 1


def test_duplicate_storage_object_must_match_selected_bytes(tmp_path, monkeypatch):
    settings = Settings(mode="supabase", data_dir=tmp_path, supabase_url="https://example.invalid", worker_key="test")
    worker = Worker(settings, store=object())
    response = httpx.Response(400, text='{"error":"Duplicate"}')
    client = MagicMock()
    client.__enter__.return_value.post.return_value = response
    monkeypatch.setattr(worker_module.httpx, "Client", lambda **kwargs: client)
    monkeypatch.setattr(worker, "load_file", lambda document: b"%PDF-1.6 forged object")
    with pytest.raises(ValueError, match="differs"):
        worker.save_file(str(uuid4()),str(uuid4()),b"%PDF-1.6 selected source")


def test_duplicate_storage_object_with_matching_bytes_is_idempotent(tmp_path, monkeypatch):
    settings = Settings(mode="supabase", data_dir=tmp_path, supabase_url="https://example.invalid", worker_key="test")
    worker = Worker(settings, store=object())
    response = httpx.Response(400, text='{"error":"Duplicate"}')
    client = MagicMock()
    client.__enter__.return_value.post.return_value = response
    monkeypatch.setattr(worker_module.httpx, "Client", lambda **kwargs: client)
    content = b"%PDF-1.6 same source"
    monkeypatch.setattr(worker, "load_file", lambda document: content)
    pid,did = str(uuid4()),str(uuid4())
    assert worker.save_file(pid,did,content) == pid+"/"+did+".pdf"
