# Davapprove pilot operations

Updated November 14, 2026. See [implementation status](IMPLEMENTATION_STATUS.md) for release limits. Secrets are stored in ignored, permission-restricted files and on the dedicated host; never copy them into frontend variables or this document.

## Deployed resources

- Frontend: https://davapprove-preview.delicacybydesign.workers.dev — Cloudflare Worker `davapprove-preview`.
- Supabase: project `znoysvmruyzlfllqblpi`, **Davapprove**, HAIDAA organization, `us-west-1`. Currently Free, not the proposed Pro tier. Migrations have been applied and security/performance advisors returned no notices.
- Hetzner: server `175016728`, **davapprove-beta**, `178.105.77.156`, CX23 in Falkenstein. Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk. Firewall `davapprove-beta` exposes SSH only; API access uses an outbound HTTPS tunnel.
- Server login: `ssh -i ~/.ssh/hetzner root@178.105.77.156`. Application directory `/opt/davapprove`. This is separate from Orbitfleet; do not deploy to `5.78.196.181`.
- API preview: https://exclusive-orbit-fruit-appendix.trycloudflare.com — temporary hostname; see recovery below.

Verified account quote: server $6.49/month + IPv4 $0.60/month = **$7.09/month**, excluding usage outside included allowances. Supabase and static hosting currently use free tiers. Platform OpenAI processing is enabled with a $5/month application allowance. A future $25 Supabase Pro subscription would bring the base to $32.09, leaving room within the $50 budget for bounded AI and backups. No Pro or Workers paid-plan upgrade was activated.

## Runtime and deployment

`deploy/compose.yaml` runs isolated API and worker containers. `--profile preview` also runs a Cloudflare Quick Tunnel; `--profile domain` runs Caddy instead when a controlled hostname is available. Do not activate both profiles accidentally. API has only the publishable key; worker has the service-role key. Both use `DAVAPPROVE_MODE=supabase` in hosted deployment.

Required protected environment in `deploy/.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`. Current `MAX_PDF_BYTES=52428800` matches the Free storage limit. `EMAIL_DELIVERY_ENABLED=true` now uses the configured Cloudflare Auth email hook; see the delivery verification status below. OpenAI configuration is documented below. The legacy proxy remains deployed for rollback but is no longer the default processing provider. Do not set guessed model prices.

On the dedicated host:

```sh
cd /opt/davapprove
docker compose -p davapprove --env-file deploy/.env -f deploy/compose.yaml --profile preview up -d --build api worker
docker compose -p davapprove --env-file deploy/.env -f deploy/compose.yaml ps
docker compose -p davapprove --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 api worker
```

Rebuilding only API/worker preserves the tunnel process. Never run `down -v` during a routine deployment. Before a future release, retain the previous API/worker image IDs and source archive, apply compatible migrations, then rebuild. Rollback retags the retained images and recreates API/worker without rebuilding; it does not roll back database migrations or evidence. A full rollback/restore drill remains a pilot acceptance task.

Frontend: put the current HTTPS API origin in ignored `web/.env.production` as `VITE_API_URL`, then run `npm --prefix web test`, `npm --prefix web run build`, and from `web/`, `npx wrangler deploy`. Public Supabase settings can be obtained from the API; no worker key belongs in `VITE_*` variables.

## Preview hostname and sign-in

Cloudflare Quick Tunnels are temporary development endpoints with no uptime guarantee. On a tunnel restart, inspect `docker compose ... logs tunnel` for the new `trycloudflare.com` URL, update `web/.env.production`, and redeploy the frontend. The app URL remains stable, but live API access is interrupted until this update. Replace this with a controlled hostname before a dependable external beta.

The frontend supports Supabase email/password sign-in, email/password registration, recovery links, and an **Account & password** panel for existing users, including users who originally signed in with an operator link. Password sign-in works independently of email delivery. Sessions restore on reload; sign-out clears private workspace state and discards outstanding project requests. New accounts receive no existing project membership automatically.

