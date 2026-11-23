/* Project inputs and editable allowances shared by the browser and server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidPresentation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVELS = ['required', 'likely', 'possible', 'unknown'];
  var LEVEL_RANK = { required: 0, likely: 1, possible: 2, unknown: 3 };
  var SCOPE_FIELDS = {
    waterbody: { label: 'Water setting', choices: { auto: 'Use maps / not sure', marine: 'Marine / tidal', freshwater: 'Lake, river or wetland' }, default: 'auto' },
    fill_discharge: { label: 'Dredged or fill material placed in water / wetlands?', choices: { unknown: 'Not sure', yes: 'Proposed', no: 'Not proposed' } },
    navigability: { label: 'Section 10 navigable water status', choices: { unknown: 'Not established', yes: 'Reported navigable', no: 'Reported non-navigable' } },
    waters_us: { label: 'Federal waters jurisdiction at discharge', choices: { unknown: 'Not established', yes: 'Reported jurisdictional', no: 'Reported non-jurisdictional' } },
    land_status: { label: 'Jurisdiction at the work / discharge location', choices: { unknown: 'Not established', state_local: 'Reported state / local jurisdiction', tribal: 'Reported tribal / Indian Country', exclusive_federal: 'Reported exclusive federal jurisdiction' } },
    flood_work: { label: 'Work within the floodplain', choices: { unknown: 'Not established', yes: 'Proposed', no: 'Footprint reported outside' } },
    floodway_work: { label: 'Work within the regulatory floodway', choices: { unknown: 'Not established', yes: 'Proposed', no: 'Footprint reported outside' } },
    floodway_designation: { label: 'Regulatory floodway adopted for this river reach?', choices: { unknown: 'Not established', yes: 'Reported adopted', no: 'Reported not adopted' } }
  };

  var PROJECT_TYPES = {
    new_sfr: { label: 'New single-family home', new_sqft: 2400, hard_surface_sqft: 4500, disturbance_sqft: 14000, grading_cy: 120, bedrooms: 3, new_dwelling: true },
    adu: { label: 'Accessory dwelling unit (detached)', new_sqft: 800, hard_surface_sqft: 1400, disturbance_sqft: 5000, grading_cy: 40, bedrooms: 1, new_dwelling: true },
    addition: { label: 'Addition or major remodel', new_sqft: 600, hard_surface_sqft: 700, disturbance_sqft: 2500, grading_cy: 20, bedrooms: 1, new_dwelling: false },
    accessory: { label: 'Garage, shop or other accessory building', new_sqft: 720, hard_surface_sqft: 1200, disturbance_sqft: 3000, grading_cy: 30, bedrooms: 0, new_dwelling: false },
    rebuild: { label: 'Tear down and rebuild', new_sqft: 2400, hard_surface_sqft: 4500, disturbance_sqft: 12000, grading_cy: 100, bedrooms: 3, new_dwelling: true, demo: true },
    shoreline_structure: { label: 'Dock, bulkhead or other shoreline structure', new_sqft: 0, hard_surface_sqft: 0, disturbance_sqft: 1500, grading_cy: 20, bedrooms: 0, new_dwelling: false, in_water: true },
    short_plat: { label: 'Short plat (divide into lots)', new_sqft: 0, hard_surface_sqft: 6000, disturbance_sqft: 30000, grading_cy: 300, bedrooms: 0, new_dwelling: false, lots: 2 },
    clearing: { label: 'Clearing and grading only', new_sqft: 0, hard_surface_sqft: 0, disturbance_sqft: 20000, grading_cy: 200, bedrooms: 0, new_dwelling: false, tree_clearing: true }
  };

  /** Fill a partial project description with the defaults for its type. */
  function normaliseProject(input) {
    input = input || {};
    var type = Object.prototype.hasOwnProperty.call(PROJECT_TYPES, input.type) ? input.type : 'new_sfr';
    var d = PROJECT_TYPES[type];
    function num(v, def) { var n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? def : Math.max(0, n); }
    var project = {
      type: type,
      label: d.label,
      new_sqft: num(input.new_sqft, d.new_sqft),
      construction_value: num(input.construction_value, 0),
      prior_planning_review: ['yes', 'no'].indexOf(input.prior_planning_review) >= 0 ? input.prior_planning_review : 'unknown',
      hard_surface_sqft: num(input.hard_surface_sqft, d.hard_surface_sqft),
      disturbance_sqft: num(input.disturbance_sqft, d.disturbance_sqft),
      grading_cy: num(input.grading_cy, d.grading_cy),
      bedrooms: num(input.bedrooms, d.bedrooms),
      lots: num(input.lots, d.lots || 0),
      new_dwelling: !!d.new_dwelling,
      demo: input.demo != null ? !!input.demo : !!d.demo,
      in_water: input.in_water != null ? !!input.in_water : !!d.in_water,
      tree_clearing: input.tree_clearing != null ? !!input.tree_clearing : !!d.tree_clearing,
      wastewater: input.wastewater || 'unknown', // 'septic_new' | 'septic_existing' | 'sewer' | 'unknown'
      water: input.water || 'unknown',           // 'well_new' | 'well_existing' | 'public' | 'unknown'
      state_highway_access: !!input.state_highway_access,
      federal_nexus: !!input.federal_nexus,
      federal_operator: !!input.federal_operator,
      common_plan: !!input.common_plan,
      floodplain_modification: !!input.floodplain_modification,
      flood_rise_ft: input.flood_rise_ft !== '' && input.flood_rise_ft != null && Number.isFinite(Number(input.flood_rise_ft)) ? Number(input.flood_rise_ft) : null
    };
    Object.keys(SCOPE_FIELDS).forEach(function (key) {
      var field = SCOPE_FIELDS[key];
      project[key] = Object.prototype.hasOwnProperty.call(field.choices, input[key]) ? input[key] : field.default || 'unknown';
    });
    return project;
  }

  function totals(items) {
    var t = {
      base: { low: 0, high: 0 }, contingent: { low: 0, high: 0 },
      by_kind: {}, unpriced: [], excluded: []
    };
    items.forEach(function (c) {
      if (c.excluded) { t.excluded.push(c.fee); return; }
      if (c.unpriced) { t.unpriced.push(c.fee); return; }
      var b = t[c.bucket];
      b.low += c.low; b.high += c.high;
      var k = t.by_kind[c.kind] || (t.by_kind[c.kind] = { base: { low: 0, high: 0 }, contingent: { low: 0, high: 0 } });
      k[c.bucket].low += c.low; k[c.bucket].high += c.high;
    });
    return t;
  }

  /** Keep small published fees and user quotes visible; the range conveys estimation. */
  function roundMoney(n) {
    return Math.round(n * 100) / 100;
  }

  /** Overrides are bid allowances, never edits to the cited schedule or applicability. */
  function applyOverrides(report, overrides) {
    var result = JSON.parse(JSON.stringify(report));
    result.costs.items.forEach(function (c) {
      c.reference_low = c.low; c.reference_high = c.high;
      var o = overrides[c.fee];
      if (!o) return;
      var hasRange = o.low != null || o.high != null;
      if (hasRange && (!Number.isFinite(o.low) || !Number.isFinite(o.high) || o.low < 0 || o.high < o.low)) {
        throw new Error('Enter a nonnegative low and high amount, with high at least low.');
      }
      if (hasRange) { c.low = o.low; c.high = o.high; c.edited = true; c.unpriced = false; }
      c.excluded = !!o.excluded;
      c.override_note = String(o.note || '');
    });
    result.findings.forEach(function (f) {
      f.costs = f.costs.map(function (c) { return result.costs.items.find(function (item) { return item.fee === c.fee; }); });
    });
    result.costs.totals = totals(result.costs.items);
    return result;
  }

  return {
    LEVELS: LEVELS,
    LEVEL_RANK: LEVEL_RANK,
    PROJECT_TYPES: PROJECT_TYPES,
    SCOPE_FIELDS: SCOPE_FIELDS,
    normaliseProject: normaliseProject,
    applyOverrides: applyOverrides,
    totals: totals,
    roundMoney: roundMoney
  };
});
