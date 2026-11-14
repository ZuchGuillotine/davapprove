# Test-parcel cascade run — November 8, 2026

The operational Jev → GPT-6.1 Sol pipeline is deployed. Extraction/reclassification and the automated source-verification pass are complete. After the initial $25 stop, the user authorized a $35 shared limit and all 240 paused page checks finished without new request failures. This is not a completed code-compliance or permit-approval determination.

## Corpus outcome

- 44 immutable imported documents, 774 pages; all 774 have extraction results.
- 31 documents have complete extraction coverage. Thirteen retain incomplete-coverage flags on 32 pages after bounded escalation. Another source-issue count, including readability/conflicting annotations, is 148 pages; these are visible in page coverage. Processing every page does not mean every relevant fact was recovered.
- 4,712 new observations: 3,976 passed source verification; 3,691 are in the automatically resolved bucket after conflict/human-override checks. There are 1,013 new observations in Resolve now and eight deferred to a later work stage.
- No observations remain blocked on automated verification. The continuation checked all 1,692 previously blocked observations; source contradictions, insufficient support and geometry still require resolution. A supported source assertion can remain in review when cross-source conflicts or human overrides prevent automatic reliance.
- 3,839 older extraction records are retained as history rather than default review tasks. Existing human decisions were preserved. Historical extraction versions are not synonymous with superseded designs.
- 280 geometric observations remain subject to calibration/review. This release does not automatically register all sheets or activate unvalidated numeric code rules.
- Jev routed 60 pages to text-only reasoning; 714 used images. No page was discarded because a classifier considered it irrelevant or old.

The separate source-verification pass was necessary: the first compound Jev assertion/identity/lineage questions were too uncertain to resolve most claims. The fallback requires explicit claim, identity, lineage and readability support. Model confidence is not a measured accuracy rate, and a second Sol pass has correlated-model limitations.

## Costs

Amounts are USD derived from API-reported usage and recorded pricing, including reasoning output and cache writes. They are not reconciled provider invoices. Hosting, storage, local OCR and development time are excluded.

| Item | USD |
| --- | ---: |
| Corpus Jev routing/support checks | 0.093590 |
| Corpus Sol extraction, escalation and verification | 26.134600 |
| **Metered corpus reprocessing** | **26.228190** |
| All comparisons and credential/vision smoke tests | 0.451334 |
| **Metered total for this implementation/test run** | **26.679524** |
| Held reservation for one timed-out request; actual charge unknown | 0.228185 |
| Earlier shared-ledger usage/reservations | 1.865858 |
| **Shared ledger at stop** | **28.773567 / 35.000000** |

The original $25 pass stopped with $0.070874 available, less than the next conservative reservation. The user then authorized $35. Finishing verification added $3.844441 in metered model usage; $6.226433 remains under the cap, and no in-flight requests remain. A completed benchmark response recovered the timed-out extraction only after both complete request identities and source hashes matched; the uncertain original charge remains reserved. No duplicate extraction charge was created for that recovery.

The $26.23 corpus figure covers extraction, bounded escalation and all attempted automatic source checks. It does not establish that the corpus is accurate or exhaustive: 32 pages retain coverage gaps, and unresolved source/geometry observations remain visible. The database and active worker both enforce the authorized $35 cap; usage and uncertain reservations were retained. Completed requests were reused rather than billed again.

## Small comparisons

| Comparison | Jev/cascade | Sol-only |
| --- | ---: | ---: |
| Three-page extraction plus cascade source verification | $0.143676 | $0.075985 for extraction alone |
| Ten literal source assertions/negative controls | $0.000084; 10/10 expected choices | $0.002284; 10/10 expected choices |

The three-page cascade extracted 33 observations, of which 26 passed its source check. Sol alone extracted 34 observations and had no verification stage. All three pages used images. The cascade did more work and cost more; this does not show a quality advantage or Jev savings on complex drawings. One page in each arm reported saturation. The comparison covers the first extraction pass, not production continuation.

The ten literal controls used five explicit source assertions and five deliberate number/negation changes on one narrative page. Both models selected all expected answers; Jev assigned at least .97 probability to each selected answer. This small, deliberately easy test supports narrow Jev tasks but cannot establish production accuracy or calibrate confidence. The release notes retain the earlier diagnostic comparison separately. Benchmark facts were not published as project evidence.

## Deployment and validation

- Live app: https://davapprove-preview.delicacybydesign.workers.dev
- Frontend version: `3ba29129-9d65-4d2f-9d6b-96e824c59a48`; public asset hashes match the production build.
- API and worker rebuilt/restarted after active processing drained; existing tunnel preserved. API health returned 200.
- Runtime: Jev `jev-1.14.0`, GPT `gpt-6.1-sol` at low reasoning; one bounded medium-effort continuation for incomplete extraction.
- The original release passed 114 backend tests and 23 frontend tests, along with TypeScript/production build and research-report regression checks. The local test-worker startup stalled; frontend tests passed in an isolated Linux container using the same source/lockfile after excluding macOS archive metadata. After raising the cap, all 35 targeted budget/processing tests passed. Existing dependency/bundle-size warnings remain.
- No active import/reprocessing/verification jobs remain. The old import queue contains 51 completed jobs and one prior failed job; this run processed the fixed original-document manifest independently.

A source/version-bound snapshot is retained as project event `7478141a-8188-4b60-b7b1-d6627f9a9ea4` (SHA-256 `58f8bc43d2e059e7abb17615136af4f39b2d34a3d01c1dea439f8c396325ae66`). It binds the project revision, jurisdiction/rule hash, documents, fact/validation identities and conservative assessment. The compact metrics are in [CASCADE_RUN_RESULTS.json](CASCADE_RUN_RESULTS.json); its cost `calls` fields count request records. All current records are completed; one recovered extraction retains an unreconciled original timeout reservation. The earlier $25-stop snapshot remains retained as event `99794bc2-1c42-421a-9f8b-3686776b5fb3`.

Implementation/limits: [CASCADE_RELEASE.md](CASCADE_RELEASE.md). Broader roadmap: [AUTOMATED_PRECHECK_PIPELINE.md](AUTOMATED_PRECHECK_PIPELINE.md). Cross-sheet registration, independent geometric validation and executable code-rule activation remain unfinished parts of that roadmap.
