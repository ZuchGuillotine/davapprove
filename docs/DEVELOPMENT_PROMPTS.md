# Davapprove development agent prompts

Implementation update (November 7, 2026): this document is the design/acceptance target. See [implementation status](IMPLEMENTATION_STATUS.md) and [operations](operations.md) for the deployed MVP, verified behavior and remaining work.

Run these in order, handing each completed milestone and its tests to the next agent. They are task prompts, not a request to launch agents automatically. The four planning documents are the source of product decisions; a prompt does not authorize spending above the stated budget or expanding jurisdiction coverage.

## Shared instruction for every task

> Work in the Davapprove repository. Read AGENTS.md, README.md, docs/PROJECT_CONTEXT.md, docs/MVP_REQUIREMENTS.md, docs/FEATURE_1_SPRINT_PLAN.md and docs/APP_ARCHITECTURE.md. Inspect Git status and preserve existing work. Treat the HTML/JSON research as reference material, not production rule code. Keep documented legal requirements, internal recommendations and unresolved agency questions separate. Attach source, date, jurisdiction, design revision and milestone to evaluated requirements. Never equate missing evidence with approval or AI extraction with an agency decision. Follow the documents' interfaces and budget; do not add infrastructure without a concrete need. Deliver working code or the specified research artifact, relevant tests, setup instructions and a concise handoff with known gaps. Use synthetic/sanitized fixtures in Git; never commit credentials or private client PDFs. Do not submit permits, contact agencies, purchase services or push/deploy unless authorized in the active task.

## Task 0 — Source feasibility and rule-pack baseline

> Complete Milestone 0 of docs/FEATURE_1_SPRINT_PLAN.md. Inspect the official entry points and published application configurations to identify real county/Poulsbo GIS layers and current records access. Test metadata discovery separately from file download. Produce docs/research/source-access-matrix.md with tested URL, timestamp, method, pagination/limits, matching fields, permissions/access observations, automated/assisted/unsupported status and a reproducible bounded example. Do not label an API usable based solely on a portal URL. Use public candidate parcels initially; ask the sponsor to validate the six-case cohort before labeling it an acceptance set. Do not bypass login/CAPTCHA or submit records requests.
>
> Define the shared fact/rule/edge contracts and county/Poulsbo pack skeletons, preserving research node IDs. Seed only independently verified rule predicates with section-level citations and effective dates; keep everything else inactive and explicitly unresolved. Separate prerequisite ordering from change-impact relationships. Add county/Poulsbo routing and unknown-applicability fixtures. Finish with a minimum automated path in each jurisdiction and explicit assisted alternatives. If a source cannot be automated, document the limitation and continue with its assisted contract.

## Task 1 — Application foundation and private project workspace

> Implement the architecture's React/Vite frontend, FastAPI API, Python worker, local Supabase/PostGIS setup and migrations. Add email-link auth integration, project membership roles, private storage policies, project creation and a basic feedback/comment flow. Use local services and fake mail for development. Create a durable leased job table and idempotent claim/retry functions; keep heavy work outside request handlers. Publish OpenAPI and derive frontend types from it.
>
> Add database/file authorization tests for two unrelated projects, cross-project foreign-key attempts, reviewer write restrictions and job access. Add expected-revision concurrency checks. Provide .env.example, Docker Compose, local start/check commands and a deployment runbook with the under-$50 preflight budget. Do not provision billable resources as part of scaffolding. The deliverable is a functioning authenticated shell with an end-to-end synthetic discovery job, not only directories and interfaces.

## Task 2 — Parcel discovery and user-selected import

