# Davapprove project handoff

November 8 implementation: [Jev/Sol cascade release](CASCADE_RELEASE.md) records the operational processing pipeline, validation, benchmark and deployment limits. The broader architecture below remains the roadmap where the release explicitly lists remaining work.

November 7 automation direction: [Automated pre-check pipeline](AUTOMATED_PRECHECK_PIPELINE.md) defines the next architecture: machine-validated evidence, scoped revision reconciliation, automated geometry and exception-based human review. It supersedes blanket manual-acceptance design requirements below; existing runtime behavior remains unchanged until implemented.

November 7 follow-up decision: [Document processing v2 and model funding](DOCUMENT_PROCESSING_V2.md) supersedes the earlier AI/funding plan: initial platform OpenAI processing for three trial projects. The later automated pre-check plan supersedes its user-model gate: core processing stays platform funded, user models are deferred, and the shared test cap was initially $25/month. On November 8 the user authorized $35 to finish source verification; the database and hosted worker now enforce $35. The Jev/Sol cascade is deployed; no user-facing model integration is exposed.

Updated: November 7, 2026. Research baseline: November 5, 2026.

## November 13 product priority

The first paying-customer feature is **Bids & assessments**: parcel screening for early client meetings, agency/code routing, approximate permitting and technical-study allowances, and an explicitly unconfirmed site map. It must not depend on document ingestion or bulk fact review. The existing project records, evidence processing, site-envelope coordination and dependency graph remain the deeper workflow product.

The local application branch and standalone bid research branch have now been reconciled on `codex/bid-assessment-workspace`. The web sidebar and welcome screen expose the bid tool. Drafts and price overrides persist in this browser; no team synchronization, approval status or approved design revision is implied. See [Bid Assistant](BID_ASSISTANT.md) for implementation, sources, validation and unresolved coverage. This priority supersedes the earlier document-first beachhead direction, while retaining that work.

## November 14 agency coverage

Bid assessments now check Corps, tribal consultation and land jurisdiction, state/tribal/EPA certification, DNR freshwater/marine use, FEMA hydraulic/map revisions and stormwater authority independently of county permit history. Optional scope answers persist with the bid. Sources and unresolved questions remain visible; the regional tribal contact list is preliminary, with full affected-tribe identification assigned to the lead agency and Tribes. See [Bid Assistant](BID_ASSISTANT.md) for source dates and validation.

## Objective

Help owners, architects, engineers and developers identify site constraints and coordinate approvals early enough to avoid expensive redesign. Kitsap County is the first target, with separate routing for incorporated cities, tribes, utilities, state and federal authorities.

The key problem identified in this conversation is the disjointed septic–civil–wetland–shoreline–designer loop: disciplines optimize their own plans while shared geometry, capacity and conditions remain inconsistent.

## Completed work

- A source-backed interactive HTML reference with 43 node templates, four diagrams, three synthetic blocker demonstrations and 60 source references.
- A JSON export of the node register and source index. It does not yet contain the complete typed edge register; the report's dependency table and model expressions are the current reference for those relationships.
- A portable report generator and logic/consistency checks.

The graph distinguishes inputs, hard prerequisites, consultations, conditions, property rights, change propagation and recommended coordination gates. Approval should be tied to a specific design revision, scope and work stage. Septic design approval and septic installation authorization are separate nodes.

## Bid assistant (added November 12, 2026)

A narrower first product built as a separate feature in `bid-assistant/`: parcel in, agencies and a sourced permitting cost range out, with a constraint map. It reads public map layers and published code and fees, and does not depend on parsing a parcel's document history. See `docs/BID_ASSISTANT.md`. The November 13 integration makes this available from the desktop application navigation while keeping its data and execution separate from document processing.

## Status and limits

The desktop checkout integrated origin/main at `e486caa`. A hosted MVP now implements parcel discovery, selected private document imports, OCR/evidence review, revision-aware coordination and partial site geometry. See [implementation status](IMPLEMENTATION_STATUS.md) for exact limits and [operations](operations.md) for deployed resources. The original report remains a research artifact, not a permit-authorizing engine.

The original checks covered gate behavior, unique IDs, citations and internal links, plus visual inspection of the four diagrams. Full browser layout testing could not run in the research environment because browser process creation was restricted. The JS checks use a DOM stub and are not a substitute for browser testing.

The report flags unresolved city-specific code, parcel-specific jurisdiction, professional exceptions, vesting, expiry and special-project modules. Do not infer a universal buffer or permitting rule from the graph. The proposed MVP stack is now documented in the architecture; live county/Poulsbo and KPHD source integrations have been exercised; numeric legal rule packs still require validation before activation.

## MVP decisions from November 7, 2026

- Pilot: unincorporated Kitsap residential/ADUs plus Poulsbo, with repeatable municipality onboarding.
- Assisted autonomy: discover candidate records first; users select some or all before file import and AI processing. Unselected or unavailable evidence remains a visible gap.
- Hosted browser access for nontechnical beta users, with project comments and review. Managed services are acceptable within a recurring budget below $50.
- Deployed stack: Cloudflare static React app, Supabase Free Postgres/Auth/Storage, and a separate Hetzner Python API/worker. Current base cost is $7.09/month; Pro remains a future upgrade. No custom domain yet; HTTPS API uses a temporary tunnel. See operations for current configuration.
- Deliver a preliminary/partial site envelope and cited next actions; preserve unknowns, legal versus recommended dependencies, and historical approvals across project revisions.

Read [MVP requirements](MVP_REQUIREMENTS.md), [feature sprint plan](FEATURE_1_SPRINT_PLAN.md), [architecture](APP_ARCHITECTURE.md) and [development prompts](DEVELOPMENT_PROMPTS.md) before implementation. The sprint plan revises the supplied introductory PREP plan; the original research report remains unchanged.

## Next validation work

1. Sponsor-review the six-parcel cohort, including rural-house, ADU, shoreline and wetland cases.
2. Validate and activate narrowly scoped numeric rules with source citations.
3. Configure a stable API hostname, email delivery, independent backups and a restore drill.
4. Expand assisted records integrations and improve constraint drawing based on architect feedback.

## Continuity

Use this repository for versioned files and project guidance. This handoff summarizes the relevant work; it is not a transcript export or a merger of ChatGPT and Codex chat histories. It does not configure a background sync service.

Remote: https://github.com/ZuchGuillotine/davapprove.git

For the desktop checkout: verify its remote and working-tree state, fetch origin, then integrate main without discarding local work. If main is clean and only behind, a fast-forward pull is appropriate. If there are local commits or modifications, inspect and reconcile them first. Keep the desktop project pointed at that existing checkout.


## Drawing coordination follow-up

Parcel identifiers require provider-specific formatting; see the onboarding and sprint-plan regression guidance. The shared-reference/sheet-registration implementation is in `backend/app/alignment.py` and `web/src/SheetAlignment.tsx`. It uses imported page images, persisted controls, a similarity transform and independent checks. Its database migration must accompany deployment. Source alignment, feature review and agency approval remain separate. See `docs/SITE_ENVELOPE_VIEWER.md` for current behavior and limitations.
