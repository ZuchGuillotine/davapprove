# Davapprove web workspace

The React app and beta screening API deploy together as Cloudflare Worker `davapprove-preview`. Signed-out users see account access. Invited testers can open the address-first estimate, homeowner page, and full cited reports. The Worker holds the rule engine and reference packs. Hosted requests use the Worker's same-origin routes.

For a local integrated build, run `npm ci` and `npm run build`, then `npx wrangler dev` with the desired Supabase publishable key and test metrics secret in the ignored `web/.dev.vars`. Use a test project and apply the beta migration there. The Vite dev server remains available for isolated project UI development with the Python API at `127.0.0.1:8000`. Run the standalone bid tool with `node bid-assistant/server.js` from the repo root.

Real mode supports API project lookup, candidate discovery, selected imports, job polling, evidence review, versioned bedroom changes, comments, maps/workflow and reviewed GeoJSON constraints. Upload size validation and labels use `/api/v1/config.max_pdf_bytes` (currently 50 MiB on the deployed free project; local fallback 250 MiB). Production PDF uploads use TUS direct to private Supabase Storage in 6 MB chunks. Files open through an authorized signed URL (or demo API blob); rendering uses the browser's sandboxed PDF viewer. MapLibre loads lazily; if WebGL or basemap loading fails, parcel geometry renders as an SVG schematic without a basemap. The map makes no claim to survey accuracy.

Use `npm run deploy:dry-run` to check the Workers package. The Worker serves both `davapprove.com` and the existing preview hostname. See [private beta operations](../docs/operations.md#private-beta) for deployment inputs.

Known pilot limits: reviewer geometry entry currently uses GeoJSON, not drawing/CAD tools. Invite administration and account provisioning are operator tasks. PDF evidence review supports accepting, rejecting and correcting extracted values. Full code rules must remain inactive until independently validated. Hosting/source connectivity and restore checks are tracked in the repository implementation handoff.
