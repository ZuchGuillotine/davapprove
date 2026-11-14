# Jev / Sol processing release — November 8, 2026

This release implements the first operational cascade from the automated pre-check plan. It is a permitting pre-check aid, not an approval or construction-authorization system. Deployment and corpus results are recorded below after verification.

## Implemented processing

- Immutable originals and retained native/OCR page inventories are reused. Every page has a processing record; no page is discarded merely because Jev calls it irrelevant or historical.
- Pinned Jev 1.14 classifies page role, relevance and source-reported status. Clear native narrative pages use Sol text processing; drawings, scans and uncertain pages use text plus page images.
- GPT-6.1 Sol low performs structured extraction with original-page citations, named entity/property/scope/revision, explicit date/permit/agency lineage, conditions and geometric observations. Up to 40 observations per page; saturation or rejected citations triggers one bounded medium-effort continuation. Continued saturation remains a coverage exception.
- Jev verifies quoted textual assertions against source context. Exact-quote checks, schema validation and scoped contradiction detection remain deterministic. Pilot routing thresholds are engineering settings, not calibrated accuracy claims: .90 support for ordinary extraction, .97 for critical terms, with at most .01 contradiction probability. Those decisions establish extraction support only, never legal applicability or agency approval.
- Ambiguous Jev checks escalate to a separate Sol low source-verification pass (`source-verification-2026-11-08-v3`). It checks the original text/image, claim, identity, lineage and readability, and requires explicit high-confidence support for all of them. It cannot promote traced coordinates. A second pass by the same model is corroboration, not an independent model or an accuracy guarantee. Verification failure/budget exhaustion preserves the extracted evidence as an exception.
- Human corrections remain separate and authoritative. New facts have new identities, and old facts are retained. A complete newer page extraction retires older unreviewed extraction versions for that page from the default queue; this is separate from design supersession. Source-supported explicit replacement language can retire a particular entity/property scope when permit, agency, jurisdiction, revision and issue-date checks match. Dates alone cannot do so.
- Machine-supported evidence can populate workflow evidence availability without a human acceptance click. Actual decisions, applicability, geometry acceptance and inactive numerical code packs do not become approved through this path.
- The UI distinguishes evidence exceptions from resolved evidence and retains source inspection and correction.

## Limits that remain explicit

Automatic geometric observations retain sheet coordinates, dimensions and the existing geographic-control solver. Source-supported text does not validate traced outlines. Geometry without independent calibration remains a provisional sheet preview; this release does not fabricate survey controls or remove the geometry-validation gate. General automatic cross-sheet feature registration, bearing/distance reconstruction, independent geometric validation and calibrated positional uncertainty remain follow-up work. Numeric legal rule packs remain inactive where not independently validated. The complete long-term architecture is not claimed delivered by this release.

Entity matching currently uses extracted named identities and explicit scoped lineage. Semantic identity resolution for unnamed features remains a review/investigation case. Different prose values within the same asserted entity/property/scope may be conservative conflict candidates, not proven physical contradictions. A benchmark without expert labels does not establish false-negative rates.

## Reliability and accounting

Jev and Sol share the atomic $35 monthly reservation ledger (raised from $25 with explicit user authorization on November 8). Charges include input, cached input, cache writes and output (including reasoning tokens) at the published November 8 rates. Unknown/failed requests retain reservations and cannot be automatically replayed. Actual usage above a reservation is an explicit error. Request caches include complete request content, provider, model, effort, schema, source hash, pipeline version, project/document and benchmark variant. Pinned Jev access and Sol text/image calls were verified with the protected credentials.

Four page tasks per document and two documents in the explicit reprocessing runner bound concurrency. The normal worker still claims one job at a time. Long documents resume from stored results; documents cannot switch to the new active extraction until their facts are persisted. Benchmark requests are marked separately and do not replace document facts or active processing metadata.

Published pricing sources checked November 8: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Sol capabilities](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [TypeSafe models](https://docs.typesafe.ai/models). Accounting uses API-reported usage and published unit prices, not a reconciled provider invoice.

## Initial comparison

Three source pages were selected across a short document, a scan and a larger package. Each ran through Jev + Sol and Sol alone, with the same extraction schema. This initial diagnostic preceded the final lineage fields and pilot routing-threshold adjustments. It is not a held-out quality evaluation.

The cascade cost $0.104749 (Sol $0.104065; Jev $0.000684); Sol-only cost $0.081004. All three selected pages used vision in both arms. Extracted fact counts were 20/24/4 for the cascade and 21/23/4 for Sol-only. The two dense pages reported saturation in both arms. Jev did not demonstrate savings on this drawing-heavy subset; differing generated output lengths and cache behavior contribute to the cost difference. Total comparison cost was $0.185753. Raw source-linked observations and request records remain in the private project; no source documents are published in this report.

## Validation and deployment

Frontend `3ba29129-9d65-4d2f-9d6b-96e824c59a48` is live; its JavaScript/CSS asset hashes match the local production build. API and worker are deployed with cascade routing and the authorized $35 cap. The original $25 run extracted all 774 pages, then paused source verification; the authorized continuation completed all 240 remaining page checks with zero processing backlog. Total metered corpus cost is $26.228190; the shared ledger totals $28.773567 including benchmarks, earlier work and the uncertain reservation. See [run results and costs](CASCADE_RUN_RESULTS.md). Before activation, 107 backend tests, 23 frontend tests, TypeScript/production build, research-report regression checks and Wrangler dry-run passed. Final checks passed: 114 backend tests and 23 frontend tests, production build and report regressions. Tests cover source verification, per-page activation and the separate processing backlog. Existing uncommitted work and host differences were inspected and preserved. Rollback source/environment and images are retained under `/opt/davapprove-releases/cascade-before` and `davapprove-{api,worker}:before-cascade`.

## Final small comparisons

The final extraction/schema comparison used the same three pages. Cascade extraction produced 12/20/1 claims; the added source-verification pass supported 7/18/1 (26 of 33). Sol extraction alone produced 15/18/1; these were not automatically accepted because that arm deliberately omitted verification. One cascade page and one Sol-only page reported saturation. This benchmark tests the first extraction pass, not the production continuation path. It has no expert ground truth and cannot estimate accuracy or establish that the cascade captures more evidence.

Final cascade cost including verification: $0.143676 (Jev $0.000625, Sol $0.143051). Sol extraction alone: $0.075985. All three pages used images. Additional verification provides different work, so the total-cost comparison is not an equal-quality comparison. It does not show Jev saving money on this subset. Original paid provider durations sum to 90.733 seconds for cascade calls versus 62.841 for Sol-only; warm-cache rerun timings are excluded and these sums are not a throughput benchmark.

A separate Jev-only versus Sol-only test used ten literal assertions on one narrative source page: five source-supported assertions and five deliberately altered numbers/negations. Both chose the expected answer on 10/10; Jev assigned at least .97 to all ten choices. Jev cost $0.000084 and Sol $0.002284. The source anchors were checked before execution. This tiny, deliberately simple control set supports narrow Jev questions; it does not calibrate confidence or establish performance on revision lineage, visual geometry or legal applicability. No benchmark facts were published to the project evidence set.
