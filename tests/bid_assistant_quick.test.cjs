/*
 * Quick estimate summary. No network: map responses are synthetic.
 * Checks that the ungated summary comes from the same engine result as the full report,
 * keeps quote-needed items and failed map layers visible, and carries no line items.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const B = path.join(__dirname, '../bid-assistant');
const Geo = require(B + '/lib/geo.js');
const Screen = require(B + '/lib/screen.js');
const Engine = require(B + '/lib/engine.js');
const Quick = require(B + '/lib/quick.js');
const DATA = require(B + '/data/data.js');
const pack = require(B + '/packs/wa-kitsap.js');
const rulesets = {
  federal: require(B + '/rules/federal.js'),
  'wa-state': require(B + '/rules/wa-state.js'),
  'wa-kitsap': require(B + '/rules/wa-kitsap.js')
};

const parcel = Screen.buildParcel([{ geometry: { rings: [[[-122.65, 47.6], [-122.649, 47.6], [-122.649, 47.601], [-122.65, 47.601], [-122.65, 47.6]]] } }], { parcel_key: '123456', rp_acct_id: 123456 });
function fakeScreen(options) {
  return {
    screenParcel: async () => {
      const layers = Object.fromEntries(pack.layers.map(l => [l.id, { id: l.id, layer: l, kind: l.kind, status: 'none', features: [], classes: {}, near_classes: [], values: [] }]));
      layers.zoning = { ...layers.zoning, status: 'on_parcel', features: [{ attrs: { ZONEBREV: 'RR', ZONE_DESCRIPTION: 'Rural Residential' } }] };
      if (options.floodOutage) layers.flood = { ...layers.flood, status: 'unknown', error: 'Synthetic outage' };
      const tables = Object.fromEntries(pack.tables.map(t => [t.id, { id: t.id, table: t, status: 'none', rows: [] }]));
      tables.land = { ...tables.land, status: 'found', rows: [{ ACRES: 2, TOT_IMPROV: 0, NUM_DWELL: 0 }] };
      tables.address = { ...tables.address, status: 'found', rows: [{ SITUS_ADDR: '1 SYNTHETIC RD', ACCT_NO: 'TEST-123' }] };
      return { pack_id: pack.id, parcel, layers, tables, screened_at: '2026-11-23T00:00:00Z' };
    }
  };
}

(async () => {
  const project = { type: 'new_sfr', new_sqft: 2400, wastewater: 'septic_new', water: 'well_new', scope_items: ['solar', 'heat_pump', 'solar', 'unknown_item'] };
  const deps = { pack, data: DATA, rulesets, Screen: fakeScreen({ floodOutage: true }), Geo, Engine };
  const result = await Quick.analyze(deps, parcel, project);
  const s = Quick.summarize(result, project, DATA);
  const t = result.report.costs.totals;

  // Same numbers as the full report.
  assert.deepEqual(s.estimate, { low: t.base.low, high: t.base.high });
  assert(s.estimate.high > 0 && s.estimate.high >= s.estimate.low, 'a new house with septic and a well has priced allowances');
  assert.equal(s.quotes_needed, t.unpriced.length);
  assert.equal(s.agencies.firm + s.agencies.possible, result.report.agencies.filter(a => a.tier !== 'professional').length);

  // A failed layer is never a clean result.
  assert.equal(s.coverage.complete, false);
  assert(s.coverage.unread_layers.length >= 1);

  // Captured scope is deduplicated, filtered to known items and reported as unpriced.
  assert.deepEqual(s.unassessed_scope.map(x => x.id), ['solar', 'heat_pump']);

  // The ungated summary carries no line items, excerpts or citations.
  const text = JSON.stringify(s);
  assert(!/citation|excerpt|"fee"|https?:\/\//i.test(text), 'summary must not include granular report content');
  assert.equal(s.parcel.jurisdiction, 'Unincorporated Kitsap County');

  // With every layer read, an unincorporated parcel can report complete coverage.
  const clean = Quick.summarize(await Quick.analyze({ ...deps, Screen: fakeScreen({}) }, parcel, project), project, DATA);
  assert.equal(clean.coverage.complete, true);
  assert.deepEqual(clean.coverage.unread_layers, []);

  // Tribal or federal land reported by the user keeps coverage open.
  assert.equal(Quick.incomplete(result.facts, { layers: {} }, { land_status: 'tribal' }), true);

  console.log('PASS: quick estimate summary (same totals, open coverage, unpriced scope, no granular content).');
})().catch(e => { console.error(e); process.exitCode = 1; });
