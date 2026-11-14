# Automated evidence reconciliation and permitting pre-check

November 8 implementation: [Jev/Sol cascade release](CASCADE_RELEASE.md) records the operational processing pipeline, validation, benchmark and deployment limits. The broader architecture below remains the roadmap where the release explicitly lists remaining work.

Decision direction: November 7, 2026. Status: proposed implementation architecture, grounded in the current checkout; not deployed functionality or a regulatory requirement. Applies first to the existing Kitsap County/Poulsbo pilot.

## Product objective and precedence

Davapprove should turn selected documents into a reconciled project model, perform supported checks against cited code specifications, and ask people only about consequential unresolved questions. Importing facts into a large manual acceptance queue is not the product outcome. Optimize for time to useful pre-check and avoided drafting cycles, while measuring missed issues and incorrect clearance.

This plan supersedes blanket per-fact human-acceptance requirements and the prohibition on automatic georeferencing in the earlier MVP, architecture, development prompts and document-processing plans. It does not change running software by itself. It retains selected-import boundaries, the revised funding/budget policy below, immutable sources, jurisdiction separation and deterministic evaluation. The research report remains unchanged.

Results are permitting pre-check findings: supported check satisfied, likely issue, indeterminate, or unsupported check. They are scoped to a project revision, work stage and rule version. They do not issue permits, authorize construction, certify surveys or guarantee agency acceptance. Documented requirements, proposed product policies and agency-confirmation questions remain distinct.

## Revised model and funding decision — November 7 follow-up

Optimize reliable project outcomes and human time saved, not the lowest token bill. The initial GPT-4.1 mini deployment operated under a $5 monthly pilot allowance; no checked-in comparative evaluation establishes it as the best model for complex drawings. Retain it as a benchmark baseline, not the target architecture.

The intended processing cascade is:

1. **Local parsing and deterministic preparation:** inventory every page, parse text/vectors, OCR, normalize dates and units, identify candidate spans and relationships, and reuse unchanged results.
2. **Jev routing and bounded decisions:** classify roles and relevance, associate date/status labels with candidate source spans, select entity/revision matches, identify replacement scope and test source support. Batch independent questions over a compact shared state. Compose the results with explicit code rather than asking one broad question about document trustworthiness.
3. **GPT-6.1 Sol at low reasoning:** primary complex extraction and reconciliation route for drawings, mixed text/image evidence, ambiguous relationships and cross-sheet conflicts. Send source pages/crops plus related evidence and explicit tasks. Complex drawing pages go directly here after inventory; do not force a failed cheap extraction first. Simple cases solved by Jev plus validated parsing need no generative-model call.
4. **Deterministic validation and targeted Jev verification:** check citations, units, topology, lineage consistency and evidence support. A Jev check supplements source validation; model agreement alone cannot establish truth. Preserve separate source evidence and reasoning provenance.
5. **Bounded machine investigation, then human exceptions:** inspect alternate crops or related sheets and allow one targeted higher-effort reasoning pass when likely to resolve a material issue. Missing information or legal discretion goes straight to a specific human/source request. Cap retries and total cost rather than looping until models agree.

