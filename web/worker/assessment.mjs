import Geo from '../../bid-assistant/lib/geo.js';
import Screen from '../../bid-assistant/lib/screen.js';
import Engine from '../../bid-assistant/lib/engine.js';
import Quick from '../../bid-assistant/lib/quick.js';
import base from '../../bid-assistant/data/data.js';
import manifest from '../../bid-assistant/data/regions.js';
import Regions from '../../bid-assistant/lib/regions.js';
import kitsap from '../../bid-assistant/packs/wa-kitsap.js';
import Regional from '../../bid-assistant/packs/wa-regional.js';
import federalRules from '../../bid-assistant/rules/federal.js';
import stateRules from '../../bid-assistant/rules/wa-state.js';
import kitsapRules from '../../bid-assistant/rules/wa-kitsap.js';
import regionalRules from '../../bid-assistant/rules/wa-regional.js';
import supplements from './packs.generated.mjs';
import census from './counties.json' with { type: 'json' };

const rulesets = { federal: federalRules, 'wa-state': stateRules, 'wa-kitsap': kitsapRules, 'wa-regional': regionalRules };
const countyCodes = { 'wa-kitsap': '53035', 'wa-king': '53033', 'wa-skagit': '53057' };
const byCode = new Map(Object.entries(countyCodes).map(([id, code]) => [code, id]));
const available = base.meta.jurisdictions.filter(county => county.available);
const packsByPath = new Map(supplements.map(pack => [manifest.regions[pack.region.id].url, pack]));
const loader = Regions.create(base, manifest, async path => ({
  ok: packsByPath.has(path),
  json: async () => packsByPath.get(path),
}));

export class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const countyOptions = Object.entries(census).map(([code, [state, name]]) => ({ code, state, name }));

async function context(id) {
  if (!Object.hasOwn(countyCodes, id)) throw new ClientError('Select a supported county.');
  const data = await loader.load(id);
  const pack = id === kitsap.id ? kitsap : Regional.create(data.region);
  return { pack, data, rulesets, Geo, Screen, Engine };
}

const thresholdSources = ['kitsap-guidance-stormwater', 'kitsap-guidance-sdap', 'kitsap-guidance-grading'];

const displayData = data => ({
  meta: data.meta,
  guidance: data.region ? {} : Object.fromEntries(thresholdSources.map(id => {
    const { key_values, url, related_url, citation, fetched } = data.citations[id];
    return [id, { key_values, url, related_url, citation, fetched }];
  })),
  region: data.region && {
    checked: data.region.checked,
    valid_through: data.region.valid_through,
    coverage_note: data.region.coverage_note,
  },
});

export async function metadata() {
  const counties = await Promise.all(available.map(async county => {
    const { pack, data } = await context(county.id);
    const { id, center, zoom, examples } = pack;
    return { id, name: county.name, code: countyCodes[id], center, zoom, examples, data: displayData(data) };
  }));
  return { counties, scopeItems: Quick.SCOPE_ITEMS, projectTypes: Engine.PROJECT_TYPES };
}

export async function search({ query, county }) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 150)
    throw new ClientError('Enter a street address or parcel number.');
  if (county && !Object.hasOwn(countyCodes, county)) throw new ClientError('Select a supported county.');
  const requested = county ? available.filter(row => row.id === county) : available;
  const settled = await Promise.allSettled(requested.map(async row => {
    const { pack } = await context(row.id);
    const rows = await pack.search(query.trim());
    return {
      truncated: !!rows.truncated,
      hits: rows.slice(0, 6).map(hit => ({
        label: hit.label, sublabel: hit.sublabel, parcel_key: String(hit.parcel_key),
        county: row.id, countyName: row.name,
      })),
    };
  }));
  const failed = requested.filter((_, index) => settled[index].status === 'rejected').map(row => row.name);
  const results = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (!results.length) throw new ClientError('Parcel search is unavailable right now. Retry in a moment.', 503);
  return { hits: results.flatMap(row => row.hits).slice(0, 10), failed, truncated: results.some(row => row.truncated) };
}

function checkProject(input) {
  if (!input || !Object.hasOwn(Engine.PROJECT_TYPES, input.type)) throw new ClientError('Select a project type.');
  return { ...Engine.normaliseProject(input), scope_items: Quick.scopeItems(input.scope_items) };
}

