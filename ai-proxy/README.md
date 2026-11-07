# Davapprove private Workers AI proxy

This narrow server-to-server adapter lets the document worker use Cloudflare Workers AI without an OpenAI API key. It supports only `POST /v1/chat/completions`, one allowlisted extraction model, one bounded user prompt and at most 1,200 output tokens. It returns proposed facts, not approvals. The backend still validates exact page quotations and requires human review.

## Verified model and costs

Checked November 7, 2026 against official documentation:

- Model: [`@cf/meta/llama-3.3-70b-instruct-fp8-fast`](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/). Current model page lists a 24,000-token context and no planned deprecation; supports [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/). Smaller historical Llama fast endpoints were unavailable or flagged for near-term deprecation, so this implementation does not use them.
- Published unit prices: **$0.293 per million input tokens, $2.253 per million output tokens**. Use these nonzero rates for the application's conservative accounting even when requests fall inside the free allowance.
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) includes **10,000 neurons per account per day**, resetting at 00:00 UTC. On Workers Free, requests beyond the allowance fail; no paid-plan upgrade is performed here. On an already-paid account, overage billing applies; the backend's monthly reservation cap remains necessary.
- Free allocation is shared with other Workers AI workloads on the same account. An unavailable model or exhausted allowance returns an error and preserves the application's manual-review fallback.

Wrangler OAuth for the existing account includes `ai:write`. Deployed at `https://davapprove-ai-proxy.delicacybydesign.workers.dev`. Live synthetic inference and extraction from a selected public six-page KPHD document succeeded; the latter produced 10 exact-quote-validated proposed facts. Unit tests use a mocked binding and consume no quota.

## Deploy and connect

1. `npm ci`, `npm run types`, `npm run typecheck`, `npm test`, `npm run deploy:dry-run`.
2. Create a cryptographically random secret of at least 32 characters in a protected local file. Do not place it in command arguments, this repository, logs, or browser environment variables.
3. Deploy with `npm run deploy`; add `AI_PROXY_SECRET` with Wrangler's documented stdin secret mechanism. Secret addition deploys a version. The endpoint fails closed until the secret is configured.
4. Configure the **Python worker container only**:

```dotenv
AI_BASE_URL=https://davapprove-ai-proxy.<account-subdomain>.workers.dev/v1
AI_API_KEY=<same server-only shared secret>
AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
AI_INPUT_USD_PER_MILLION=0.293
AI_OUTPUT_USD_PER_MILLION=2.253
AI_MONTHLY_USD=5
```

5. Test a short synthetic property-document excerpt through the deployed proxy and then a selected public record through the app. Verify output quotations and page references before asserting quality. The app's reservation key prevents repeat AI billing for an already attempted document/model/extractor combination; use a new test document when verifying a newly configured model.

## Bounds and security

- SHA-256 plus timing-safe secret comparison; no browser CORS allowance.
- Request body ≤100,000 bytes; extraction prompt ≤21,000 UTF-8 bytes; output ≤1,200 tokens; ≤12 proposed facts.
- No tools, streaming, arbitrary model IDs or caller-supplied system prompts.
- Fixed extraction system instruction, JSON schema and output validation. These help constrain output but are not proof that extracted statements are true; backend citation validation remains mandatory.
- Model usage is returned when available. Missing usage is not fabricated, so the backend retains its conservative cost reservation.
- Logs contain only outcome, model ID and fact count. Prompts, document text, model output, secrets and upstream error bodies are not logged by this code.
- Requires no KV, Durable Objects, database, paid external provider key or paid-plan upgrade. Generated Worker types and package lockfile are checked in.

`GET /health` returns model and whether the shared secret is configured; it performs no inference. A successful dry run does not prove model access or available account quota.
