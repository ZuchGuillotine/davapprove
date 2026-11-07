# Public source integration results

Checked November 7, 2026. Implementation: `backend/app/sources.py`; tests: `backend/tests/test_sources.py`. These integrations use the ordinary public interfaces linked from government websites and their published ArcGIS/WebLink configurations. Public access has been verified; this is not a blanket certification of data completeness or redistribution rights. No login, CAPTCHA or access restriction was bypassed.

## Working adapters

| Source | Verified interface | Implemented coverage and limits |
| --- | --- | --- |
| County parcel identity | [Public ArcGIS Parcels MapServer](https://utility.arcgis.com/usrsvcs/servers/6472a56bd5b1442ea048226ea8f622d5/rest/services/Public/Parcels/MapServer), table 4 | Query exact `ACCT_NO` or `RP_ACCT_ID`, return only parcel identity, situs address, address jurisdiction and primary-address flag. 100-row bound; ambiguous account IDs or truncated results fail explicitly. Tax parcel is **ACCT_NO**, not the seven-digit internal field called APN. |
| County parcel geometry, including Poulsbo | Same service, layer 0 | Query `GISPUB.GIS.PARCEL_PARCELS_RP_POLY.RP_ACCT_ID`; request output EPSG:4326. Merge duplicate join geometry and preserve holes/multipolygons. This is assessor GIS, not a survey. |
| City boundaries | [Jurisdiction Outlines layer 3](https://utility.arcgis.com/usrsvcs/servers/ab1e2df696934ea79c1b03f4a6a626f6/rest/services/Public/Jurisdiction_Outlines/MapServer/3) | Spatial envelope query with `SYMBOL = 2`, then actual polygon intersection. Municipal borders are distinct from UGA (`SYMBOL = 1`). Multiple cities, a materially straddling parcel or conflict with address jurisdiction becomes unknown. Small border touches do not classify a neighboring parcel as city land. |
| Tribal/military screening | [County zoning layer](https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Zoning_Designations/FeatureServer/0) | Positive-area intersection with `ZONEBREV` T or MIL routes to unsupported/special review. Absence of these features does **not** establish legal tenure; tenure remains unconfirmed. Failure of either jurisdiction overlay leaves jurisdiction unknown. |
| County PREP | [PREP MapServer layer 0](https://utility.arcgis.com/usrsvcs/servers/35500cef8d084ae09d100ab6ad1e3d5e/rest/services/DCD/DCD_Permit_Review/MapServer/0) | Exact `ACCT_NO` query returns classification, notes and indicator fields. No exclusion polygons or legal approval inferred. Only queried for county parcels; no county rule fallback in Poulsbo. |
| County zoning | [Zoning Designations](https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Zoning_Designations/FeatureServer/0) | Spatial metadata/geometry, `ZONEBREV`, `ZONE_DESCRIPTION`, `GMA_JURISDICTION`; screening only, not an activated setback rule. |
| Poulsbo zoning | [City Zoning layer](https://services9.arcgis.com/em8ydubtfJ7H3Rlq/arcgis/rest/services/Zoning/FeatureServer/0) | City-published service owned by the city GIS contact, found via ArcGIS item `ee3500af72af4347b08edf9f1403c980`. Fields `Zone_Code`, `Zone_Description`, `Zone_2022`. Map fields can retain old labels; code/amendment review remains necessary. |
| KPHD scanned-record discovery | [Official record-search entry](https://secure.kitsappublichealth.org/irecordsearch/) → [public WebLink](https://secure.kitsappublichealth.org/WebLink/) | Ordinary cookie session, then published WebLink `SearchService.aspx/GetSearchListing`, exact Environmental Health Tax ID. Pages of 50, at most 150 records; truncated search marked partial. Keep document name/type/date/page count/ID/match basis, not owner-name fields. Discovery never calls PDF generation or downloads page imagery. |
| KPHD selected PDF import | WebLink DocView → `FolderListingService.aspx/GetDocumentInfo` → `GeneratePDF10.aspx` → `DocumentService.aspx/PDFTransition` → session `PDF10` URL | Only after selection. Verify public print rights, actual page count (1–500), generation completion, byte limit and PDF signature. No pre-generated static file URL is assumed. Store the stable DocView citation, not the temporary export URL. Non-imaged documents with no exportable pages remain manual. |

County endpoint provenance: the [official PREP application](https://experience.arcgis.com/experience/29469422ff88417c9cc729e235c3bca0/) points to web map `45454ea22deb404097d617992e1441d1`, whose public item data declares PREP, boundary and special-zoning services. The county's public ArcGIS organization (`qt3UCV9x5kB4CwRA`) publishes Parcels item `6472a56bd5b1442ea048226ea8f622d5`. The [official parcel search](https://psearch.kitsap.gov/psearch/) also identifies the underlying parcel service and field mapping. Direct `ags.kitsap.gov` service requests returned “Token Required”; the adapter uses the separately published public ArcGIS item proxy, not a forged token or private service.

KPHD provenance: the [official public records page](https://www.kitsappublichealth.org/publicrecords) links its map application, whose public web map `28854b8260484d19a0be3b3d82246512` contains the parcel-specific WebLink search expression. The public WebLink search/document-viewer JavaScript defines the JSON request contracts and export sequence. HTTP POST here performs public search or selected export; it does not submit a permit or change agency records.

## Assisted and deferred sources

| Source | Current behavior | Reason |
| --- | --- | --- |
| County SmartGov | Parcel-specific public portal link in coverage; user downloads/uploads chosen attachments | Portal reachable, but attachment retrieval and status mapping not verified. The [county workflow](https://www.kitsap.gov/dcd/Pages/permitpathway.aspx) separately links Camino for new applications. No assumed SmartGov API. |
| Poulsbo SmartGov | City portal link in coverage | Portal reachable; no fabricated document candidates. Live extraction deferred. |
| Auditor surveys/easements | [Public recorder](https://kcwaimg.kitsap.gov/recorder/web/) link, manual search and upload | Portal requires JavaScript/cookies. Exact APN alone is not exhaustive; historical IDs/legal descriptions and non-indexed older records need review. |
| KPHD application status | Public status endpoint was checked, but not merged into document status automatically | `HealthDeptRecordsKitsap.aspx?RP_ACCT_ID=...` contains current/source-reported status rows. Mapping a row to a scanned record requires explicit permit identity matching. A discovered PDF does not inherit a nearby row's approval. |
| Utility availability, private consultant work, title evidence | Assisted upload/source link | Service-area maps do not establish capacity, rights or applicability. |
| Ecology/DNR/FEMA and specialist agencies | Research referrals from planning documents | Not yet automated; no claim of comprehensive constraints coverage. |

Do not create “possible document” rows merely because an agency might have something. Only discovered actual records enter the selectable candidate list. Source coverage explains unavailable/manual routes separately. Zero exact-tax-ID hits does not mean no relevant records: KPHD documents [historical-address and indexing limitations](https://secure.kitsappublichealth.org/irecordsearch/help/searchtips.html).

## Reproducible smoke checks

Public samples are engineering smoke cases, **not** the sponsor-approved six-parcel acceptance cohort. No owner names or PDF bytes are stored in repository fixtures.

| Parcel | Observed routing | Discovery/export observation |
| --- | --- | --- |
| `01220110052001` | `kitsap_county` | Eight KPHD records discovered. Selected entry `1024729` exported as PDF, 53,893 bytes; SHA-256 `8dbc2a433ea7670cca07ecc35193c201ede76578fbb3e706eb0781294bd4b5e1`. |
| `13260110202004` | `poulsbo` | Three KPHD records discovered. Selected entry `782115` exported as PDF, 151,919 bytes; SHA-256 `7f94fc597d0d3c1c17693bd2148deff76373aeeecf275e71fa1c5ecad1abcb38`. |
| `14260130432002` | `poulsbo` | Multiple situs addresses resolved to one account/outline. Zero exact-tax-ID KPHD results; returned as complete-for-query with coverage warning, not “no constraints.” |

From the repository root after installing backend requirements:

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_sources.py -q
PYTHONPATH=backend python -c 'import asyncio; from app.sources import discover; d=asyncio.run(discover("13260110202004")); print(d["parcel"]["jurisdiction"], len(d["candidates"]), [(s["source"],s["status"]) for s in d["coverage"]])'
```

Do not make live export tests part of routine CI. A maintainer can explicitly select a discovered candidate and invoke `fetch_selected(candidate)` for a bounded smoke test. Ordinary tests use synthetic metadata and mocked HTTP; they verify selection boundaries, pagination caps, geometry holes, jurisdiction ambiguity, failure behavior and response limits.

## Remaining launch checks

- Sponsor review of the actual six-case cohort and expected source documents; current samples do not establish discovery recall.
- Source permissions/terms review for the intended retention and client use; do not represent a public endpoint as a commercial data license.
- Monitor endpoint schema changes, report source failures visibly and keep manual routes working. No availability SLA is inferred.
- Confirm intended map/code editions before activating numeric rules. The adapter deliberately returns screening observations rather than accepted constraint geometry.
