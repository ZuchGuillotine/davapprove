/*
 * Engine HTTP service. Routes (Caddy sends these paths here; everything else goes to the API):
 *
 *   GET  /health
 *   GET  /api/v1/engine/coverage
 *   GET  /api/v1/engine/search?q=
 *   POST /api/v1/estimate          {county, parcel, project}  basic summary, open, rate-limited
 *   POST /api/v1/reports           {county, parcel, project}  full report, Supabase sign-in required
 *   POST /mcp                      MCP Streamable HTTP (stateless)
 *
 * Errors use {detail, code}, matching the existing API so the web client reads them unchanged.
 */
'use strict';
const http = require('node:http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createEngine, EngineError } = require('./engine');
const { createAuth, entitlement, createRateLimiter, createEvents } = require('./support');
const { createMcpServer } = require('./mcp');

const MAX_BODY = 32 * 1024;

function config(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    appUrl: env.PUBLIC_APP_URL || 'https://davapprove.com',
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
    freeReports: Number(env.FREE_REPORTS || 1),
    requirePayment: env.REPORTS_REQUIRE_PAYMENT === 'true',
    limits: {
      estimate: { limit: Number(env.ESTIMATES_PER_HOUR || 30), windowMs: 3600_000 },
      report: { limit: Number(env.REPORTS_PER_HOUR || 30), windowMs: 3600_000 },
      search: { limit: Number(env.SEARCHES_PER_MINUTE || 60), windowMs: 60_000 },
      mcp: { limit: Number(env.MCP_REQUESTS_PER_MINUTE || 60), windowMs: 60_000 },
    },
  };
}

class HttpError extends Error { constructor(status, code, message, headers) { super(message); this.status = status; this.code = code; this.headers = headers; } }

function createApp(options = {}) {
  const cfg = { ...config(options.env), ...(options.config || {}) };
  const engine = options.engine || createEngine();
  const events = options.events || createEvents();
  const auth = options.auth || createAuth({ supabaseUrl: cfg.supabaseUrl, publishableKey: cfg.publishableKey });
  const limiter = createRateLimiter();

  function clientKey(req) {
    const forwarded = cfg.trustProxy && req.headers['x-forwarded-for'];
    return (forwarded ? String(forwarded).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  }
  function limit(req, name) {
    const { limit: max, windowMs } = cfg.limits[name];
    const result = limiter.take(`${name}:${clientKey(req)}`, max, windowMs);
    if (!result.allowed) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.', { 'Retry-After': String(result.retryAfter) });
  }

  function cors(req, res, { open = false } = {}) {
    const origin = req.headers.origin;
    if (open) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && cfg.corsOrigins.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', open ? 'Content-Type,Authorization,Mcp-Session-Id,Mcp-Protocol-Version,Last-Event-ID' : 'Content-Type,Authorization');
    if (open) res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  }
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }
  async function readJson(req) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'json_required', 'Send JSON with Content-Type: application/json.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'body_too_large', 'Request body is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.'); }
  }
  function estimateInput(body) {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_request', 'Expected {county, parcel, project}.');
    return { county: String(body.county || ''), parcel: String(body.parcel || ''), project: body.project };
  }
  function audience(body) { return body && body.audience === 'homeowner' ? 'homeowner' : 'pro'; }

  async function handleMcp(req, res) {
    limit(req, 'mcp');
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless: use POST.' }, id: null }, { Allow: 'POST' });
    const body = await readJson(req);
    const toolLimit = (name) => {
      try { limit(req, name); return null; } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }], structuredContent: { status: 'error', code: 'rate_limited', message: error.message } }; }
    };
    const server = createMcpServer({ engine, events, appUrl: cfg.appUrl, limit: toolLimit });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://engine.local');
    const path = url.pathname;
    const isMcp = path === '/mcp';
    cors(req, res, { open: isMcp });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (isMcp) return handleMcp(req, res);

    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, counties: engine.counties.map((c) => c.id) });
    if (req.method === 'GET' && path === '/api/v1/engine/coverage') return send(res, 200, engine.coverage(), { 'Cache-Control': 'public, max-age=300' });
    if (req.method === 'GET' && path === '/api/v1/engine/search') {
      limit(req, 'search');
      const result = await engine.search(url.searchParams.get('q'));
      events.log({ event: 'search_run', source: 'web', status: result.hits.length ? 'match' : 'no_match' });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && path === '/api/v1/estimate') {
      limit(req, 'estimate');
      const body = await readJson(req);
      const input = estimateInput(body);
      try {
        const summary = await engine.estimate(input);
        events.log({ event: 'estimate_run', source: 'web', audience: audience(body), status: 'ok', ...events.fromSummary(summary, input.project) });
        return send(res, 200, summary);
      } catch (error) {
        events.log({ event: 'estimate_failed', source: 'web', audience: audience(body), status: error.code || 'engine_error', county: input.county || undefined, project_type: input.project && input.project.type });
        throw error;
      }
    }
    if (req.method === 'POST' && path === '/api/v1/reports') {
      limit(req, 'report');
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!auth.configured) throw new HttpError(503, 'auth_unavailable', 'Sign-in is not configured on this server.');
      const user = token ? await auth.verify(token) : null;
      if (!user) throw new HttpError(401, 'sign_in_required', 'Sign in to open the full report.', { 'WWW-Authenticate': 'Bearer' });
      const body = await readJson(req);
      const input = estimateInput(body);
      const used = await auth.ownedReports(token, user.id);
      const access = entitlement(used, { freeReports: cfg.freeReports, requirePayment: cfg.requirePayment });
      if (!access.allowed) {
        events.log({ event: 'paywall_blocked', source: 'web', audience: audience(body), user_id: user.id, county: input.county, project_type: input.project && input.project.type });
        throw new HttpError(402, 'payment_required', 'You have used your free report. Choose a plan to open more.');
      }
      const report = await engine.report(input);
      events.log({ event: 'report_served', source: 'web', audience: audience(body), user_id: user.id, status: access.would_require_payment ? 'beta_would_require_payment' : 'free', ...events.fromSummary({ ...report.summary, county: input.county }, input.project) });
      return send(res, 200, { ...report, entitlement: access });
    }
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  return async function handler(req, res) {
    const started = Date.now();
    try {
      await route(req, res);
    } catch (error) {
      const known = error instanceof HttpError || error instanceof EngineError;
      if (!known) process.stderr.write(JSON.stringify({ type: 'error', at: new Date().toISOString(), path: req.url.split('?')[0], message: String(error && error.message) }) + '\n');
      if (!res.headersSent) send(res, known ? error.status : 500, { detail: known ? error.message : 'The engine could not complete this request. Retry shortly.', code: known ? error.code : 'engine_error' }, (error && error.headers) || {});
      else res.end();
    } finally {
      if (options.accessLog !== false) process.stdout.write(JSON.stringify({ type: 'request', at: new Date().toISOString(), method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Date.now() - started }) + '\n');
    }
  };
}

if (require.main === module) {
  const cfg = config();
  const server = http.createServer(createApp());
  server.requestTimeout = 120_000;
  server.listen(cfg.port, cfg.host, () => process.stdout.write(JSON.stringify({ type: 'start', port: cfg.port }) + '\n'));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { createApp, config, HttpError };
