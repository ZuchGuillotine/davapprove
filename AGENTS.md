# Davapprove

This repository belongs to the Davapprove property-development feasibility and permitting project.

Start with `docs/PROJECT_CONTEXT.md` and the research index in `README.md` before changing the approval model. These checked-in files are the durable handoff between web research and local Codex work.

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
- Do not request or display parcel owner or permit applicant names.
