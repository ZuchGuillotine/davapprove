# Engine service

Node service that runs the bid assistant's screening engine on the server and hosts the MCP server. Added November 23, 2026. It loads `../bid-assistant` unchanged (the same modules the web workspace and CLI use), so every figure still traces to `data/fees.json` and `citations.json`. The Python API is unchanged; Caddy routes the paths below here and everything else to the API.

## Endpoints

| Route | Access | Returns |
|---|---|---|
| `GET /health` | open | `{ok, counties}` |
| `GET /api/v1/engine/coverage` | open | supported counties, project types (with defaults), scope items |
| `GET /api/v1/engine/search?q=` | open, rate-limited | parcel suggestions across counties; `failed_counties` lists counties that could not be searched |
| `POST /api/v1/estimate` | open, rate-limited | the basic summary (`BidQuick.summarize`): ranges, counts, coverage, unpriced scope. No line items, excerpts or citations |
| `POST /api/v1/reports` | Supabase sign-in | the full report as data: findings, agencies, sourced costs, the citations used, map layer status, plus `entitlement` |
| `POST /mcp` | open, rate-limited | MCP Streamable HTTP, stateless, JSON responses |

Request body for estimate and reports: `{county, parcel, project, audience?}`, where `parcel` is a `parcel_key` from search and `project` is the engine's project input (`type` plus optional fields; unknown fields are ignored, `scope_items` are filtered to the catalog). Errors are `{detail, code}` with specific codes (`unsupported_county`, `invalid_parcel`, `parcel_not_found`, `county_unavailable`, `rate_limited`, `sign_in_required`, `payment_required`, …).

**Entitlement.** The first report is free (`FREE_REPORTS`). During the beta (`REPORTS_REQUIRE_PAYMENT=false`) every report is served and `entitlement.would_require_payment` says whether it would have been paid. With `REPORTS_REQUIRE_PAYMENT=true`, later reports return 402. Reports used are counted as bids the account owns, read with the user's own token under row-level security; replace `ownedReports` in `src/support.js` when the entitlement table lands. The service holds no service-role key.

**Screening cache.** Map screening depends only on the parcel, so it is cached for an hour (`SCREEN_CACHE_TTL_MS`); project-specific steps always rerun. A screen with an unread layer is never reused, so a retry can read it. At most `MAX_CONCURRENT_SCREENS` (4) screens run at once.

## MCP server

Tools (all read-only):

- `get_coverage`: counties, project type ids and scope item ids.
- `search_parcels`: address or parcel number → parcel keys. Never returns owner names.
- `estimate_permit_costs`: county + parcel_key (or an address) + project → the same basic summary as the website, as structured data and text. Caveats are fields, not just prose: `quotes_needed`, `coverage.complete` / `unread_layers`, `unassessed_scope`. Several address matches return `status: "ambiguous"` with candidates instead of a guess.

The MCP server never returns the full report. Each estimate carries `report_url`, a website link (`/?estimate=…`) that opens the estimate pre-filled; the full report is then behind the same email capture as any visitor. See [Product strategy](../docs/PRODUCT_STRATEGY.md), decision 3.

Connect a client to `https://mcp.davapprove.com/mcp` (Streamable HTTP). For example, in Claude Code:

```bash
claude mcp add --transport http davapprove https://mcp.davapprove.com/mcp
```

## Events

One JSON line per event on stdout (`docker compose logs engine`), alongside request lines. Events: `search_run`, `estimate_run`, `estimate_failed`, `report_served`, `paywall_blocked`, `mcp_tool_call`. Fields: `event, source (web|mcp), audience, user_id (reports only), state, county, jurisdiction (city name, unincorporated or unconfirmed), project_type, scope_items, coverage_complete, quotes_needed, status`. Never logged: addresses, parcel keys, search text, emails, owner names or IP addresses. To write to the events table instead, replace the `sink` in `createEvents` (`src/support.js`); call sites do not change.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | 8080 | |
| `CORS_ORIGINS` | localhost dev origins | comma-separated website origins (MCP allows any origin) |
| `TRUST_PROXY` | false | `true` behind Caddy, to rate-limit by the forwarded client address |
| `PUBLIC_APP_URL` | `https://davapprove.com` | base of MCP `report_url` links |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | | for report sign-in checks |
| `FREE_REPORTS`, `REPORTS_REQUIRE_PAYMENT` | 1, false | entitlement policy |
| `ESTIMATES_PER_HOUR`, `REPORTS_PER_HOUR`, `SEARCHES_PER_MINUTE`, `MCP_REQUESTS_PER_MINUTE` | 30, 30, 60, 60 | per client address |
| `SCREEN_CACHE_TTL_MS`, `MAX_CONCURRENT_SCREENS` | 3600000, 4 | |

Rate limits and the cache are in memory: correct for one container. Use a shared store before running several.

## Run and test

```bash
cd engine && npm ci && npm test
```

```bash
cd engine && PORT=8080 npm start
```

Tests use synthetic county responses (no network) with the real rules and fees. The website uses this service for estimates when built with `VITE_ENGINE_API=true` (see `web/src/bidEngine.ts`); otherwise it keeps running the engine in the browser.

## Verified November 23, 2026

- 13 offline tests: same numbers as the shared summary, error codes, cache behavior, sign-in and entitlement, rate limits, CORS, privacy of events, MCP tools through the SDK client.
- Live: the Kitsap example parcel (ADU, new septic) returned $35,264–$55,127, the same as the in-browser estimate. Server-side, all map layers were read; the same run in a browser had two unread layers, most likely refused cross-origin requests. Same-parcel reruns returned in under 0.1 s from the cache.
- The image built and ran read-only as a non-root user with all capabilities dropped; the health check passed; Caddy routed engine paths to the engine and everything else to the API in a local network test. The build was verified in this sandbox with its proxy certificate added; the committed Dockerfile has no such step.
- Not verified: deployment on the Hetzner host, real Supabase tokens, DNS and TLS for `api.` and `mcp.davapprove.com`. King County's map service failed or timed out during these checks; it is reported in `failed_counties`, never as no match.
