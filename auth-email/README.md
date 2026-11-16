# Davapprove beta authentication email

Cloudflare Worker `davapprove-auth-email` handles the Supabase **Send Email hook** for project `znoysvmruyzlfllqblpi`. Sender: **Davapprove <davapprove@haidaa.com>**, using the existing verified `haidaa.com` domain. No separate Davapprove domain or Resend account is needed for this beta.

The hook replaces Supabase's built-in mail transport. It does not manage passwords, sessions, project membership or permit records. Email confirmation stays enabled. The frontend remains at https://davapprove-preview.delicacybydesign.workers.dev.

## Delivery and security

- Endpoint: `POST https://davapprove-auth-email.delicacybydesign.workers.dev/auth/send-email`.
- Standard Webhooks verifies the raw request body, signature and timestamp before processing. The hook secret is a Cloudflare secret and a Supabase Auth setting, never a frontend variable or checked-in file.
- Cloudflare's binding permits only `davapprove@haidaa.com` as sender. The Worker has no Cloudflare management token or Supabase service-role credential.
- Recipients come from the signed Auth user fields. Link hosts and redirects come from deployment configuration, not user metadata or request URLs.
- Signup, invite, sign-in, recovery, reauthentication and both secure-email-change confirmations are supported. Security-notification templates are supported without changing which notifications Supabase enables.
- Payloads are capped at 64 KiB. Provider acceptance is awaited; delivery errors return a failure to Supabase. Success means provider acceptance, not confirmed inbox receipt. Hook retries can result in duplicate messages, including the first message in a partially completed two-address email change.
- Logs contain action names and provider message IDs only. No addresses, passwords, codes, message bodies or login links are logged by this application. `GET /health` checks the Worker, not inbox delivery.

## Development and deployment

```sh
cd auth-email
npm ci
npm run types
npm run typecheck
npm test
npm run deploy:dry-run
```

Wrangler 4.162.0 is pinned for this new Worker because the existing application's 4.158.0 local runtime does not support its November 14 compatibility date. Existing application dependencies are unchanged. Generated `worker-configuration.d.ts` is committed; regenerate it after changing bindings.

Generate a random 32-byte secret and encode it as `v1,whsec_<base64>`. Put it in a permission-restricted JSON file outside version control under `SEND_EMAIL_HOOK_SECRET`, then deploy with `wrangler deploy --secrets-file /absolute/private/secrets.json`. Never pass secrets as command arguments. A local `.dev.vars` can hold a disposable test secret; it is ignored. The default local `send_email` binding writes test messages locally and does not send them; do not set `remote: true` for automated tests.

Configure Supabase Auth with:

- `hook_send_email_enabled=true`, the endpoint above as `hook_send_email_uri`, and the same secret as `hook_send_email_secrets`.
- `mailer_autoconfirm=false`, `external_email_enabled=true`, `disable_signup=false`.
- Site URL: the frontend origin. Allow both `/` and `/?auth=recovery` at that origin. The hook always uses those production redirects, including requests from local development clients.
- Beta `rate_limit_email_sent=30` per hour; the existing 60-second resend interval remains. Account-wide Cloudflare limits are shared with other projects.

Set protected `deploy/.env` `EMAIL_DELIVERY_ENABLED=true`, recreate only the API container with Compose `up -d --no-deps api`, and preserve the worker and tunnel. The Compose mapping is required. Set the frontend's public fallback `VITE_EMAIL_DELIVERY_ENABLED=true` and rebuild/deploy. The API flag takes precedence.

For a delivery test, obtain permission for the real recipient and trigger the normal signup or recovery flow. Do not silently create fake users in production or reset an existing user's password. Use the provider message ID for troubleshooting; never paste a recovery link into logs or a ticket. Existing confirmed users can still sign in with passwords during a mail outage.

To disable email workflows, first turn off the API/frontend delivery flags. Then disable the Supabase hook if needed. Do not disable email confirmation or rely on Supabase's restricted default sender as a replacement. For rollback, preserve user accounts and project memberships; restore only the relevant Auth settings and API configuration from protected backups.

## Verified configuration and limits — November 14, 2026

Cloudflare reports `haidaa.com` sending enabled, DNS status ready, arbitrary recipients allowed and a 1,000-email daily account quota. No DNS, domain purchase or billing-plan upgrade was needed. Email Sending usage shares the account's existing plan: the published Workers Paid allowance is 3,000 messages/month, then $0.35 per 1,000; this is not an unlimited free-mail claim.

Validation: 30 unit tests, TypeScript, deployment build and a successful local Workers-runtime recovery-message handoff. The deployed hook returns 200 for health, 401 for an invalid signature and 422 for a correctly signed invalid payload without sending. An authorized recovery-email request through the production Supabase client succeeded on November 14 at 18:17 UTC, and the live hook recorded Cloudflare provider acceptance. The recipient subsequently confirmed receipt in chat. A full emailed signup/confirmation or password-change round trip remains unverified. See [operations](../docs/operations.md) for the release record.

Official references reviewed November 14, 2026:

- [Supabase Send Email hook and secure-email-change token mapping](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
- [Supabase hosted Auth testing and email limits](https://supabase.com/docs/guides/auth/testing-auth-flows)
- [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare sending-domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Cloudflare Email Sending pricing](https://developers.cloudflare.com/email-service/platform/pricing/)

## Design-partner recovery investigation — November 16, 2026

Read-only production checks for the reported missing reset email found:

- The affected account exists and is email-confirmed. Its last sign-in predates the
  November 14 email-hook verification. Its `recovery_sent_at` is null, so there is
  no recorded successful recovery send for that account. This does not identify
  the original failure or prove that the user did not attempt a request.
- The exact recipient has no active Cloudflare Email Sending suppression.
- Worker observations from November 14 00:00 UTC through the investigation showed
  one `auth_email_accepted` recovery event, matching the existing November 14
  verification above, and no `auth_email_failed` events. These privacy-preserving
  logs do not identify the recipient, and provider acceptance is not delivery.
- Supabase Auth logs available for November 14 showed no email delivery errors;
  the latest 24-hour query showed a refresh-token-not-found error, not a delivery
  error. A November 13 query and the affected-account audit-entry query returned
  no rows. Empty historical results are not proof of absence.
- Supabase health advisors returned no notices. No email was sent and no account,
  password, suppression, or service configuration was changed during this review.

**Status:** the original missing-email cause and the affected recipient's current
inbox delivery remain unverified. Do not report this as a proven inbox fix. The
frontend now offers confirmation resends, a visible 60-second repeat-request wait,
missing-email guidance, and regression coverage for rejected email hooks and
expired recovery callbacks with an existing browser session.

For a follow-up delivery check, have the recipient request recovery from the app
and record the UTC time. Correlate the Auth request, signed hook invocation, and
provider message ID; inspect the provider's delivery/bounce status. Check Spam and
All Mail for Davapprove from `davapprove@haidaa.com`. Only recipient confirmation
and completing the password-reset/sign-in round trip verify the complete flow.
Never store the reset URL, token, or password in an issue or log. Use an authorized
test account for signup/confirmation/reset end-to-end checks.

Frontend resend implementation follows [Supabase auth.resend](https://supabase.com/docs/reference/javascript/auth-resend)
and recovery follows [Password-based Auth](https://supabase.com/docs/guides/auth/passwords),
reviewed November 16, 2026. Business/agency signup metadata is presentation-only;
it must never be used for authorization.
