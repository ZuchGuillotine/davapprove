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
assert(Report.flags(r, facts(), grid(30, 0)).some((f) => /geotechnical report/.test(f.text) && f.text.includes(Report.range(DATA.fees['pro-geotech-report'].low, DATA.fees['pro-geotech-report'].high))), 'geotech cost reaches the meeting flags');
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
assert(has(r, /Corps Section 404: dredged or fill discharge/));
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
assert.equal(has(r, /Establish land status/).basis, 'confirm', 'reservation land status is a question, not a determination');
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
  assert(Math.abs(t.base.low + t.contingent.low - rep.costs.items.filter(c => !c.unpriced).reduce((s, c) => s + c.low, 0)) < 0.01);
  n++;
}
// a study triggered twice is counted once, and in the base estimate if any trigger is firm
r = run(settings[3], { type: 'shoreline_structure' });
assert.equal(r.costs.items.filter((c) => c.fee === 'pro-geotech-report').length, 1);
assert.equal(cost(r, 'pro-geotech-report').bucket, 'base');
// memo renders and carries the disclaimer
const memo = Report.memo(r, settings[3], grid(50, 45), { screened_at: '2026-11-12T00:00:00Z', layers: {} }, DATA);
assert(/Screening only/.test(memo) && /\| \*\*Base total\*\*/.test(memo));

// ---- early-bid overrides, gaps and provenance ---------------------------------------------------
const priced = run(facts({ geohazard: { status: 'on_parcel', high: true, classes: ['High'] } }), { type: 'new_sfr', hard_surface_sqft: 10000 });
const before = priced.costs.totals.base.low;
const originalGeotech = cost(priced, 'pro-geotech-report').low;
const edited = Engine.applyOverrides(priced, {
  'pro-geotech-report': { low: 4200, high: 4200, note: 'Local firm quote, scope includes borings' },
  'pro-civil-sdap': { low: 7000, high: 8500, note: 'Project allowance' }
});
assert.equal(edited.costs.totals.base.low, before - originalGeotech + 4200 + 7000);
assert.equal(cost(priced, 'pro-geotech-report').low, DATA.fees['pro-geotech-report'].low, 'reference report is immutable');
assert(Report.flags(edited, facts(), grid(30, 0)).some(f => f.text.includes('$4,200') && !f.text.includes('$5,300')), 'meeting notes use the edited allowance');
assert(edited.findings.flatMap(f => f.costs).filter(c => c.fee === 'pro-geotech-report').every(c => c.low === 4200));
assert(!edited.costs.totals.unpriced.includes('pro-civil-sdap'), 'a user allowance prices an otherwise unsourced item');
assert(priced.costs.totals.unpriced.includes('pro-civil-sdap'));
for (const range of [{low: -1, high: 1}, {low: 3, high: 2}, {low: Infinity, high: Infinity}, {low: 2}]) {
  assert.throws(() => Engine.applyOverrides(priced, {'pro-geotech-report': range}), /nonnegative/);
}
const excluded = Engine.applyOverrides(priced, { 'pro-geotech-report': { excluded: true, note: 'Client procures separately' } });
assert(excluded.findings.some(f => f.title.includes('Geotechnical report')), 'excluding a price must not remove its requirement');
assert.equal(excluded.costs.totals.base.low, before - originalGeotech);
const editedMemo = Report.memo(excluded, facts(), grid(0, 0), { screened_at: '2026-11-13T00:00:00Z', layers: {}, tables: {} }, DATA, { notes: 'Client procures geotech separately.' });
assert(editedMemo.includes('(EXCLUDED)') && editedMemo.includes('Client procures separately') && editedMemo.includes('Quote needed'));
assert(editedMemo.includes('EARLY BID') && editedMemo.includes('No approved design revision'));
assert(priced.findings.every(f => f.work_stage === 'early_bid' && f.approved_revision === null && f.research_date));
assert.equal(Engine.roundMoney(6.5), 6.5, 'small fees must not display as zero');
assert.equal(cost(run(facts({ jurisdiction: { status: 'unknown' } }), { type: 'new_sfr' }), 'dcd-building-permit'), undefined, 'unknown jurisdiction cannot authorize county pricing');
const reuse = run(facts({ permits: { status: 'found', items: [lapsed] } }), { type: 'new_sfr' });
assert(has(reuse, /earlier permit/).citations.includes('kitsap-permit-reactivation'));
assert(has(reuse, /earlier permit/).why.includes('reactivation'));
assert(!has(reuse, /earlier permit/).why.includes('needs a new application'));
const pack = require(B + '/packs/wa-kitsap.js');
assert(pack.layers.concat(pack.tables).every(l => (l.fields || []).every(f => !/OWNER|APPLICANT|PROJECT_NAME/.test(f))), 'screening never requests personal owner or applicant fields');
const partialScreen = { screened_at: '2026-11-13T00:00:00Z', layers: { wetland: { status: 'nearby', truncated: true, layer: { label: 'Wetland inventory' } } } };
const partialFlags = Report.flags({ findings: [] }, facts(), grid(0, 0), partialScreen);
assert(!partialFlags.some(f => f.text.includes('No mapped')) && partialFlags.some(f => f.level === 'unknown'), 'truncated maps cannot produce a clean meeting flag');
assert(Report.memo(reuse, facts(), grid(0, 0), partialScreen, DATA).includes('Wetland inventory: partial result'), 'memo retains incomplete map coverage');


