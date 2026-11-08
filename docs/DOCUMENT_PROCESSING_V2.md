# Document processing v2 and model funding

Decision: November 7, 2026. This is the next implementation plan, not deployed functionality. It supersedes the original single-excerpt/provider-neutral AI plan. The live prototype still uses Cloudflare Workers AI; no OpenAI calls or new trial gates are enabled by this document.

## Product boundary

Davapprove funds document search, selected import/upload, parsing, preliminary site-envelope graphics and dependency-graph population through its own OpenAI API connection for the first **three trial projects**. No user model connection is required to experience that complete flow. Review/correction of extracted evidence is part of this flow, not paid document editing.

Beyond the three-project allowance, or when requesting AI-assisted document/drawing authoring or editing, require a user-funded model connection. This is the user's chosen funding boundary; do not silently charge the platform for those operations. Existing evidence, downloads and completed results stay accessible. No user-facing connection form, API-token input, connector or MCP server is to be built in this phase.

Proposed counting policy: three lifetime project slots per billing owner, consumed atomically when a real project is successfully created; synthetic demos, retries and new design revisions do not count. Deletion does not restore slots. Collaborators do not consume their own allowance by joining someone else's project. Use a unique project allocation ledger and transaction to prevent concurrent fourth-project creation. Confirm this counting policy before rollout and handle existing beta projects explicitly rather than surprising users retroactively.

Future server entitlement decisions: `allowed`, `requires_user_model`, `budget_paused`. Store funding owner, provider connection reference and operation class on each job. A queued job cannot switch payer silently. User-model availability never bypasses membership, source-selection, review or code-evaluation rules. Until the connector exists, return a clear capability-unavailable state rather than presenting a nonfunctional integration flow.

## Processing flow

1. Preserve an immutable original, checksum, source URL/date, original page numbering and project/revision context. Validate PDF format, page count and resource bounds.
2. Inventory **every page**: native text, OCR quality, orientation, drawing/table/text classification and image/vector availability. Preserve page images and OCR bounding boxes. Native text and Tesseract remain useful local extraction tools; OCR is no longer the only representation sent to AI.
3. Build durable page/section chunks sized by tokens, image dimensions and request bytes. Keep tables and related drawing sheets together where feasible, use bounded overlap, and retain original-page mappings. Do not truncate a document to its first excerpt. Every page must be processed or explicitly marked unreadable, excluded or awaiting budget.
4. Use the OpenAI Responses API with structured extraction schemas. Route ordinary text to a cost-efficient model; route drawings, stamps, handwriting and ambiguous scans to a vision-capable model with page images and selected enlarged crops. Configure models by role, pin tested versions where available, and select exact models after evaluating account availability, published prices and the representative corpus. A larger context model is useful for cross-sheet reconciliation, not a substitute for coverage accounting.
5. Reconcile chunk outputs into a document-level evidence register: deduplicate overlap, resolve references, identify conflicting dates/dimensions/revisions and keep contradictions visible. Global synthesis consumes this register and fetches cited source regions as needed. Retrieval supports follow-up questions; it does not prove exhaustive parsing.
6. Validate quotations, page references, schema, units and source regions. Text quotations must match native/OCR text. Visual-only observations carry a crop/page reference and explicit visual provenance; do not fabricate OCR matches. Low-confidence or contradictory observations remain proposed and require review.
7. Produce a provisional envelope and populate workflow evidence from accepted facts. Unknown applicability remains unknown; deterministic, cited rules evaluate requirements. An agency decision is separate from a report or AI proposal.

Persist `processing_runs`, `page_manifest`, `chunks`, `extractions`, `usage_reservations` and `entitlement_allocations` behind existing project RLS. A chunk key includes document hash, page range/crop, pipeline version, model and prompt/schema version. Lease/heartbeat per chunk; bounded retries; resume only missing/failed work. Expose page counts and stages, not a single spinner. Budget exhaustion yields partial coverage, never “complete.” Preserve prior accepted facts during reprocessing; publish a new extraction version for review.

## Drawings and geometry

Vision identifies candidate dimensions, scale labels, north arrows, legends, boundaries and relationships. Use full-sheet context plus crops to retain small lettering and line-style context. Prefer native vector/CAD coordinates when available. Raster geometry requires explicit scale/control-point calibration, coordinate-system handling, unit checks, topology validation and reviewer acceptance. Do not derive survey-grade setbacks or areas from uncalibrated model pixels. A page's printed scale may be invalid after resizing.

Store geometry provenance: document hash, sheet/revision, crop/bounds, coordinate transform, units, extraction method and reviewer. Keep interpreted geometry separate from accepted geometry and deterministic envelope calculations. Unresolved scale, conflicting dimensions or missing survey control must produce a partial/unavailable envelope. Initial visual interpretation is not a CAD editing engine.

## Cost and connection architecture

Three projects is an acquisition allowance, not a sufficient spend cap. Reserve worst-case cost before each chunk; reconcile measured tokens/images/retries after completion. Enforce platform-global and per-owner/project budgets plus upload/page limits. Never spend beyond the configured cap to complete a run. Keep the existing $5 global pilot AI allowance until the owner approves a revised budget; this may pause full-document runs and is not a promise of three unlimited projects.

Measure representative scan/drawing workloads before setting an included page allowance or user price. Report per-project cost, pages by processing route, retries, latency, extraction quality and reviewer corrections; calculate median and high-percentile costs. Platform cost includes VM, storage/egress and backups as well as inference. A user API token only transfers model charges, not these infrastructure costs.

Implement a provider boundary now in design: `process(request, funding_context)` with capability declarations for vision, structured output, context and usage reporting. Platform credentials remain server-only. Future user credentials need encrypted storage, per-owner isolation, revocation and redacted logs; never browser localStorage or frontend environment variables. Provider destinations must be allowlisted to prevent arbitrary endpoint/SSRF access.

A future MCP/connector exposes authorized project context and proposed change sets to an external agent; it is separate from API billing and is not itself a model credential. Use scoped authorization, project access checks and audited, revision-bound proposals. Changes to documents/geometry require explicit acceptance and conflict checks. Do not expose platform credentials through tools. A ChatGPT subscription must not be treated as API billing credit.

## Implementation sequence and acceptance

1. Add manifests, chunk jobs, coverage/provenance and cost reservations with migrations and RLS tests; preserve existing records and accepted facts.
2. Add platform OpenAI text/vision adapters and benchmark on the pilot's 7-, 2-, 46- and 6-page files plus sponsor-reviewed drawings. Test facts on the last page, rotated scans, dense tables, conflicting dimensions and ambiguous scales. No golden expected facts invented from model output.
3. Add deterministic chunk reconciliation, source-region review and geometry calibration. Verify 100% page accounting, recoverable failures, no duplicate charges on known-safe retries, and no promotion of unsupported geometry/approval.
4. Add server-only three-project entitlement enforcement and audit ledger. Test concurrent creation, deletion/recreation, collaborator access and editing operation denial. Do not build the future connection UI.
5. Enable OpenAI after protected credential setup, measured quality/cost review and smoke tests. Reprocess the prior 46-page AI failure as a new version; do not overwrite accepted evidence. Retire Cloudflare AI as the default after verification, with rollback preserving data and run provenance.

## Official references

Reviewed November 7, 2026: [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs) documents PDF text plus page-image processing and detail controls. [Vision limitations](https://developers.openai.com/api/docs/guides/images-vision#limitations) documents small-text, line-style and precise spatial-localization limitations. These capabilities justify visual extraction with verification, not autonomous engineering accuracy. Exact model selection/pricing and account access remain implementation checks.
