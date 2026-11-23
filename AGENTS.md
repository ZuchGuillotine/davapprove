# Davapprove

This repository belongs to the Davapprove property-development feasibility and permitting project.

Start with `docs/PROJECT_CONTEXT.md` and the research index in `README.md` before changing the approval model. These checked-in files are the durable handoff between web research and local Codex work.

## Product direction

Read `docs/PRODUCT_STRATEGY.md` before product, UX or scope work. In short: the bid assessment tool is the beta beachhead; project-management features stay in the code but hidden behind a feature flag; an MCP server wraps the bid engine for distribution; a separate public homeowner view and professional directory come later. Do not expand deferred features without a recorded decision. Project management is hidden by `projectsEnabled()` in `web/src/features.ts`; keep it working behind the flag. UX direction for the estimate pages is in `docs/UX_DESIGN_BRIEF.md`.

## Research and modeling

- Preserve the distinction between documented requirements, proposed workflow rules, and questions requiring agency confirmation.
- Keep citations, research dates, jurisdiction, approved design revision, and work stage attached to requirements.
- Do not treat unknown applicability as approval, consultant reports as agency decisions, or an approval as permission for every construction activity.
- The report and JSON are research artifacts, not a production permit-authorizing engine.

## Editing and validation

- Edit `scripts/build_kitsap_report.py` to change the report and regenerate both outputs with `python3 scripts/build_kitsap_report.py` (requires Graphviz `dot`).
- Run `node tests/report_logic.test.cjs` after changing the report or demonstration logic.
- Check repository status before edits and preserve work created in other checkouts. Do not infer local desktop state from GitHub alone.

## Bid assistant

- `bid-assistant/` is a separate feature from the approval dependency model: a parcel screening tool for bidding. Read `docs/BID_ASSISTANT.md` first, especially the section on what was and was not verified.
- Every number a user sees must trace to a record in `bid-assistant/data/citations.json` or `fees.json`. Do not put code values, buffer widths or fees directly in rule files.
- Never report a failed map request as a clean result. Keep the required, likely, possible and unknown levels and the documented, workflow and confirm bases distinct.
- Do not work around a site's bot protection to fetch code text. Use another official publication and record the source used.
- After changing data run `node bid-assistant/build.js`; after changing rules or data run `node tests/bid_assistant_engine.test.cjs` and `node tests/bid_assistant_geo.test.cjs`.
- `engine/` runs the same bid-assistant modules on the server and hosts the MCP server (`engine/README.md`). It must never return the full report without sign-in, and its events must never hold addresses, parcel keys, search text, emails or owner names. Run `cd engine && npm test` after changing it or `lib/quick.js`.
- The estimate pages summarize the engine through `bid-assistant/lib/quick.js`. The basic estimate must not show line items, code excerpts or citations; run `node tests/bid_assistant_quick.test.cjs` after changing it, and `cd web && npm test` after changing the estimate pages.
- Do not request, store or display names of parcel owners or individual permit applicants, or other personal details that could identify a private person from parcel or permit records. The tool must not become a doxxing or OSINT aid.
- Licensed contractor and design-firm business names from official public registries (for example, Washington L&I contractor registration) may be shown. Professional directory listings are opt-in: professionals claim their own service areas and specialties.
