'use strict';
/* HTTP routes, report auth and entitlement, rate limits, CORS, events and MCP tools. No network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createApp } = require('../src/server');
const { createEngine } = require('../src/engine');
const { createAuth, createEvents, entitlement } = require('../src/support');
const { fakeDeps, PARCEL_KEY, ADDRESS } = require('./fixtures');

const HIT = { label: ADDRESS, sublabel: 'Tax account TEST', parcel_key: PARCEL_KEY };

async function start(options = {}) {
  const lines = [];
  const events = createEvents({ sink: (line) => lines.push(JSON.parse(line)) });
  const engine = createEngine(fakeDeps(options.deps || { hits: { 'wa-kitsap': [HIT] } }));
  const auth = options.auth || { configured: true, verify: async (token) => (token === 'good' ? { id: 'user-1' } : null), ownedReports: async () => options.used || 0 };
  const handler = createApp({ engine, events, auth, accessLog: false, config: { corsOrigins: ['https://davapprove.com'], appUrl: 'https://davapprove.com', freeReports: 1, requirePayment: !!options.requirePayment, limits: { estimate: { limit: options.estimateLimit || 30, windowMs: 3600_000 }, report: { limit: 30, windowMs: 3600_000 }, search: { limit: 60, windowMs: 60_000 }, mcp: { limit: 60, windowMs: 60_000 } } } });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, lines, close: () => new Promise((resolve) => server.close(resolve)) };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const estimateBody = { county: 'wa-kitsap', parcel: PARCEL_KEY, project: { type: 'adu', scope_items: ['solar'] }, audience: 'homeowner' };

test('estimate endpoint returns the summary and logs a privacy-safe event', async (t) => {
  const s = await start(); t.after(s.close);
  const res = await post(s.base, '/api/v1/estimate', estimateBody, { Origin: 'https://davapprove.com' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://davapprove.com');
  const body = await res.json();
  assert.equal(body.parcel.label, ADDRESS);
  const event = s.lines.find((l) => l.event === 'estimate_run');
  assert.deepEqual({ ...event, at: undefined }, { type: 'event', at: undefined, event: 'estimate_run', source: 'web', audience: 'homeowner', state: 'WA', county: 'wa-kitsap', jurisdiction: 'unincorporated', project_type: 'adu', scope_items: ['solar'], coverage_complete: true, quotes_needed: body.quotes_needed, status: 'ok' });
  const logged = JSON.stringify(s.lines);
  assert(!logged.includes(PARCEL_KEY) && !logged.includes(ADDRESS), 'events never hold parcel keys or addresses');
});

test('request validation, CORS and rate limits', async (t) => {
  // Every attempt counts toward the limit, including rejected ones: three bad requests, then 429.
  const s = await start({ estimateLimit: 3 }); t.after(s.close);
  assert.equal((await fetch(s.base + '/api/v1/estimate', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(s.base + '/api/v1/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })).status, 400);
  assert.equal((await fetch(s.base + '/api/v1/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(40_000) })).status, 413);
  const limited = await post(s.base, '/api/v1/estimate', estimateBody);
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get('retry-after')) > 0);
  assert.deepEqual(await limited.json(), { detail: 'Too many requests. Try again shortly.', code: 'rate_limited' });
  const foreign = await fetch(s.base + '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const missing = await fetch(s.base + '/nope');
  assert.deepEqual([missing.status, (await missing.json()).code], [404, 'not_found']);
  const search = await fetch(s.base + '/api/v1/engine/search?q=1%20synth');
  assert.equal((await search.json()).hits[0].parcel_key, PARCEL_KEY);
});

test('full report needs sign-in and reports beta entitlement honestly', async (t) => {
  const s = await start({ used: 1 }); t.after(s.close);
  assert.equal((await post(s.base, '/api/v1/reports', estimateBody)).status, 401);
  assert.equal((await post(s.base, '/api/v1/reports', estimateBody, { Authorization: 'Bearer bad' })).status, 401);
  const res = await post(s.base, '/api/v1/reports', estimateBody, { Authorization: 'Bearer good' });
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.deepEqual(report.entitlement, { used: 1, free_reports: 1, would_require_payment: true, allowed: true, beta: true });
  assert(report.findings.length && Object.keys(report.citations).length);
  assert.equal(s.lines.find((l) => l.event === 'report_served').status, 'beta_would_require_payment');
});

test('with payment required, a second report returns 402', async (t) => {
  const s = await start({ used: 1, requirePayment: true }); t.after(s.close);
  const res = await post(s.base, '/api/v1/reports', estimateBody, { Authorization: 'Bearer good' });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, 'payment_required');
  assert.deepEqual(entitlement(0, { requirePayment: true }).allowed, true, 'the first report stays free');
});

test('Supabase auth: verifies tokens with Supabase and counts owned reports with the user token', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.headers]);
    if (url.endsWith('/auth/v1/user')) return { ok: init.headers.Authorization === 'Bearer t1', json: async () => ({ id: 'u1', email: 'not-kept@example.com' }) };
    return { ok: true, status: 206, headers: new Map([['content-range', '0-0/3']]) };
  };
  const auth = createAuth({ supabaseUrl: 'https://sb.example', publishableKey: 'pk', fetchImpl });
  assert.deepEqual(await auth.verify('t1'), { id: 'u1' });
  assert.deepEqual(await auth.verify('t1'), { id: 'u1' });
  assert.equal(seen.length, 1, 'verified tokens are cached briefly');
  assert.equal(await auth.verify('t2'), null);
  assert.equal(await auth.ownedReports('t1', 'u1'), 3);
  assert.equal(seen.at(-1)[0], 'https://sb.example/rest/v1/bids?select=id&owner_id=eq.u1');
  assert.equal(seen.at(-1)[1].Authorization, 'Bearer t1');
});

test('MCP: tools, caveats as data, address resolution and a link into the web report gate', async (t) => {
  const s = await start({ deps: { outage: 'flood', hits: { 'wa-kitsap': [HIT], 'wa-king': [] } } }); t.after(s.close);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(s.base + '/mcp')));
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), ['estimate_permit_costs', 'get_coverage', 'search_parcels']);

  const r = await client.callTool({ name: 'estimate_permit_costs', arguments: { address: '1 synthetic', project: { type: 'adu', scope_items: ['solar'] } } });
  const out = r.structuredContent;
  assert.equal(out.status, 'ok');
  assert.equal(out.coverage.complete, false);
  assert.deepEqual(out.unassessed_scope, [{ id: 'solar', label: 'Solar panels' }]);
  assert.match(r.content[0].text, /could not be read/);
  assert.match(r.content[0].text, /Not an approval/);
  const link = new URL(out.report_url);
  assert.equal(link.origin, 'https://davapprove.com');
  assert.deepEqual(JSON.parse(Buffer.from(link.searchParams.get('estimate'), 'base64url').toString()), { county: 'wa-kitsap', parcel: PARCEL_KEY, label: ADDRESS, project: { type: 'adu', scope_items: ['solar'] } });
  assert(!('findings' in out) && !('citations' in out), 'MCP never returns the full report');
  assert.equal(s.lines.find((l) => l.event === 'estimate_run').source, 'mcp');

  const unsupported = await client.callTool({ name: 'estimate_permit_costs', arguments: { county: 'wa-pierce', parcel_key: '1', project: { type: 'adu' } } });
  assert.equal(unsupported.isError, true);
  assert.equal(unsupported.structuredContent.code, 'unsupported_county');

  const none = await client.callTool({ name: 'estimate_permit_costs', arguments: { address: 'nowhere at all', project: { type: 'adu' } } });
  assert.equal(none.structuredContent.status, 'no_match');
});

test('MCP: several matches are returned as candidates, not guessed', async (t) => {
  const s = await start({ deps: { hits: { 'wa-kitsap': [HIT, { ...HIT, parcel_key: '654321', label: '1 SYNTHETIC RD UNIT B' }] } } }); t.after(s.close);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(s.base + '/mcp')));
  t.after(() => client.close());
  const r = await client.callTool({ name: 'estimate_permit_costs', arguments: { address: '1 synthetic', project: { type: 'adu' } } });
  assert.equal(r.structuredContent.status, 'ambiguous');
  assert.equal(r.structuredContent.candidates.length, 2);
  const coverage = await client.callTool({ name: 'get_coverage', arguments: {} });
  assert(!('project_type_defaults' in coverage.structuredContent));
  assert.equal((await fetch(s.base + '/mcp')).status, 405);
});
