import { afterEach, describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import worker, { buildMessages } from '../src/index';

const secret = 'v1,whsec_' + btoa('test-only-secret-for-signed-auth-hooks');
const settings = {
  APP_URL: 'https://davapprove-preview.delicacybydesign.workers.dev',
  SUPABASE_URL: 'https://znoysvmruyzlfllqblpi.supabase.co',
  FROM_EMAIL: 'davapprove@haidaa.com',
} as const;
const payload = (action = 'signup') => ({
  user: { email: 'beta@example.com', user_metadata: { email: 'attacker@example.com' } },
  email_data: { email_action_type: action, token_hash: 'valid_hash', token: '12345678', redirect_to: 'https://attacker.example/', site_url: 'https://attacker.example/' },
});
function signed(body: string, timestamp = new Date(), key = secret): Request {
  const id = 'msg_test';
  return new Request('https://hook.example/auth/send-email', {
    method: 'POST', body,
    headers: {
      'webhook-id': id, 'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': new Webhook(key.replace('v1,whsec_', '')).sign(id, timestamp, body),
    },
  });
}
const envFor = (send = vi.fn().mockResolvedValue({ messageId: 'message-test' })) => ({
  ...settings, SEND_EMAIL_HOOK_SECRET: secret, EMAIL: { send },
});

afterEach(() => vi.restoreAllMocks());

describe('authentication email messages', () => {
  it.each(['signup', 'email', 'invite', 'magiclink', 'recovery'])('builds a fixed-host %s link and ignores metadata recipients/redirects', action => {
    const { messages } = buildMessages(payload(action), settings);
    expect(messages[0].to).toBe('beta@example.com');
    expect(messages[0].text).not.toContain('attacker');
    const link = new URL(messages[0].text.match(/https:\/\/[^\s]+/)![0]);
    expect(link.origin).toBe(settings.SUPABASE_URL);
    expect(link.searchParams.get('token')).toBe('valid_hash');
    expect(link.searchParams.get('type')).toBe(action);
    expect(link.searchParams.get('redirect_to')).toBe(settings.APP_URL + (action === 'recovery' ? '/?auth=recovery' : '/'));
    expect(messages[0].html).toContain('&amp;');
  });
  it('sends secure email changes with Supabase’s reversed hash mapping', () => {
    const input = payload('email_change');
    const { messages } = buildMessages({ ...input, user: { email: 'old@example.com', new_email: 'new@example.com' }, email_data: { ...input.email_data, token_hash: 'new_address_hash', token_hash_new: 'old_address_hash' } }, settings);
    expect(messages).toHaveLength(2);
    expect(messages[0].to).toBe('old@example.com');
    expect(messages[0].text).toContain('token=old_address_hash');
    expect(messages[1].to).toBe('new@example.com');
    expect(messages[1].text).toContain('token=new_address_hash');
  });
  it('sends a single email change only to the new address when secure change is off', () => {
    const input = payload('email_change');
    const { messages } = buildMessages({ ...input, user: { email: 'old@example.com', new_email: 'new@example.com' } }, settings);
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe('new@example.com');
  });
  it('escapes email addresses in HTML', () => {
    const input = payload('email_change');
    const { messages } = buildMessages({ ...input, user: { email: 'old@example.com', new_email: 'a&b@example.com' } }, settings);
    expect(messages[0].html).toContain('a&amp;b@example.com');
    expect(messages[0].html).not.toContain('a&b@example.com');
  });
  it('renders reauthentication codes and rejects markup in codes', () => {
    const input = payload('reauthentication');
    expect(buildMessages(input, settings).messages[0].text).toContain('12345678');
    expect(() => buildMessages({ ...input, email_data: { ...input.email_data, token: '<script>' } }, settings)).toThrow();
  });
  it.each(['password_changed', 'email_changed', 'phone_changed', 'identity_linked', 'identity_unlinked', 'mfa_factor_enrolled', 'mfa_factor_unenrolled'])('supports %s security notices without credentials', action => {
    const mail = buildMessages(payload(action + '_notification'), settings).messages[0];
    expect(mail.text).toContain('contact your beta administrator');
    expect(mail.text + mail.html).not.toContain('valid_hash');
  });
});

describe('signed hook boundary', () => {
  it('awaits provider acceptance before reporting success and logs no recipients or tokens', async () => {
    let accept!: (value: { messageId: string }) => void;
    const env = envFor(vi.fn(() => new Promise(resolve => { accept = resolve; })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let completed = false;
    const result = worker.fetch(signed(JSON.stringify(payload())), env).then(r => { completed = true; return r; });
    await vi.waitFor(() => expect(env.EMAIL.send).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect(env.EMAIL.send.mock.calls[0][0].from).toEqual({ email: settings.FROM_EMAIL, name: 'Davapprove' });
    accept({ messageId: 'provider-id' });
    expect((await result).status).toBe(200);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/beta@example|valid_hash|12345678/);
  });
  it.each(['missing', 'tampered', 'wrong-secret', 'old', 'future'])('rejects %s signatures without sending', async mode => {
    const body = JSON.stringify(payload());
    let request = signed(body);
    if (mode === 'missing') request.headers.delete('webhook-signature');
    if (mode === 'tampered') request = new Request(request, { body: body.replace('beta@', 'attacker@') });
    if (mode === 'wrong-secret') request = signed(body, new Date(), btoa('another-test-only-secret'));
    if (mode === 'old') request = signed(body, new Date(Date.now() - 600_000));
    if (mode === 'future') request = signed(body, new Date(Date.now() + 600_000));
    const env = envFor();
    expect((await worker.fetch(request, env)).status).toBe(401);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...payload(), user: { email: 'beta@example.com\r\nBcc:other@example.com' } }, payload('__proto__'), payload('unsupported')])('rejects malformed signed payloads', async input => {
    const env = envFor();
    expect((await worker.fetch(signed(JSON.stringify(input)), env)).status).toBe(422);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });
  it('caps streamed bodies even without Content-Length', async () => {
    const env = envFor();
    expect((await worker.fetch(signed('x'.repeat(65_537)), env)).status).toBe(413);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });
  it('does not turn provider failures into success or leak provider errors', async () => {
    const env = envFor(vi.fn().mockRejectedValue(new Error('Recipient beta@example.com token valid_hash')));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await worker.fetch(signed(JSON.stringify(payload('recovery'))), env);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('beta@example');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/beta@example|valid_hash/);
  });
  it('exposes only the health and signed POST routes', async () => {
    const env = envFor();
    expect((await worker.fetch(new Request('https://hook.example/health'), env)).status).toBe(200);
    expect((await worker.fetch(new Request('https://hook.example/auth/send-email'), env)).status).toBe(405);
    expect((await worker.fetch(new Request('https://hook.example/unknown'), env)).status).toBe(404);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });
});
