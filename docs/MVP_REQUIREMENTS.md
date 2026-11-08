# Davapprove parcel intelligence MVP requirements

November 7 automation direction: [Automated pre-check pipeline](AUTOMATED_PRECHECK_PIPELINE.md) defines the next architecture: machine-validated evidence, scoped revision reconciliation, automated geometry and exception-based human review. It supersedes blanket manual-acceptance design requirements below; existing runtime behavior remains unchanged until implemented.

November 7 follow-up decision: [Document processing v2 and model funding](DOCUMENT_PROCESSING_V2.md) supersedes the earlier AI/funding plan: initial platform OpenAI processing for three trial projects. The later automated pre-check plan supersedes its user-model gate: core processing stays platform funded, user models are deferred, and the shared test cap is $25/month. This is planned, not yet deployed; no user-facing model integration in this phase.

Implementation update (November 7, 2026): this document is the design/acceptance target. See [implementation status](IMPLEMENTATION_STATUS.md) and [operations](operations.md) for the deployed MVP, verified behavior and remaining work.

Decision baseline: November 7, 2026. Audience: architect/product sponsor and implementation agents. Companion documents: [sprint plan](FEATURE_1_SPRINT_PLAN.md), [architecture](APP_ARCHITECTURE.md), [agent prompts](DEVELOPMENT_PROMPTS.md).

## Product outcome

An architect enters a parcel number, reviews discovered records, chooses what to import, and receives a preliminary site envelope plus an evidence-backed list of next actions. They can inspect the sources, correct assumptions, change a project input, and see which disciplines need to revisit their work. Beta users access a hosted website without Git or local installation.

The pilot covers single-family residential development and ADUs in **unincorporated Kitsap County and Poulsbo**. Other cities, ambiguous boundaries, tribal/federal tenure, subdivisions and commercial projects receive a routing explanation and research workspace, not unsupported local rule results. Shoreline, wetland and other complex residential sites remain usable for discovery and issue identification; unresolved specialist determinations can prevent an envelope from being calculated.

Success means reducing research and coordination effort, not issuing a buildability certificate or promising approval. The existing 43-node research register supplies identifiers and concepts, not executable permitting authority.

## First user journey

1. Sign up through an email link, create a private project, and enter a parcel number. Normalize spaces/dashes while preserving leading zeros; validate against the source, not just length. Show address and parcel outline for confirmation. Record parcel history when available; a tax parcel does not establish legal-lot status.
2. Ask only the initial design questions: new house/addition/ADU, proposed units and bedrooms, known water/sewer/septic arrangement, and optional approximate footprint. Unknown is an acceptable answer. Establish municipal jurisdiction independently of mailing address and utility service area.
3. Automatically fetch baseline parcel/jurisdiction/GIS metadata and discover candidate records. Show progressive results grouped by survey/title, environment, septic/water, permits/civil and utilities/access. Display source, date if known, identifier, match reason, access method, and source-reported status. Treat this as metadata, not accepted project evidence.
4. Let the user select individual records or all discovered records. Nothing is preselected. Before import, show count, known sizes, unknown sizes, and processing allowance. Only the selected files are fetched, retained, OCRed or sent to AI. A source requiring full-file retrieval merely to identify a record becomes an explicit user-requested fetch, not hidden discovery.
5. Analyze selected documents and present extracted facts with page references for acceptance or correction. Resolve ambiguous parcel matches before including them. Users can upload a missing PDF, attach a source link, or follow a portal link when automation is unavailable.
6. Display a map with parcel geometry, constraint layers and a **preliminary site envelope**, alongside records and a plain-language “What to resolve next” list. Each action has an owner/discipline, reason, affected milestone, source and missing evidence. A graph tab exposes the dependencies without forcing every user to understand a graph.
7. Save a new project revision when accepted inputs change. Highlight affected facts, geometry and dependent work; retain the original decisions and documents. Invite a reviewer, leave comments tied to a document/node/revision, and provide a print-friendly briefing for client discussion.

## Required behavior

