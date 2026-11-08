# Davapprove pilot operations

Updated November 7, 2026. See [implementation status](IMPLEMENTATION_STATUS.md) for release limits. Secrets are stored in ignored, permission-restricted files and on the dedicated host; never copy them into frontend variables or this document.

## Deployed resources

- Frontend: https://davapprove-preview.delicacybydesign.workers.dev — Cloudflare Worker `davapprove-preview`.
- Supabase: project `znoysvmruyzlfllqblpi`, **Davapprove**, HAIDAA organization, `us-west-1`. Currently Free, not the proposed Pro tier. Migrations have been applied and security/performance advisors returned no notices.
- Hetzner: server `175016728`, **davapprove-beta**, `178.105.77.156`, CX23 in Falkenstein. Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk. Firewall `davapprove-beta` exposes SSH only; API access uses an outbound HTTPS tunnel.
- Server login: `ssh -i ~/.ssh/hetzner root@178.105.77.156`. Application directory `/opt/davapprove`. This is separate from Orbitfleet; do not deploy to `5.78.196.181`.
- API preview: https://exclusive-orbit-fruit-appendix.trycloudflare.com — temporary hostname; see recovery below.

Verified account quote: server $6.49/month + IPv4 $0.60/month = **$7.09/month**, excluding usage outside included allowances. Supabase and static hosting currently use free tiers. Platform OpenAI processing is enabled with a $5/month application allowance. A future $25 Supabase Pro subscription would bring the base to $32.09, leaving room within the $50 budget for bounded AI and backups. No Pro or Workers paid-plan upgrade was activated.

## Runtime and deployment

`deploy/compose.yaml` runs isolated API and worker containers. `--profile preview` also runs a Cloudflare Quick Tunnel; `--profile domain` runs Caddy instead when a controlled hostname is available. Do not activate both profiles accidentally. API has only the publishable key; worker has the service-role key. Both use `DAVAPPROVE_MODE=supabase` in hosted deployment.

Required protected environment in `deploy/.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`. Current `MAX_PDF_BYTES=52428800` matches the Free storage limit. `EMAIL_DELIVERY_ENABLED=false` until a sender is configured. OpenAI configuration is documented below. The legacy proxy remains deployed for rollback but is no longer the default processing provider. Do not set guessed model prices.

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

Supabase's allowed redirect includes the frontend URL. Email confirmation, refresh-token rotation and TOTP options remain enabled. The frontend does not claim to send login emails while SMTP is unconfigured. Operators can generate a one-use sign-in link without sending email:

```sh
# Supply server-only credentials through the environment, not command arguments.
python3 scripts/create_beta_link.py person@example.com --output .data/private-beta-access.html
```

The generated HTML contains a login credential. Open or share it privately with the intended recipient; it expires and is single-use. Never commit it or add it to a public site. To invite collaborators to an existing project, an owner uses the membership API with the recipient's Supabase user ID and `editor` or `reviewer`; a friendly invitation-management UI is not yet implemented.

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