Official OpenAI documentation confirms `gpt-6.1-sol` supports text/image inputs, structured outputs and `reasoning.effort: low`. Use the Responses API and set effort explicitly (the documented default is medium). This is the selected implementation target, not a claim of account access or successful deployment. Before switching, verify access, current pricing, image-token bounds, output/reasoning-token reservations, timeouts and a representative text/vision smoke test. Include model, effort, schema, routing policy and source context in cache identity. Preserve prior extractions as separate versions. Do not merely add a model name to the current allowlist: its image-cost reservation is specific to GPT-4.1 mini. [Official model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

### Concrete Jev decision graph

For a possible replacement, local code first identifies source spans, candidate dates, permit/parcel identifiers and sheet numbers. Jev answers separate typed questions: which date is issuance versus submission versus decision; whether the status is proposed/submitted/approved/conditional/unknown; whether two sheets concern the same design element; whether replacement language covers all or only part of the sheet; and whether retained conditions are referenced. Every answer selects supplied IDs or an unknown option. Code then parses and compares dates, checks identity and builds scoped relationship edges. A drawing created before a decision is not automatically obsolete; it might be the drawing that was approved.

Use Jev beyond document labels: select plausible OCR readings from candidates, classify table rows/notes, identify references to another sheet, map extracted facts to supported check inputs, distinguish historical changes from simultaneous contradictions, and verify whether a source supports a proposed assertion. Decompose difficult tasks into reusable question sets and deterministic predicates. Evaluate multi-stage error accumulation and false suppression as well as per-question accuracy.

TypeSafe documents both [atomic decision patterns](https://docs.typesafe.ai/patterns) and an [extraction/verifier/reasoning cascade](https://docs.typesafe.ai/cookbooks/sde_cascade). These support testing the architecture, not assuming domain accuracy. Start Jev with text/metadata; separately benchmark image/Box experiments without making them the production geometry dependency.

### Budget and commercial assumptions

The authorized test budget is **$35 shared per UTC calendar month across the hosted test projects**, raised from $25 by explicit user authorization on November 8 to finish source verification. This follows the existing monthly global ledger; it is not $35 per project, document or model, and existing spend/reservations count toward it. The deployed cascade shares this ledger across Jev and OpenAI. No automatic top-ups, provider switches or payer changes. Reservations include worst-case input/images and billed output/reasoning; uncertain requests retain reservations. Admission pauses when the remaining budget cannot fund a bounded request.

The original $25 planning allocation for the first comparative evaluation was up to $2 for Jev experiments, $18 for reasoning-model intake/reconciliation and $5 for targeted escalation/retests, all within the shared $25 cap and reduced by existing usage. These are planning allocations, not separate implemented spend limits or a commitment to consume them. Reallocate within the cap based on measured benefit. Do not reparse the full corpus on every prompt experiment; replay cached inputs and test a stratified subset first.

Annual subscriptions can accommodate uneven intake costs. Treat the sponsor's 2–10 projects/year and $200–$500 competitor-price range as planning assumptions, not verified market research or adopted pricing. Model annual cost as initial intake per project + incremental revisions + exception handling + storage/operations/support. Measure heavy users and burst months as well as average annual spend; quiet months do not eliminate peak cash requirements. Set eventual annual usage credits with project/intake burst limits from observed costs rather than copying the test monthly allowance into customer pricing. Track quality and human time saved alongside model spend.

**All core ingestion, parsing, reconciliation and pre-check processing is platform funded in this version.** No user API key or connector is required. This supersedes the earlier hard boundary requiring a user-funded model beyond three trial projects; trial eligibility can remain separate from how inference is funded. Future versions may offer user-funded specialist processing and authoring/editing. Preserve a funding-context interface and immutable payer on each job, but defer connection UI, credentials and mandatory external-model gates. The eventual boundary follows usage evidence and user feedback.

### Evaluation commitment and promotion

Make Jev evaluation an explicit implementation deliverable, not an indefinite optional experiment. Compare four routes on the same labeled, held-out project families: current baseline; Sol low without Jev; Jev + Sol low; and Jev + Sol low with bounded escalation. Include relevant material that Jev would defer, as well as obvious outdated sheets, partial replacements, mixed packages, wrong-parcel matches and conflicting current drawings. A reasoning model's output is not the ground-truth label. Use targeted expert adjudication for the benchmark and audit samples after promotion, not mandatory review of every customer fact.

Report end-to-end cost, latency, human minutes, critical omission/false-suppression rates, false merges and incorrect satisfied checks. Calibrate question-specific thresholds on training/validation cases; hold out entire permit/project families so duplicated sheets cannot leak across splits. Version each question set and test how performance changes as candidate count and document quality change. Promote demonstrated Jev capabilities individually, widening its role where measured performance supports it.

The routing/model changes above remain planned. The budget change has local code and a hosted database migration; hosted worker activation is staged pending a safe restart after active processing. See operations for exact deployment status. No benchmark results or Jev deployment are claimed by this document.

## Findings from the current code

- `backend/app/classification.py` uses keyword triage at read time. Unknown relevance stays in the queue. Supersession depends on curated reviewer metadata that extraction does not populate. It sorts evidence but does not select a current computational model.
- Its conflict comparison groups differing values by fact key, without entity, revision or stage context. This can confuse legitimate historical differences with current contradictions.
- `backend/app/openai_processing.py` performs text/vision extraction and overlap deduplication. Its instruction caps useful facts per response and requires review; processed-page accounting does not establish exhaustive capture of relevant features or conditions.
- `backend/app/worker.py` saves proposed facts and sets documents to `needs_review`. Broad excerpts are useful source material but should not each become a human task.
- `backend/app/drawings.py` requires explicit WGS84 controls for geographic output and reconciles only identical entity IDs. Many ordinary survey/site sheets cannot satisfy that path.
- `backend/app/alignment.py` supports shared-reference registration, but accepted survey registration depends on manual controls/review. `backend/app/evaluation.py` still separates proposed overlays from accepted calculation inputs, with reviewer-confirmed extracted geometry required for subtraction.

These observations explain architectural bottlenecks. They are not a new inspection or accuracy measurement of the live parcel corpus. Existing unrelated and uncommitted implementation work must be preserved.

## Target processing flow

1. **Inventory and normalize.** Preserve selected originals, hashes, source identity, parcel/permit aliases, page numbers, dates, page images, vector content and source regions. Detect exact duplicates; identify near-duplicates as candidates, not interchangeable originals. Inventory every page, including attachments and mixed document packages.
2. **Classify before expensive extraction.** Identify document/page role, discipline, drawing versus narrative, possible revision, existing/proposed/record condition and relevant checks. Use cheap deterministic signals first and narrow probabilistic decisions next. A document can have several roles. Unknown classifications trigger machine investigation, not immediate human review. Retain all source coverage; relevance filtering must not erase possible constraints.
3. **Build source and revision relationships.** Group permit families and sheet series; identify replacement sheets, amendments, decisions and referenced conditions. Extract date meanings separately (issue, submission, decision, recording, retrieval). Use explicit replacement language, sheet identifiers, package manifests and decision attachments to establish precedence. Resolve dates and identity constraints in code.
4. **Extract task-relevant observations.** Use native text/vector parsing, OCR and vision as appropriate. Retain exact spans or crops, units, feature outlines, dimensions and alternative interpretations. Search specifically for the inputs required by supported checks and referenced conditions. A fixed top-N fact list cannot prove absence or completeness; mark saturated responses and schedule focused follow-up extraction.
5. **Reconcile across sources.** Match physical entities and assertions across disciplines using candidate generation followed by narrow AI decisions. Compare facts within entity + property + scope + revision + stage. Normalize units and compare values deterministically. Preserve both corroboration and disagreement; copied sheets are not independent corroboration.
6. **Validate and assemble a pre-check snapshot.** A versioned policy decides which resolved assertions and geometries are eligible for which uses. It checks provenance, identity, temporal applicability, coverage, contradictions and geometric quality. Publish an immutable snapshot with machine decisions and reasons. Do not manufacture human acceptance or agency verification.
7. **Run deterministic checks.** Bind the snapshot to a reviewed rule pack, jurisdiction, code edition/effective basis, design revision, stage and as-of date. Evaluate explicit predicates and geometry with uncertainty. Unsupported provisions or unknown applicability remain indeterminate. AI may identify relevant provisions and explain cited results; it cannot activate invented executable code requirements.
8. **Investigate exceptions automatically, then ask narrowly.** Retry OCR, inspect enlarged crops, retrieve referenced material within selected sources, compare alternate sheets, or escalate to a stronger model within budget. Ask a person only when the remaining decision materially affects an output or cannot be resolved from available evidence. Missing selected coverage is visible; requesting another import is different from asking someone to verify hundreds of facts.

## Independent evidence states

Do not extend `review_status` into a catch-all confidence field. Retain human decisions unchanged and add separate state axes:

| Axis | Example states / meaning |
| --- | --- |
| Observation | Extracted value and source region; immutable alternatives remain available |
| Validation | Pending, machine-validated, failed, human-corrected; records actual checks performed |
| Temporal role | Current for scope, historical, superseded for scope, unresolved |
| Source authority | Consultant assertion, submitted design, source-reported agency decision, verified scoped decision |
| Applicability | Applicable, not applicable with support, unknown; bound to revision and stage |
| Use eligibility | Display only, provisional scenario, automated pre-check input, human-confirmed input |
| Exception | Machine investigation, needs user decision, missing source, unsupported capability, budget paused, resolved |

A machine-validated assertion can be eligible for a pre-check without a human acceptance event. Source authority is not a proxy for extraction quality. A permit decision does not establish installation, or current applicability to an altered design. A newer unapproved design can be the current proposal while the previously approved design remains the historical agency baseline.

Persist decisions with assertion/relationship IDs, immutable source hashes and regions, project revision, task/scope, normalized entity, policy/model/prompt versions, probabilities, deterministic validation results, evidence dependencies, time and actual actor type. Machine outputs must never populate a reviewer identity. Human corrections override machine proposals until explicitly revised; stale jobs cannot overwrite them.

## Supersession and contradiction policy

Retire outdated *assertions for a specific use*, not whole documents. A replaced house footprint may be historical while an easement, approval condition or septic reserve location on that same sheet still matters. The current-proposal baseline and the agency-approved baseline are separate relationship graphs.

Automatically exclude exact duplicates from repeated work. Automatically select an explicit replacement when identity, sheet/property scope and source-linked lineage are consistent, supported by the validated policy. No approval is required merely to recognize that the designer has issued a new proposed drawing. Explicit agency evidence is required to describe a revision as agency approved.

Do not suppress evidence solely because of a later date, an approval-looking stamp, a classifier score or the absence of a feature on a newer sheet. An unexplained disappearance of a material constraint is a contradiction to investigate. Cycles, ambiguous replacements, conditional approvals and partial package amendments remain explicit. Automatic historical routing does not require manually checking every obsolete value.

Resolve disagreements through scope, units, source role and lineage before treating them as conflicts. If a new footprint is an intentional revision, it is a change, not two incompatible current footprints. If civil and architectural current sheets disagree on the same footprint, create one coordination issue with both crops and affected checks.

## Geometry automation

Separate three capabilities: render in sheet coordinates, compare in a shared local frame, and locate on the parcel. Lack of geographic controls must not prevent the first two. Clearly label unlocated views and screening overlays.

Use the following order, selecting the best supported method per sheet:

1. Native geospatial/vector coordinates with declared CRS and units; validate datum, axis order and source provenance.
2. Printed coordinate tables, survey bearings/distances, monuments and dimensions; solve and validate coordinate transformations in code. Local traverses can establish scale and shape without inventing geographic placement.
3. Automatic registration to a suitable shared survey/reference sheet using matched boundary corners, monuments and stable features. AI proposes correspondences; geometric solvers fit them, reject outliers and test independent held-out controls. Do not use a proposed movable building as the sole anchor for comparing that building's movement.
4. Scanned-sheet registration with explicit distortion checks, full-sheet context and detail-specific scales. Reject unsupported transforms; a low residual alone cannot prove correct feature identity or outline accuracy.
5. A focused human correction only when automated routes fail: identify a disputed control, select between two boundary interpretations, or supply a missing reference. Reuse a valid sheet transform across its features instead of recalibrating each polygon.

Validate topology, units, coordinate frame, scale, orientation, independent residuals, dimension consistency, feature interpretation and source lineage separately. Carry uncertainty from the reference, registration and traced outline; do not treat multiple matching copies as independent accuracy evidence. Public GIS alignment can support screening, not acquire survey accuracy by repeated matching.

Use bounded uncertainty in deterministic checks. For a minimum-distance rule, if the entire credible distance interval is above the threshold, report that scoped check satisfied; if entirely below, flag a likely issue; if it crosses the threshold, investigate and possibly ask for more precise evidence. Derive the interval from supported error bounds, not arbitrary model confidence. If bounds are unavailable, return indeterminate. A boundary near the threshold needs more precision than one far away.

Permit relative-distance/dimension checks before geographic placement when their coordinate frame and evidence are valid. For envelopes, display a nominal preliminary result and conservative uncertainty extent where supported; never show an uncertain remainder as definitely buildable land. Missing constraint geometry keeps the result partial.

## Jev evaluation and role

Official documentation checked November 7, 2026. Jev is the intended classifier/verifier tier, subject to capability-specific evaluation before promotion. It complements parsing and reasoning; the revised decision above makes its benchmark an explicit deliverable.

- Use small typed decisions: document/page role; same physical entity versus distinct versus insufficient evidence; current-revision relationship; whether a candidate source span supports an extracted value. Supply bounded candidate IDs and exact source context. Code validates returned IDs and combines decisions.
- Always offer unknown/none-of-the-above. Split compound questions. Keep date arithmetic, unit conversion, graph constraints and geometric solving in deterministic code. Do not multiply correlated model scores into an invented overall reliability estimate.
- Benchmark against existing heuristics and the current extraction provider using the same held-out parcel cases. Compare error rates, abstention, total investigation cost, end-to-end latency and human minutes, including wrong high-confidence decisions.
- Start in shadow mode on text/metadata and candidate relationships. Promote one task at a time after calibration on this domain. Policy thresholds are task/risk specific; no global “95% means accepted” rule. Schema correctness is not semantic correctness.
- Jev images/Box should be a separate prototype track: the vendor explicitly describes them as not production ready. Continue established vision/vector extraction while evaluating them.
- Keep the classifier adapter server-side, bounded, cached by source/context/policy/model versions, and charged within existing budgets. Use official TypeSafe infrastructure only; similarly named third-party sites are not interchangeable providers. No private files are sent and no paid benchmark is initiated by this planning change.

References: [typed questions](https://docs.typesafe.ai/introduction), [confidence versus probabilities](https://docs.typesafe.ai/confidence), [model versions and pricing](https://docs.typesafe.ai/models), [image/Box maturity](https://docs.typesafe.ai/images). The model reference currently lists `jev-1.14.0` at $0.042 per million input tokens with free output tokens; confirm account availability and billing before use. Vendor price/latency claims are not measured pipeline savings. Pin a tested model version rather than a moving alias.

## Human experience and escalation

The default result is a pre-check summary and coordinated drawing view, not a fact inbox. Show checks completed, likely issues, indeterminate checks, source coverage, processing progress and the few decisions needed. Machine-validated evidence remains inspectable and correctable in a secondary evidence browser.

An exception card contains one concrete question, recommended resolution with evidence, alternatives, side-by-side crops, affected checks/geometry, and the consequence of leaving it unresolved. Group exceptions by root cause: resolving one sheet revision or reference alignment should update all dependent facts and checks. Record user actions as revisioned decisions and recompute affected outputs only.

Escalate material unresolved identity, current-revision ambiguity, conflicting constraints, insufficient geometric precision near a threshold, missing source conditions and unsupported legal applicability. Do not ask users to approve harmless duplicates, every historical fact, or every extracted label. A low-confidence fact unrelated to any supported check can remain uncertain in the evidence register without blocking the project.

Confidence alone cannot control the queue. Silent omissions and confidently incorrect outputs require coverage checks and independent audit sampling. Budget exhaustion pauses machine investigation with a clear reason and partial results; it must not disguise a cost limit as a mandatory expert-review requirement.

## Implementation sequence and release evidence

1. **Contracts and replay corpus.** Add independent validation/use-eligibility states, scoped relationships, machine-decision audit and root-cause exceptions. Build a project-isolated replay harness using existing imports; establish manual-time and error baselines before external inference. Preserve all originals and human corrections.
2. **Reconciliation and Jev shadow adapter.** Resolve duplicates, revision families and entity-scoped comparisons. Replay the corrected-parcel corpus and adversarial fixtures. Avoid migrating existing human statuses or retiring calculation inputs merely because a classifier changed.
3. **Automated pre-check snapshot and focused queue.** Add a policy-controlled snapshot builder and deterministic evaluator input contract. Support machine-validated text inputs first, followed by geometry classes that pass evaluation. Create new snapshots atomically; never mutate a pinned assessment. Replace blanket review counts with checks and actionable exceptions.
4. **Geometry registration and uncertainty.** Add automatic shared-sheet correspondences, state-plane/traverse support and native vectors in measured increments. Render local-frame comparisons early. Activate automated geometry use only for validated source/method classes; unsupported methods retain useful previews and specific gaps.
5. **Pilot promotion.** Compare against the current workflow on held-out projects and conduct end-to-end architect sessions. Enable per-capability flags with replayable decisions and rollback. Audit samples of auto-resolved cases, not just the queue. A new model, prompt, rule pack or reference invalidates only affected decisions and triggers evaluation before promotion.

Measure: human minutes and decisions per project; time to first useful pre-check; checks resolved automatically; critical-evidence recall; erroneous historical suppression; entity false merges; false satisfied results; missed contradictions; registration and outline errors; abstention/coverage by document class; total model cost and p50/p95 latency. Report denominators, sample sizes and uncertainty. Six pilot parcels can expose failure modes but cannot establish rare-error reliability alone. Set quantitative release thresholds from labeled baseline data and domain-risk review rather than inventing an accuracy promise here.

Required fixtures include partial supersession retaining an easement; new unapproved design versus old approved design; resubmitted but not approved sheets; copied evidence; mixed scales; changed parcel IDs; nearby-property records; scanned/rotated drawings; wrong units/datum; misleading stamps; hallucinated controls; independent-check failure; omitted final-page condition; top-N extraction saturation; legal rule inapplicability; unavailable classifier; exhausted budget; human override; stale revision race; and cross-project isolation. Include quiet, high-confidence errors and auto-suppressed cases in the evaluation set.

Success is demonstrably less user work with reliable, traceable pre-check findings. A smaller queue alone is not evidence of improvement.
