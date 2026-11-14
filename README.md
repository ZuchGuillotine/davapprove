# davapprove

Property-development feasibility and approval coordination, starting with Kitsap County, Washington.

## Hosted MVP

Open [Davapprove beta](https://davapprove-preview.delicacybydesign.workers.dev) to explore the labeled sample, create an account, or sign in with email and password. Real projects use private authenticated workspaces. Confirmation and password-reset emails are configured through Cloudflare as **Davapprove <davapprove@haidaa.com>**; an authorized inbox delivery test is still pending. Existing users can set a password in **Account & password**. See [authentication operations](docs/operations.md#preview-hostname-and-sign-in).

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for delivered features and limits, and [operations](docs/operations.md) for deployment, access and local development. The API currently uses a temporary preview hostname.

## Bid-first workflow

Use **Bids & assessments** in the application sidebar, or run the standalone tool below. It screens public parcel maps and permit summaries, keeps agency requirements tied to code, builds editable cost allowances, saves browser-local drafts and exports a client memo. The map is explicitly an **early bid** screen with unconfirmed buffers/layout. Records, Site envelope, Workflow and Activity remain the separate project workflow.

Run the integrated application with `cd web && npm run dev` (install its dependencies first if needed). Read the current coverage and verification limits in [Bid Assistant](docs/BID_ASSISTANT.md).

## Start here

- **[Bid Assistant](docs/BID_ASSISTANT.md)**: put in a Kitsap parcel and a project type, get the agencies involved, a sourced permitting cost range and a constraint map. Run `node bid-assistant/server.js` and open http://localhost:8080.

- [Automation-first permitting pre-check direction](docs/AUTOMATED_PRECHECK_PIPELINE.md)
- [Test-parcel pipeline results and AI costs](docs/CASCADE_RUN_RESULTS.md)

- [MVP product requirements](docs/MVP_REQUIREMENTS.md)
- [Feature 1 sprint plan and source coverage](docs/FEATURE_1_SPRINT_PLAN.md)
- [Application architecture and hosting budget](docs/APP_ARCHITECTURE.md)
- [Development agent prompts](docs/DEVELOPMENT_PROMPTS.md)
- [Project context and desktop handoff](docs/PROJECT_CONTEXT.md)
- [Interactive Kitsap approval dependency report](docs/research/Davapprove_Kitsap_Approval_Dependency_Graph.html)
- [Node register and sources (JSON)](docs/research/kitsap-node-register.json)
- [Agent project guidance](AGENTS.md)

The report includes 43 node templates, four graph views, three synthetic blocker demonstrations, professional-versus-owner requirements and 60 linked primary references. Research date: November 5, 2026. It distinguishes documented requirements, proposed workflow rules and items needing agency confirmation.

Download or open the HTML locally in a browser to use the diagrams and interactive demonstrations; GitHub's file view displays source. The report is self-contained and makes no runtime network requests. It is a research reference, not parcel-specific approval software.

## Rebuild and check the research report

Requires Python 3, Graphviz (`dot` on PATH), and a modern Node.js version (18 or newer). The research generator needs no Python or npm packages; the application has separate dependencies described in the operations guide.

```sh
python3 scripts/build_kitsap_report.py
node tests/report_logic.test.cjs
```

The generator writes the HTML and JSON under `docs/research/`. The checks verify synthetic blocker behavior, IDs, source references, internal links and consistency between embedded and exported data. They do not validate law or browser layout.

Bid assistant checks (no dependencies; the last one needs network):

```sh
node tests/bid_assistant_geo.test.cjs
node tests/bid_assistant_engine.test.cjs
node tests/bid_assistant_drafts.test.cjs
node tests/bid_assistant_ui.test.cjs # requires web dependencies
node tests/bid_assistant_live.cjs
```

## Sync the existing desktop checkout

Use the existing local Davapprove folder. First inspect:

```sh
git remote -v
git status --short --branch
git fetch origin
```

The intended remote is `https://github.com/ZuchGuillotine/davapprove.git`.
If the checkout is on `main`, has no conflicting local work, and can fast-forward:

```sh
git pull --ff-only origin main
```

If local commits or changes exist, reconcile them before integrating. Do not reset or overwrite the desktop work. Have desktop Codex read `AGENTS.md` and `docs/PROJECT_CONTEXT.md` after syncing.

Repository files and durable guidance are shared through Git. This does not merge separate app projects or chat histories. See [OpenAI's project documentation](https://learn.chatgpt.com/docs/projects) for the distinction between conversation sync and local folder access.
