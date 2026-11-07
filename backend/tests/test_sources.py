"""Source contracts use synthetic fixtures. Live smoke checks are opt-in."""
import asyncio
import json

import httpx
import pytest
from shapely.geometry import Polygon, mapping

from app import sources


def run(value):
    return asyncio.run(value)


def feature(bounds, **attrs):
    x1, y1, x2, y2 = bounds
    return {"geometry": mapping(Polygon([(x1,y1),(x2,y1),(x2,y2),(x1,y2),(x1,y1)])), "properties": attrs}


def test_tax_number_normalization_preserves_zero_and_rejects_sql():
    assert sources.normalize_parcel(" 012201-1-005-2001 ") == "01220110052001"
    assert sources.normalize_parcel("1010156") == "1010156"
    with pytest.raises(sources.SourceError):
        sources.normalize_parcel("123' OR 1=1")


def test_jurisdiction_does_not_use_mailing_city_or_neighbor_touch():
    parcel = Polygon([(0,0),(1,0),(1,1),(0,1)])
    neighbor = feature((1,0,2,1), GMA_JURISDICTION="City of Poulsbo")
    assert sources._classify_jurisdiction(parcel, [neighbor], [], {"CO"})[0] == "kitsap_county"
    city = feature((-1,-1,2,2), GMA_JURISDICTION="City of Poulsbo")
    assert sources._classify_jurisdiction(parcel, [city], [], {"PB"})[0] == "poulsbo"
    assert sources._classify_jurisdiction(parcel, [city], [], {"CO"})[0] == "unknown"
    boundary = feature((0.5,-1,2,2), GMA_JURISDICTION="City of Poulsbo")
    assert sources._classify_jurisdiction(parcel, [boundary], [], {"PB"})[0] == "unknown"
    tribal = feature((0,0,1,1), ZONEBREV="T", GMA_JURISDICTION="Tribal")
    assert sources._classify_jurisdiction(parcel, [], [tribal], {"CO"})[0] == "unsupported"


def test_esri_holes_and_disjoint_parts_preserved():
    geom = sources._esri_geometry([
        [(0,0),(4,0),(4,4),(0,4),(0,0)],
        [(1,1),(2,1),(2,2),(1,2),(1,1)],
        [(5,0),(6,0),(6,1),(5,1),(5,0)],
    ])
    assert geom.area == 16
    assert geom.geom_type == "MultiPolygon"


def record(record_id=1, tax_id="01220110052001"):
    return {"entryId": record_id, "type": -2, "name": "Synthetic septic record", "thumbnailPageCount": 2,
            "metadata": [{"name":"Tax ID","values":[tax_id]}, {"name":"EH Document Type","values":["As built"]},
                         {"name":"Event Date","values":["4/18/2018"]}]}


def test_candidate_requires_exact_tax_match_and_does_not_infer_approval():
    assert sources._lf_candidate(record(), "99999999999999") is None
    result = sources._lf_candidate(record(), "01220110052001")
    assert result["selected"] is False
    assert result["document_url"] is None
    assert result["access"] == "automated"
    assert result["status"] == "Discovered; not reviewed"
    assert result["date"] == "2018-04-18"
    assert "not approval" in result["date_basis"]


def test_discovery_only_requests_metadata(monkeypatch):
    requests = []

    async def fake_request(client, method, url, **kwargs):
        requests.append((method, url, kwargs))
        return b"<html>ordinary session</html>", "text/html"

    async def fake_json(client, url, **kwargs):
        requests.append(("POST", url, kwargs))
        return {"data": {"results": [record()], "hitCount": 1, "searchUUID": "sample"}}

    monkeypatch.setattr(sources, "_request", fake_request)
    monkeypatch.setattr(sources, "_json", fake_json)
    candidates, coverage = run(sources._discover_kphd({"parcel_number":"01220110052001"}))
    assert len(candidates) == 1
    assert coverage["status"] == "complete-for-query"
    assert all("GeneratePDF" not in url and "/PDF10/" not in url and "DocView" not in url for _,url,_ in requests)


def test_source_pagination_is_bounded_and_marked_partial(monkeypatch):
    calls = []

    async def fake_request(*args, **kwargs):
        return b"session", "text/html"

    async def fake_json(client, url, **kwargs):
        calls.append(kwargs["payload"]["startIdx"])
        return {"data": {"results": [record(len(calls))], "hitCount": 500, "searchUUID": "sample"}}

    monkeypatch.setattr(sources, "_request", fake_request)
    monkeypatch.setattr(sources, "_json", fake_json)
    candidates, coverage = run(sources._discover_kphd({"parcel_number":"01220110052001"}))
    assert calls == [0,50,100]
    assert len(candidates) == 3
    assert coverage["status"] == "partial"


