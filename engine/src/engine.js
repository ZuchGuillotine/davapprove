/*
 * Server-side screening engine. Loads ../bid-assistant unchanged (the same modules the web
 * workspace and CLI use), so every figure still traces to data/fees.json and citations.json.
 *
 *   search(query)                   parcel suggestions across supported counties
 *   estimate({county, parcel, project})  basic summary (BidQuick.summarize): open, no line items
 *   report({county, parcel, project})    full findings, costs, agencies and citations: signed-in only
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const BID = process.env.BID_ASSISTANT_DIR || path.join(__dirname, '../../bid-assistant');
const load = (file) => require(path.join(BID, file));

const SCREEN_TTL_MS = Number(process.env.SCREEN_CACHE_TTL_MS || 60 * 60 * 1000);
const SCREEN_CACHE_MAX = Number(process.env.SCREEN_CACHE_MAX || 200);
const MAX_CONCURRENT_SCREENS = Number(process.env.MAX_CONCURRENT_SCREENS || 4);

class EngineError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** A small FIFO-limited semaphore so a burst of estimates cannot flood county map servers. */
function limiter(max) {
  let active = 0;
  const waiting = [];
  return async function run(task) {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try { return await task(); } finally { active--; const next = waiting.shift(); if (next) next(); }
  };
}

/**
 * deps (optional, for tests): { Screen } replacing the map screening, { preparePack(pack) } to
 * stub a pack's county lookups, { now } for the clock.
 */
