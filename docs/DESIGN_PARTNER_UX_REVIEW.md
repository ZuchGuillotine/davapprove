# Design-partner UX revision

Reviewed November 16, 2026. Implementation branch: `codex/design-partner-ux`, based on `codex/bid-assessment-workspace`. This change is source-ready; it does not record a production deployment.

## Feedback and resulting behavior

| Area | Finding | Change |
| --- | --- | --- |
| Account access | Basic signup, sign-in and recovery existed, but confirmation resend and useful missing-email guidance were absent. An expired recovery callback could fall through to an existing session. | Confirmation resend, repeat-request timing, explicit delivery errors, expired-link handling and optional business-name signup metadata. |
| Full assessment navigation | The standalone page had no dashboard return. Mobile hid the sidebar, and tablet hid the project list. | Explicit standalone return, actionable Projects breadcrumb, responsive workspace navigation and project switcher. Browser Back/Forward retains the selected project tab and mounted assessment. |
| Property discovery | Projects accepted only an ID; bid searches depended on exact address formatting and slow retry behavior. | Address or parcel input, normalized candidate ranking, bounded searches, explicit address-candidate selection and stale-response protection. Projects remain Kitsap-only; bids retain their regional packs. |
| Assumptions | Specialist terms and planning defaults were difficult to interpret. | Expandable explanations beside controls and sourced threshold notices that distinguish stormwater planning, SDAP and engineered grading. City/Tribal/federal and unresolved jurisdiction are kept distinct. |
| Client deliverables | Davapprove was the primary brand; export framing depended on the interactive map. | Editable business/agency per bid, persisted with the draft; account business metadata supplies new-bid defaults. Agency leads print and memo, Davapprove is secondary. Print and downloadable SVG use a fixed parcel-fit vector map. |

## Email finding and remaining verification

The reported recipient has a confirmed account, no recorded successful recovery send, and no active provider suppression. Available observations do not establish the original missing-email cause or prove current inbox delivery. No email was sent and no account, password or provider setting was changed during this review. See the detailed investigation and safe verification procedure in [auth-email/README.md](../auth-email/README.md#design-partner-recovery-investigation--november-16-2026).

Automated tests exercise account requests and callback behavior with simulated auth responses. They do not replace recipient verification of signup confirmation, recovery delivery, setting a new password and signing in with it.

## Source and export limits

Thresholds are sourced in `bid-assistant/data/citations.json`; explanations are screening guidance, not construction permission. In particular, stormwater Minimum Requirements 1–5 are not interchangeable with a separate SDAP. Proposed future manual updates are not treated as adopted requirements. Source details and jurisdiction limitations are in [Bid Assistant](BID_ASSISTANT.md).

The export uses public parcel geometry, available mapped features and screening cells, with an approximate scale and snapshot date. It has no aerial basemap. Missing coverage remains unresolved. A synthetic SVG was rendered and visually inspected; browser PDF pagination and actual printer output remain unverified because local Chromium could not start in this execution environment.

## Release considerations

Deploy the backend search/lookup changes and frontend together: the new project search uses `/api/v1/parcels/search`. No database migration or email-worker change is required. Existing browser-local bids remain compatible. Changing an account default does not silently reattribute an existing saved bid.

The GitHub branch/PR is the synchronization point for the desktop checkout. Fetch and inspect its working tree before integrating; do not overwrite uncommitted desktop work. Chat histories and desktop project registration are not synchronized by Git.

## Validation

Executed successfully: 127 backend tests; 58 frontend tests; 30 signed-email-hook tests and its TypeScript check; generated-reference checks; bid engine/geometry/regions/drafts/UI tests; new search, guidance, export and navigation suites; original report checks; production TypeScript/Vite build; Wrangler deployment dry-run; and Git whitespace checks. CI now includes the new suites. The production build retains a large-chunk advisory; it is not a build failure.

Public GIS verification is separate from deterministic tests and does not guarantee county service uptime or complete address coverage. Live JavaScript adapter checks confirmed expanded-address, typo and tax-ID results. Python live connector verification was blocked by this environment's DNS validation; the backend identity/geometry contract was tested with synthetic service responses. No production deployment or end-to-end recipient email test occurred.
