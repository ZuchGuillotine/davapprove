# Task-scoped fact classification

November 8 implementation: [Jev/Sol cascade release](CASCADE_RELEASE.md) records the operational processing pipeline, validation, benchmark and deployment limits. The broader architecture below remains the roadmap where the release explicitly lists remaining work.

November 7 automation direction: [Automated pre-check pipeline](AUTOMATED_PRECHECK_PIPELINE.md) defines the next architecture: machine-validated evidence, scoped revision reconciliation, automated geometry and exception-based human review. It supersedes blanket manual-acceptance design requirements below; existing runtime behavior remains unchanged until implemented.

Implemented November 7, 2026. Proposed workflow rules, not regulatory requirements.

The review API now derives `envelope-triage-v1` classifications without modifying original facts, document bytes, citations or human review decisions. The Records panel defaults to unresolved site-envelope evidence and provides later-stage, reviewed, superseded and all-facts views. No external classifier service is required.

## Classification axes

- Relevance: direct spatial/layout evidence, likely later-stage evidence, or unknown. Unknown stays in the immediate queue. Spatial terms take precedence over administrative terms.
- Resolution: unresolved versus accepted/rejected extraction. These remain distinct from agency approval.
- Conflict: differing values for a named structured fact require review. Generic excerpts and geometry are excluded from this simple comparison because multiple excerpts and separate geometries are legitimate. Semantic conflicts still need a reviewer.
- Authority: an explicitly verified agency decision has an agency, citation, reviewer, revision and scope. An extracted “approved” string is insufficient. Approval establishes the agency's scoped decision, not the accuracy of OCR or applicability to a changed proposal.
- Temporal lineage: supersession requires an explicit cited, reviewed relationship for this task, matching permit ID, agency and jurisdiction, and a verified approved successor. Dates alone never establish precedence. Conflicts remain visible.
- Priority: conflicts first, then direct envelope facts, then unknown relevance. This is a review recommendation, not a legal dependency ordering.

All views retain source links. Changing the filter does not change calculation inputs or accept evidence. The classifier deliberately does not suppress prior facts from the evaluator: retiring a previously accepted calculation input requires a separate reviewed revision. An approved replacement cannot silently remove an easement or environmental constraint.

## Curated lineage contract and remaining work

Document records may carry `decision_verification` with `decision`, `agency`, `revision`, `scope`, `reviewer`, and `citation`; and `supersession` with `document_ids`, `task: site_envelope`, `reviewer`, and `citation`. This is a curated contract: current extraction does not populate it and there is not yet a UI to verify these relationships. Consequently existing imports will not automatically disappear based on an approval label. Keep these fields out of probabilistic extraction output until an authorized review path is implemented.

Next implementation should provide a revisioned source-lineage review interface, with fact-level scope where a replacement only supersedes part of a source. Add explicit effective/expiry dates, conditions, parcel identity, design revision and stage applicability before allowing automatic reliance. Preserve historical approvals when current applicability fails. Task-specific erroneous/deferred judgments should be stored separately from the existing global extraction rejection; this release does not introduce task-specific rejection.

A probabilistic classifier can later propose typed relevance tags, document roles, permit families, revision identifiers and supersession candidates with citations and calibrated uncertainty. Deterministic checks should enforce identity, scope and review provenance. Do not let a probability threshold retire evidence or approve a prerequisite. Evaluate recall of envelope-critical facts and mistaken suppression on the sponsor's parcel cohort before enabling automatic routing beyond these transparent heuristics.

The current keyword classifier can miss paraphrases; unknown facts remain visible for this reason. It classifies imported facts at read time, not candidate documents before import. Original records remain available for other workflow steps.

## Retroactive review

All stored facts, including imports created before classification existed, are classified on every review API read. There is no backfill job or AI charge. Records → Evidence review → **Reclassify existing facts** reloads this result without changing evidence or human decisions. The panel shows total retained, direct envelope, uncertain relevance, later-stage, historical and reviewed counts. Direct and uncertain filters allow focused inspection; the default Resolve now view still includes unknown relevance and conflicts. A synthetic API test covers 540 legacy facts and verifies repeated classification makes no writes or document fetches. These synthetic counts are not measurements of the live test parcel.
