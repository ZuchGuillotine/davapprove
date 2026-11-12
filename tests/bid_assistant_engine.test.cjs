/*
 * Rule engine and data checks for the bid assistant. No network: facts are synthetic.
 * These check behaviour and internal consistency. They do not validate law.
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const B = path.join(__dirname, '../bid-assistant');
const Engine = require(B + '/lib/engine.js');
const Report = require(B + '/lib/report.js');
const DATA = require(B + '/data/data.js');
const build = require(B + '/build.js');
const RULES = ['federal', 'wa-state', 'wa-kitsap'].flatMap((n) => require(B + '/rules/' + n + '.js').rules);
const K = require(B + '/rules/wa-kitsap.js');

// ---- data integrity -----------------------------------------------------------------------------
assert.equal(fs.readFileSync(B + '/data/data.js', 'utf8'), build.render(build.load()), 'data/data.js is out of date: run node bid-assistant/build.js');
const cites = Object.values(DATA.citations), fees = Object.values(DATA.fees);
assert(cites.length >= 100 && fees.length >= 50);
for (const c of cites) {
  assert(c.fetched, c.id + ' has no research date');
  if (c.verified) assert(c.excerpt && c.excerpt.split(/\s+/).length >= 10, c.id + ' verified without a real excerpt');
}
for (const f of fees) {
  if (f.basis === 'published') assert(f.source && f.source.url.startsWith('https://'), f.id + ' published fee without a source');
  if (f.basis === 'market' && f.confidence !== 'unsourced') assert(f.source && f.source.url, f.id + ' sourced market range without a source');
  if (f.confidence === 'unsourced') assert(/no published source/i.test(f.note), f.id + ' unsourced estimate must say so');
}
// spot values that the rules depend on, as recorded in the citation library
assert.deepStrictEqual(K._internals.wetlandBufferRange(DATA, 'moderate'), { min: 40, max: 225 });
assert.equal(K._internals.streamBuffer(DATA, 'F', false).ft, 200);
assert.equal(K._internals.streamBuffer(DATA, 'F', true).alt, 150);
assert.equal(K._internals.streamBuffer(DATA, 'Np', false).ft, 100);
assert.equal(K._internals.streamBuffer(DATA, 'S', false), null, 'Type S waters are governed by the shoreline program');
assert.deepStrictEqual(K._internals.shorelineBuffer(DATA, ['Shoreline Residential', 'Rural Conservancy']), { ft: 130, designation: 'Rural Conservancy' });

// ---- fixtures -----------------------------------------------------------------------------------
function facts(over) {
  const f = {
    parcel: { key: '1', account_no: '000000-0-000-0000', situs: '1 TEST RD', acres: 2, acres_gis: 2, area_sqft: 87120, zone_code: 'RR', zone_name: 'Rural Residential', zone_density: 'Rural Residential (1 DU/5 Ac)', split_zoned: false, dwellings: 0, improvements: 0, vacant: true, oldest_year_built: null, bedrooms: null, assessor_water: 'N', assessor_sewer: 'N' },
    jurisdiction: { status: 'on_parcel', county: 'Kitsap', city: null, uga: null, reservation: null, tribal_zoning: false, military: false, fire_district: 'South Kitsap Fire & Rescue', water_district: null, airport_overlay: null },
    sewer: { status: 'none', in_county_service_area: null, main_distance_ft: null, assessor_flag: 'N' },
    wetland: { status: 'none', on_parcel: false, min_distance_ft: null, bearing: null, count: 0 },
    stream: { status: 'none', streams: [], lakes: [], nearest: null, types: [] },
    shoreline: { status: 'none', in_jurisdiction: false, designations: [], upland_designations: [], marine: false, marine_distance_ft: null, waterfront: false, armoring: [], armoring_status: 'none', feeder_bluff: [], forage_fish: [], forage_fish_status: 'none', eelgrass: false },
    geohazard: { status: 'none', classes: [], high: false, moderate: false, near_classes: [], cell_ft: null },
    flood: { status: 'none', sfha_on_parcel: false, zones: [], coastal_high_hazard: false, floodway: false, bfe_ft: null, nearby: false },
    cara: { status: 'none', category_1: false, category_2: false, names: [] },
    permits: { status: 'none', items: [], lapsed: [], open: [], cancelled: [] }
  };
  for (const k of Object.keys(over || {})) Object.assign(f[k], over[k]);
  return f;
}
function grid(corePct, bufferPct, extra) {
  const clear = 100 - corePct - bufferPct;
  const g = { totals: { core: { pct: corePct, sqft: 871.2 * corePct }, buffer: { pct: bufferPct, sqft: 871.2 * bufferPct }, review: { pct: 0, sqft: 0 }, clear: { pct: clear, sqft: 871.2 * clear } }, constraints: extra || [], quadrants: {} };
  for (const q of ['NW', 'NE', 'SW', 'SE']) g.quadrants[q] = { share_of_parcel_pct: 25, constrained_pct: corePct + bufferPct, by: [] };
  return g;
}
const run = (f, project, g) => Engine.evaluate({ facts: f, project, grid: g || grid(0, 0), rules: RULES, data: DATA });
const has = (r, re) => r.findings.find((x) => re.test(x.title));
const cost = (r, id) => r.costs.items.find((c) => c.fee === id);
const agency = (r, id) => r.agencies.find((a) => a.id === id);

// ---- a clean rural lot: base permits only -------------------------------------------------------
let r = run(facts(), { type: 'new_sfr', new_sqft: 2000 });
assert(agency(r, 'kitsap-dcd').level === 'required' && agency(r, 'kphd').level === 'required' && agency(r, 'lni'));
assert.equal(agency(r, 'geotech'), undefined, 'no geotechnical finding without a mapped hazard');
assert.equal(agency(r, 'usace'), undefined, 'no federal permit on an upland lot with no wetland');
// published formula: 2,000 sq ft x $177.63 x 0.0224, plus 3%, plus $90 and $6.50
assert(Math.abs(cost(r, 'dcd-building-permit').low - 8293.05) < 0.02, 'building permit formula');
assert(Math.abs(cost(r, 'kitsap-impact-fees').low - 7801.34) < 0.02, 'impact fee formula');
assert(Math.abs(cost(r, 'lni-electrical').high - 196.30) < 0.01, 'electrical fee formula');
assert(has(r, /Building Site Application/) && cost(r, 'kphd-bsa').bucket === 'base', 'no sewer mapped means a new septic application');
assert(has(r, /Road approach/), 'vacant lot needs a road approach');
assert(has(r, /Stormwater site plan/) && !has(r, /^Site Development Activity Permit/), 'default house is under the SDAP thresholds');
assert(r.findings.every((f) => f.level !== 'unknown'));

// ---- thresholds read from the code library ------------------------------------------------------
r = run(facts(), { type: 'new_sfr', grading_cy: 150 });
assert(has(r, /^Site Development Activity Permit/) && cost(r, 'dcd-sdap-sfr'), '150 cu yd of grading triggers an SDAP');
r = run(facts(), { type: 'new_sfr', hard_surface_sqft: 10000 });
assert(/engineered/.test(has(r, /^Site Development Activity Permit/).title) && cost(r, 'pro-civil-sdap').bucket === 'base', '10,000 sq ft outside a UGA needs engineered plans');
r = run(facts({ jurisdiction: { uga: 'Silverdale UGA' } }), { type: 'new_sfr', hard_surface_sqft: 5000 });
assert(/engineered/.test(has(r, /^Site Development Activity Permit/).title), '5,000 sq ft inside a UGA needs engineered plans');
r = run(facts(), { type: 'clearing', disturbance_sqft: 43560 });
assert(has(r, /Construction Stormwater General Permit/), 'one acre of disturbance');
assert.equal(has(run(facts(), { type: 'clearing', disturbance_sqft: 43000 }), /Construction Stormwater General Permit/), undefined);

// ---- geologic hazard ----------------------------------------------------------------------------
r = run(facts({ geohazard: { status: 'on_parcel', classes: ['High', 'Moderate'], high: true, moderate: true } }), { type: 'new_sfr' }, grid(30, 0, [{ id: 'geo_high', pct: 30 }, { id: 'geo_moderate', pct: 50 }]));
assert.equal(has(r, /Geotechnical report/).level, 'required');
assert.equal(cost(r, 'pro-geotech-report').bucket, 'base');
assert(Report.flags(r, facts(), grid(30, 0)).some((f) => /geotechnical report/.test(f.text) && /\$2,500 to \$6,000/.test(f.text)), 'geotech cost reaches the meeting flags');
r = run(facts({ geohazard: { status: 'on_parcel', classes: ['Moderate'], moderate: true } }), { type: 'new_sfr' });
assert.equal(cost(r, 'pro-geo-assessment').bucket, 'base');
assert.equal(cost(r, 'pro-geotech-report').bucket, 'contingent', 'full report is a contingency on moderate hazard');
r = run(facts({ geohazard: { status: 'nearby', near_classes: ['High'] } }), { type: 'new_sfr' });
assert.equal(has(r, /Geological letter/).level, 'likely');

// ---- wetlands and streams -----------------------------------------------------------------------
r = run(facts({ wetland: { status: 'on_parcel', on_parcel: true, min_distance_ft: 0, bearing: 'east', count: 1 } }), { type: 'new_sfr' }, grid(10, 20));
assert.equal(has(r, /Wetland delineation/).level, 'required');
assert.equal(has(r, /Wetland mitigation report/).level, 'possible', 'room on the lot: mitigation is a contingency');
r = run(facts({ wetland: { status: 'on_parcel', on_parcel: true, min_distance_ft: 0, bearing: 'east', count: 1 } }), { type: 'new_sfr' }, grid(40, 50));
assert.equal(has(r, /Wetland mitigation report/).level, 'likely', 'tight lot: mitigation moves into the base estimate');
assert.equal(cost(r, 'dcd-buffer-reduction').bucket, 'base');
assert(has(r, /Corps permit if any wetland is filled/));
r = run(facts({ wetland: { status: 'nearby', min_distance_ft: 180, bearing: 'north', count: 1 } }), { type: 'new_sfr' });
assert.equal(has(r, /Wetland delineation/).level, 'likely', 'off-site wetland within the largest buffer');
r = run(facts({ wetland: { status: 'nearby', min_distance_ft: 290, bearing: 'north', count: 1 } }), { type: 'new_sfr' });
assert.equal(has(r, /Wetland delineation/).level, 'possible', 'beyond the largest buffer but inside the 300 ft inventory distance');
const F = { type: 'F', distance_ft: 120, on_parcel: false, bearing: 'west' };
r = run(facts({ stream: { status: 'nearby', streams: [F], types: ['F'] } }), { type: 'new_sfr' });
assert(/200 ft plus 15 ft/.test(has(r, /Buffer for a Type F/).title));
assert.equal(has(run(facts({ stream: { status: 'nearby', streams: [{ ...F, distance_ft: 230 }], types: ['F'] } }), { type: 'new_sfr' }), /Buffer for a/), undefined, 'a Type F stream 230 ft away is beyond buffer plus setback');
r = run(facts({ stream: { status: 'nearby', streams: [{ type: 'U', distance_ft: 100, on_parcel: false, bearing: 'west' }], types: ['U'] } }), { type: 'new_sfr' });
assert.equal(has(r, /Buffer for a untyped|Buffer for a/).level, 'likely', 'untyped stream inside the fish-bearing width but outside the minimum');
assert(has(r, /Water type verification/));

// ---- shoreline and in-water work ----------------------------------------------------------------
const shore = { status: 'on_parcel', in_jurisdiction: true, designations: ['Shoreline Residential'], upland_designations: ['Shoreline Residential'], marine: true, marine_distance_ft: 0, waterfront: true, forage_fish: ['smelt'] };
r = run(facts({ shoreline: shore }), { type: 'new_sfr' });
assert(/exemption/.test(has(r, /^Shoreline exemption/).title) && cost(r, 'dcd-shoreline-exemption').bucket === 'base' && cost(r, 'dcd-shoreline-sdp').bucket === 'contingent');
assert(/\$8,504/.test(has(r, /^Shoreline exemption/).why), 'current substantial development threshold');
assert.equal(agency(r, 'usace'), undefined, 'an upland house on a shoreline lot is not a Corps project');
r = run(facts({ shoreline: shore }), { type: 'shoreline_structure' });
for (const id of ['kitsap-dcd', 'ecology', 'wdfw', 'dnr', 'usace', 'services', 'treaty-tribes']) assert(agency(r, id), 'dock or bulkhead involves ' + id);
assert.equal(agency(r, 'usace').level, 'required');
assert(has(r, /SEPA environmental checklist/), 'work on lands covered by water is not SEPA exempt');
assert(/surf smelt/.test(has(r, /Hydraulic Project Approval/).why));
r = run(facts({ shoreline: { ...shore, designations: ['Natural'], upland_designations: ['Natural'] } }), { type: 'shoreline_structure' });
assert(/prohibited/.test(has(r, /Shoreline permit for a dock/).flag), 'single-use dock next to a Natural designation');

// ---- flood --------------------------------------------------------------------------------------
r = run(facts({ flood: { status: 'on_parcel', sfha_on_parcel: true, zones: ['AE'], bfe_ft: 13 } }), { type: 'new_sfr' }, grid(0, 0, [{ id: 'sfha', pct: 40 }]));
assert(has(r, /Flood hazard development permit/) && cost(r, 'pro-elevation-cert') && cost(r, 'pro-flood-habitat') && agency(r, 'fema'));

// ---- jurisdiction -------------------------------------------------------------------------------
r = run(facts({ jurisdiction: { city: 'Bremerton' }, geohazard: { status: 'on_parcel', classes: ['High'], high: true }, wetland: { status: 'on_parcel', on_parcel: true, min_distance_ft: 0, bearing: 'east' } }), { type: 'new_sfr' });
assert.equal(agency(r, 'city-bremerton').level, 'required');
assert.equal(agency(r, 'kitsap-dcd'), undefined, 'the county is not the permitting authority inside a city');
assert(r.findings.every((f) => !f.citations.some((c) => /^kcc-(19|22|12|15|17)/.test(c))), 'no county development code is cited for a city parcel');
assert.equal(cost(r, 'dcd-building-permit'), undefined, 'no county fees inside a city');
assert(agency(r, 'geotech') && agency(r, 'wetland-biologist'), 'mapped features still drive studies inside a city');
r = run(facts({ jurisdiction: { reservation: { tribe: 'suquamish', name: 'Port Madison Indian Reservation' } } }), { type: 'new_sfr' });
assert.equal(agency(r, 'suquamish').level, 'required');
assert.equal(has(r, /establish land status/).basis, 'confirm', 'reservation land status is a question, not a determination');
r = run(facts({ jurisdiction: { reservation: { tribe: 'pgst', name: "Port Gamble S'Klallam Reservation" } } }), { type: 'new_sfr' });
assert(agency(r, 'pgst'));

// ---- ADU, sewer, demolition, history ------------------------------------------------------------
r = run(facts({ parcel: { vacant: false, dwellings: 1 } }), { type: 'adu' });
assert(has(r, /Conditional use permit for a detached rural ADU/) && cost(r, 'dcd-cup-adu'));
assert(/added bedrooms or a second dwelling/.test(has(r, /Health district review/).title));
r = run(facts({ parcel: { vacant: false }, jurisdiction: { uga: 'Kingston UGA' }, sewer: { status: 'on_parcel', in_county_service_area: 'Kingston', main_distance_ft: 40 } }), { type: 'adu' });
assert.equal(has(r, /Conditional use permit for a detached rural ADU/), undefined, 'urban ADU needs no conditional use permit');
assert(/must connect/.test(has(r, /Sewer availability/).why) && cost(r, 'sewer-connection'));
r = run(facts({ parcel: { vacant: false, oldest_year_built: 1961 } }), { type: 'rebuild' });
assert(agency(r, 'pscaa') && cost(r, 'pro-asbestos-survey') && cost(r, 'dcd-demolition'));
assert.equal(has(r, /Impact fees/).level, 'possible', 'replacement dwelling: impact fee credit to confirm');
const lapsed = { number: '19 01234', type: 'SDAP-SFR', status: 'EXPIRED', status_date: '2021-03-01', submitted: '2019-02-01', lapsed: true, open: false, family: 'site_development' };
const harvest = { number: '24 00011', type: 'TIMBER HARVEST MINOR', status: 'FINALED', issued: String(new Date().getFullYear() - 2) + '-05-01', lapsed: false, open: false, family: 'forest' };
r = run(facts({ permits: { status: 'found', items: [lapsed, harvest] } }), { type: 'new_sfr' });
assert(/SDAP-SFR 19 01234/.test(has(r, /earlier permit/).why));
assert.equal(has(r, /development moratorium/).level, 'likely', 'recent timber harvest on record');

// ---- "could not check" is never silence ---------------------------------------------------------
for (const key of ['wetland', 'stream', 'geohazard', 'flood', 'shoreline', 'cara', 'jurisdiction']) {
  r = run(facts({ [key]: { status: 'unknown' } }), { type: 'new_sfr' });
  assert(r.findings.some((f) => f.level === 'unknown'), 'unreadable ' + key + ' layer must surface as unknown');
}
r = run(facts({ permits: { status: 'unknown' } }), { type: 'new_sfr' });
assert(has(r, /County permit records: map layer could not be read/));

// ---- every rule resolves its citations and fees for every project type and setting --------------
const settings = [facts(), facts({ jurisdiction: { city: 'Poulsbo' } }), facts({ jurisdiction: { uga: 'Silverdale UGA' }, parcel: { vacant: false } }),
  facts({ shoreline: shore, wetland: { status: 'on_parcel', on_parcel: true, min_distance_ft: 0, bearing: 'east' }, stream: { status: 'on_parcel', streams: [{ ...F, distance_ft: 0, on_parcel: true }], lakes: [{ type: 'F', name: null, distance_ft: 10, on_parcel: false, bearing: 'east' }], types: ['F'] }, geohazard: { status: 'on_parcel', high: true, moderate: true, classes: ['High', 'Moderate'] }, flood: { status: 'on_parcel', sfha_on_parcel: true, zones: ['VE'], coastal_high_hazard: true }, cara: { status: 'on_parcel', category_1: true, names: ['Hansville Significant Recharge Area'] } })];
let n = 0;
for (const f of settings) for (const type of Object.keys(Engine.PROJECT_TYPES)) for (const g of [grid(0, 0), grid(50, 45)]) {
  const rep = run(f, { type, demo: true, tree_clearing: true, state_highway_access: true }, g);
  for (const x of rep.findings) { assert(DATA.agencies[x.agency], x.id); assert(['documented', 'workflow', 'confirm'].includes(x.basis), x.id + ' has no basis'); assert(x.why && x.title); }
  for (const c of rep.costs.items) assert(c.high >= c.low && c.low >= 0 && isFinite(c.high), c.fee);
  const t = rep.costs.totals;
  assert(Math.abs(t.base.low + t.contingent.low - rep.costs.items.reduce((s, c) => s + c.low, 0)) < 0.01);
  n++;
}
// a study triggered twice is counted once, and in the base estimate if any trigger is firm
r = run(settings[3], { type: 'shoreline_structure' });
assert.equal(r.costs.items.filter((c) => c.fee === 'pro-geotech-report').length, 1);
assert.equal(cost(r, 'pro-geotech-report').bucket, 'base');
// memo renders and carries the disclaimer
const memo = Report.memo(r, settings[3], grid(50, 45), { screened_at: '2026-11-12T00:00:00Z', layers: {} }, DATA);
assert(/Screening only/.test(memo) && /\| \*\*Base total\*\*/.test(memo));

console.log('PASS: bid assistant engine (' + RULES.length + ' rules, ' + n + ' project and site combinations, ' + cites.length + ' citations, ' + fees.length + ' cost lines).');
