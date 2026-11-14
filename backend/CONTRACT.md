# Backend implementation contract

Run from `backend`: `uv pip install --python .venv/bin/python -r requirements.lock`, then `DAVAPPROVE_MODE=demo .venv/bin/uvicorn app.main:app --port 8000` and in a second process `DAVAPPROVE_MODE=demo .venv/bin/python -m app.worker`. Demo mode is explicit and local-only; it uses unauthenticated synthetic identities and must never be exposed publicly. Default mode is Supabase and requires authenticated users.

API documentation is served at `/docs`, machine schema at `/openapi.json`. `/api/v1/config` returns mode, public Supabase configuration and upload size. For production use Bearer access token; `X-Demo-User` works only in demo mode. Source lookup is live in both modes. No fake source records are generated.

## Important behavior

- Project creation resolves the parcel server-side. The Supabase RPC stores only an unverified parcel ID initially; the automatically queued discovery worker revalidates and saves authoritative geometry/jurisdiction. Reload the project after discovery completes.
- Sources return `access: automated` on downloadable candidates even when `document_url` is null. The KPHD Laserfiche export is session-generated. Only import jobs selected by the user call `fetch_selected`.
- Both county and Poulsbo have real parcel lookup and KPHD record discovery/import. Permit attachments and recorded title/survey portals currently use explicit assisted routes.
- Uploads use multipart `/uploads` only in demo. Production: `/upload-init` returns path and resumable endpoint; upload through Supabase TUS with the user's JWT; `/upload-complete` registers the immutable object and starts processing. Bucket: `project-documents`.
- `/documents/{id}/file` serves authenticated PDF bytes in demo and `{url}` containing a five-minute signed private URL in production.
- Reviews POST `/revisions` with `expected_revision` and fact IDs. Conflicts return 409. Accepted transcription never turns into an agency approval. Revision fields include intent, facts, geometry, constraints, setbacks, boundary_reviewed and node_reviews.
- Jobs are durable database records. Run one worker process per pilot deployment. Cancellation preserves completed steps; running subprocess work may finish its bounded current step before the cancelled status is observed.
- Private PDF text extraction runs first, followed by Tesseract where available. `pdftoppm` and `tesseract` binaries are required for scanned PDFs. Extraction is proposed evidence with exact page references.

## Optional AI extraction

Worker-only variables: `AI_API_KEY`, `AI_BASE_URL` (defaults to OpenAI-compatible `https://api.openai.com/v1`), `AI_MODEL`, `AI_INPUT_USD_PER_MILLION`, `AI_OUTPUT_USD_PER_MILLION`, `AI_MONTHLY_USD` (maximum 5). The model and current pricing must be chosen/verified by the operator. No key, model or positive prices means disabled, with an explicit document warning and deterministic text extraction fallback.

Only selected-document text is sent. At most 20,000 text characters and 1,200 completion tokens are submitted per document. Exact page quotations are validated against submitted text. Atomic monthly budget reservations prevent concurrent calls exceeding the configured allowance; uncertain failures retain their reservation. No model call has been validated against paid credentials in this implementation.

The adapter uses the documented [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) with `max_completion_tokens`, JSON output and `store:false`; the configured model must support that interface. Models with incompatible parameters fall back to manual review, not silent retries with expanded budgets.

## Database deployment

Apply the generated migration in `supabase/migrations` to an empty Davapprove project. Projects and records are isolated by membership. User clients receive SELECT-only access to records and use validated RPCs for jobs, upload registration, comments and revision changes; source candidates and extraction outputs can only be written by the worker. API forwards user JWTs to Supabase; the service-role key belongs only to the worker process.

The MVP stores typed entity documents in a generic JSON record table behind relational project boundaries. This is a deliberate smaller implementation than the proposed normalized schema. Worker service-role privileges are broader than an eventual dedicated least-privilege worker role; isolate that container and never expose its key to the frontend/API. Geometry currently uses Shapely/PROJ in Python rather than PostGIS SQL. The canonical wire geometry is EPSG:4326; metric operations use EPSG:2285.

## Checks

`cd backend && .venv/bin/python -m pytest -q` covers source parsing/network boundaries, selective import, duplicate jobs, project access, reviews, revision conflicts, geometry/rule evaluation and AI budget/citation behavior. Root SQL assertions exercise migration/RLS independently against a disposable PostgreSQL cluster. Hosted verification is required before claiming production ready.


## OpenAI processing v2

`POST /projects/{pid}/documents/{did}/process` (owner/editor) enqueues a parse/resume job, reusing an existing pending parse job when present. The immutable original and prior accepted evidence remain. `document.ai_processing` reports provider/model, page/chunk totals, complete/partial/budget-paused status and page manifest. A completed job means the processing attempt ended; it does not guarantee complete document coverage.

Facts include `evidence_type: text_quote | visual_observation`, original page, model/prompt/pipeline version and `source_region`. Text quotes are checked against supplied text; visual proposals use an empty quote with a page-image hash and region description and never contain accepted calibrated geometry. Partial runs expose a Resume processing action. Completed checkpoints are reused without repeat inference; failed/uncertain prior charges are not automatically retried.

Worker-only `processing_chunk` records use existing project RLS; clients cannot write them. `renew_processing_job` renews only the matching running attempt and cannot revive a cancelled job. Platform key is `OPENAI_API_KEY`, only on the worker. Three-project entitlement enforcement and user model connections remain planned.