function coordinates(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

function restoreScreening(saved, deps) {
  const { parcel: input, screening } = saved;
  if (!input?.geometry?.rings?.length || !screening?.layers || !screening?.tables ||
      screening.pack_id !== deps.pack.id || !Number.isFinite(Date.parse(screening.screened_at)))
    throw new ClientError('The saved map snapshot is incomplete. Refresh maps to start again.');
  const { parcel_key, rp_acct_id, account_no, situs } = input;
  const parcel = Screen.buildParcel([{ geometry: input.geometry }], { parcel_key, rp_acct_id, account_no, situs });
  return { parcel, screening: { ...screening, parcel } };
}

function reportView(result, deps) {
  const { data } = deps;
  const { parcel, screening, facts, constraints, grid, report } = result;
  const validStatuses = ['on_parcel', 'nearby', 'none', 'unknown', 'found'];
  const layers = Object.fromEntries(Object.entries(screening.layers).map(([id, row]) => {
    const layer = deps.pack.layers.find(entry => entry.id === id);
    if (!layer) return null;
    const { label, publisher, caveat, style } = layer;
    return [id, { ...row, layer: { label, publisher, caveat, style }, search_ft: Number(row.search_ft) || 0,
      status: validStatuses.includes(row.status) ? row.status : 'unknown' }];
  }).filter(Boolean));
  const tables = Object.fromEntries(Object.entries(screening.tables).map(([id, row]) => {
    const table = deps.pack.tables.find(entry => entry.id === id);
    return table ? [id, { ...row, table: { label: table.label }, status: validStatuses.includes(row.status) ? row.status : 'unknown' }] : null;
  }).filter(Boolean));
  const cited = new Set([...report.findings, ...report.independent_checks].flatMap(item => item.citations));
  return {
    parcel, screening: { ...screening, parcel: undefined, layers, tables }, facts, grid, report,
    constraints: constraints.map(({ id, short, label, citation, tier, basis }) => ({ id, short, label, citation, tier, basis })),
    data: { ...displayData(data),
      routing: { checked: data.routing.checked, tribal_contact_limit: data.routing.tribal_contact_limit },
      citations: Object.fromEntries([...cited].map(id => {
        const { key_values, ...citation } = data.citations[id];
        return [id, citation];
      })),
    },
  };
}

export function coverageRequest(code) {
  if (typeof code !== 'string' || !Object.hasOwn(census, code)) throw new ClientError('Select a US county or county equivalent.');
  const [state, county] = census[code];
  return { state, county, supported: byCode.has(code) };
}

export async function assess(input, { source, detailed, record }) {
  const { county, county_code: code, parcel, point, snapshot, track = true } = input;
  const area = coverageRequest(code || countyCodes[county]);
  if (!area.supported) {
    await record(area, true);
    return { ...area, coverage: 'unsupported' };
  }
  const deps = await context(code ? byCode.get(code) : county);
  if (code && !input.project && source === 'web') return area;
  const project = checkProject(input.project);
  const event = { ...area, source, project_type: project.type, upgrades: project.scope_items };
  async function trackEvent(coverage) {
    if (track !== false && !snapshot) await record({ ...event, coverage });
  }
  let result;
  if (detailed && snapshot) {
    const saved = restoreScreening(snapshot, deps);
    result = Quick.evaluate(deps, saved.parcel, project, saved.screening);
  } else {
    if (!(detailed && coordinates(point)) && (typeof parcel !== 'string' || !/^[a-z0-9 .-]{3,50}$/i.test(parcel)))
      throw new ClientError('Select a parcel.');
    try {
      const found = coordinates(point) && detailed ? await deps.pack.parcelAtPoint(...point) : await deps.pack.parcelById(parcel);
      if (!found) throw new ClientError('That parcel could not be found in county records.', 404);
      result = await Quick.analyze(deps, found, project);
    } catch (error) {
      await trackEvent('unavailable');
      if (error instanceof ClientError) throw error;
      throw new ClientError('County map screening could not be completed. Retry in a moment.', 503);
    }
  }
  const summary = Quick.summarize(result, project, deps.data);
  const coverage = summary.coverage.complete ? 'complete' : 'partial';
  await trackEvent(coverage);
  if (!detailed) return summary;
  const view = reportView(result, deps);
  return { ...view, summary, coverage, unassessed_scope: summary.unassessed_scope };
}
