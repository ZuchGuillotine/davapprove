"""Read-only public-source adapters. Discovery never downloads document bytes.

Endpoint provenance and known coverage limitations: docs/research/source-access-matrix.md.
Do not use source-reported metadata as accepted evidence or a legal determination.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import re
import socket
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin, urlparse

import httpx
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

PARCEL_SERVICE = "https://utility.arcgis.com/usrsvcs/servers/6472a56bd5b1442ea048226ea8f622d5/rest/services/Public/Parcels/MapServer"
PREP_LAYER = "https://utility.arcgis.com/usrsvcs/servers/35500cef8d084ae09d100ab6ad1e3d5e/rest/services/DCD/DCD_Permit_Review/MapServer/0"
CITY_LAYER = "https://utility.arcgis.com/usrsvcs/servers/ab1e2df696934ea79c1b03f4a6a626f6/rest/services/Public/Jurisdiction_Outlines/MapServer/3"
ZONE_LAYER = "https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Zoning_Designations/FeatureServer/0"
POULSBO_ZONE_LAYER = "https://services9.arcgis.com/em8ydubtfJ7H3Rlq/arcgis/rest/services/Zoning/FeatureServer/0"
KPHD_BASE = "https://secure.kitsappublichealth.org/WebLink/"
PREP_URL = "https://experience.arcgis.com/experience/29469422ff88417c9cc729e235c3bca0/"
KPHD_SOURCE = "KPHD scanned records"
HEADERS = {"User-Agent": "Davapprove/0.1 (bounded public parcel research)", "Accept": "application/json,text/html"}
ALLOWED_HOSTS = frozenset({"utility.arcgis.com", "services6.arcgis.com", "services9.arcgis.com", "secure.kitsappublichealth.org", "co-kitsap-wa.smartgovcommunity.com", "paladin-sg-prod-blobs.s3.amazonaws.com"})
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_DOCUMENT_BYTES = 250 * 1024 * 1024
MAX_PAGES = 500


class SourceError(Exception):
    """Recoverable source failure; caller should preserve other successful results."""

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_parcel(value: str) -> str:
    normalized = re.sub(r"[\s-]", "", value)
    if not re.fullmatch(r"\d{14}|\d{7}", normalized):
        raise SourceError("Enter a 14-digit tax parcel number or a 7-digit assessor account ID.")
    return normalized


def _formatted_tax_id(number: str) -> str:
    return f"{number[:6]}-{number[6]}-{number[7:10]}-{number[10:]}"


async def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.port not in (None, 443) or parsed.username:
        raise SourceError("Source URL is not an approved public HTTPS endpoint.")
    if parsed.hostname == 'paladin-sg-prod-blobs.s3.amazonaws.com' and not re.fullmatch(r'/jur-blobs/co-kitsap-wa/Note/[0-9a-fA-F-]{36}', parsed.path):
        raise SourceError('County storage redirect is outside the verified attachment path.')
    try:
        addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, 443, 0, socket.SOCK_STREAM)
    except OSError as exc:
        raise SourceError("The public source could not be resolved.", retryable=True) from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise SourceError("Source resolved to a non-public address.")


async def _request(client: httpx.AsyncClient, method: str, url: str, *, params=None, payload=None,
                   max_bytes=MAX_METADATA_BYTES) -> tuple[bytes, str]:
    # HTTP read timeouts reset for each chunk. An overall deadline also prevents a
    # slow/trickling public response from holding the single worker indefinitely.
    try:
        async with asyncio.timeout(180 if max_bytes > MAX_METADATA_BYTES else 45):
            return await _request_bounded(client, method, url, params=params, payload=payload, max_bytes=max_bytes)
    except TimeoutError as exc:
        raise SourceError("Public source exceeded the request deadline.", retryable=True) from exc


async def _request_bounded(client: httpx.AsyncClient, method: str, url: str, *, params=None, payload=None,
                           max_bytes=MAX_METADATA_BYTES) -> tuple[bytes, str]:
    """Bound response bytes and validate every redirect, never forwarding credentials."""
    for _ in range(5):
        await _validate_url(url)
        kwargs = {"params": params}
        if payload is not None:
            kwargs["json"] = payload
        try:
            async with client.stream(method, url, **kwargs) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise SourceError("Source returned an incomplete redirect.")
                    url = urljoin(str(response.url), location)
                    params = None
                    if response.status_code in (301, 302, 303):
                        method, payload = "GET", None
                    continue
                response.raise_for_status()
                length = response.headers.get("content-length", "")
                if length.isdigit() and int(length) > max_bytes:
                    raise SourceError("Source response exceeds the configured size limit.")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > max_bytes:
                        raise SourceError("Source response exceeds the configured size limit.")
                return bytes(content), response.headers.get("content-type", "")
        except httpx.HTTPError as exc:
            retryable = isinstance(exc, httpx.TransportError)
            if isinstance(exc, httpx.HTTPStatusError):
                retryable = exc.response.status_code in (408, 429) or exc.response.status_code >= 500
            raise SourceError(f"Public source unavailable ({type(exc).__name__}). Retry or open its portal.", retryable=retryable) from exc
    raise SourceError("Public source redirected too many times.")


async def _json(client, url, *, params=None, payload=None):
    content, _ = await _request(client, "POST" if payload is not None else "GET", url, params=params, payload=payload)
    try:
        result = json.loads(content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise SourceError("Public source returned an unexpected response format.") from exc
    if not isinstance(result, dict) or result.get("error"):
        code = (result.get("error") or {}).get("code") if isinstance(result, dict) and isinstance(result.get("error"), dict) else None
        raise SourceError("Public GIS source rejected the query; no access restrictions were bypassed.", retryable=code in (408, 429, 500, 502, 503, 504))
    return result


async def _query(client, layer, **params):
    return await _json(client, layer + "/query", params={"f": "json", "returnGeometry": "false", "resultRecordCount": 100, **params})


def _esri_geometry(rings):
    """Parity nesting preserves holes and islands independently of ring orientation."""
    result = Polygon()
    for ring in rings:
        polygon = Polygon(ring)
        if not polygon.is_valid:
            raise SourceError("Source parcel contains invalid geometry and needs review.")
        result = result.symmetric_difference(polygon)
    if result.is_empty or result.geom_type not in ("Polygon", "MultiPolygon") or not result.is_valid:
        raise SourceError("Parcel geometry could not be resolved safely.")
    return result


def _spatial_params(geometry):
    return {"geometry": ",".join(str(x) for x in geometry.bounds), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outSR": 4326,
            "returnGeometry": "true"}


def _feature_geometry(feature):
    value = feature.get("geometry") or {}
    return shape(value) if value.get("type") else _esri_geometry(value.get("rings", []))


def _classify_jurisdiction(parcel_geometry, city_features, zone_features, address_codes):
    # Require positive-area overlap, excluding a neighboring boundary touch.
    overlaps = {}
    for feature in city_features:
        attrs = feature.get("attributes", feature.get("properties", {}))
        geom = _feature_geometry(feature)
        if parcel_geometry.intersection(geom).area > parcel_geometry.area * 0.000001:
            name = str(attrs.get("GMA_JURISDICTION", ""))
            overlaps.setdefault(name, []).append(geom)
    special = []
    for feature in zone_features:
        attrs = feature.get("attributes", feature.get("properties", {}))
        if str(attrs.get("ZONEBREV", "")).upper() in {"T", "MIL"}:
            if parcel_geometry.intersection(_feature_geometry(feature)).area > parcel_geometry.area * 0.000001:
                special.append(attrs.get("GMA_JURISDICTION") or attrs.get("ZONEBREV"))
    if special:
        return "unsupported", "Possible tribal/federal tenure: " + ", ".join(sorted(set(special)))
    if len(overlaps) > 1:
        return "unknown", "Parcel intersects multiple city boundaries; confirm jurisdiction."
    if overlaps:
        name, geometries = next(iter(overlaps.items()))
        fraction = parcel_geometry.intersection(unary_union(geometries)).area / parcel_geometry.area
        if fraction < 0.999:
            return "unknown", "Parcel crosses a municipal boundary; confirm the work-area jurisdiction."
        if "poulsbo" in name.lower():
            if address_codes and not address_codes <= {"PB"}:
                return "unknown", "Parcel address jurisdiction conflicts with city boundary data."
            return "poulsbo", "Inside published City of Poulsbo boundary; tenure still requires confirmation."
        return "unsupported", name
    if address_codes and not address_codes <= {"CO"}:
        return "unknown", "Parcel address jurisdiction conflicts with municipal boundary data."
    return "kitsap_county", "Outside published incorporated boundaries; screening does not establish land tenure."


async def lookup_parcel(parcel_number: str) -> dict:
    """Return real parcel identity and geometry, or an explicit recoverable error."""
    number = normalize_parcel(parcel_number)
    where = f"RP_ACCT_ID = {int(number)}" if len(number) == 7 else f"ACCT_NO = '{_formatted_tax_id(number)}'"
    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        records = await _query(client, PARCEL_SERVICE + "/4", where=where,
                               outFields="ACCT_NO,RP_ACCT_ID,JURISDICTION,STREET_ADDR,PRIMARY_FLAG")
        rows = [f["attributes"] for f in records.get("features", [])]
        ids = {r.get("RP_ACCT_ID") for r in rows}
        if not rows:
            raise SourceError("No parcel matched the county account index. Check the number or research parcel history.")
        if len(ids) != 1 or records.get("exceededTransferLimit"):
            raise SourceError("Parcel identity is ambiguous or the account result is incomplete. Confirm with the assessor.")
        account_id = int(next(iter(ids)))
        tax_id = normalize_parcel(rows[0]["ACCT_NO"])
        geometry_result = await _query(client, PARCEL_SERVICE + "/0",
            where=f"GISPUB.GIS.PARCEL_PARCELS_RP_POLY.RP_ACCT_ID = {account_id}",
            outFields="GISPUB.GIS.PARCEL_PARCELS_RP_POLY.RP_ACCT_ID", returnGeometry="true", outSR=4326)
        if geometry_result.get("exceededTransferLimit") or not geometry_result.get("features"):
            raise SourceError("Parcel outline is missing or incomplete; no envelope can be generated.")
        geometry = unary_union([_feature_geometry(f) for f in geometry_result["features"]])
        if geometry.is_empty or not geometry.is_valid:
            raise SourceError("Parcel outline is invalid and requires review.")
        jurisdiction, reason = "unknown", "Jurisdiction sources unavailable. Confirm before applying local rules."
        source_warnings = []
        try:
            cities, zones = await asyncio.gather(
                _query(client, CITY_LAYER, where="SYMBOL = 2", outFields="GMA_JURISDICTION,SYMBOL", **_spatial_params(geometry)),
                _query(client, ZONE_LAYER, where="ZONEBREV IN ('T','MIL')", outFields="ZONEBREV,GMA_JURISDICTION", **_spatial_params(geometry)))
            if cities.get("exceededTransferLimit") or zones.get("exceededTransferLimit"):
                raise SourceError("Jurisdiction overlay query is incomplete.")
            jurisdiction, reason = _classify_jurisdiction(geometry, cities.get("features", []), zones.get("features", []),
                                                         {r["JURISDICTION"] for r in rows if r.get("JURISDICTION")})
        except SourceError as exc:
            source_warnings.append(str(exc))
        addresses = list(dict.fromkeys(r["STREET_ADDR"] for r in rows if r.get("STREET_ADDR")))
        return {"id": tax_id, "parcel_number": tax_id, "account_id": account_id,
                "address": addresses[0] if addresses else "Address unavailable", "address_aliases": addresses,
                "jurisdiction": jurisdiction, "jurisdiction_reason": reason,
                "geometry": mapping(geometry), "geometry_accuracy": "assessor GIS; not a boundary survey",
                "source_url": PARCEL_SERVICE, "retrieved_at": _now(), "source_warnings": source_warnings,
                "source_mode": "live", "tenure_status": "unconfirmed"}


def _coverage(source, status, detail, url, **extra):
    return {"source": source, "status": status, "detail": detail, "url": url, "retrieved_at": _now(), **extra}


def _lf_search_url(tax_id):
    expression = '{[Environmental Health]:[Tax ID]="' + tax_id + '"}'
    return KPHD_BASE + "Search.aspx?" + urlencode({"dbid": 0, "searchcommand": expression}), expression


def _lf_candidate(record, tax_id):
    fields = {m["name"]: m.get("values", []) for m in record.get("metadata", [])}
    matched = [re.sub(r"[\s-]", "", str(v)) for v in fields.get("Tax ID", [])]
    if tax_id not in matched or record.get("type") != -2:
        return None
    record_id = str(record.get("entryId", ""))
    if not record_id.isdigit():
        return None
    count = int(record.get("thumbnailPageCount") or 0)
    kind = next(iter(fields.get("EH Document Type", [])), "Public health record")
    event_date = next(iter(fields.get("Event Date", [])), "")
    # Event date is source metadata, not an approval/expiration date.
    date = None
    if event_date:
        try:
            date = datetime.strptime(event_date, "%m/%d/%Y").date().isoformat()
        except ValueError:
            pass
    url = KPHD_BASE + "DocView.aspx?" + urlencode({"id": record_id, "dbid": 0})
    return {"id": "kphd-" + record_id, "external_id": record_id, "title": record.get("name") or kind,
            "source": KPHD_SOURCE, "source_url": url, "url": url, "document_url": None,
            "document_type": kind, "date": date, "date_basis": "Event Date metadata; not approval or expiry",
            "match_reason": f"Exact Tax ID metadata match: {tax_id}", "parcel_number": tax_id,
            "access": "automated" if 0 < count <= MAX_PAGES else "manual",
            "access_method": "selected PDF export" if count else "portal review",
            "retrieval_method": "laserfiche_pdf" if 0 < count <= MAX_PAGES else None,
            "page_count": count, "size_bytes": None, "status": "Discovered; not reviewed",
            "retrieved_at": _now(), "selected": False}


async def _discover_kphd(parcel):
    number = normalize_parcel(parcel["parcel_number"])
    if len(number) != 14:
        raise SourceError("KPHD requires a resolved 14-digit tax parcel number.")
    url, expression = _lf_search_url(number)
    candidates, search_uuid, hit_count = [], "", 0
    async with httpx.AsyncClient(timeout=20, headers={**HEADERS, "X-Lf-Suppress-Login-Redirect": "1"}) as client:
        await _request(client, "GET", url)  # Establish the ordinary public browser session.
        for page in range(3):
            response = await _json(client, KPHD_BASE + "SearchService.aspx/GetSearchListing", payload={
                "repoName": "Laserfiche", "searchSyn": expression, "searchUuid": search_uuid,
                "sortColumn": "", "startIdx": page * 50, "endIdx": (page + 1) * 50,
                "getNewListing": page == 0, "sortOrder": 0, "displayInGridView": False})
            data = response.get("data", {})
            if not isinstance(data, dict) or data.get("failed") or not isinstance(data.get("results"), list) or "hitCount" not in data:
                raise SourceError("KPHD public search is unavailable or requires manual access.")
            search_uuid = data.get("searchUUID", "")
            hit_count = int(data.get("hitCount") or 0)
            for record in data["results"]:
                candidate = _lf_candidate(record, number)
                if candidate:
                    candidates.append(candidate)
            if (page + 1) * 50 >= hit_count or not data["results"]:
                break
    candidates = list({c["id"]: c for c in candidates}.values())
    complete = hit_count <= 150
    return candidates, _coverage(KPHD_SOURCE, "complete-for-query" if complete else "partial",
        f"Exact tax-ID search returned {len(candidates)} matching documents. "
        "No files downloaded. Address aliases, historic parcel IDs and unindexed records may contain more evidence."
        + (" First 150 results only; refine in the portal." if not complete else ""), url,
        query_scope="Exact current Tax ID; document metadata only", total_hits=hit_count)


async def _discover_prep(parcel):
    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        fields = "ACCT_NO,PREPClassification,PREPNotes,ZONE_CODE,StreamsRed,SurfaceWaterRed,WetlandHydricSoilRed,GeohazardRed,FloodZoneRed,TimberMoratoriumRed,ShorelineRed,StreamsYellow,SurfaceWaterYellow,WetlandHydricYellow,GeohazardYellow,SeismicHazardYellow"
        data = await _query(client, PREP_LAYER, where=f"ACCT_NO = '{_formatted_tax_id(parcel['parcel_number'])}'", outFields=fields)
        attrs = [f["attributes"] for f in data.get("features", [])]
        return {"records": attrs, "source_url": PREP_LAYER, "retrieved_at": _now(),
                "kind": "screening", "not_a_delineation": True}, _coverage("County PREP", "complete-for-query",
            "County screening metadata only; mapped indicators do not define accepted constraint geometry."
            if attrs else "No county PREP record found. This does not establish absence of environmental constraints.", PREP_URL)


async def _discover_zoning(parcel):
    city = parcel.get("jurisdiction") == "poulsbo"
    layer = POULSBO_ZONE_LAYER if city else ZONE_LAYER
    fields = "Zone_Code,Zone_Description,Zone_2022" if city else "ZONEBREV,ZONE_DESCRIPTION,GMA_JURISDICTION"
    geometry = shape(parcel["geometry"])
    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        data = await _query(client, layer, where="1=1", outFields=fields, **_spatial_params(geometry))
        zones = []
        for feature in data.get("features", []):
            polygon = _feature_geometry(feature)
            if polygon.intersection(geometry).area <= geometry.area * 0.000001:
                continue
            attrs = feature.get("attributes", {})
            zones.append({"code": attrs.get("Zone_Code") if city else attrs.get("ZONEBREV"),
                          "description": attrs.get("Zone_Description") if city else attrs.get("ZONE_DESCRIPTION"),
                          "geometry": mapping(polygon), "source_attributes": attrs})
        return {"zones": zones, "source_url": layer, "kind": "screening", "retrieved_at": _now()}, _coverage(
            "Poulsbo zoning" if city else "County zoning", "partial" if data.get("exceededTransferLimit") else "complete-for-query",
            "Published map designations only; adopted code, amendments and project-specific conditions require review.", layer)


async def _discover_county(parcel):
    from .county_records import BASE, SOURCE, parcel_ids, attachments
    number = normalize_parcel(parcel['parcel_number'])
    url = BASE + '/Parcels/ParcelSearch?' + urlencode({'query': _formatted_tax_id(number), '_conv': 1})
    found=[]
    async with httpx.AsyncClient(timeout=30, headers=HEADERS) as client:
        content,_ = await _request(client, 'GET', url)
        html=content.decode('utf-8', errors='replace')
        ids=parcel_ids(html)
        if not ids and 'No results found' not in html:
            raise SourceError('County search response could not be interpreted; portal review required.')
        for ident in ids[:5]:
            detail=BASE+'/Parcels/ParcelDetail/Index/'+ident
            content,_=await _request(client,'GET',detail)
            html=content.decode('utf-8',errors='replace')
            if _formatted_tax_id(number) not in html:
                raise SourceError('County parcel detail did not confirm the requested tax ID.')
            found.extend(attachments(html,number,detail))
    unique={}
    for c in found:
        unique.setdefault(c['external_id'],{**c,'retrieved_at':_now()})
    return list(unique.values()), _coverage(SOURCE, 'partial',
        f"Found {len(unique)} public PDF attachments across {min(len(ids),5)} parcel records. "
        "Metadata only; revisions may coexist. Unpublished attachments, historical records and auditor records remain outside this search.",
        url, query_scope='Exact formatted current tax ID; up to 5 public parcel detail records')


async def discover_records(parcel: dict) -> dict:
    coverage, candidates, screening = [], [], {}
    try:
        found, status = await _discover_kphd(parcel)
        candidates.extend(found)
        coverage.append(status)
    except (SourceError, ValueError, KeyError) as exc:
        coverage.append(_coverage(KPHD_SOURCE, "unavailable", str(exc), "https://secure.kitsappublichealth.org/irecordsearch/"))
    if parcel.get("jurisdiction") == "kitsap_county":
        try:
            screening, status = await _discover_prep(parcel)
            coverage.append(status)
        except (SourceError, ValueError) as exc:
            coverage.append(_coverage("County PREP", "unavailable", str(exc), PREP_URL))
    else:
        coverage.append(_coverage("County PREP", "not-searched", "County PREP is not a substitute for city environmental rules.", PREP_URL))
    if parcel.get("jurisdiction") in {"kitsap_county", "poulsbo"}:
        try:
            zoning, status = await _discover_zoning(parcel)
            screening["zoning"] = zoning
            coverage.append(status)
        except (SourceError, ValueError) as exc:
            coverage.append(_coverage("Zoning", "unavailable", str(exc), "https://poulsbo.gov/codes-amendments-maps/" if parcel.get("jurisdiction") == "poulsbo" else PREP_URL))
    if parcel.get('jurisdiction') == 'kitsap_county':
        try:
            found,status=await _discover_county(parcel)
            candidates.extend(found);coverage.append(status)
        except (SourceError,ValueError,KeyError) as exc:
            coverage.append(_coverage('Kitsap county permit attachments','unavailable',str(exc),'https://co-kitsap-wa.smartgovcommunity.com/Public/Home'))
    number = parcel["parcel_number"]
    permit_url = ("https://ci-poulsbo-wa.smartgovcommunity.com/Public/Home" if parcel.get("jurisdiction") == "poulsbo"
                  else "https://co-kitsap-wa.smartgovcommunity.com/Parcels/ParcelHome/?" + urlencode({"parcelSearch": _formatted_tax_id(number)}))
    coverage.extend([
        _coverage("Permit history", "manual-access", "Review portal decisions and any records absent from attachment discovery. Search the formatted tax ID; missing public attachments do not establish absence.", permit_url),
        _coverage("Recorded surveys and easements", "manual-access", "Search tax parcel and legal description. An empty index is not a title clearance; upload selected records.", "https://kcwaimg.kitsap.gov/recorder/web/"),
        _coverage("Water and sewer availability", "manual-access", "Obtain site-specific availability/capacity evidence from the responsible provider.", "https://poulsbo.gov/engineering/" if parcel.get("jurisdiction") == "poulsbo" else "https://www.kitsappublichealth.org/dwos/privatewells"),
    ])
    return {"candidates": candidates, "coverage": coverage, "screening": screening, "retrieved_at": _now()}


async def discover(parcel_id: str) -> dict:
    parcel = await lookup_parcel(parcel_id)
    return {"parcel": parcel, **await discover_records(parcel)}


async def fetch_selected(candidate: dict, max_bytes: int = MAX_DOCUMENT_BYTES) -> dict:
    try:
        async with asyncio.timeout(300):
            return await _fetch_selected(candidate, max_bytes)
    except TimeoutError as exc:
        raise SourceError("Selected public document import exceeded its five-minute deadline.", retryable=True) from exc


async def _fetch_selected(candidate: dict, max_bytes: int = MAX_DOCUMENT_BYTES) -> dict:
    """Call only after authorization of a server-stored candidate selection manifest.

    Download a user-selected scanned record through the portal's published PDF export.
    Export is bounded and session-specific; document URLs must not be supplied by callers.
    """
    from .county_records import BASE, SOURCE, UUID
    if candidate.get('source') == SOURCE and candidate.get('retrieval_method') == 'county_blob':
        ident=str(candidate.get('external_id',''))
        if candidate.get('access') != 'automated' or not re.fullmatch(UUID,ident):
            raise SourceError('Invalid county attachment identifier.')
        url=BASE+'/Blob/'+ident
        async with httpx.AsyncClient(timeout=30,headers=HEADERS) as client:
            data,_=await _request(client,'GET',url,max_bytes=min(max_bytes,MAX_DOCUMENT_BYTES))
        if not data.startswith(b'%PDF-'):
            raise SourceError('County attachment did not return a PDF; review public access in the portal.')
        return {'content':data,'filename':'county-'+ident+'.pdf','content_type':'application/pdf',
                'source_url':url,'sha256':hashlib.sha256(data).hexdigest(),'retrieved_at':_now()}
    record_id = str(candidate.get("external_id", ""))
    if candidate.get("source") != KPHD_SOURCE or candidate.get("retrieval_method") != "laserfiche_pdf" or not record_id.isdigit():
        raise SourceError("This record requires manual portal download and upload.")
    if candidate.get("access") != "automated":
        raise SourceError("This record is not available for automated import.")
    max_bytes = min(max_bytes, MAX_DOCUMENT_BYTES)
    url = KPHD_BASE + "DocView.aspx?" + urlencode({"id": record_id, "dbid": 0})
    async with httpx.AsyncClient(timeout=30, headers={**HEADERS, "X-Lf-Suppress-Login-Redirect": "1"}) as client:
        content, _ = await _request(client, "GET", url)
        if b'"hasPrintRights":true' not in content:
            raise SourceError("The public portal does not currently permit PDF export of this record.")
        info = (await _json(client, KPHD_BASE + "FolderListingService.aspx/GetDocumentInfo",
                           payload={"repoName": "Laserfiche", "dId": int(record_id)})).get("data", {})
        pages = int(info.get("pageCount") or 0)
        if not 0 < pages <= MAX_PAGES:
            raise SourceError("Document page count is unavailable or exceeds the pilot limit; use manual review.")
        content, _ = await _request(client, "POST", KPHD_BASE + "GeneratePDF10.aspx", params={
            "key": record_id, "PageRange": f"1 - {pages}", "Watermark": -1, "repo": "Laserfiche"}, payload={})
        key = content.decode("utf-8", errors="replace").splitlines()[0].strip()
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", key):
            raise SourceError("Public portal could not start PDF export.")
        for _ in range(30):
            state = (await _json(client, KPHD_BASE + "DocumentService.aspx/PDFTransition", payload={"Key": key})).get("data", {})
            if state.get("finished"):
                if not state.get("success"):
                    raise SourceError("Public portal PDF generation failed.")
                break
            await asyncio.sleep(1)
        else:
            raise SourceError("Public portal PDF generation timed out; retry later.", retryable=True)
        data, mime = await _request(client, "GET", KPHD_BASE + "PDF10/" + key + "/" + record_id, max_bytes=max_bytes)
        if not data.startswith(b"%PDF-"):
            raise SourceError("Source did not return a valid PDF signature.")
        return {"content": data, "filename": "kphd-" + record_id + ".pdf", "content_type": "application/pdf",
                "source_url": url, "sha256": hashlib.sha256(data).hexdigest(), "retrieved_at": _now()}
