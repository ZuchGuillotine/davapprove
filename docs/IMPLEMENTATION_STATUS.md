# MVP implementation status

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
| AI | Cloudflare Workers AI proxy is deployed with server-only authentication, verified token rates and a $5/month application allowance. Live inference is verified; output remains proposed evidence with exact quotation checks. Free quota is shared account-wide and exhaustion falls back to manual review. |
| Auth/onboarding | Manual one-time beta links work without email delivery. Custom SMTP and a project invitation UI remain. Do not promise automated email signup yet. |
| Uploads | Current Free Supabase limit is 50 MiB. The planned 100 MB interrupted-upload test and 250 MB ceiling need a paid tier and verification. |
| Operations | API tunnel URL can change on restart. Independent backups, restore/rollback drills and stable API domain remain before dependable client use. |
| Product validation | Sponsor-reviewed six-parcel acceptance cohort and measured research-time savings remain. Live technical samples do not replace professional review. |

## Implementation choices versus the design

The prototype stores typed JSON entities behind relational project boundaries, uses Python Shapely/PROJ for geometry, and uses a server-only Supabase service-role worker. The architecture proposed more normalized entities, PostGIS operations and a narrower worker role. These substitutions reduce initial implementation size but should be revisited before expansion; the frontend and evidence interfaces allow that change.

Source-derived parcel geometry is revalidated by the worker before it is trusted; browser-provided jurisdiction is never enough. Evidence transcription acceptance does not approve a permit. Changing the proposal flags dependent work for review without revoking past agency decisions.