**Current email configuration:** the Supabase Send Email hook sends through Cloudflare as **Davapprove <davapprove@haidaa.com>**, using the already verified domain. The hook and `EMAIL_DELIVERY_ENABLED=true` are deployed, with signup and password-reset controls enabled. Email confirmation remains required; new accounts receive no existing project access. No domain purchase, DNS change, Resend account or plan upgrade was needed. An authorized recovery request reached Cloudflare successfully on November 14 at 18:17 UTC. The recipient subsequently confirmed receipt in chat. The full signup/confirmation and password-change round trips remain unverified.

The signed hook is `https://davapprove-auth-email.delicacybydesign.workers.dev/auth/send-email`, with a server-only secret shared between Supabase Auth and Cloudflare. Signup and recovery redirects are explicitly allowed at `/` and `/?auth=recovery`. The hook pins both links to the frontend origin, even for local-development requests. Supabase's beta email limit is 30/hour with the existing 60-second per-recipient resend interval. See [email deployment, testing, limits and rollback](../auth-email/README.md).

Password sign-in works independently of email delivery. If mail delivery fails, turn off the API/frontend delivery flags while diagnosing it. Keep confirmation enabled. Operators can still generate a one-use sign-in link without sending email:

```sh
# Supply server-only credentials through the environment, not command arguments.
python3 scripts/create_beta_link.py person@example.com --output .data/private-beta-access.html
```

The generated HTML contains a login credential. Open or share it privately with the intended recipient; it expires and is single-use. After opening it, use **Account & password** to set a password for subsequent sign-ins. Never commit it or add it to a public site. To invite collaborators to an existing project, an owner uses the membership API with the recipient's Supabase user ID and `editor` or `reviewer`; a friendly invitation-management UI is not yet implemented.

## Health and recovery

- Check `/health`, container status and worker logs. A healthy API is not proof that a public records portal is responding.
- Source failures appear in project coverage and jobs; retry only transient failures. Manual-access sources stay manual until their adapter is verified.
- Originals and project records live in private Supabase storage/database; the VM is replaceable compute. Free Supabase does not provide the planned paid backup retention. Before private client use, configure independent database/object backups and perform a restore drill; no automatic backup or restore claim is made for this preview.
- Keep one worker process. Heavy PDF parsing has a hard subprocess deadline and memory limit; duplicate imports are keyed by project/document hash. Review processing errors rather than increasing limits without checking memory and cost.
- Monitor Free database/storage/egress usage. Uploads above 50 MiB are rejected; upgrade and retest before promising the planned 250 MB/100 MB stress-case support.

## Local checks

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r backend/requirements.lock
PYTHONPATH=backend .venv/bin/pytest backend/tests -q
node tests/report_logic.test.cjs
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

For a local live-source workspace, start API and worker with `DAVAPPROVE_MODE=demo`, the same `DATA_DIR`, and `PYTHONPATH=backend`; use `uvicorn app.main:app` and `python -m app.worker`. Bind to loopback. Demo authentication is not safe for public deployment. `npm --prefix web run dev` proxies the local API; the separate synthetic sample never stores real files.

Database checks use `tests/supabase_bootstrap.sql`, all migrations in filename order, then `tests/rls_assertions.sql` against a disposable empty PostgreSQL database. The bootstrap creates test auth/storage surfaces and must never run on a hosted Supabase project. CI includes these checks.

## OpenAI processing configuration

