/*
 * Rule engine for the bid assistant.
 *
 * Input:  facts (from a jurisdiction pack), a project description, and rule sets.
 * Output: findings grouped by agency, a cost range built from sourced line items, and the
 *         list of things that could not be checked.
 *
 * Vocabulary (kept deliberately small so a bid reader can rely on it):
 *   required  A documented trigger is met by the project itself or by a mapped feature on the parcel.
 *   likely    A mapped feature is close enough that the code's review distance is met; the
 *             outcome depends on field verification by a qualified professional.
 *   possible  The trigger depends on something maps cannot show. Carried as a contingency.
 *   unknown   The map layer behind this question could not be read. Not a clearance.
 *
 * The engine never emits "not required". Absence of a finding means only that nothing in the
 * mapped data or the project description triggered the rule.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVELS = ['required', 'likely', 'possible', 'unknown'];
  var LEVEL_RANK = { required: 0, likely: 1, possible: 2, unknown: 3 };

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
    var type = PROJECT_TYPES[input.type] ? input.type : 'new_sfr';
    var d = PROJECT_TYPES[type];
    function num(v, def) { var n = Number(v); return v === '' || v == null || isNaN(n) ? def : n; }
    return {
      type: type,
      label: d.label,
      new_sqft: num(input.new_sqft, d.new_sqft),
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
      federal_nexus: !!input.federal_nexus
    };
  }

  /**
   * Evaluate all rules. `rules` is an array of { id, agency, topic, evaluate(ctx) } where
   * evaluate returns null, a finding, or an array of findings.
   */
  function evaluate(input) {
    var data = input.data;
    var project = normaliseProject(input.project);
    var ctx = { facts: input.facts, project: project, grid: input.grid || null, data: data, helpers: helpers(data) };
    var findings = [];

    input.rules.forEach(function (rule) {
      var out;
      try { out = rule.evaluate(ctx); }
      catch (err) {
        out = { level: 'unknown', title: 'Rule could not be evaluated: ' + rule.id, why: String(err && err.message || err) };
      }
      if (!out) return;
      (Array.isArray(out) ? out : [out]).forEach(function (f, i) {
        if (!f) return;
        if (LEVELS.indexOf(f.level) < 0) throw new Error('Rule ' + rule.id + ' returned an invalid level: ' + f.level);
        f.id = f.id || rule.id + (i ? '.' + i : '');
        f.rule = rule.id;
        f.agency = f.agency || rule.agency;
        f.topic = f.topic || rule.topic;
        f.citations = (f.citations || []).map(function (id) {
          var c = data.citations[id];
          if (!c) throw new Error('Rule ' + rule.id + ' cites unknown citation "' + id + '"');
          return id;
        });
        f.costs = (f.costs || []).map(function (c) { return resolveCost(c, f, data, rule.id); });
        findings.push(f);
      });
    });

    findings.sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || String(a.topic).localeCompare(String(b.topic)); });
    return {
      project: project,
      findings: findings,
      agencies: rollUpAgencies(findings, data),
      costs: rollUpCosts(findings),
      generated_at: new Date().toISOString()
    };
  }

  function helpers(data) {
    return {
      cite: function (id) { return data.citations[id]; },
      rangeText: function (id) { var f = data.fees[id]; return '$' + roundMoney(f.low).toLocaleString('en-US') + ' to $' + roundMoney(f.high).toLocaleString('en-US'); },
      fee: function (id) { return data.fees[id]; },
      value: function (citationId, key) {
        var c = data.citations[citationId];
        if (!c || !c.key_values || !(key in c.key_values)) throw new Error('Missing key value ' + citationId + '.' + key);
        return c.key_values[key];
      }
    };
  }

  /** A cost reference is either a fee id string, or { fee: id, qty, note, low, high, label }. */
  function resolveCost(ref, finding, data, ruleId) {
    var spec = typeof ref === 'string' ? { fee: ref } : ref;
    var fee = data.fees[spec.fee];
    if (!fee) throw new Error('Rule ' + ruleId + ' references unknown fee "' + spec.fee + '"');
    var qty = spec.qty == null ? 1 : spec.qty;
    var low = spec.low != null ? spec.low : fee.low * qty;
    var high = spec.high != null ? spec.high : fee.high * qty;
    return {
      fee: spec.fee,
      label: spec.label || fee.label,
      kind: fee.kind,                 // 'agency_fee' | 'professional' | 'impact_fee' | 'utility'
      basis: fee.basis,               // 'published' | 'market'
      payee: fee.payee,
      low: low,
      high: high,
      qty: qty,
      unit: fee.unit || 'flat',
      note: spec.note || fee.note || null,
      source: fee.source || null,
      confidence: fee.confidence || (fee.basis === 'published' ? 'high' : 'medium'),
      // Required and likely items go in the base estimate; possible and unknown are contingencies.
      bucket: spec.bucket || (finding.level === 'required' || finding.level === 'likely' ? 'base' : 'contingent'),
      finding: finding.id,
      level: finding.level
    };
  }

  function rollUpAgencies(findings, data) {
    var by = {};
    findings.forEach(function (f) {
      var a = by[f.agency] || (by[f.agency] = { id: f.agency, findings: [], level: 'unknown' });
      a.findings.push(f.id);
      if (LEVEL_RANK[f.level] < LEVEL_RANK[a.level]) a.level = f.level;
    });
    return Object.keys(by).map(function (id) {
      var meta = data.agencies[id];
      if (!meta) throw new Error('Unknown agency id "' + id + '"');
      var a = by[id];
      a.name = meta.name; a.tier = meta.tier; a.role = meta.role; a.url = meta.url; a.phone = meta.phone || null;
      return a;
    }).sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name); });
  }

  function tierRank(t) { return ['local', 'tribal', 'state', 'federal', 'utility', 'professional'].indexOf(t); }

  /** Merge duplicate fee lines (the same study can be triggered by more than one rule). */
  function rollUpCosts(findings) {
    var lines = {}, order = [];
    findings.forEach(function (f) {
      f.costs.forEach(function (c) {
        var cur = lines[c.fee];
        if (!cur) {
          cur = lines[c.fee] = JSON.parse(JSON.stringify(c));
          cur.findings = [f.id];
          order.push(c.fee);
        } else {
          cur.findings.push(f.id);
          // one study serves several triggers: keep the widest range, promote to base if any trigger is base
          cur.low = Math.max(cur.low, c.low);
          cur.high = Math.max(cur.high, c.high);
          if (c.bucket === 'base') cur.bucket = 'base';
          if (LEVEL_RANK[c.level] < LEVEL_RANK[cur.level]) cur.level = c.level;
        }
      });
    });
    var items = order.map(function (k) { return lines[k]; });
    return { items: items, totals: totals(items) };
  }

  function totals(items) {
    var t = {
      base: { low: 0, high: 0 }, contingent: { low: 0, high: 0 },
      by_kind: {}
    };
    items.forEach(function (c) {
      if (c.excluded) return;
      var b = t[c.bucket];
      b.low += c.low; b.high += c.high;
      var k = t.by_kind[c.kind] || (t.by_kind[c.kind] = { base: { low: 0, high: 0 }, contingent: { low: 0, high: 0 } });
      k[c.bucket].low += c.low; k[c.bucket].high += c.high;
    });
    return t;
  }

  /** Round a dollar amount for display in a bid: nearest $50 under $2k, $100 under $20k, else $500. */
  function roundMoney(n) {
    var step = n < 2000 ? 50 : n < 20000 ? 100 : 500;
    return Math.round(n / step) * step;
  }

  return {
    LEVELS: LEVELS,
    LEVEL_RANK: LEVEL_RANK,
    PROJECT_TYPES: PROJECT_TYPES,
    normaliseProject: normaliseProject,
    evaluate: evaluate,
    totals: totals,
    roundMoney: roundMoney
  };
});
