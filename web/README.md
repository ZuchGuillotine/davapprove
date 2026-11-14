# Davapprove web workspace

React/TypeScript SPA. Run `npm ci`, then `npm run dev`. The Vite development server proxies `/api` to the Python API at `127.0.0.1:8000`. Run `npm test` and `npm run build` before deployment.

Set `VITE_API_URL` to the deployed API origin for a hosted build. Public Supabase URL/key can come from `/api/v1/config` or the public variables in `.env.example`. Never set a service-role key in Vite variables. Supabase magic-link sign-in uses `shouldCreateUser: false`; provision invited users and allowed redirect URLs for operator-supplied one-time beta links. The email-request button stays disabled until `/api/v1/config.email_delivery_enabled` is true; `VITE_EMAIL_DELIVERY_ENABLED=true` is only a fallback when the server omits that flag. Enable delivery only after SMTP verification.

`Explore the sample project` is explicit browser-only synthetic mode. It persists only sample records in localStorage and never uploads files or claims to look up a real parcel. A connected demo API is separately labeled local development. Network failures do not silently fall back to synthetic results.

Real mode supports API project lookup, candidate discovery, selected imports, job polling, evidence review, versioned bedroom changes, comments, maps/workflow and reviewed GeoJSON constraints. Upload size validation and labels use `/api/v1/config.max_pdf_bytes` (currently 50 MiB on the deployed free project; local fallback 250 MiB). Production PDF uploads use TUS direct to private Supabase Storage in 6 MB chunks. Files open through an authorized signed URL (or demo API blob); rendering uses the browser's sandboxed PDF viewer. MapLibre loads lazily; if WebGL or basemap loading fails, parcel geometry renders as an SVG schematic without a basemap. The map makes no claim to survey accuracy.

Use `npm run deploy:dry-run` to check the static Workers package. Wrangler targets the separate `davapprove-preview` Worker, with no custom domain routes. `npm run deploy` is for an explicitly authorized release. Free static hosting is not a substitute for the API/worker server.

Known pilot limits: reviewer geometry entry currently uses GeoJSON, not drawing/CAD tools. Invite administration and account provisioning are operator tasks. PDF evidence review supports accepting, rejecting and correcting extracted values. Full code rules must remain inactive until independently validated. Hosting/source connectivity and restore checks are tracked in the repository implementation handoff.