The platform credential is `OPENAI_API_KEY` in protected `deploy/.env`; it is passed only to the worker container. `AI_PROVIDER=openai` selects the Responses adapter, with `AI_MODEL=gpt-4.1-mini-2025-04-14`, input $0.40/M tokens and output $1.60/M tokens ([official pricing](https://developers.openai.com/api/docs/pricing), verified November 7, 2026). Keep `AI_MONTHLY_USD=5`; the database also enforces this pilot cap. The legacy Cloudflare adapter remains available for rollback; no user-model connection UI is exposed.

OpenAI requests use `store:false`, no external tools and bounded text/image inputs. This setting is not a claim of zero provider retention. Originals remain in private Supabase Storage; rendered images are temporary worker files. Model proposals, source pages and processing checkpoints are project-scoped data.

Resume processing uses `POST /api/v1/projects/{project_id}/documents/{document_id}/process` as an owner/editor. Completed chunks are reused; unresolved possibly-billed requests are not blindly resent. An incomplete run remains visibly partial. Reprocessing adds versioned proposals and preserves prior accepted evidence. Model interpretation alone does not supply calibrated geometry.


## November 7 site-envelope v1 release

Deployed frontend version `fa3e16de-2de5-48cb-be81-fa6eba9dec75` and updated API/worker with drawing calibration and reconciliation. Previous frontend version: `a4c6dc2a-96f0-4981-ac76-ae5a9f3ba622`. Backend rollback source archive and image IDs: `/opt/davapprove-releases/site-viewer-v1-before/`; retained image tags: `davapprove-api:before-site-viewer-v1`, `davapprove-worker:before-site-viewer-v1`. No database migration or infrastructure change. Tunnel preserved.

Verified live frontend asset hashes against the release build, public API health and synthetic calibration inside the deployed worker. Predeployment checks passed: 69 backend tests, 14 frontend tests, build and Wrangler dry-run. Real-document extraction accuracy remains for beta benchmarking. Prompt version: `facts-drawings-2026-11-07-v3`; explicitly reprocess existing documents to generate new proposals. See [viewer behavior and limits](SITE_ENVELOPE_VIEWER.md).

## November 7 workflow evidence release

Deployed frontend version `d1f8f187-0310-4a9d-aa57-ebf5360f78cb` with status highlighting, node evidence inspection and electrical utility coverage. Previous version: `fa3e16de-2de5-48cb-be81-fa6eba9dec75`. Updated API/worker include X0 extraction and the current checked-in-workspace drawing/classification support. Backend rollback source and image IDs: `/opt/davapprove-releases/workflow-evidence-before/`; tags `davapprove-api:before-workflow-evidence` and `davapprove-worker:before-workflow-evidence`. Tunnel preserved; no schema migration or document reprocessing queued. Validated 75 backend tests, 20 frontend tests, production build, research checks, Wrangler dry-run, public API health and deployed utility evaluation smoke check.

## November 7 fact-classification release

Deployed the review classifier API and current frontend build as Cloudflare version `6368a82a-940e-4e34-8062-93f896c7c4d9`. The previous observed frontend version was `fa3e16de-2de5-48cb-be81-fa6eba9dec75`. API rollback source and image ID are in `/opt/davapprove-releases/fact-classification-v1-before/`, with retained image tag `davapprove-api:before-fact-classification-v1`. No database migration; tunnel preserved.

Checks: 75 backend tests, 20 frontend tests, production build and Wrangler dry run passed. Public API health and a classifier smoke test inside the deployed API passed. See [classification behavior and remaining verification UI](FACT_CLASSIFICATION.md).

Retroactive review UI follow-up: frontend version `a3f20190-0c48-496a-b77a-674684621ec0` adds Reclassify existing facts, queue counts and direct/uncertain relevance filters. Previous version `6368a82a-940e-4e34-8062-93f896c7c4d9`. Existing API already classifies historical imports on read; no backend deployment or data migration required. Verified 17 API/classifier tests (including 540 legacy facts), 20 frontend tests, build and dry run.


## November 7 project UX release

Applied hosted `rename_project` migration and deployed editable names and in-place fact review as frontend version `227a5d74-3f68-482b-8631-bed2504e3f7a` (previous `a3f20190-0c48-496a-b77a-674684621ec0`). Updated only API `main.py` and `store.py` after comparing host copies; worker and tunnel preserved. API rollback archive and image ID: `/opt/davapprove-releases/project-ux-before/`; retained tag `davapprove-api:before-project-ux`.

Verified 77 backend tests, 21 frontend tests, build and Wrangler dry run; live API health, rename endpoint and frontend asset hashes. Hosted rename smoke check used a rolled-back transaction and preserved the design revision. Security advisor reports leaked-password protection disabled; Auth configuration was unchanged. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.


Project rename CORS hotfix: the first UX deployment omitted PATCH from allowed CORS methods, causing browsers to report Failed to fetch despite the installed migration. Added PATCH, verified 14 API tests including browser preflight regression, redeployed only API, and verified the hosted OPTIONS request returns 200 with PATCH and the frontend origin allowed. Prior API retained as `davapprove-api:before-rename-cors`; source backup `/opt/davapprove-releases/rename-cors-before/`.

## November 7 county discovery / draft geometry correction

Frontend version `95b1571f-402f-4d20-89a4-76421ff36beb`; API/worker updated with `county_records.py`, the corrected formatted-parcel search and selected county PDF import, draft line/point support and document geometry diagnostics. Backend rollback retained under `/opt/davapprove-releases/discovery-drafts-before/` and image tags `before-discovery-drafts`. 83 backend tests and 21 frontend tests passed, plus build/dry-run. Added 115 unselected county attachment candidates to the test project; no model processing was queued. Original evidence and accepted facts were preserved. Automatic drawing alignment is still limited to supported control fits.

## November 8 shared survey alignment release

Applied hosted `sheet_alignment` migration and deployed frontend version `bbec51ba-37b5-4098-9eab-e6592364f0a2` (previous `95b1571f-402f-4d20-89a4-76421ff36beb`). API now supports deterministic per-sheet registration and authenticated cached page previews. Updated only `main.py`, `evaluation.py`, `alignment.py` and `page_preview.py` on the host after comparing its existing files. Worker and tunnel were preserved. API rollback source/image ID: `/opt/davapprove-releases/sheet-alignment-before/`; retained tag `davapprove-api:before-sheet-alignment`.

Validation: 95 backend tests, 23 frontend tests, production build, Wrangler dry-run, research/report checks, public API health, installed alignment routes and Poppler, and a rolled-back hosted revision-RPC save. Synthetic browser QA verified source-page selection, control matching controls, residual display and raster overlay preview. Real survey registration accuracy remains unbenchmarked. No survey controls or accepted facts were written to the test parcel; no source imports or model jobs were queued. Local database RLS suite was not run because the local PostgreSQL instance requires credentials; hosted RPC smoke validation preserved project state.


## $25 test AI budget and model plan — November 7 follow-up

Authorized cap: $25 shared per UTC calendar month across the hosted test projects, including existing usage/reservations. Local settings, OpenAI admission and SQLite reservation guard now support that cap; lower configured limits remain enforceable. Applied hosted migration `raise_test_ai_budget` (local file `20261108075249_raise_test_ai_budget.sql`) changes the worker-only database hard ceiling to $25 without resetting the ledger. Rollback-only SQL checks verified $6 + $19 reservations succeed and an additional microdollar or oversized limit fails. All 97 backend tests passed.

**Historical activation status (superseded by the cascade release below):** hosted source files and protected `deploy/.env` are staged for $25, but the running worker still has its prior $5 configuration. One active import and ten queued imports were present at the deployment check, so the worker was not restarted mid-parse. The budget increase is not fully effective until the worker is recreated at a safe job boundary. Do not describe this as a live $25 worker limit yet. No new imports or reprocessing jobs were queued by this change.

Only narrow replacements were applied to host `config.py`, `openai_processing.py`, `store.py` and Compose; existing host work was retained. Rollback files (including a protected environment backup) are under `/opt/davapprove-releases/test-budget-25-before`; previous worker image is tagged `davapprove-worker:before-test-budget-25`. When active processing has drained, recreate only the worker using the existing Compose deployment, preserving API and tunnel. Verify `Settings().ai_monthly_usd == 25` inside the new worker and confirm API health. Do not print credentials. The database accepts lower runtime caps, so leaving the old worker temporarily running does not break reservation calls.

Jev + GPT-6.1 Sol low is the revised architecture target, not deployed routing. See `AUTOMATED_PRECHECK_PIPELINE.md` for evaluation and funding decisions. No private documents were sent to Jev and no paid model benchmark ran during this planning/budget change. The security advisor reported an existing leaked-password-protection warning; no database privilege warning was reported for this migration. No authentication settings were changed.


## Jev / Sol cascade — November 8, 2026

The previous import queue drained before deployment (51 completed jobs and one previously failed job; no active queued/running jobs). The fixed reprocessing manifest contains 44 existing originals / 774 pages for test parcel 04260110252000; no new source discovery is part of this run.

Deployed `AI_PROVIDER=cascade`, `AI_MODEL=gpt-6.1-sol`, `AI_MONTHLY_USD=25`; confirmed both provider credentials are present only in the worker. The Jev key is passed as `TYPESAFE_API_KEY`. The OpenAI and TypeSafe ledger uses shared reservations, actual usage reconciliation, and retained uncertain reservations. Reprocessing and comparisons share this cap. The running Cloudflare frontend is `3ba29129-9d65-4d2f-9d6b-96e824c59a48`; public asset hashes match the release build. The API health endpoint returned 200. The existing tunnel was preserved.

See [cascade release](CASCADE_RELEASE.md) for implemented behavior, comparisons and remaining geometry/code-check limits. Source/image extraction uses `precheck-cascade-2026-11-08-v2`, with `source-verification-2026-11-08-v3` for ambiguous source checks. Request hashes include the full prompts/schema, so verification refinements cannot silently reuse an incompatible answer. Paid responses are retained separately from published facts.

Reprocessing: `scripts/reprocess_cascade.py PROJECT_ID /data/cascade-v2-manifest.json` on the protected worker. Supplemental verification: `scripts/verify_cascade.py PROJECT_ID`. Existing document/fact identities, immutable originals and human overlays are retained. Do not clear ledger entries or request caches to force a rerun. Inspect uncertain requests before any retry; source-equivalent cached responses may be reused only after checking the complete request identity. Never restart the worker while either explicit runner is active.

Rollback copies are `/opt/davapprove-releases/cascade-before/source.tgz` and protected `env`; retained image tags are `davapprove-api:before-cascade` and `davapprove-worker:before-cascade`. Recreating only API/worker preserves the tunnel and data volume. Rollback must not erase new evidence or accounting rows. The run is stopped with no active paid requests. See [final corpus results and exact costs](CASCADE_RUN_RESULTS.md): $22.383749 metered corpus processing; $24.929126 shared-ledger total including earlier work, tests and the held uncertain reservation. All 774 pages were extracted; 240 page verification requests await a budget decision. The $25 cap remains unchanged.


### Authorized verification continuation: $35 cap

The user explicitly authorized raising the shared test cap to $35 after the first run stopped at $24.929126. Migration `20261108201906_raise_test_ai_budget_35.sql` preserves the atomic ledger and service-role-only grants while raising the database ceiling. Runtime configuration and its upper bound are updated; the default remains $25 unless configured. The verification/reprocessing runners now read the configured allowance rather than hardcoding $25. Existing usage and uncertain reservations were retained. Thirty-five targeted budget/processing tests passed. Only the idle worker was rebuilt/recreated; API, frontend and tunnel remain unchanged. Pending verification resumes from existing source/fact records and request caches; it does not rerun document extraction.


The $35 continuation finished: all 240 formerly paused source-verification requests completed, all 1,692 blocked observations were checked, and no processing backlog or active requests remain. Incremental model cost was $3.844441. Corpus cost is $26.228190; shared ledger total is $28.773567 / $35, including the unchanged $0.228185 uncertain timeout reservation. All 35 targeted tests passed and API health returned 200. Final snapshot event: `7478141a-8188-4b60-b7b1-d6627f9a9ea4`. See [completed run results](CASCADE_RUN_RESULTS.md). The snapshot writer now stores compact source/validation references and uses an insert with `return=minimal`; larger upsert/returned snapshot writes hit database statement timeouts. Original evidence and provider responses remain retained.

## Provisional drawing rendering — November 8, 2026

Frontend version `17755608-ff96-4190-8523-b56321288372` and API now render grouped native-sheet outlines before review and propose conservative GIS parcel-shape registration. Live corpus: 328 outlines / 133 pages; 22 provisional geographic features. Geometry remains excluded from calculations until the existing reviewed-control requirements are met. Authenticated browser verification showed the original approved site-plan page with five extracted overlays and the geographic barn/access layers. No document reprocessing, paid model calls, database migration or fact-status changes were required. API corpus computation took 0.52 seconds; health returned 200. Production assets match the build (`index-B6LnRMv1.js`, `index-DdZ-Xt37.css`).

Validation: 121 backend tests and 25 frontend tests passed before the final warning-grouping adjustment; 37 targeted geometry/evaluation tests passed after that adjustment. TypeScript/production build, Wrangler dry-run, report regressions and diff checks passed. API rollback image: `davapprove-api:before-provisional-viewer`; prior evaluation module saved under `/opt/davapprove-releases/provisional-viewer-before/`. Worker and tunnel were not restarted. See `SITE_ENVELOPE_VIEWER.md` for remaining registration limitations.


## November 14 beta accounts and bid workspace release

Frontend version `0e5733d7-a8d8-46a3-abc0-37685cb22c03` adds email/password account screens and the separate lightweight bid workspace, including independent agency checks. Initial authentication release: `11a00816-e3ba-4a42-9ebd-a309f1992f19`; previous deployed frontend before this work: `17755608-ff96-4190-8523-b56321288372`. API, worker, database schema, project memberships and email-confirmation policy were not changed.

Both existing confirmed beta accounts retain their original IDs. The requested existing-account password was updated through the Auth admin API and verified by an actual hosted password sign-in, existing-project load and sign-out. No credential is stored in the repository. Operator-generated private links remain available for existing users to choose their own password in **Account & password**.

Validation: 42 frontend tests pass, including registration/confirmation messaging, password recovery, rejected credentials, existing-user password changes, session restoration, logout and stale project/document/image response isolation. Production build and Wrangler dry-run pass; the hosted page loads the final build asset `/assets/index-CmILt4hM.js`. Direct automated HTTP verification returned 403, so browser verification was used; a remote byte-for-byte comparison was not completed. At this initial release, live signup and emailed recovery were not enabled; the Cloudflare email release below supersedes that configuration.

Build note: iCloud offloaded files in the Documents workspace during this release and stalled file reads in Git and Wrangler. The release was built from an isolated temporary local checkout outside iCloud, with the same pinned dependencies and public frontend configuration. Only static production assets were deployed.

## November 14 Cloudflare authentication email release

Deployed `davapprove-auth-email` version `962d77ae-e669-4ea2-ab43-7c3f2a2725e3` and connected the signed Supabase Send Email hook. The existing `haidaa.com` sender is verified and permits arbitrary recipients. Sender: **Davapprove <davapprove@haidaa.com>**. No new domain, DNS changes or billing-plan upgrade. Cloudflare Email Sending uses the account's existing allowances and quotas; see [email operations and pricing sources](../auth-email/README.md).

Frontend version `37fc6b72-3e96-4846-85c3-46f4fc1766ab` enables the email-delivery fallback; prior version `0e5733d7-a8d8-46a3-abc0-37685cb22c03`. Added the missing Compose mapping for `EMAIL_DELIVERY_ENABLED` and recreated only the API container. The background worker and tunnel container IDs stayed unchanged. Protected host rollback configuration is under `/opt/davapprove-releases/auth-email-before/`. The pre-change Supabase configuration and hook secret are stored only in ignored, permission-restricted operator files. No migration, account deletion, password change or project-membership change occurred in this release. Both existing confirmed beta account IDs were checked and preserved.

Validation: 30 hook tests, TypeScript, a successful local Workers-runtime message handoff, 42 frontend tests, production build and deployment dry-run. Hosted hook health and rejection of invalid/incorrectly signed requests pass; valid signatures with invalid payloads return 422 without sending. API health and `email_delivery_enabled=true` verified. Hosted registration/recovery forms are available, and `/assets/index-7LRpzaBc.js` matches the local release bytes. No test email was sent during the configuration release itself. The authorized delivery test and recipient confirmation are recorded below.


### Authorized email test — November 14, 2026

Sent one password-recovery email to the existing user after explicit permission, using the same Supabase client method and production redirect as the app. Supabase returned success at 18:17:58 UTC, and the live Worker logged `auth_email_accepted` for `recovery` with a provider message ID. No password was changed, no recovery link was redeemed, and no test account was created. Protected test records are under ignored `.data/auth-email-delivery-test-*`; no login link or code was printed. The recipient subsequently confirmed receipt in chat. Mail delivery is now verified by the recipient; completing signup confirmation or a password change has not been verified.
