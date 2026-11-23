/*
 * Auth, entitlement, rate limiting and event logging for the engine service.
 * No owner names, addresses, parcel keys, search text, emails or IP addresses are logged.
 */
'use strict';

/* ---------------------------------------------------------------- Supabase auth */

/**
 * Verifies a Supabase access token by asking Supabase Auth who it belongs to. No JWT secret
 * lives in this service. Successful lookups are cached briefly.
 */
function createAuth({ supabaseUrl, publishableKey, fetchImpl = fetch, ttlMs = 60_000, now = Date.now }) {
  const cache = new Map();
  async function verify(token) {
    if (!supabaseUrl || !publishableKey) return null;
    if (!token || token.length > 4096) return null;
    const hit = cache.get(token);
    if (hit && now() - hit.at < ttlMs) return hit.user;
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !body.id) return null;
    const user = { id: body.id };
    cache.set(token, { at: now(), user });
    if (cache.size > 1000) cache.delete(cache.keys().next().value);
    return user;
  }

  /**
   * Full reports this account owns (saved bids), read with the user's own token so row-level
   * security applies. Shared bids do not count. Replace with the entitlement table when it lands.
   */
  async function ownedReports(token, userId) {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/bids?select=id&owner_id=eq.${encodeURIComponent(userId)}`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Prefer: 'count=exact', Range: '0-0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 416) throw new Error(`Report count unavailable (${response.status})`);
    const range = response.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  }

  return { verify, ownedReports, configured: !!(supabaseUrl && publishableKey) };
}

/**
 * Beta policy: the first report is free; later reports would need payment. While
 * requirePayment is false (the beta), every report is served and the response says whether
 * it would have needed payment, so the pricing prompt and metrics stay honest.
 */
function entitlement(used, { freeReports = 1, requirePayment = false } = {}) {
  const wouldRequirePayment = used >= freeReports;
  return { used, free_reports: freeReports, would_require_payment: wouldRequirePayment, allowed: !(requirePayment && wouldRequirePayment), beta: !requirePayment };
}

/* ---------------------------------------------------------------- rate limiting */

/** Fixed-window counters per key. In-memory: one engine container; use Redis if scaled out. */
function createRateLimiter({ now = Date.now } = {}) {
  const windows = new Map();
  function take(key, limit, windowMs) {
    const t = now();
    let w = windows.get(key);
    if (!w || t - w.start >= windowMs) { w = { start: t, count: 0 }; windows.set(key, w); }
    w.count++;
    if (windows.size > 20_000) for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
    return { allowed: w.count <= limit, retryAfter: Math.ceil((w.start + windowMs - t) / 1000) };
  }
  return { take };
}

/* ---------------------------------------------------------------- events */

const EVENT_FIELDS = ['event', 'source', 'audience', 'user_id', 'session_id', 'state', 'county', 'jurisdiction', 'project_type', 'scope_items', 'coverage_complete', 'quotes_needed', 'status', 'detail'];

/**
 * Structured events for beta metrics and county-expansion demand. Default sink: one JSON line
 * on stdout (docker logs). Swap the sink for the events table without touching call sites.
 */
function createEvents({ sink = (line) => process.stdout.write(line + '\n'), now = () => new Date().toISOString() } = {}) {
  function log(fields) {
    const entry = { at: now() };
    for (const key of EVENT_FIELDS) if (fields[key] !== undefined && fields[key] !== null) entry[key] = fields[key];
    try { sink(JSON.stringify({ type: 'event', ...entry })); } catch { /* logging never breaks a request */ }
  }
  /** Fields from a summary that are safe to log: no parcel key, address or owner data. */
  function fromSummary(summary, project) {
    const j = summary.parcel.jurisdiction || '';
    return {
      state: 'WA',
      county: summary.county,
      jurisdiction: j.startsWith('City of ') ? j : j.startsWith('Unincorporated') ? 'unincorporated' : 'unconfirmed',
      project_type: project.type,
      scope_items: (summary.unassessed_scope || []).map((s) => s.id),
      coverage_complete: summary.coverage.complete,
      quotes_needed: summary.quotes_needed,
    };
  }
  return { log, fromSummary };
}

module.exports = { createAuth, entitlement, createRateLimiter, createEvents, EVENT_FIELDS };