> Implement Milestone 1 using the Task 0 access matrix and contracts. Resolve parcel identity, confirm the mapped parcel, route jurisdiction and load the minimum baseline GIS. Display progressive candidate records, matching rationale and source coverage. Keep discovery metadata separate from evidence. Implement individual selection and select-all-found as a frozen manifest; no record is selected by default. Do not download, OCR or send unselected documents to AI, including after refresh.
>
> Implement the proven automated adapters for county and Poulsbo; add clear portal-link/upload fallbacks for all remaining core sources. Support direct private resumable uploads, content hashes, immutable versions, idempotent selected imports, bounded network fetches, cancellation and retries. Enforce adapter-host allowlists and block private-address/redirect SSRF. Test pagination, ambiguous matches, address aliases, partial outage, link expiry, duplicated selection and interrupted 100 MB upload. Demonstrate selected live imports in both jurisdictions and record exact coverage limitations.

## Task 3 — Document evidence and preliminary envelope

> Implement Milestone 2. Extract native PDF text before invoking Tesseract on scanned pages. Add bounded structured AI extraction through the provider-neutral interface, using a small fixture evaluation to select and record the initial model and actual unit costs. Enforce the $5 monthly application budget with reservations and bounded retries. Validate page references; AI output remains proposed until accepted. Provide manual review when parsing/model service fails or budget is exhausted.
>
> Implement the evidence-review UI and PostGIS envelope calculation from reviewed geometry and active jurisdiction rules. Classify lot edges explicitly, support multipolygons/holes, and label source accuracy. Keep screening layers distinct from accepted exclusions. Missing survey/easement/environmental geometry yields a partial/cannot-determine result with next actions, not an invented polygon. Allow reviewed sketch/import of geometry; do not attempt autonomous PDF georeferencing. Test units/CRS, neighboring features, known overlap, empty remainder, conflicting facts and Poulsbo/county rule separation. Demo the map and cited evidence together.

## Task 4 — Dependency workflow and revision impact

> Implement Milestone 3's deterministic evaluation module and UI. Use accepted revision + pack version + as-of date as explicit inputs. Return typed graph states, ordered next actions, missing facts, citations and explanations. Keep source decisions, applicability, evidence review, effectiveness and freshness separate. Validate cycles only in the milestone prerequisite projection; change-impact traversal must terminate even when links loop. Unknown never passes a required gate, and recommended coordination never becomes legal prohibition.
>
> Implement revisions for intent/fact/geometry changes with optimistic concurrency and preserved originals. Demonstrate bedroom-capacity impact and wetland-boundary impact; flag relevant work for review without revoking an agency decision or mandating unsupported resubmission. Add revision-linked comments, graph detail and print briefing. Test stable deterministic results, stage-specific conditions, explicit expiry/extensions, not-applicable evidence, obsolete rulesets and stale writes. Keep actual construction authorization outside v1.

## Task 5 — Pilot release and municipality handoff

> Run the full acceptance checklist against the sponsor-reviewed county/Poulsbo cohort and synthetic failure cases. Measure missed discoveries, incorrect matches, unsupported conclusions and the sponsor's ability to finish without developer assistance. Fix release-blocking defects and make remaining source limitations visible. Verify upload restart, worker restart, quota exhaustion, tenant isolation, database-plus-file restore and app rollback. Run the existing research logic checks without changing generated research artifacts unnecessarily.
>
> Finalize docs/operations.md with setup, actual provider quotes, secrets inventory (names only), SMTP/domain requirements, backup/restore steps, quotas, monitoring and deploy/rollback commands. Ensure the expected total is below $50 including chosen AI allowance and applicable recurring charges. Prepare deployment assets; deploy only when the active task authorizes it. Hand the architect a hosted URL if deployed, a short guided demo and a feedback path.
>
> Write docs/municipality-onboarding.md using the implemented Poulsbo pack as the worked example: authority/boundary checks, official sources/adopted amendments, shared concepts versus local rules, fixtures, review, activation and future changes. Demonstrate adding a disabled third-jurisdiction skeleton without copying the application or falling back to county law. Report supported functionality and measured gaps honestly; do not mark v1 complete solely because a demo with synthetic data passes.
