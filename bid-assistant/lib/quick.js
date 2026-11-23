/*
 * Quick estimate: the basic, ungated summary of a full bid assessment.
 *
 * analyze()   runs the same screening, constraint and rule steps as the full workspace.
 * summarize() reduces a full result to what the public landing pages may show: one priced
 *             range, the possible-allowance range, counts and coverage. No line items, code
 *             excerpts or citations; those belong to the full report.
 *
 * Every figure comes from Engine.evaluate, so it traces to fees.json and citations.json.
 * Quote-needed lines are counted and reported as excluded, never silently priced. Incomplete
 * map coverage is reported, never treated as a clean result.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidQuick = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * Scope the engine does not price yet. Captured so the user sees it was not forgotten,
   * shown as "not separately estimated", and recorded as demand for future research.
   */
  var SCOPE_ITEMS = {
    solar: { label: 'Solar panels', group: 'electrical' },
    battery: { label: 'Battery storage or generator', group: 'electrical' },
    ev_charger: { label: 'EV charger', group: 'electrical' },
    electrical_service: { label: 'Electrical service upgrade', group: 'electrical' },
    heat_pump: { label: 'Heat pump, furnace or HVAC', group: 'mechanical' },
    water_heater: { label: 'Water heater', group: 'mechanical' },
    plumbing: { label: 'Plumbing changes or new fixtures', group: 'plumbing' },
    roof: { label: 'New roof', group: 'building' },
    windows: { label: 'Windows or exterior doors', group: 'building' },
    deck: { label: 'Deck or covered porch', group: 'building' },
    retaining_wall: { label: 'Retaining wall', group: 'site' },
    fence: { label: 'Fence', group: 'site' }
  };

  var LEVEL_WORDS = {
    pro: { required: 'Plan for', likely: 'Probably', possible: 'Check', unknown: "Couldn't tell" },
    plain: { required: 'Will be involved', likely: 'Probably involved', possible: 'May be involved', unknown: "Couldn't check" }
  };

  function scopeItems(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (id) {
      if (!Object.prototype.hasOwnProperty.call(SCOPE_ITEMS, id) || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  /** True when any part of the map screen is unresolved. Mirrors the workspace's gray-cell rule. */
  function incomplete(facts, screening, project) {
    var j = (facts && facts.jurisdiction) || {};
    var land = project && project.land_status;
    return !!(facts && facts.regional) || j.status === 'unknown' || !!j.city || !!j.reservation || !!j.off_reservation_trust ||
      (j.tribal_names || []).length > 0 || ['tribal', 'exclusive_federal'].indexOf(land) >= 0 ||
      Object.keys((screening && screening.layers) || {}).some(function (id) {
        var r = screening.layers[id];
        return r.status === 'unknown' || r.truncated;
      });
  }

  function unreadLayers(screening) {
    var out = [];
    Object.keys((screening && screening.layers) || {}).forEach(function (id) {
      var r = screening.layers[id];
      if (r.status === 'unknown' || r.truncated) out.push((r.layer && r.layer.label) || id);
    });
    return out;
  }

  function jurisdictionLabel(facts) {
    var j = (facts && facts.jurisdiction) || {};
    if (j.status === 'unknown') return 'Jurisdiction not confirmed';
    if (j.city) return 'City of ' + j.city;
    return 'Unincorporated ' + (j.county || '') + ' County';
  }

  /**
   * Run the screening and rules for one parcel. deps: { pack, data, rulesets, Screen, Geo, Engine }.
   * Same steps, in the same order, as the full workspace.
   */
  function analyze(deps, parcel, project, options) {
    return deps.Screen.screenParcel(deps.pack, parcel, options || {}).then(function (screening) {
      return evaluate(deps, parcel, project, screening);
    });
  }

  /** Re-evaluate a saved map snapshot without fetching current maps. */
  function evaluate(deps, parcel, project, screening) {
    var pack = deps.pack, data = deps.data, rulesets = deps.rulesets;
    screening.reference_revision = screening.reference_revision || data.meta.reference_revision || data.meta.research_date;
    var facts = pack.deriveFacts(screening);
    var constraints = rulesets[pack.constraint_ruleset || pack.id].constraints(screening, facts, data, project);
    var grid = deps.Geo.gridAnalyze(parcel.shape, constraints, { targetSamples: 3000 });
    var rules = [];
    pack.rule_sets.forEach(function (id) { rules = rules.concat(rulesets[id].rules); });
    var report = deps.Engine.evaluate({ facts: facts, project: project, grid: grid, rules: rules, data: data });
    return { parcel: parcel, screening: screening, facts: facts, constraints: constraints, grid: grid, report: report };
  }

  /** The basic estimate. Safe to show without an account. */
  function summarize(result, project, data) {
    var report = result.report, facts = result.facts, screening = result.screening;
    var t = report.costs.totals;
    var parties = report.agencies.filter(function (a) { return a.tier !== 'professional'; });
    var professionals = report.agencies.filter(function (a) { return a.tier === 'professional'; });
    var firm = parties.filter(function (a) { return a.level === 'required' || a.level === 'likely'; });
    var issues = report.findings.filter(function (f) { return f.level === 'required' || f.level === 'likely'; });
    var parcel = (facts && facts.parcel) || {};
    var scope = scopeItems(project && project.scope_items);
    return {
      parcel: {
        key: parcel.key,
        label: parcel.situs || ('Parcel ' + (parcel.account_no || parcel.key || '')),
        jurisdiction: jurisdictionLabel(facts),
        zoning: parcel.zone_code ? parcel.zone_code + (parcel.zone_name ? ' · ' + parcel.zone_name : '') : null
      },
      project_label: report.project.label,
      estimate: { low: t.base.low, high: t.base.high },
      possible: t.contingent.high ? { low: t.contingent.low, high: t.contingent.high } : null,
      quotes_needed: t.unpriced.length,
      agencies: {
        firm: firm.length,
        possible: parties.length - firm.length,
        professionals: professionals.length,
        list: parties.map(function (a) { return { name: a.name, tier: a.tier, level: a.level, role: a.role || '' }; })
      },
      professionals: professionals.map(function (a) { return { name: a.name, level: a.level, role: a.role || '' }; }),
      issues: issues.map(function (f) { return { title: f.title, level: f.level }; }),
      coverage: { complete: !incomplete(facts, screening, project), unread_layers: unreadLayers(screening) },
      unassessed_scope: scope.map(function (id) { return { id: id, label: SCOPE_ITEMS[id].label }; }),
      checked: (data && data.meta && (data.meta.reference_revision || data.meta.research_date)) || null,
      screened_at: screening && screening.screened_at
    };
  }

  return {
    SCOPE_ITEMS: SCOPE_ITEMS,
    LEVEL_WORDS: LEVEL_WORDS,
    scopeItems: scopeItems,
    incomplete: incomplete,
    unreadLayers: unreadLayers,
    jurisdictionLabel: jurisdictionLabel,
    analyze: analyze,
    evaluate: evaluate,
    summarize: summarize
  };
});
