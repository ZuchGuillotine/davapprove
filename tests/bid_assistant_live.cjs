/*
 * Live smoke test: screens real Kitsap parcels against the public map services.
 * Needs network, so it is not part of the default checks. Run: node tests/bid_assistant_live.cjs
 * It checks that the services still answer and still have the fields the pack reads.
 * Parcel attributes change over time, so assertions are deliberately loose.
 */
const assert = require('node:assert');
const path = require('node:path');
const B = path.join(__dirname, '../bid-assistant');
const Geo = require(B + '/lib/geo.js'), Screen = require(B + '/lib/screen.js'), Engine = require(B + '/lib/engine.js');
const DATA = require(B + '/data/data.js'), pack = require(B + '/packs/wa-kitsap.js');
const RS = { federal: require(B + '/rules/federal.js'), 'wa-state': require(B + '/rules/wa-state.js'), 'wa-kitsap': require(B + '/rules/wa-kitsap.js') };

(async () => {
  const hits = await pack.search('614 DIVISION ST');
  assert(hits.length >= 1 && /PORT ORCHARD/.test(hits[0].label), 'address search');
  for (const ex of pack.examples) {
    const parcel = await pack.parcelById(ex.parcel_key);
    assert(parcel && parcel.area_sqft > 1000, 'parcel ' + ex.parcel_key);
    const s = await Screen.screenParcel(pack, parcel, {});
    const unknown = Object.values(s.layers).filter((l) => l.status === 'unknown').map((l) => l.id + ': ' + l.error);
    const facts = pack.deriveFacts(s);
    const grid = Geo.gridAnalyze(parcel.shape, RS['wa-kitsap'].constraints(s, facts, DATA), { targetSamples: 2000 });
    const rep = Engine.evaluate({ facts, project: { type: ex.type }, grid, rules: pack.rule_sets.flatMap((id) => RS[id].rules), data: DATA });
    assert(rep.agencies.length >= 3 && rep.costs.totals.base.high > 0);
    console.log(ex.label.padEnd(36), Object.keys(s.layers).length + ' layers,', unknown.length + ' unreadable,', rep.agencies.length + ' parties, base $' + Math.round(rep.costs.totals.base.low) + ' to $' + Math.round(rep.costs.totals.base.high) + ',', Math.round(grid.totals.core.pct + grid.totals.buffer.pct) + '% constrained');
    if (unknown.length) console.log('   could not read: ' + unknown.join(' | '));
  }
  console.log('PASS: live screening of ' + pack.examples.length + ' example parcels.');
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
