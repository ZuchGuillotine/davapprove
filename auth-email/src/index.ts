import { Webhook } from 'standardwebhooks';

const MAX_BODY_BYTES = 65_536;
type Settings = Pick<Env, 'APP_URL' | 'SUPABASE_URL' | 'FROM_EMAIL'>;
type Message = { to: string; subject: string; text: string; html: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid payload');
  return value as Record<string, unknown>;
}

function field(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048) throw new Error('Invalid field');
  return value;
}

function address(value: unknown): string {
  const email = field(value);
  if (email.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) throw new Error('Invalid email');
  return email;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function message(to: string, title: string, body: string, link?: string, label?: string): Message {
  const footer = 'If you did not request this, you can ignore this email. Never share this link or code.';
  return {
    to,
    subject: `Davapprove — ${title}`,
    text: `${title}\n\n${body}${link ? `\n\n${label}: ${link}` : ''}\n\n${footer}`,
    html: `<html><body><h1>Davapprove</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(label!)}</a></p>` : ''}<p>${footer}</p></body></html>`,
  };
}

function verificationLink(hash: unknown, action: string, settings: Settings): string {
  const tokenHash = field(hash);
  if (!/^[A-Za-z0-9_-]+$/.test(tokenHash)) throw new Error('Invalid token hash');
  const redirect = new URL('/', settings.APP_URL);
  if (action === 'recovery') redirect.searchParams.set('auth', 'recovery');
  const link = new URL('/auth/v1/verify', settings.SUPABASE_URL);
  link.searchParams.set('token', tokenHash);
  link.searchParams.set('type', action);
  // Redirects and the verification host come only from our deployment configuration.
  // Never use user_metadata, site_url or redirect_to from the hook as a URL.
  link.searchParams.set('redirect_to', redirect.href);
  return link.href;
}

const ACTIONS: Record<string, [string, string, string]> = {
  signup: ['Confirm your email', 'Confirm your email address to finish creating your Davapprove beta account.', 'Confirm email'],
  email: ['Confirm your email', 'Confirm this email address for your Davapprove account.', 'Confirm email'],
  invite: ['Your beta invitation', 'You have been invited to Davapprove. Accept your invitation to get started.', 'Accept invitation'],
  magiclink: ['Your sign-in link', 'Use this one-time link to sign in to Davapprove.', 'Sign in'],
  recovery: ['Reset your password', 'Use this one-time link to choose a new password. Your current password stays unchanged until you save a new one.', 'Reset password'],
};

const NOTIFICATIONS: Record<string, string> = {
  password_changed_notification: 'Your password was changed',
  email_changed_notification: 'Your email address was changed',
  phone_changed_notification: 'Your phone number was changed',
  identity_linked_notification: 'A sign-in method was added',
  identity_unlinked_notification: 'A sign-in method was removed',
  mfa_factor_enrolled_notification: 'A verification method was added',
  mfa_factor_unenrolled_notification: 'A verification method was removed',
};

export function buildMessages(payload: unknown, settings: Settings): { action: string; messages: Message[] } {
  const input = record(payload);
  const user = record(input.user);
  const data = record(input.email_data);
  const to = address(user.email);
  const action = field(data.email_action_type);
  if (Object.hasOwn(ACTIONS, action)) {
    const [title, body, label] = ACTIONS[action];
    return { action, messages: [message(to, title, body, verificationLink(data.token_hash, action, settings), label)] };
  }
  if (action === 'email_change') {
    const newEmail = address(user.new_email);
    const body = `Confirm the request to change your Davapprove email address to ${newEmail}.`;
    // Supabase's legacy naming is reversed: token_hash_new belongs to the CURRENT email.
    // https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
    const messages = [message(newEmail, 'Confirm email change', body, verificationLink(data.token_hash, action, settings), 'Confirm email change')];
    if (data.token_hash_new) messages.unshift(message(to, 'Confirm email change', body, verificationLink(data.token_hash_new, action, settings), 'Confirm email change'));
    return { action, messages };
  }
  if (action === 'reauthentication') {
    const token = field(data.token);
    if (!/^\d{6,10}$/.test(token)) throw new Error('Invalid code');
    return { action, messages: [message(to, 'Your verification code', `Your one-time verification code is ${token}. Enter it in Davapprove to continue.`)] };
  }
  if (Object.hasOwn(NOTIFICATIONS, action)) {
    const title = NOTIFICATIONS[action];
    // Security notices contain no one-time login credentials.
    return { action, messages: [{
      to, subject: `Davapprove — ${title}`,
      text: `${title}. If you did not make this change, open Davapprove directly and contact your beta administrator immediately.`,
      html: `<html><body><h1>Davapprove</h1><h2>${title}</h2><p>If you did not make this change, open Davapprove directly and contact your beta administrator immediately.</p></body></html>`,
    }] };
  }
  throw new Error('Unsupported email action');
}

async function boundedBody(request: Request): Promise<string> {
  const length = Number(request.headers.get('content-length'));
  if (length > MAX_BODY_BYTES) throw new Error('Body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
}

function failure(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ ok: true });
    if (path !== '/auth/send-email') return failure(404, 'Not found');
    if (request.method !== 'POST') return failure(405, 'Method not allowed');
    const headers = Object.fromEntries(request.headers);
    if (!headers['webhook-id'] || !headers['webhook-timestamp'] || !headers['webhook-signature']) return failure(401, 'Invalid hook signature');
    if (!env.SEND_EMAIL_HOOK_SECRET) return failure(503, 'Email delivery unavailable');
    let body: string;
    try { body = await boundedBody(request); } catch { return failure(413, 'Invalid or oversized body'); }
    let payload: unknown;
    try {
      // Standard Webhooks verifies the raw body, timestamp freshness and signature.
      const secret = env.SEND_EMAIL_HOOK_SECRET.replace(/^v1,whsec_/, '');
      payload = new Webhook(secret).verify(body, headers);
    } catch { return failure(401, 'Invalid hook signature'); }
    let delivery: ReturnType<typeof buildMessages>;
    try { delivery = buildMessages(payload, env); } catch { return failure(422, 'Invalid email payload'); }
    try {
      for (const mail of delivery.messages) {
        const result = await env.EMAIL.send({ ...mail, from: { email: env.FROM_EMAIL, name: 'Davapprove' } });
        console.log(JSON.stringify({ event: 'auth_email_accepted', action: delivery.action, messageId: result.messageId }));
      }
    } catch {
      // Provider errors can include addresses or content; keep logs and responses generic.
      console.error(JSON.stringify({ event: 'auth_email_failed', action: delivery.action }));
      return failure(503, 'Email delivery unavailable. Please try again later.');
    }
    // Supabase requires a successful synchronous provider handoff before reporting success.
    return Response.json({}, { headers: { 'Cache-Control': 'no-store' } });
  },
} satisfies ExportedHandler<Env>;
