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