| ID | Requirement and acceptance condition |
| --- | --- |
| R1 | Correctly route county versus Poulsbo. A county zoning rule must never be silently applied inside Poulsbo. Unsupported/ambiguous cases retain an explicit unknown jurisdiction state. |
| R2 | Discovery and import are separate. Selecting two of ten candidates downloads/analyzes exactly those two; deselected files do not enter AI context or satisfy dependencies. Baseline map metadata is clearly distinguished from selected documents. |
| R3 | Report each source as complete-for-query, partial, unavailable, manual-access or not-searched, with search time and query scope. Zero results means “no records found in this search,” not “no constraint exists.” |
| R4 | Keep immutable originals, checksums, source URLs/IDs, retrieval times, document dates and page citations. Duplicate imports are idempotent within the project; changed bytes create a new version. |
| R5 | Separate source-reported permit status, evidence review, freshness and applicability. An old approved permit may remain historically approved while unsuitable for the new proposal. |
| R6 | Compute spatial results only from identified geometry and applicable, reviewed rules. Missing geometry or rule inputs produce a partial result or “cannot determine,” never invented setbacks or empty exclusions. |
| R7 | Each dependency result exposes its rule version, facts, citations and explanation. Unknown applicability cannot pass a hard prerequisite; recommended coordination does not become a legal prohibition. |
| R8 | AI proposes classification, dates, conditions, facts and summaries with citations. Human-reviewed inputs and explicit deterministic rules control reliance, applicability and graph results. AI cannot approve permits, write executable rules, or silently replace accepted facts. |
| R9 | Changing bedrooms, footprint or an accepted wetland boundary creates a revision and marks relevant downstream work for review. It does not revoke an agency decision or declare that every discipline must resubmit. |
| R10 | Project owners/editors can import and review evidence; reviewers can inspect and comment. Users cannot read another project's files, candidate metadata, job results or signed URLs without membership. |
| R11 | Hosted beta supports resumable PDF upload, background progress, failure/retry, saved projects, comments and a print-friendly summary. No local setup is required for reviewers. |
| R12 | Future municipality onboarding uses a documented jurisdiction pack and fixture checks, without duplicating the app or silently inheriting county law. |

## Site envelope and workflow semantics

Use two visually distinct layers: **screening constraints** from public maps and **reviewed project constraints** from accepted evidence. Calculate the remaining footprint opportunity only for known exclusions; display every unresolved constraint beside it. Name incomplete results “partial preliminary envelope,” show the included assumptions, and avoid a single definitive buildable-area number. Absence of a mapped wetland is not evidence of absence.

Front/rear/side parcel edges require classification and user confirmation where ambiguous. Do not use a uniform inset for all lot lines. Include applicable rights-of-way, easements, environmental buffers, septic primary/reserve areas, existing improvements and access needs when their geometry is known. Do not automatically georeference scanned survey/easement drawings in v1: accept supplied geospatial geometry or a reviewer-confirmed sketch, labeled with its accuracy. Screen relevant neighboring features using each rule's search distance, not just features clipped to the parcel.

The geometric remainder does not establish legal-lot status, allowed use, lot coverage, building separation, height, utility capacity, access rights or permit issuance. These stay as separate checks. A zero-area result is a calculated conflict for the stated assumptions, not a final determination that development is impossible.

Use the research edge vocabulary: INPUT, HARD, CONSULT, CONDITION, RIGHT, INVALIDATES and RECOMMENDED. Compute order of operations from the prerequisite projection for a particular milestone; change propagation is a separate relationship and may contain loops. For v1, use research IDs for jurisdiction/rights, survey, environment, geotechnical, water, septic/sewer, shared site plan, civil/access and building intake. Keep other modules as explicit referrals when triggered.

Track applicability (unknown/required/not applicable), evidence review, source decision, effectiveness, conditions and freshness separately. A not-applicable determination requires evidence and reviewer attribution. Record the named stage: feasibility, design coordination or intake readiness. No v1 result authorizes construction.

An expired or mismatched wetland report should generate “verify/update environmental evidence before relying on the affected layout”; it must not automatically say “all civil engineering is prohibited.” Specific expiry dates, extensions, code changes, scope and vesting require their own evidence. Keep legal requirements, internal workflow recommendations and agency questions visibly distinct.

## Pilot boundaries and acceptance

Assume up to 10 invited users and 20 active projects. Default PDF limit: 250 MB and 500 pages; storage allowance: 10 GB total pilot files. Process one heavy document at a time, with a configurable 20-minute timeout. Oversize, encrypted, corrupt or ambiguous documents produce actionable exceptions and retain the original if safely stored. These are product limits to validate, not vendor maximums.

Use six representative real parcel cases, lawfully accessible and reviewed by the sponsor: county new home on septic, county ADU with existing septic, county environmental constraint, Poulsbo new home, Poulsbo ADU and Poulsbo constrained site. Supplement with synthetic cases for unavailable sources, conflicting records, changed parcel IDs and out-of-scope jurisdiction. At least one selected document per supported jurisdiction must complete a live automated import; other unautomatable sources must demonstrate the assisted path.

The sponsor must be able to complete lookup → selection → map → next actions → comment without developer assistance. Baseline target: show initial parcel results within 15 seconds and partial discovery within 60 seconds on the pilot fixtures; external delays remain visible, not hidden behind an indefinite spinner. A 100 MB scanned test PDF must survive upload interruption and worker restart without duplicate records. Compare discovery and next actions to the sponsor's manual review, record missed items and time saved, and publish the actual supported-source matrix before client demos.

Defer automatic agency submission, payment, CAD/BIM editing, full professional signoff, legal-title interpretation, exact project cost/schedule forecasting, live agency monitoring and Git-style branching/merging. Allow optional user-entered fee/time ranges with attribution; otherwise show “not estimated.” Preserve immutable revisions and change history so these capabilities can follow without replacing the evidence model.