function createEngine(deps = {}) {
  const Geo = load('lib/geo.js');
  const Screen = deps.Screen || load('lib/screen.js');
  const Engine = load('lib/engine.js');
  const Quick = load('lib/quick.js');
  const BASE = load('data/data.js');
  const regionManifest = load('data/regions.js');
  const RegionalPack = load('packs/wa-regional.js');
  const packs = { 'wa-kitsap': load('packs/wa-kitsap.js') };
  const rulesets = {
    federal: load('rules/federal.js'),
    'wa-state': load('rules/wa-state.js'),
    'wa-kitsap': load('rules/wa-kitsap.js'),
    'wa-regional': load('rules/wa-regional.js'),
  };
  const regions = load('lib/regions.js').create(BASE, regionManifest, async (url) => ({
    ok: true,
    json: async () => JSON.parse(await fs.readFile(path.join(BID, url), 'utf8')),
  }));
  const now = deps.now || Date.now;
  const counties = BASE.meta.jurisdictions.filter((j) => j.available).map((j) => ({ id: j.id, name: j.name }));
  const contexts = new Map();
  const screens = new Map();
  const throttle = limiter(MAX_CONCURRENT_SCREENS);

  function context(id) {
    if (!counties.some((c) => c.id === id)) throw new EngineError(422, 'unsupported_county', `Unsupported county "${id}". Supported: ${counties.map((c) => c.id).join(', ')}.`);
    if (!contexts.has(id)) {
      contexts.set(id, regions.load(id).then((data) => {
        const pack = id === 'wa-kitsap' ? packs['wa-kitsap'] : RegionalPack.create(data.region);
        return { data, pack: deps.preparePack ? deps.preparePack(pack) : pack };
      }).catch((error) => { contexts.delete(id); throw error; }));
    }
    return contexts.get(id);
  }

  /** Screening depends only on the parcel, so it is cached; project-specific steps always rerun. */
  function cachedScreen(pack, parcel, options) {
    const key = `${pack.id}:${parcel.parcel_key}`;
    const hit = screens.get(key);
    if (hit && now() - hit.at < SCREEN_TTL_MS) return hit.promise;
    const promise = throttle(() => Screen.screenParcel(pack, parcel, options || {}));
    screens.set(key, { at: now(), promise });
    promise.catch(() => screens.delete(key));
    // A screen with an unread layer is not reused: a retry may read it.
    promise.then((s) => { if (Object.values(s.layers || {}).some((l) => l.status === 'unknown' || l.truncated)) screens.delete(key); }, () => {});
    if (screens.size > SCREEN_CACHE_MAX) screens.delete(screens.keys().next().value);
    return promise;
  }

  async function search(query) {
    const q = String(query || '').trim();
    if (q.length < 3) throw new EngineError(400, 'query_too_short', 'Enter at least 3 characters of an address or parcel number.');
    if (q.length > 120) throw new EngineError(400, 'query_too_long', 'Search text is too long.');
    const settled = await Promise.allSettled(counties.map(async (county) => {
      const { pack } = await context(county.id);
      const hits = await pack.search(q);
      return { county, hits, truncated: !!hits.truncated };
    }));
    const failed = [];
    const hits = [];
    let truncated = false;
    settled.forEach((result, index) => {
      if (result.status === 'rejected') { failed.push(counties[index].id); return; }
      truncated = truncated || result.value.truncated;
      result.value.hits.slice(0, 6).forEach((h) => hits.push({ label: h.label, sublabel: h.sublabel || null, parcel_key: String(h.parcel_key), county: result.value.county.id, county_name: result.value.county.name }));
    });
    if (failed.length === counties.length) throw new EngineError(503, 'search_unavailable', 'County parcel search is unavailable right now. Retry shortly.');
    return { hits: hits.slice(0, 10), failed_counties: failed, truncated };
  }

  function checkProject(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new EngineError(400, 'invalid_project', 'project must be an object with a type.');
    if (!Engine.PROJECT_TYPES[project.type]) throw new EngineError(400, 'invalid_project_type', `Unknown project type. Use one of: ${Object.keys(Engine.PROJECT_TYPES).join(', ')}.`);
    if (project.scope_items != null && !Array.isArray(project.scope_items)) throw new EngineError(400, 'invalid_scope_items', 'scope_items must be an array.');
    // Only fields the engine understands survive; scope_items are filtered to the known catalog.
    const normal = Engine.normaliseProject(project);
    const scope = Quick.scopeItems(project.scope_items);
    if (scope.length) normal.scope_items = scope;
    return normal;
  }

  async function analyze({ county, parcel, project }) {
    const normal = checkProject(project);
    const key = String(parcel || '').trim();
    if (!key || key.length > 40) throw new EngineError(400, 'invalid_parcel', 'parcel must be a parcel key from search.');
    const { pack, data } = await context(county);
    let parcelRecord;
    try {
      parcelRecord = await pack.parcelById(key);
    } catch (error) {
      const message = String(error && error.message);
      if (/^Invalid (assessor account ID|parcel identifier)/.test(message)) throw new EngineError(400, 'invalid_parcel', 'That is not a parcel key for this county. Use a parcel_key from search.');
      if (/truncated|incomplete/i.test(message)) throw new EngineError(422, 'parcel_incomplete', 'The county returned an incomplete parcel boundary. Confirm the parcel with the assessor.');
      throw new EngineError(503, 'county_unavailable', `County parcel records are unavailable right now (${message.slice(0, 120)}). Retry shortly.`);
    }
    if (!parcelRecord) throw new EngineError(404, 'parcel_not_found', 'No tax parcel matched that key. It may be right-of-way, water or an untaxed tract.');
    const result = await Quick.analyze({ pack, data, rulesets, Screen: { screenParcel: cachedScreen }, Geo, Engine }, parcelRecord, normal);
    return { result, project: normal, data, pack };
  }

  async function estimate(input) {
    const { result, project, data } = await analyze(input);
    return { county: input.county, ...Quick.summarize(result, project, data) };
  }

  /** The full report: what the signed-in workspace shows, as data. No geometry or owner fields. */
  async function report(input) {
    const { result, project, data } = await analyze(input);
    const { report: r, facts, screening, grid } = result;
    const citationIds = new Set();
    r.findings.forEach((f) => f.citations.forEach((id) => citationIds.add(id)));
    (r.independent_checks || []).forEach((c) => (c.citations || []).forEach((id) => citationIds.add(id)));
    const citations = {};
    citationIds.forEach((id) => {
      const c = data.citations[id];
      if (c) citations[id] = { citation: c.citation, title: c.title || null, url: c.url, verified: !!c.verified, verified_against: c.verified_against || null, excerpt: c.excerpt || null, excerpt_kind: c.excerpt_kind || null, summary: c.summary || null, fetched: c.fetched || null, source_currency: c.source_currency || null };
    });
    const j = facts.jurisdiction || {};
    return {
      county: input.county,
      summary: Quick.summarize(result, project, data),
      project,
      parcel: { key: facts.parcel.key, account_no: facts.parcel.account_no || null, situs: facts.parcel.situs || null, area_sqft: facts.parcel.area_sqft, zone_code: facts.parcel.zone_code || null, zone_name: facts.parcel.zone_name || null, vacant: facts.parcel.vacant },
      jurisdiction: { label: Quick.jurisdictionLabel(facts), status: j.status, county: j.county || null, city: j.city || null, uga: j.uga || null, fire_district: j.fire_district || null },
      findings: r.findings.map((f) => ({ id: f.id, agency: f.agency, level: f.level, basis: f.basis || 'documented', title: f.title, why: f.why, confirm: f.confirm || null, authority_role: f.authority_role || null, research_date: f.research_date || null, citations: f.citations, costs: f.costs.filter(Boolean).map((c) => ({ fee: c.fee, label: c.label, low: c.unpriced ? null : c.low, high: c.unpriced ? null : c.high, unpriced: !!c.unpriced, bucket: c.bucket, note: c.note || null })) })),
      agencies: r.agencies.map((a) => ({ name: a.name, tier: a.tier, level: a.level, role: a.role || null, url: a.url || null, phone: a.phone || null, findings: a.findings })),
      costs: { items: r.costs.items.map((c) => ({ fee: c.fee, label: c.label, kind: c.kind, payee: c.payee || null, bucket: c.bucket, low: c.unpriced ? null : c.low, high: c.unpriced ? null : c.high, unpriced: !!c.unpriced, basis: c.basis || null, source: c.source ? { title: c.source.title || null, url: c.source.url || null, date: c.source.date || null, checked: c.source.checked || null } : null, note: c.note || null })), totals: { base: r.costs.totals.base, contingent: r.costs.totals.contingent, unpriced: r.costs.totals.unpriced } },
      independent_checks: (r.independent_checks || []).map((c) => ({ id: c.id, label: c.label, status: c.status, citations: c.citations || [] })),
      citations,
      map_layers: Object.values(screening.layers).map((l) => ({ id: l.id, label: (l.layer && l.layer.label) || l.id, publisher: (l.layer && l.layer.publisher) || null, status: l.truncated ? 'partial' : l.status, error: l.error || null })),
      constrained: { core_pct: grid.totals.core.pct, buffer_pct: grid.totals.buffer.pct, review_pct: grid.totals.review.pct, unresolved: Quick.incomplete(facts, screening, project) },
      sources: { reference_revision: data.meta.reference_revision || data.meta.research_date, research_date: data.meta.research_date, screened_at: screening.screened_at },
      limits: 'Screening for bids and early planning. Agencies decide; maps are approximate at lot scale. Not an approval, a determination, legal advice or a quote.',
    };
  }

  function coverage() {
    return {
      counties: counties.map((c) => ({ ...c, state: 'WA', tier: 'deep' })),
      project_types: Object.fromEntries(Object.entries(Engine.PROJECT_TYPES).map(([id, t]) => [id, t.label])),
      project_type_defaults: Engine.PROJECT_TYPES,
      scope_items: Object.fromEntries(Object.entries(Quick.SCOPE_ITEMS).map(([id, s]) => [id, s.label])),
      reference_revision: BASE.meta.reference_revision || BASE.meta.research_date,
    };
  }

  return { search, estimate, report, coverage, counties, projectTypes: Engine.PROJECT_TYPES, scopeItems: Quick.SCOPE_ITEMS };
}

module.exports = { createEngine, EngineError };
