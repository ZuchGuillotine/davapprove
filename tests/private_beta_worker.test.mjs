import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../web/worker/index.mjs';

const base = 'https://davapprove.com';

test('invitation gates and metrics are enforced at the Worker', async () => {
  const events = [];
  const pending = [];
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_PUBLISHABLE_KEY: 'synthetic-public',
    BETA_EVENTS_SERVICE_KEY: 'synthetic-service',
    ASSETS: { fetch: async () => new Response('shell') },
    BETA_RATE_LIMIT: { limit: async () => ({ success: true }) },
  };
  const ctx = { waitUntil: promise => pending.push(promise) };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) {
      const invited = options.headers.Authorization === 'Bearer invited';
      return Response.json({ id: 'tester', email_confirmed_at: '2026-11-22', app_metadata: { davapprove_beta: invited } });
    }
    assert.ok(url.endsWith('/rest/v1/beta_events'));
    assert.equal(options.headers.Authorization, 'Bearer synthetic-service');
    events.push(JSON.parse(options.body));
    return new Response(null, { status: 201 });
  };
  function request(path, token, body, headers = {}) {
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) Object.assign(headers, { 'Content-Type': 'application/json', Origin: base });
    return worker.fetch(new Request(base + path, {
      headers, method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
    }), env, ctx);
  }
  try {
    for (const path of ['/beta-api/meta', '/bid-assistant/index.html', '/mcp']) {
      assert.equal((await request(path)).status, 401);
      assert.equal((await request(path, 'uninvited')).status, 403);
    }
    for (const path of ['/bid-assistant/lib/engine.js', '/bid-assistant/data/data.js', '/bid-assistant/rules/wa-kitsap.js']) {
      assert.equal((await request(path, 'invited')).status, 404);
    }
    const session = await request('/beta-api/session', 'invited', {});
    const setCookie = session.headers.get('Set-Cookie');
    assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict/);
    assert.equal((await request('/bid-assistant/index.html', undefined, undefined, {
      Cookie: setCookie.split(';', 1)[0],
    })).status, 200);

    const meta = await (await request('/beta-api/meta', 'invited')).json();
    assert.equal(meta.counties.length, 3);
    assert.ok(meta.counties.every(county => !county.data.citations && !county.data.fees));

    const expectation = { state: 'AK', county: 'Kusilvak Census Area', supported: false };
    const outside = await request('/beta-api/coverage', 'invited', {
      county_code: '02158', parcel: 'ignored', project: { type: 'adu' },
    });
    assert.deepEqual(await outside.json(), { ...expectation, coverage: 'unsupported' });
    const mcp = await worker.fetch(new Request(base + '/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer invited', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'screen_parcel',
        arguments: { county_code: '02158', parcel: 'ignored', project: { type: 'adu', scope_items: ['solar'] } },
      } }),
    }), env, ctx);
    assert.deepEqual((await mcp.json()).result.structuredContent, { ...expectation, coverage: 'unsupported' });
    await Promise.all(pending);
    assert.deepEqual(events, [expectation, expectation]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
