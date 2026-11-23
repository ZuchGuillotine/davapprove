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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./presentation.js'));
  else root.BidEngine = factory(root.BidPresentation);
})(typeof self !== 'undefined' ? self : this, function (Presentation) {
  'use strict';

  var LEVELS = Presentation.LEVELS, LEVEL_RANK = Presentation.LEVEL_RANK;
  var normaliseProject = Presentation.normaliseProject, totals = Presentation.totals, roundMoney = Presentation.roundMoney;

  function landContext(facts, project, data) {
    var j = facts.jurisdiction || {};
    var names = (j.tribal_names || []).concat(j.reservation ? [j.reservation.name] : [], j.off_reservation_trust ? [j.off_reservation_trust] : []);
    var tribal = project.land_status === 'tribal' || names.length > 0 || j.tribal_zoning;
    var conflict = tribal && ['state_local', 'exclusive_federal'].indexOf(project.land_status) >= 0;
    var mode = conflict ? 'unknown' : tribal ? 'tribal' : project.land_status === 'exclusive_federal' ? 'federal' :
      j.military ? 'unknown' : project.land_status === 'state_local' || (j.trust_status === 'none' && j.status !== 'unknown') ? 'state' : 'unknown';
    var tribes = [];
    (data.routing.tribal_name_matches || []).forEach(function (match) {
      if (names.some(function (name) { return new RegExp(match.pattern, 'i').test(name); })) tribes.push(match.agency);
    });
    return { mode: mode, tribes: tribes, names: names, conflict: conflict, missing: j.trust_status === 'unknown' };
  }

  function waterContext(facts, project) {
    var sh = facts.shoreline || {}, wet = facts.wetland || {}, stream = facts.stream || {};
    var marine = project.waterbody === 'marine' || (project.waterbody === 'auto' && sh.marine);
    var navigation = project.navigability;
    if (marine) navigation = navigation === 'no' ? 'unknown' : 'yes';
    return { work: project.in_water, marine: !!marine, navigation: navigation,
      fill: project.fill_discharge, waters: project.waters_us,
      mapped: wet.on_parcel || (stream.streams || []).some(function (s) { return s.on_parcel; }) || (stream.lakes || []).some(function (s) { return s.on_parcel; }),
      missing: wet.status === 'unknown' || stream.status === 'unknown' || sh.status === 'unknown' };
  }

  /**
   * Evaluate all rules. `rules` is an array of { id, agency, topic, evaluate(ctx) } where
   * evaluate returns null, a finding, or an array of findings.
   */
  function evaluate(input) {
    var data = input.data;
    var project = normaliseProject(input.project);
    var ctx = { facts: input.facts, project: project, grid: input.grid || null, data: data, helpers: helpers(data) };
    var findings = [], checks = [];

    input.rules.forEach(function (rule) {
      var out;
      try { out = rule.evaluate(ctx); }
      catch (err) {
        out = { level: 'unknown', basis: 'confirm', title: 'Rule could not be evaluated: ' + rule.id, why: String(err && err.message || err) };
      }
      if (rule.independent) {
        var outcomes = (Array.isArray(out) ? out : out ? [out] : []).filter(Boolean);
        checks.push({ id: rule.id, label: rule.check_label || rule.topic, citations: rule.citations || [],
          status: outcomes.some(function (f) { return f.level === 'unknown'; }) ? 'unknown' : outcomes.length ? 'follow_up' : 'no_trigger',
          source_checked: data.routing.checked });
      }
      if (!out) return;
      (Array.isArray(out) ? out : [out]).forEach(function (f, i) {
        if (!f) return;
        if (LEVELS.indexOf(f.level) < 0) throw new Error('Rule ' + rule.id + ' returned an invalid level: ' + f.level);
        f.id = f.id || rule.id + (i ? '.' + i : '');
        f.rule = rule.id;
        f.agency = f.agency || rule.agency;
        f.topic = f.topic || rule.topic;
        f.work_stage = 'early_bid';
        f.approved_revision = null;
        f.independent = !!rule.independent;
        f.jurisdiction = f.jurisdiction || (rule.independent ? 'Tribal / state / federal: see cited authority' : input.facts.jurisdiction.city || input.facts.jurisdiction.county || 'To confirm');
        f.citations = (f.citations || []).map(function (id) {
          var c = data.citations[id];
          if (!c) throw new Error('Rule ' + rule.id + ' cites unknown citation "' + id + '"');
          return id;
        });
        f.costs = (f.costs || []).map(function (c) { return resolveCost(c, f, data, rule.id); });
        f.research_date = f.citations.reduce(function (date, id) { return data.citations[id].fetched > date ? data.citations[id].fetched : date; }, data.meta.research_date);
        findings.push(f);
      });
    });

    findings.sort(function (a, b) { return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || String(a.topic).localeCompare(String(b.topic)); });
    return {
      project: project,
      findings: findings,
      independent_checks: checks,
      agencies: rollUpAgencies(findings, data),
      costs: rollUpCosts(findings),
      generated_at: new Date().toISOString()
    };
  }

  function helpers(data) {
    return {
      landContext: function (facts, project) { return landContext(facts, project, data); },
      waterContext: waterContext,
      cite: function (id) { return data.citations[id]; },
      rangeText: function (id) { var f = data.fees[id]; return f.confidence === 'unsourced' ? 'quote needed' : '$' + roundMoney(f.low).toLocaleString('en-US') + ' to $' + roundMoney(f.high).toLocaleString('en-US'); },
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
      unpriced: spec.unpriced === true || fee.confidence === 'unsourced',
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

  return Object.assign({ evaluate: evaluate }, Presentation);
});
