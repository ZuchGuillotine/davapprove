/*
 * Plain-language outputs built from an engine report: the short "say this in the meeting"
 * flags and a Markdown bid memo that can be pasted into a proposal or email.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BidReport = factory(root.BidEngine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  function money(n) { return '$' + Engine.roundMoney(n).toLocaleString('en-US'); }
  function range(lo, hi) { return Engine.roundMoney(lo) === Engine.roundMoney(hi) ? money(lo) : money(lo) + ' to ' + money(hi); }
  function pct(n) { return n > 0 && n < 1 ? '<1%' : Math.round(n) + '%'; }
  var QUAD_NAME = { NW: 'northwest', NE: 'northeast', SW: 'southwest', SE: 'southeast' };

  /** Short statements for the client meeting, most consequential first. */
  function flags(report, facts, grid, screening) {
    var out = [];
    var incomplete = screening && Object.keys(screening.layers || {}).some(function (id) {
      var layer = screening.layers[id]; return layer.status === 'unknown' || layer.truncated;
    });
    var localUnresolved = facts.jurisdiction && (facts.jurisdiction.status === 'unknown' || facts.jurisdiction.city || facts.jurisdiction.off_reservation_trust);
    // 1. cost flags written by the rules themselves
    report.findings.forEach(function (f) {
      if (!f.flag) return;
      var text = f.flag;
      if (f.costs.some(function (c) { return c.edited || c.excluded || c.unpriced; })) {
        text = f.title + '. Bid allowances: ' + f.costs.map(function (c) {
          return c.label + ' — ' + (c.excluded ? 'excluded' : c.unpriced ? 'quote needed' : range(c.low, c.high) + (c.edited ? ' (your allowance)' : ''));
        }).join('; ') + '.';
      }
      out.push({ level: f.level, text: text, weight: weightOf(f) });
    });
    // 2. spatial flags from the grid
    if (grid) {
      var constrained = grid.totals.core.pct + grid.totals.buffer.pct;
      Object.keys(grid.quadrants).forEach(function (q) {
        var Q = grid.quadrants[q];
        if (Q.share_of_parcel_pct < 8) return;
        if (Q.constrained_pct >= 85 && constrained < 85) {
          var top = Q.by[0] ? Q.by[0].id : null;
          out.push({ level: 'likely', weight: 60 + Q.constrained_pct / 10, quadrant: q, top: top,
            text: 'The ' + QUAD_NAME[q] + ' part of the lot is ' + pct(Q.constrained_pct) + ' inside mapped constraints and standard buffers. Plan the footprint elsewhere unless a study moves the lines.' });
        }
      });
      if (constrained >= 85) {
        out.push({ level: 'required', weight: 95,
          text: pct(constrained) + ' of the lot is inside mapped constraints and indicative buffers. Confirm a viable layout with the relevant professionals and agency; allow for studies and schedule risk before committing to a design.' });
      } else if (constrained < 1 && grid.totals.review.pct < 1 && !incomplete && !localUnresolved && !report.findings.some(function (f) { return f.level === 'unknown'; })) {
        out.push({ level: 'possible', weight: 5, text: 'No mapped critical area, shoreline or flood constraint reaches this lot. Maps miss features, so confirm on a site walk.' });
      }
    }
    // 3. unknowns
    var unknown = report.findings.filter(function (f) { return f.level === 'unknown'; });
    if (unknown.length) {
      out.push({ level: 'unknown', weight: 50, text: unknown.length + ' question' + (unknown.length === 1 ? '' : 's') + ' remain unresolved because source coverage or applicability could not be established. Check the agency follow-ups before relying on the scope.' });
    } else if (incomplete) {
      out.push({ level: 'unknown', weight: 50, text: 'Map coverage is incomplete. Results show only the features returned; do not treat remaining areas as clear.' });
    }
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out.slice(0, 8);
  }

  function weightOf(f) {
    var base = { required: 80, likely: 65, possible: 30, unknown: 40 }[f.level];
    var cost = f.costs.reduce(function (n, c) { return n + (c.unpriced || c.excluded ? 0 : c.high); }, 0);
    return base + Math.min(15, cost / 1500) + (f.flag_weight || 0);
  }

  /** Markdown memo. */
  function memo(report, facts, grid, screening, data, draft) {
    draft = draft || {};
    var L = [], p = facts.parcel, j = facts.jurisdiction, t = report.costs.totals;
    var byId = {}; report.findings.forEach(function (f) { byId[f.id] = f; });
    var where = j.city ? 'City of ' + j.city : 'unincorporated ' + j.county + ' County' + (j.uga ? ' (' + j.uga + ')' : '');
    L.push('# Permitting scope for bid: ' + (draft.title || p.situs || 'parcel ' + p.key));
    L.push('');
    L.push('EARLY BID · UNCONFIRMED. No approved design revision or construction authorization.');
    L.push('');
    L.push('- Tax account: ' + (p.account_no || p.key));
    L.push('- Location: ' + where + (j.reservation ? ', inside ' + j.reservation.name : ''));
    L.push('- Lot: ' + p.acres + ' acres' + (p.zone_code ? ', zoned ' + p.zone_code + (p.zone_name ? ' (' + p.zone_name + ')' : '') : ''));
    L.push('- Project: ' + report.project.label + ' (' + [
      report.project.new_sqft ? report.project.new_sqft.toLocaleString() + ' sq ft building' : null,
      report.project.hard_surface_sqft ? report.project.hard_surface_sqft.toLocaleString() + ' sq ft hard surface' : null,
      report.project.disturbance_sqft ? report.project.disturbance_sqft.toLocaleString() + ' sq ft disturbed' : null,
      report.project.grading_cy ? report.project.grading_cy + ' cu yd grading' : null
    ].filter(Boolean).join(', ') + ')');
    if (report.project.construction_value) L.push('- Supplied construction valuation: ' + money(report.project.construction_value) + '; city valuation not confirmed. Prior planning review: ' + report.project.prior_planning_review + '.');
    L.push('- Screened: ' + screening.screened_at.slice(0, 10) + '. Code and fees checked ' + data.meta.research_date + '.');
    if (data.meta.municipal_fees_checked) L.push('- Municipal fee sources checked: ' + data.meta.municipal_fees_checked + '. Published rates are a research-date baseline; confirm collection date, city valuation, credits and unpriced items.');
    L.push('- Independent agency-routing sources checked: ' + data.routing.checked + '. No county permit record is used to clear tribal, state or federal requirements.');
    L.push('- Agency-scope answers are bid assumptions, not verified agency determinations.');
    Object.keys(Engine.SCOPE_FIELDS).forEach(function (key) {
      var field = Engine.SCOPE_FIELDS[key];
      L.push('  - ' + field.label + ': ' + field.choices[report.project[key]]);
    });
    ['federal_nexus', 'federal_operator', 'common_plan', 'floodplain_modification'].forEach(function (key) {
      if (report.project[key]) L.push('  - Reported: ' + key.replace(/_/g, ' '));
    });
    if (report.project.flood_rise_ft != null) L.push('  - Supplied estimated flood-elevation change: ' + report.project.flood_rise_ft + ' ft; hydraulic result not verified.');
    L.push('');
    L.push('## Bid allowances');
    L.push('');
    L.push('- Add **' + range(t.base.low, t.base.high) + '** to the bid for permit fees and pre-construction studies that are required or likely.');
    if (t.unpriced && t.unpriced.length) L.push('- **Incomplete estimate:** ' + t.unpriced.length + ' items need quotes and are outside the priced subtotal.');
    L.push('- Additional allowances are conditional; alternative scopes may not all apply. No reuse credit is assumed for prior permits.');
    var k = t.by_kind, part = function (key, name) { return k[key] && k[key].base.high ? name + ' ' + range(k[key].base.low, k[key].base.high) : null; };
    var split = [part('agency_fee', 'agency fees'), part('professional', 'studies and consultants'), part('impact_fee', 'impact fees'), part('utility', 'utility connections')].filter(Boolean);
    if (split.length > 1) L.push('  - Of which: ' + split.join('; ') + '.');
    if (t.contingent.high) L.push('- Carry **' + range(t.contingent.low, t.contingent.high) + '** as contingency for items that depend on what is found on site.');
    if (grid && grid.totals.core.pct + grid.totals.buffer.pct < 85 && grid.totals.core.pct + grid.totals.buffer.pct >= 1) L.push('- ' + pct(grid.totals.core.pct + grid.totals.buffer.pct) + ' of the lot is inside mapped constraints and standard buffers.');
    flags(report, facts, grid, screening).forEach(function (f) { L.push('- ' + f.text); });
    if (draft.notes) { L.push(''); L.push('## Bid assumptions and exclusions'); L.push(''); L.push(draft.notes); }
    L.push(''); L.push('## Agency checks beyond county records'); L.push('');
    L.push(data.routing.tribal_contact_limit);
    (report.independent_checks || []).forEach(function (check) {
      L.push('- ' + check.label + ': ' + ({ follow_up: 'see agency scope and follow-up questions', unknown: 'unresolved coverage', no_trigger: 'no trigger in supplied inputs; not a clearance' }[check.status]) + '. ' +
        check.citations.map(function (id) { var c = data.citations[id]; return '[' + c.citation + '](' + c.url + ') (checked ' + c.fetched + ')'; }).join('; '));
    });
    L.push('');
    L.push('## Who is involved');
    L.push('');
    report.agencies.forEach(function (a) {
      L.push('### ' + a.name + ' — ' + a.level);
      a.findings.forEach(function (fid) {
        var f = byId[fid];
        L.push('- **' + f.title + '** (' + f.level + '; ' + (f.basis || 'confirm') + '). ' + f.why);
        if (f.authority_role) L.push('  - Role: ' + f.authority_role + '. Jurisdiction: ' + f.jurisdiction + '. Source check: ' + f.research_date + '. Stage: early bid; no approved design revision.');
        if (f.confirm) L.push('  - Confirm: ' + f.confirm);
        if (f.citations.length) {
          L.push('  - Code: ' + f.citations.map(function (id) { var c = data.citations[id]; return '[' + c.citation + '](' + c.url + ') (checked ' + c.fetched + '; ' + (c.source_currency || (c.verified ? 'source matched' : 'text not verified')) + ')'; }).join('; '));
        }
      });
      L.push('');
    });
    L.push('## Cost lines');
    L.push('');
    L.push('| Item | Payee | Type | Low | High | Basis |');
    L.push('|---|---|---|---:|---:|---|');
    ['base', 'contingent'].forEach(function (bucket) {
      report.costs.items.filter(function (c) { return c.bucket === bucket; }).forEach(function (c) {
        L.push('| ' + c.label + (c.excluded ? ' (EXCLUDED)' : bucket === 'contingent' ? ' (conditional)' : '') + ' | ' + (c.payee || '') + ' | ' + c.kind.replace('_', ' ') + ' | ' + (c.unpriced ? 'Quote needed' : money(c.low)) + ' | ' + (c.unpriced ? 'Quote needed' : money(c.high)) + ' | ' +
          (c.source ? '[' + (c.basis === 'published' ? 'published fee' : 'market range') + '](' + c.source.url + ') · ' + (c.source.date || '') : 'No published price') + (c.edited ? '; your allowance overrides reference' : '') + (c.override_note ? '; ' + c.override_note.replace(/\|/g, '/').replace(/\n/g, ' ') : '') + ' |');
      });
    });
    L.push('| **Base total** | | | **' + money(t.base.low) + '** | **' + money(t.base.high) + '** | |');
    if (t.contingent.high) L.push('| **Contingency total** | | | **' + money(t.contingent.low) + '** | **' + money(t.contingent.high) + '** | |');
    L.push('');
    if (grid) {
      L.push('## Site constraints (screening)');
      L.push('');
      L.push('Potential siting area only: zoning setbacks, agricultural/resource buffers, septic reserves, easements, allowed use and legal lot status are not resolved. Mapped constraints do not prove land is unbuildable or buildable.');
      grid.constraints.filter(function (c) { return c.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; }).forEach(function (c) {
        L.push('- ' + c.label + ': ' + pct(c.pct) + ' of the lot');
      });
      L.push('- By quadrant (share inside mapped features and buffers): ' + ['NW', 'NE', 'SW', 'SE'].filter(function (q) { return grid.quadrants[q].share_of_parcel_pct >= 1; })
        .map(function (q) { return q + ' ' + pct(grid.quadrants[q].constrained_pct); }).join(', '));
      L.push('');
    }
    var P = facts.permits;
    if (P && P.items && P.items.length) {
      L.push('## Permit history (county records)');
      L.push('');
      P.items.slice(0, 15).forEach(function (i) {
        L.push('- ' + i.number + ' · ' + i.type + ' · ' + i.status + (i.submitted ? ' · submitted ' + i.submitted : '') + (i.lapsed ? ' · **lapsed**' : ''));
      });
      L.push('');
    }
    var unknown = Object.keys(screening.layers).filter(function (id) { return screening.layers[id].status === 'unknown' || screening.layers[id].truncated; });
    if (unknown.length) {
      L.push('## Incomplete map coverage');
      L.push('');
      unknown.forEach(function (id) { var layer = screening.layers[id]; L.push('- ' + layer.layer.label + ': ' + (layer.error || (layer.truncated ? 'partial result' : 'no response'))); });
      L.push('');
    }
    Object.keys(screening.tables || {}).forEach(function (id) {
      var table = screening.tables[id];
      if (table.status === 'unknown' || table.truncated) L.push('- Record coverage incomplete: ' + (table.table && table.table.label || id) + ' — ' + (table.error || 'partial result'));
    });
    L.push('---');
    L.push('Screening only. Based on public map layers and published code and fee schedules; maps are approximate at lot scale. Not a survey, delineation, agency determination or legal advice. Agency fees change; consultant figures are market ranges, not quotes.');
    return L.join('\n');
  }

  return { flags: flags, memo: memo, money: money, range: range };
});
