# MVP implementation status

November 8 implementation: [Jev/Sol cascade release](CASCADE_RELEASE.md) records the operational processing pipeline, validation, benchmark and deployment limits. The broader architecture below remains the roadmap where the release explicitly lists remaining work.

November 7, 2026. This is an operational prototype for early feedback, not a fully validated permit precheck product. The [requirements](MVP_REQUIREMENTS.md) remain the acceptance target; this page distinguishes delivered behavior from remaining work.

## Working

- Hosted responsive frontend with explicit synthetic sample, live authenticated API integration, parcel confirmation, selected imports, private PDFs, evidence review/correction, revisions, comments, map and workflow view.
- Real county and Poulsbo parcel lookup and jurisdiction routing, PREP/zoning screening, KPHD metadata discovery and selected PDF export. Live records from each jurisdiction were tested; sources are listed in the [access matrix](research/source-access-matrix.md).
- Supabase project with private storage, membership-based RLS, validated write RPCs, atomic revision conflicts, durable jobs, and worker-only extraction writes.
- Isolated PDF extraction/OCR, exact page excerpts, optional budget-reserved AI adapter, canonical file paths, idempotent jobs and cancellation/retry behavior.
- County/Poulsbo coordination packs, ordered next actions, revision impact and partial geometry subtraction from reviewer-supplied constraints. These are workflow models, not active numerical code compliance rules.
- Dedicated Hetzner host, Cloudflare static frontend, temporary API HTTPS tunnel, container resource limits and a CI check workflow.

## Boundaries that remain visible

| Area | Current boundary |
| --- | --- |
| Legal/numerical rules | No county/city numeric zoning or buffer rules are activated. Cite and validate the small rule set against adopted text and actual permit cases before enabling it. All legal approval states remain unknown unless separately evidenced. |
| Automated documents | KPHD selected PDFs are automated. Auditor, SmartGov permit attachments and utility letters use assisted links/uploads. A search is not exhaustive title or permit research. |
| Geometry | GeoJSON input with a source reference; no CAD import, automated survey georeferencing or drawing interface. Computed areas remain partial and code-unchecked. |
| AI | Platform OpenAI processing is deployed with server-only authentication, page/chunk coverage and a $5/month allowance. Text quotations are checked; visual observations remain explicitly unverified proposals. See processing implementation notes below. |
| Auth/onboarding | Email/password sign-in, registration, recovery and account password UI implemented. Cloudflare email hook configured and public signup/recovery enabled; an authorized recovery email was accepted by Cloudflare, with inbox receipt and the full confirmation/recovery round trip still unverified. Existing accounts and memberships preserved. A project invitation UI remains. See [email operations](../auth-email/README.md). |
| Uploads | Current Free Supabase limit is 50 MiB. The planned 100 MB interrupted-upload test and 250 MB ceiling need a paid tier and verification. |
| Operations | API tunnel URL can change on restart. Independent backups, restore/rollback drills and stable API domain remain before dependable client use. |
| Product validation | Sponsor-reviewed six-parcel acceptance cohort and measured research-time savings remain. Live technical samples do not replace professional review. |

## Implementation choices versus the design

The prototype stores typed JSON entities behind relational project boundaries, uses Python Shapely/PROJ for geometry, and uses a server-only Supabase service-role worker. The architecture proposed more normalized entities, PostGIS operations and a narrower worker role. These substitutions reduce initial implementation size but should be revisited before expansion; the frontend and evidence interfaces allow that change.

Source-derived parcel geometry is revalidated by the worker before it is trusted; browser-provided jurisdiction is never enough. Evidence transcription acceptance does not approve a permit. Changing the proposal flags dependent work for review without revoking past agency decisions.

## Next approved direction

See [document processing v2](DOCUMENT_PROCESSING_V2.md): full-document chunk coverage, OpenAI text/vision processing, verified drawing geometry, three-project trial accounting and a future user-model boundary. OpenAI page/chunk processing is now implemented; the live backend does not yet enforce the new trial policy.


## OpenAI processing implementation

The new adapter inventories all pages, splits text into bounded overlapping chunks, reviews each page image, validates text quotes and visual source regions, and saves resumable project-scoped checkpoints. It uses a pinned GPT-4.1 mini baseline via Responses with the existing $5 allowance. Versioned proposals preserve prior facts. The UI displays coverage and a resume action. Exact geometric calibration, drawing crops, cross-sheet conflict synthesis, and the three-project entitlement rollout remain separate work; this change is not a completed CAD interpretation system.

Verified on the hosted worker: the existing two-page PDF completed four text/vision chunks and produced 18 proposed facts; unsupported citations were discarded. The 46-page PDF was queued for 92 chunks, with coverage visible during processing. This checkpoint is not a claim that all 46 pages have completed. Local validation: 59 backend tests, 12 UI tests, research consistency checks and PostgreSQL RLS checks pass.