// ---- independently sourced agency routing; no county records required ---------------------------
const byRule = (report, id) => report.findings.filter(f => f.rule === id);
const independentFacts = facts({ jurisdiction: { status: 'unknown', trust_status: 'unknown' }, permits: { status: 'unknown', items: [] }, shoreline: { status: 'unknown' }, wetland: { status: 'unknown' }, stream: { status: 'unknown' } });
const dock = { type: 'shoreline_structure', waterbody: 'marine', fill_discharge: 'no' };
let independent = run(independentFacts, dock);
assert.equal(byRule(independent, 'us.section10')[0].level, 'required', 'activity routes to the Corps despite county outages');
assert.equal(byRule(independent, 'us.section404').length, 0, 'a no-fill dock does not automatically require Section 404');
for (const id of ['usace', 'wdfw', 'dnr', 'services', 'ecology', 'epa', 'treaty-tribes', 'skokomish']) assert(agency(independent, id), 'missing independent dock route '+id);
assert(byRule(independent, 'us.tribal').every(f => f.level === 'possible'), 'regional contacts are not mandatory tribal approvals');
assert(byRule(independent, 'us.water_quality').some(f => f.agency === 'epa'));
assert(!independent.findings.some(f => /^Rule could not/.test(f.title)), 'missing county data cannot break independent rules');
const fresh = run(independentFacts, { ...dock, waterbody: 'freshwater', navigability: 'unknown' });
assert(agency(fresh, 'dnr'), 'freshwater docks retain DNR title/use screening');
assert.equal(byRule(fresh, 'us.section10')[0].level, 'possible', 'freshwater navigability must be established');
assert.equal(byRule(run(independentFacts, {...dock, waterbody:'freshwater', navigability:'no'}), 'us.section10').length,0);
assert.equal(byRule(run(facts(), {type:'new_sfr', fill_discharge:'yes', waters_us:'yes'}), 'us.section404')[0].level,'required','explicit wetland fill works without a county map hit');
assert.equal(byRule(run(facts(), {type:'new_sfr', fill_discharge:'yes', waters_us:'unknown'}), 'us.section404')[0].level,'possible');
assert.equal(byRule(run(facts(), {type:'new_sfr', fill_discharge:'yes', waters_us:'no'}), 'us.section404')[0].authority_role,'Jurisdiction check');
// A less constrained wetland also merits a discharge question; no arbitrary coverage cutoff.
assert(byRule(run(facts({wetland:{on_parcel:true,status:'on_parcel'}}),{type:'new_sfr'},grid(1,0)),'us.section404').length);
const stateWaters = run(facts({jurisdiction:{trust_status:'none'}}),dock);
assert.deepStrictEqual(byRule(stateWaters,'us.water_quality').map(f=>f.agency),['ecology']);
const pgstWaters = run(facts({jurisdiction:{status:'unknown',trust_status:'on_parcel',tribal_names:["Port Gamble S'Klallam Tribe"]}}),dock);
assert.deepStrictEqual(byRule(pgstWaters,'us.water_quality').map(f=>f.agency),['pgst'],'independent state tribal layer supplies the certifier candidate even if county boundaries fail');
assert(byRule(pgstWaters,'kitsap.reservation').some(f=>f.agency==='pgst'));
assert.equal(cost(pgstWaters,'dcd-building-permit'),undefined);
const federalWaters = run(facts(),{...dock,land_status:'exclusive_federal'});
assert.deepStrictEqual(byRule(federalWaters,'us.water_quality').map(f=>f.agency),['epa']);
const unrecognizedTribe = run(facts({jurisdiction:{tribal_names:["Jamestown S'Klallam Tribe"],trust_status:'on_parcel'}}),dock);
assert.equal(byRule(unrecognizedTribe,'kitsap.reservation')[0].agency,'treaty-tribes','unrecognized tribal names must not silently become Port Gamble or Suquamish');
const conflict = run(facts({jurisdiction:{tribal_names:['Suquamish Tribe'],trust_status:'on_parcel'}}),{...dock,land_status:'state_local'});
assert.equal(byRule(conflict,'us.water_quality').length,3,'conflicting land status leaves authority alternatives open');
assert(byRule(conflict,'kitsap.reservation')[0].why.includes('conflicts'));
// EPA stormwater and common-plan triggers are independent of county and state fee schedules.
const tribalStorm = run(independentFacts,{type:'clearing',land_status:'tribal',disturbance_sqft:43560});
assert(byRule(tribalStorm,'wa.cswgp').every(f=>f.agency==='epa'));
assert.equal(cost(tribalStorm,'ecology-cswgp'),undefined);
const commonPlan = run(facts(),{type:'clearing',disturbance_sqft:3000,common_plan:true,federal_operator:true});
assert(byRule(commonPlan,'wa.cswgp').some(f=>f.agency==='epa'));
// FEMA must run without county zoning/history and distinguish the conditional revision threshold.
const floodFacts = facts({jurisdiction:{status:'unknown'},flood:{status:'on_parcel',sfha_on_parcel:true,floodway:true,zones:['AE']}});
const floodScope = {type:'new_sfr',flood_work:'yes',floodway_work:'yes',flood_rise_ft:0.1};
let floodReport = run(floodFacts,floodScope);
assert.equal(has(floodReport,/FEMA conditional map revision/).level,'required');
assert.equal(has(floodReport,/Hydraulic analysis/).level,'required');
assert(floodReport.costs.totals.unpriced.includes('pro-hydraulic-analysis'));
assert(floodReport.costs.totals.unpriced.includes('fema-map-review'));
assert.equal(has(run(floodFacts,{...floodScope,flood_rise_ft:0}),/FEMA conditional map revision/).level,'possible','supplied no-rise does not certify approval');
const noWay = facts({flood:{status:'on_parcel',sfha_on_parcel:true,floodway:false,zones:['AE']}});
assert.equal(has(run(noWay,{...floodScope,floodway_work:'no',floodway_designation:'no',flood_rise_ft:1.1}),/FEMA conditional map revision/).level,'required');
assert.equal(has(run(noWay,{...floodScope,floodway_work:'no',floodway_designation:'no',flood_rise_ft:1}),/FEMA conditional map revision/).level,'possible');
assert.equal(has(run(noWay,{...floodScope,floodway_work:'no',flood_rise_ft:1.1}),/FEMA conditional map revision/).level,'possible','absence of a parcel floodway hit does not prove that no regulatory floodway was adopted');
assert(!has(run(noWay,{type:'new_sfr',flood_work:'no',floodway_work:'no'}),/Hydraulic analysis/),'outside-footprint input does not automatically price hydraulic work');
assert.equal(byRule(run(facts({flood:{status:'unknown'}}),{type:'new_sfr'}),'us.fema')[0].level,'unknown');
assert(agency(run(facts(),{type:'new_sfr',floodplain_modification:true}),'fema'),'reported floodplain alteration triggers review without a map hit');
const noNexus=run(facts(),{type:'new_sfr'}), withNexus=run(facts(),{type:'new_sfr',federal_nexus:true});
assert.equal(byRule(noNexus,'us.consultations').length,0);
assert(byRule(withNexus,'us.consultations').length && byRule(withNexus,'us.tribal').length);
for (const report of [independent,fresh,stateWaters,pgstWaters,federalWaters,tribalStorm,floodReport]) {
  for (const finding of report.findings.filter(f=>f.independent)) {
    assert(finding.citations.length && finding.research_date && finding.jurisdiction && finding.work_stage==='early_bid');
    assert.equal(finding.approved_revision,null);
  }
  assert(report.independent_checks.length>=10);
}
assert(noNexus.independent_checks.some(c=>c.id==='us.section10' && c.status==='no_trigger'));
const scopeMemo=Report.memo(independent,independentFacts,grid(0,0),{screened_at:'2026-11-14T00:00:00Z',layers:{}},DATA);
assert(scopeMemo.includes('Regional starting contacts') && scopeMemo.includes('Permit authority') && scopeMemo.includes('https://www.epa.gov/'));
const cli=require(B+'/cli.js');
const cliArgs=cli.parseArgs(['--waterbody','freshwater','--fill-discharge','no','--land-status','tribal','--flood-rise-ft','0.2','--common-plan']);
assert.equal(cliArgs.project.fill_discharge,'no'); assert(cliArgs.project.common_plan);
assert.equal(Engine.normaliseProject({flood_rise_ft:''}).flood_rise_ft,null);
assert.equal(Engine.normaliseProject({land_status:'invalid'}).land_status,'unknown');

