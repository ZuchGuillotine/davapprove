# Parcel discovery and preliminary envelope sprint plan

November 7 follow-up decision: [Document processing v2 and model funding](DOCUMENT_PROCESSING_V2.md) supersedes the earlier AI/funding plan: platform OpenAI processing for three trial projects; future user-funded models beyond trial or for authoring/editing. This is planned, not yet deployed; no user-facing model integration in this phase.

Implementation update (November 7, 2026): this document is the design/acceptance target. See [implementation status](IMPLEMENTATION_STATUS.md) and [operations](operations.md) for the deployed MVP, verified behavior and remaining work.

Baseline: November 7, 2026. Implements the [MVP requirements](MVP_REQUIREMENTS.md) using the [architecture](APP_ARCHITECTURE.md). Planning estimate: four one-week milestones for one experienced developer with agent assistance and regular architect review; source access is the principal schedule uncertainty. Each milestone ends in a usable demo, not a promise of complete portal coverage.

## Corrections to the introductory plan

| Original assumption | Revised implementation |
| --- | --- |
| PREP supplies the whole permit model | PREP is an environmental screening input. Add municipal code, permit decisions, property rights, utility capacity and project intent. Retain the linked [official PREP entry point](https://www.kitsap.gov/dcd/Pages/permitpathway.aspx); do not depend on an unverified expansion of the acronym. |
| Four workers immediately scrape all PDFs | Discover metadata first; users select imports. Validate access and parcel matching before promising an adapter. No assumed public SmartGov API or comprehensive APN index. |
| Subtract standard buffers to yield usable land | Calculate a preliminary/partial envelope with explicit provenance, edge classification and unknowns. Public GIS is not a survey or accepted delineation. |
| Wetland/shoreline documents universally expire at five years | Evaluate the actual document type, applicable jurisdiction, date basis, conditions and extensions. Ecology describes revisiting older delineations, which need not mean complete replacement. Do not reuse a wetland rule for shoreline approvals. [Ecology guidance](https://ecology.wa.gov/water-shorelines/wetlands/tools-resources/delineation-resources). |
| BSA/soil records expire in three to five years | KPHD Ordinance 2025-01 §6, item 10 specifies BSA timing from submittal and marked approval/expiry dates. Read the full applicable section and related provisions before encoding; do not assign blanket expiry to soil logs or as-builts. [Ordinance](https://www.kitsappublichealth.org/_files/ugd/0f8b3b_b8efed6c1293475eb0b79ad3971cb7ad.pdf). |
| Code changes force all older work to be redone | Flag a compatibility review, considering proposal changes, applicable code edition, vesting and agency conditions. Preserve past approvals. |
| One four-stage DAG controls all work | Use typed edges and milestone-specific prerequisites; distinguish recommended design sequencing from enforceable requirements and revision impact. |

## Source coverage and access strategy

The official entry points below are research-verified; **automated endpoint access, completeness and reuse permissions are not yet integration-tested**. Sprint 0 records working URLs, ArcGIS layer IDs, fields, coordinate systems, query limits, access conditions, retrieval dates and sample results. Never invent API endpoints from portal branding.

| Source | What it contributes | MVP acquisition and limit |
| --- | --- | --- |
| [County parcel search](https://psearch.kitsap.gov/) and [PREP](https://experience.arcgis.com/experience/29469422ff88417c9cc729e235c3bca0/) | Parcel identity/geometry, jurisdiction and environmental screening layers | Inspect published ArcGIS configuration; use verified public queries. Save layer versions and search extent. GIS is approximate; map silence cannot clear an environmental check. |
| [County DCD records](https://www.kitsap.gov/dcd/Pages/DCD-Public-Records.aspx) and [permit pathway](https://www.kitsap.gov/dcd/Pages/permitpathway.aspx) | Prior permits, decisions, SDAP and attached studies | Discover via supported public routes; import selected available attachments. Current county guidance separates Camino applications from SmartGov management. Keep source status and retrieval time. |
| [County Auditor](https://kcwaimg.kitsap.gov/recorder/web/) | Recorded surveys, plats, easements, covenants and notices | Public index supports parcel and legal-description searches; history begins in 1987 per portal. Parcel match is not exhaustive title research. Browser/cookie flow may require assisted access; no claim that all documents are on one parcel index. |
| [KPHD records](https://www.kitsappublichealth.org/publicrecords) | Septic record drawings, BSA, water records and separate application status | Validate current geospatial/record search. Search tax ID plus verified address aliases where appropriate; historical-address issues are documented in [search help](https://secure.kitsappublichealth.org/irecordsearch/help/searchtips.html). Missing records remain unknown. |
| [Poulsbo codes/maps](https://poulsbo.gov/codes-amendments-maps/), [GIS](https://poulsbo.gov/city-of-poulsbo-gis-map), [public portal](https://ci-poulsbo-wa.smartgovcommunity.com/Public/Home) | City zoning, overlays, local permits and attached decisions | Separate Poulsbo pack and portal adapter configuration. Use official [municipal code](https://ecode360.com/PO4596/home), adopted amendments and effective dates. City boundaries, zoning and utility areas are distinct layers. |
| [Poulsbo ADU guidance](https://poulsbo.gov/accessorydwellingunits/) and [engineering](https://poulsbo.gov/engineering/) | ADU path, engineering standards, utility/access requirements | Curate a small reviewed rule set. Guidance links and code editions can differ; reconcile against adopted text before activating numeric rules. Preapproved building plans do not establish site feasibility. |
| County code and manuals in the [existing source register](research/kitsap-node-register.json) | Zoning, critical areas, shoreline, stormwater, fire/access and permit requirements | Curated county pack, separate from city law. Check adopted text and amendments; unresolved conflicts become agency questions. |
| Water/sewer providers, road owner and fire authority | Availability/capacity letters, connection terms, frontage/access and fire-flow requirements | Identify likely authority; request user upload or link for site-specific letters. Service-area overlap is not capacity approval. No utility construction commitment inferred from a map. |
| [Ecology wells](https://ecology.wa.gov/water-shorelines/water-supply/wells) | Well reports and links to water-right records | Linked research task first; automate after core sources. Nearby well coordinates or reports do not prove property entitlement or adequate supply. |
| [DNR geology](https://dnr.wa.gov/washington-geological-survey/geologic-hazards-and-environment/landslides), [lidar](https://dnr.wa.gov/washington-geological-survey/publications-and-data/lidar), [NWI](https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper) | Supplemental slope/hazard/wetland screening | Link or selectively query where needed; defer bulk datasets. NWI explicitly is not a regulatory wetland-boundary determination. |

Additional modules to catalog during onboarding, not build as universal scrapers: FEMA flood maps and amendments, NRCS soils, Ecology SEPA records, WDFW habitat/HPA, DNR forest-practice history, state highway access, tribal/federal tenure and cultural-resource referral. Use the existing source register for agency routing; sensitive or restricted records stay outside public discovery. Private title work and unsubmitted consultant reports require user-provided evidence.

## Milestone 0 — Prove sources and freeze the small rule set

Timebox: 3–5 developer days. Select the six pilot parcels with the sponsor; record expected documents and constraints from manual review. Inspect county/Poulsbo GIS, DCD, Auditor and KPHD access, with bounded requests and no CAPTCHA/access-control bypass. Test metadata discovery separately from file retrieval. Produce a source matrix marked automated, assisted or unsupported, plus sanitized fixtures and retrieval provenance.

Extract the initial node IDs and typed relationships from the existing report; do not treat its synthetic demo as production logic. Define county and Poulsbo jurisdiction packs with the minimum residential/ADU zoning checks, environmental review triggers, water/wastewater branches and intake dependencies. Numeric setbacks and freshness formulas remain inactive until exact citations, effective dates, inputs and tests have been reviewed. Independently verify county versus Poulsbo boundary routing.

**Exit:** baseline parcel geometry is accessible for both jurisdictions; at least one document source per jurisdiction can demonstrate discovery and selected retrieval; every other source has a truthful assisted route. Record actual limitations before promising automation. Confirm hosting checkout fits the architecture budget. If access is blocked, ship the assisted path and defer that connector, preserving the same evidence contract.

## Milestone 1 — Hosted lookup and selected imports

Implement hosted signup, membership, project creation, parcel confirmation and progressive candidate list. Build verified GIS discovery and the highest-value proven document adapters first, then the remaining feasible core adapters. Separate “select all found” from future search results; selection is a fixed manifest.

Add resumable uploads, immutable originals, source metadata, private viewing, import progress, cancellation, retries and manual fallback. Re-running discovery refreshes candidates without silently importing new files. Imported records remain available after their portal links expire. Add comments and a simple feedback action now so the architect can review the earliest build.

**Exit:** an invited architect completes lookup and selective import in both jurisdictions; an unselected document causes no file retrieval or AI call; another project cannot access the records. Demonstrate one source outage without losing successful results.

## Milestone 2 — Evidence review and preliminary geometry

Extract PDF text before OCR; OCR scanned pages within limits. AI produces structured candidate facts with document/page references. Add a compact review queue for document type, dates, permit identity/status, conditions and project relevance. Never trust an AI-generated polygon as a survey.

Implement projected-coordinate spatial operations, explicit parcel-edge classification, layered constraints and preliminary/partial envelope states. Let a reviewer supply or sketch missing geometry with source and accuracy labels. Add conflict display for proposed footprints intersecting known exclusions. Readiness depends on accepted evidence and rules; a skipped record stays a gap.

**Exit:** demonstrate county and Poulsbo rule separation, a simple calculated envelope, a constrained partial envelope, an unresolved-geometry case, a multipart parcel and an empty remainder. A scanned PDF's key facts can be verified against their cited pages.

## Milestone 3 — Dependency workflow and client pilot

Implement stage-specific deterministic evaluation, ordered next actions, graph view, evidence links and immutable project revisions. Show a bedroom change affecting septic/water review and an environmental boundary change affecting footprint/civil coordination. Track unknown, recommended and legal dependencies distinctly; preserve approval history.

Finish print briefing, owner/editor/reviewer flows, operational quotas, backups/recovery and deploy rollback instructions. Run the six pilot cases with the sponsor and capture corrections as fixtures. Add a municipality-onboarding checklist demonstrated by the Poulsbo pack.

**Exit:** satisfy R1–R12, pass isolation and recovery checks, and have the sponsor complete the full journey independently. Show a cost/usage dashboard and current source-coverage matrix. Do not label deferred connectors or unreviewed numerical rules as supported.

## Shared test and release checklist

- Source contracts: APN normalization, address aliases, parcel splits/merges, wrong-property candidates, duplicate records, pagination, rate limits, authentication challenges, broken attachment links and partial results.
- Rules: absent versus unknown evidence; original approval versus current relevance; explicit expiry/extensions; conflicting sources; required versus recommended edges; not-applicable with provenance; deterministic output for identical revision/ruleset/as-of time.
- Geometry: correct units/CRS, front/side/rear classification, neighboring constraints, invalid polygons, holes/multipolygons, unknown easement geometry and zero remaining area.
- Collaboration: stale revision update rejected, comment stays on its revision, change impact propagates without overwriting prior decisions, cross-project access denied at database and file levels.
- Operations: resumable large upload, malformed/encrypted PDF, worker interruption and retry, idempotent processing, AI quota exhaustion, restore of database plus files, and rollback of the deployed app.
- Preserve the existing report; run `node tests/report_logic.test.cjs` as regression verification. If research outputs change, edit the generator and regenerate both artifacts as instructed in AGENTS.md.
