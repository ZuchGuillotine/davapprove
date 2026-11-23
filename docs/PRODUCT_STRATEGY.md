# Product strategy and beta plan

Decided: November 23, 2026. Audience: founders, the architect design partner, and agents working in this repository.

This document records the product direction for the first beta. It supersedes earlier product-priority notes where they conflict, and it changes no runtime behavior on its own. Each item below is marked as a **decision** (agreed), a **hypothesis** (to be tested in beta) or an **open question**.

## Summary

Davapprove makes permitting and approval requirements easier for builders to understand. The early product was too broad: one app tried to serve the project-management workflow, professional bidding, builder websites and homeowners at once, which produced a confusing UX and would make beta feedback hard to read.

The direction is **one buyer, several surfaces**. The paying customer is the residential building professional. The homeowner view, the website lead link and the MCP server are ways to reach or serve that professional, not separate businesses.

## Implementation status — November 23, 2026

- **Done (decision 2):** project management is behind a feature flag, off by default. Turn it on per build with `VITE_FEATURE_PROJECTS=true`, or per browser with `/?features=projects` (`/?features=none` turns it off). The signed-out home page is the professional estimate landing; the signed-in workspace shows **New estimate**, **Saved reports** and **Pricing**.
- **Done (decision 1):** address-first estimate with a button-driven project description and a basic range; full report behind email capture (one-time sign-in link); pricing prompt from the second report with "Continue free (beta)" and pricing feedback. See [UX design brief](UX_DESIGN_BRIEF.md).
- **Done (decision 4, unlisted):** homeowner page at `/homeowner`, `noindex`, with a directory teaser.
- **Built (decision 3), not deployed:** the engine service and MCP server in `engine/` (see [engine/README.md](../engine/README.md)). Basic estimates only, with caveats as data and a `report_url` back into the website's email gate. The same service serves server-side estimates and an authenticated full-report endpoint with beta entitlement, and writes privacy-safe events to stdout until the events table is connected.
- **Known limit:** the report gate is still a product gate, not a security boundary. The screening engine and source library ship to the browser. `POST /api/v1/reports` now serves the full report from the server; once the report workspace renders from it and the source library is no longer published as static files, the gate becomes real.

## Decisions

### 1. The bid assessment tool is the beta beachhead

- **Segment:** small-to-mid residential builders and architects doing custom homes and ADUs, starting in Kitsap, King and Skagit counties, where the beta colleagues work. Critical areas, shoreline and steep slopes make early budgets unreliable there, which is the pain the tool addresses.
- **Product:** address in, bid-ready screen out: who is involved, what to add to the bid, and what could blow up the job, with a cited PDF report.
- **Why this first:** it is already built; the design partner is in the segment; professionals value the tool's explicit uncertainty (quote needed, unknown, confirm with the agency) instead of being put off by it; and "screening, not a determination" is an accuracy standard this audience accepts.
- **The beta question:** which is more valuable to professionals: fast bid help used internally, or reports they send to prospective clients? The answer decides whether the business leans toward an internal tool or a white-label client deliverable.

### 2. Project management is hidden behind a feature flag

The project workspace, document ingestion, evidence review, site-envelope coordination and dependency graph stay in the codebase but are removed from beta navigation. The beta landing page becomes an address search. Work resumes only if professional testers show real demand.

Context: the web app currently opens on **Projects**, with **Bids** second (`web/src/App.tsx`). A first-time tester therefore meets the deferred product before the beachhead.

### 3. Ship an MCP server

Wrap the existing deterministic bid engine (`bid-assistant/`) as an MCP server so AI agents can call it. Purpose: distribution and demand signal, not primary revenue.