console.log('PASS: bid assistant engine (' + RULES.length + ' rules, ' + n + ' project and site combinations, ' + cites.length + ' citations, ' + fees.length + ' cost lines).');

// Bainbridge city fees must be visible independently of county permitting.
const biFacts = facts({ jurisdiction: { city: 'Bainbridge Island' } });
let bi = run(biFacts, { type: 'new_sfr', construction_value: 600000, prior_planning_review: 'no' });
assert.equal(cost(bi, 'dcd-building-permit'), undefined);
assert.equal(cost(bi, 'bi-building').low, 6542.56);
assert(Math.abs(cost(bi, 'bi-plan-check').low - 4252.664) < .001);
assert(Math.abs(cost(bi, 'bi-planning-review').low - 1308.512) < .001);
assert(Math.abs(cost(bi, 'bi-transport').low - 7098.4962) < .001);
assert.equal(cost(bi, 'bi-grading').low, 3265);
assert(bi.costs.totals.unpriced.includes('bi-trades'));
assert(bi.costs.totals.unpriced.includes('bi-land-use'));
assert(bi.costs.totals.unpriced.includes('bi-connections'));
bi = run(biFacts, { type: 'new_sfr' });
assert(bi.costs.totals.unpriced.includes('bi-building'), 'missing valuation is not a free building permit');
assert(bi.costs.totals.unpriced.includes('bi-planning-review'));
const supplied = Engine.applyOverrides(bi, { 'bi-building': { low: 6000, high: 8000 } });
assert(!supplied.costs.totals.unpriced.includes('bi-building'));
bi = run(biFacts, { type: 'new_sfr', construction_value: 600000 });
assert.equal(cost(bi, 'bi-planning-review').low, 0);
assert(cost(bi, 'bi-planning-review').high > 0);
bi = run(biFacts, { type: 'new_sfr', construction_value: 600000, prior_planning_review: 'yes', grading_cy: 100 });
assert.equal(cost(bi, 'bi-planning-review'), undefined);
assert.equal(cost(bi, 'bi-grading'), undefined);
for (const [value, expected] of [[500,41.46],[500.01,46.83],[2000,122.01],[2000.01,146.81],[500000,5701.43],[500000.01,5713.93],[1000000.01,9904.05]]) {
 assert(Math.abs(cost(run(biFacts,{type:'new_sfr',construction_value:value}),'bi-building').low-expected)<.001,'valuation band '+value);
}
assert.equal(cost(run(biFacts,{type:'rebuild',construction_value:600000}),'bi-transport'),undefined,'replacement-home impact exemption is not ignored');
assert.equal(cost(run(facts({jurisdiction:{city:'Poulsbo'}}),{type:'new_sfr',construction_value:600000}),'bi-building'),undefined);
assert.equal(cost(run(biFacts,{type:'new_sfr',land_status:'tribal',construction_value:600000}),'bi-building'),undefined);
console.log('PASS: Bainbridge fees, valuation bands, missing inputs, prior review, jurisdiction and replacements.');
