'use strict';
/* Engine core: same numbers as the shared summary, clean errors, screening cache. No network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createEngine } = require('../src/engine');
const { fakeDeps, PARCEL_KEY, ADDRESS } = require('./fixtures');
const Quick = require(path.join(__dirname, '../../bid-assistant/lib/quick.js'));

const project = { type: 'new_sfr', wastewater: 'septic_new', water: 'well_new', scope_items: ['solar', 'solar', 'made_up'] };

test('estimate is the shared summary for the parcel and project', async () => {
  const engine = createEngine(fakeDeps({ outage: 'flood' }));
  const s = await engine.estimate({ county: 'wa-kitsap', parcel: PARCEL_KEY, project });
  assert.equal(s.county, 'wa-kitsap');
  assert.equal(s.parcel.label, ADDRESS);
  assert(s.estimate.high > 0 && s.estimate.high >= s.estimate.low);
  assert.equal(s.coverage.complete, false, 'an unread layer is never a clean result');
  assert.deepEqual(s.unassessed_scope.map((x) => x.id), ['solar']);
  assert(!/excerpt|citation|https?:\/\//i.test(JSON.stringify(s)), 'basic estimate carries no granular report content');
});

test('rejects bad input with specific errors', async () => {
  const engine = createEngine(fakeDeps({ down: ['wa-skagit'] }));
  const cases = [
    [{ county: 'wa-pierce', parcel: '1', project: { type: 'adu' } }, 422, 'unsupported_county'],
    [{ county: 'wa-kitsap', parcel: '1', project: { type: 'castle' } }, 400, 'invalid_project_type'],
    [{ county: 'wa-kitsap', parcel: '1', project: null }, 400, 'invalid_project'],
    [{ county: 'wa-kitsap', parcel: '1', project: { type: 'adu', scope_items: 'solar' } }, 400, 'invalid_scope_items'],
    [{ county: 'wa-kitsap', parcel: '', project: { type: 'adu' } }, 400, 'invalid_parcel'],
    [{ county: 'wa-kitsap', parcel: 'ABC', project: { type: 'adu' } }, 400, 'invalid_parcel'],
    [{ county: 'wa-kitsap', parcel: '999', project: { type: 'adu' } }, 404, 'parcel_not_found'],
    [{ county: 'wa-skagit', parcel: '1', project: { type: 'adu' } }, 503, 'county_unavailable'],
  ];
  for (const [input, status, code] of cases) {
    await assert.rejects(engine.estimate(input), (e) => e.status === status && e.code === code, `${code}`);
  }
});

test('screening is cached per parcel, but not when a layer was unread', async () => {
  const clean = fakeDeps();
  const engine = createEngine(clean);
  await engine.estimate({ county: 'wa-kitsap', parcel: PARCEL_KEY, project: { type: 'adu' } });
  await engine.estimate({ county: 'wa-kitsap', parcel: PARCEL_KEY, project: { type: 'new_sfr' } });
  assert.equal(clean.calls.screens, 1, 'a second project on the same parcel reuses the screen');

  const partial = fakeDeps({ outage: 'flood' });
  const retrying = createEngine(partial);
  await retrying.estimate({ county: 'wa-kitsap', parcel: PARCEL_KEY, project: { type: 'adu' } });
  await retrying.estimate({ county: 'wa-kitsap', parcel: PARCEL_KEY, project: { type: 'adu' } });
  assert.equal(partial.calls.screens, 2, 'an incomplete screen is retried');
});

test('search spans counties, reports a county that failed, and never turns total failure into no match', async () => {
  const engine = createEngine(fakeDeps({ down: ['wa-king'], hits: { 'wa-kitsap': [{ label: ADDRESS, sublabel: 'Tax account TEST', parcel_key: 123456 }] } }));
  const result = await engine.search('1 synthetic');
  assert.deepEqual(result.hits, [{ label: ADDRESS, sublabel: 'Tax account TEST', parcel_key: '123456', county: 'wa-kitsap', county_name: 'Kitsap County, WA' }]);
  assert.deepEqual(result.failed_counties, ['wa-king']);
  await assert.rejects(engine.search('ab'), (e) => e.code === 'query_too_short');
  const dark = createEngine(fakeDeps({ down: ['wa-kitsap', 'wa-king', 'wa-skagit'] }));
  await assert.rejects(dark.search('1 synthetic'), (e) => e.status === 503 && e.code === 'search_unavailable');
});

test('full report has findings, sourced costs and only the citations it uses', async () => {
  const engine = createEngine(fakeDeps());
  const r = await engine.report({ county: 'wa-kitsap', parcel: PARCEL_KEY, project });
  assert(r.findings.length > 0 && r.agencies.length > 0);
  const used = new Set(r.findings.flatMap((f) => f.citations).concat(r.independent_checks.flatMap((c) => c.citations)));
  assert.deepEqual(Object.keys(r.citations).sort(), [...used].filter((id) => r.citations[id]).sort());
  for (const item of r.costs.items) {
    if (item.unpriced) assert.equal(item.low, null, `${item.fee} is quote-needed, not $0`);
    if (item.basis === 'published') assert(item.source && item.source.url, `${item.fee} published fee has a source`);
  }
  assert.deepEqual(r.summary.estimate, { low: r.costs.totals.base.low, high: r.costs.totals.base.high });
  assert(!/owner|taxpayer/i.test(JSON.stringify(Object.keys(r.parcel))), 'no owner fields');
  assert(r.map_layers.every((l) => ['none', 'on_parcel', 'nearby', 'unknown', 'partial'].includes(l.status)));
});

test('coverage lists the supported counties and the scope catalog', () => {
  const c = createEngine(fakeDeps()).coverage();
  assert.deepEqual(c.counties.map((x) => x.id), ['wa-kitsap', 'wa-king', 'wa-skagit']);
  assert.equal(c.scope_items.solar, Quick.SCOPE_ITEMS.solar.label);
  assert.equal(c.project_type_defaults.adu.new_sqft, 800);
});