- **Low marginal cost:** the engine makes GIS queries and evaluates rules; it makes no LLM calls. The calling agent pays for its own inference.
- **Demand signal:** log every call, including out-of-coverage calls with their location. That log is the input to the county expansion order (see [National expansion](#national-expansion)).
- **Evidence of the gap:** a consumer real-estate portal's AI assistant, asked in November 2026 for permitting costs on a lot, declined and referred the user to the local building department. Agents are asked this question and lack a reliable, cited source. (The refusal may also reflect deliberate scope limits for liability, so data alone does not solve the partner's problem.)

Schema principles (decisions):

- Caveats travel as data, not as disclaimer text an agent can drop. Every finding carries its level (required / likely / possible / unknown), basis (documented / workflow / confirm), citation and as-of date.
- Cost answers return `{low, high, excludes: [...]}`. Quote-needed lines are part of the answer.
- Parcels outside coverage return an explicit `unsupported` response, never a guess or an empty result. A failed map request is never reported as clean.
- Each response includes the coverage tier and a link to the full cited report.
- Cache results and rate-limit the free tier so heavy agent traffic does not land on county GIS services on behalf of third parties.

Monetization (hypothesis): free or low-cost with attribution required, plus paid API keys for volume.

### 4. Public homeowner view: built separately, launched later

The homeowner-facing view is a **separate UI at its own public URL**, not a toggle inside the professional app. It launches after the professional listing side exists, so a homeowner search does not return an empty directory.

- **Output:** what is involved, plain-language flags, a wide range, what could not be confirmed, then matched local professionals who can firm it up. The uncertainty becomes the reason to contact a professional instead of a weakness.
- **Monetization (hypothesis):** professionals pay for directory placement. The homeowner is the user; the professional is the buyer. Prefer a flat listing fee bundled with the professional subscription over pay-per-lead, which professionals widely distrust because of lead quality.
- **Matching advantage:** match on the lot's constraints, project type and jurisdiction (for example, builders with critical-area experience in Kitsap), which general home-service directories cannot do.
- **Trust guardrails:** label sponsored placement; publish ranking criteria; verify Washington L&I contractor registration (and equivalents in other states).
- **Directory listings are opt-in.** Professionals claim their own service areas and specialties. Licensed contractor business names may come from official registries; owner and individual applicant names are never shown (see `AGENTS.md`).
- **Seeding:** offer beta testers founding-professional listings during the beta.
- **Traffic:** expect search-driven address pages (programmatic SEO) to be the main source, which takes months to build up.

## Beta measurement

Instrument these events before testers start, and track per tester:

| Signal | What it indicates |
| --- | --- |
| Parcels screened per month | Usage volume and per-report vs subscription fit |
| Report export or send-to-client rate | Whether the client deliverable is the product |
| Cost allowance edits | Use on real bids, not demos |
| Screen run before vs after a site visit | Lead qualification value |
| Response to a price (discounted or hypothetical) | Willingness to pay |
| Interest in a founding-professional listing | Directory supply |
| Requests for project-management features | Whether to resume deferred work |

## Pricing hypotheses

- Professionals bid perhaps 5–15 jobs a year, but they screen many more parcels than they bid. Price on **parcels screened**, not bids won.
- Test per-report credits alongside a modest subscription for heavier users. Segments likely to screen in volume: ADU builders, small developers doing land acquisition, architects doing feasibility, land-focused agents.
- Reference point: a national zoning data vendor sells consumer zoning reports from about $80 to about $990 (2022 pricing).

## National expansion

Three counties is the starting point because that is where the beta colleagues are. The goal is every US county.

- **Coverage tiers (decision):** *Baseline* everywhere: federal and state layers, jurisdiction identification, and a link to the permitting office. *Deep* where a jurisdiction pack exists: local fees, code, buffers and agency routing. Every result shows which tier produced it.
- **Expansion order (decision):** demand-driven, from MCP out-of-coverage logs, public-page searches and tester requests.
- **The real scaling cost is research upkeep, not engineering.** There are roughly 3,000 counties and thousands of permitting municipalities, and fee schedules and codes change (for example, Kitsap's 2025 critical-areas update and King's February 2026 critical-area rules). Plan a repeatable research pipeline early, even a semi-manual one.

## Market context (checked November 23, 2026)

- **Kolmo** (renovation contractor, Seattle area) publishes free, ungated address-level permit pages across 17 cities, including King County, with zoning, setbacks, overlays, permit lists, ADU rules and inline citations, ending in a phone call to action. It validates address-level permit content as lead generation, shows that a builder's alternative to buying is building it in-house, and shows that search value comes from indexable pages on the builder's own domain, not an embedded widget. It labels unincorporated county coverage "baseline-only." It could become a competitor if it productizes.
- **Redfin and Zoneomics:** zoning and land-use data on about 70 million listings since December 2022. National portals buy breadth, so a three-county product will not win a national portal deal. Regional partners (Northwest MLS member brokerages, local brokerage assistants) fit current coverage better.
- **PermitFlow** raised a $54M Series B in December 2025 at about a $500M valuation. **Pulley** raised $64M and is expanding into site selection and feasibility. The permit project-management lane is well funded, which supports deferring it, and Pulley's move toward feasibility means Davapprove's edge must be local depth and trustworthy citations, not breadth.

Sources: [Kolmo example page](https://www.kolmo.io/permits/shoreline/16233-14th-ave-ne), [Kolmo permits index](https://www.kolmo.io/permits), [Redfin zoning data](https://www.redfin.com/news/redfin-adds-zoning-data-to-home-description-pages/), [Zoneomics partnership coverage](https://www.onlinemarketplaces.com/articles/redfin-becomes-first-real-estate-site-to-add-zoning-and-land-use-information-to-its-70-million-home-descriptions/), [PermitFlow Series B](https://www.businesswire.com/news/home/20251202551013/en), [Pulley funding](https://www.citybiz.co/?p=936101).

## Deferred

- The project-management and permit-workflow product (former option 1), unless testers show demand.
- National portal partnerships, until baseline coverage exists nationally.
- Platform-specific website integrations. A builder's public lead link starts as a hosted page on the builder's subdomain, set up by hand for two or three beta builders.

## Open questions

- Internal bid tool or client-facing report: which do testers actually use? (The core beta question.)
- Per-report or subscription pricing, and at what price?
- Directory pricing: flat listing, tiered placement or per-lead?
- How many listed professionals per county before the public view launches?
- Does the MCP attract agent builders outside the three counties enough to justify baseline national coverage early?
- What research-pipeline design keeps deep packs current at national scale?