def test_fetch_rejects_unregistered_candidate_before_network():
    with pytest.raises(sources.SourceError):
        run(sources.fetch_selected({"source":"User URL", "document_url":"http://127.0.0.1/secrets"}))


def test_url_allowlist_rejects_private_and_nonstandard_urls():
    for url in ["http://secure.kitsappublichealth.org/a", "https://127.0.0.1/a",
                "https://secure.kitsappublichealth.org:444/a", "https://user@secure.kitsappublichealth.org/a"]:
        with pytest.raises(sources.SourceError):
            run(sources._validate_url(url))


def test_response_size_bound(monkeypatch):
    async def safe_url(url):
        return None
    monkeypatch.setattr(sources, "_validate_url", safe_url)

    async def check():
        transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"123456789"))
        async with httpx.AsyncClient(transport=transport) as client:
            with pytest.raises(sources.SourceError):
                await sources._request(client, "GET", sources.KPHD_BASE, max_bytes=8)
    run(check())


@pytest.mark.parametrize("status,expected", [(404,False),(401,False),(429,True),(503,True)])
def test_transient_http_failure_is_explicitly_retryable(monkeypatch, status, expected):
    async def safe_url(url):
        return None
    monkeypatch.setattr(sources, "_validate_url", safe_url)
    async def check():
        transport = httpx.MockTransport(lambda request: httpx.Response(status, content=b"source error"))
        async with httpx.AsyncClient(transport=transport) as client:
            with pytest.raises(sources.SourceError) as error:
                await sources._request(client, "GET", sources.KPHD_BASE)
            assert error.value.retryable is expected
    run(check())


def test_incomplete_metadata_schema_cannot_claim_complete_search(monkeypatch):
    async def fake_request(*args, **kwargs):
        return b"session", "text/html"
    async def fake_json(*args, **kwargs):
        return {"data":{"results":[]}}
    monkeypatch.setattr(sources, "_request", fake_request)
    monkeypatch.setattr(sources, "_json", fake_json)
    with pytest.raises(sources.SourceError):
        run(sources._discover_kphd({"parcel_number":"01220110052001"}))


def test_overall_request_deadline_becomes_retryable_source_error(monkeypatch):
    async def deadline(*args, **kwargs):
        raise TimeoutError()
    monkeypatch.setattr(sources, "_request_bounded", deadline)
    async def check():
        async with httpx.AsyncClient() as client:
            with pytest.raises(sources.SourceError) as error:
                await sources._request(client, "GET", sources.KPHD_BASE)
            assert error.value.retryable is True
    run(check())


def test_failed_jurisdiction_lookup_does_not_fall_back_to_county(monkeypatch):
    async def fake_query(client, layer, **kwargs):
        if layer.endswith("/4"):
            return {"features":[{"attributes":{"ACCT_NO":"012201-1-005-2001","RP_ACCT_ID":1010156,"JURISDICTION":"CO","STREET_ADDR":"Synthetic"}}]}
        if layer == sources.PARCEL_SERVICE + "/0":
            return {"features":[{"geometry":{"rings":[[(0,0),(1,0),(1,1),(0,1),(0,0)]]}}]}
        raise sources.SourceError("offline")

    monkeypatch.setattr(sources, "_query", fake_query)
    parcel = run(sources.lookup_parcel("01220110052001"))
    assert parcel["jurisdiction"] == "unknown"
    assert parcel["source_warnings"] == ["offline"]


def test_selected_export_fetches_only_selected_id(monkeypatch):
    calls = []
    async def fake_request(client, method, url, **kwargs):
        calls.append((url,kwargs))
        if "DocView" in url:
            return b'{"hasPrintRights":true}', "text/html"
        if "GeneratePDF" in url:
            return b"12345678-1234-1234-1234-123456789abc\r\n", "text/html"
        if "/PDF10/" in url:
            return b"%PDF-1.6 synthetic", "application/pdf"
        raise AssertionError(url)
    async def fake_json(client, url, **kwargs):
        calls.append((url,kwargs))
        if "GetDocumentInfo" in url:
            return {"data":{"pageCount":2}}
        return {"data":{"finished":True,"success":True}}
    monkeypatch.setattr(sources, "_request", fake_request)
    monkeypatch.setattr(sources, "_json", fake_json)
    selected = sources._lf_candidate(record(17), "01220110052001")
    result = run(sources.fetch_selected(selected))
    assert result["content"].startswith(b"%PDF-")
    export = next(kwargs for url,kwargs in calls if "GeneratePDF" in url)
    assert export["params"]["key"] == "17"
    assert len([url for url,kwargs in calls if "/PDF10/" in url]) == 1
