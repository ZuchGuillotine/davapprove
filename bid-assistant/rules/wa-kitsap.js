/*
 * Rule set: Kitsap County (county code, health district, local utilities).
 *
 * Every number used here is read from a record in data/citations.json or data/fees.json, so a
 * figure shown to a user always traces to a cited source. Nothing in this file is a legal
 * determination; rules restate published triggers against mapped facts.
 *
 * finding.basis:
 *   documented  the cited text states the trigger
 *   workflow    a recommended step that is good practice but not itself a code requirement
 *   confirm     a question the agency has to answer
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['wa-kitsap'] = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CITY_AGENCY = { 'Bremerton': 'city-bremerton', 'Port Orchard': 'city-port-orchard', 'Poulsbo': 'city-poulsbo', 'Bainbridge Island': 'city-bainbridge' };
  var CITY_CITE = { 'Bremerton': 'city-bremerton', 'Port Orchard': 'city-port-orchard', 'Poulsbo': 'city-poulsbo', 'Bainbridge Island': 'city-bainbridge-island' };
  var STRUCTURE = { new_sfr: 1, adu: 1, addition: 1, accessory: 1, rebuild: 1 };
  var ACRE = 43560;

  function ft(n) { return Math.round(n) + ' ft'; }
  function county(ctx) { return !ctx.facts.jurisdiction.city; }
  function unknownFinding(topic, what, citations) {
    return { level: 'unknown', basis: 'confirm', topic: topic, title: what + ': map layer could not be read', why: 'The map service behind this check did not answer, so the question is open. Run the screening again or check the county map viewer before relying on this report.', citations: citations || [] };
  }

  // ---- numbers pulled from the citation library ------------------------------------------------
  function wetlandBufferRange(data, intensity) {
    var kv = data.citations['kcc-19.200.220'].key_values;
    var idx = { low: 0, moderate: 1, high: 2 }[intensity || 'moderate'];
    var vals = [];
    ['category_I', 'category_II', 'category_III', 'category_IV'].forEach(function (cat) {
      Object.keys(kv[cat]).forEach(function (k) { if (Array.isArray(kv[cat][k])) vals.push(kv[cat][k][idx]); });
    });
    return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) };
  }
  function wetlandSetback(data) { return data.citations['kcc-19.200.220-E'].key_values.building_setback_beyond_buffer_ft; }
  function wetlandReviewDistance(data) { return data.citations['kcc-19.700.710'].key_values.inventory_map_search_distance_ft; }
  function streamBuffers(data) { return data.citations['kcc-19.300.315'].key_values; }
  /** Standard buffer for a mapped water type. Returns { ft, basis } or null where Title 22 governs. */
  function streamBuffer(data, type, inUga) {
    var kv = streamBuffers(data), b = kv.stream_buffer_ft;
    if (type === 'S') return null;
    if (type === 'F') return { ft: b.F, alt: inUga ? kv.uga_alternative_buffer_ft.F : null, label: 'Type F (fish-bearing) stream' };
    if (type === 'Np') return { ft: b.Np, alt: inUga ? kv.uga_alternative_buffer_ft.Np : null, label: 'Type Np (non-fish perennial) stream' };
    if (type === 'Ns') return { ft: b.Ns, alt: inUga ? kv.uga_alternative_buffer_ft.Ns : null, label: 'Type Ns (non-fish seasonal) stream' };
    if (type === 'N') return { ft: b.Np, alt: inUga ? kv.uga_alternative_buffer_ft.Np : null, label: 'Type N (non-fish) stream' };
    return { ft: b.O, upper: b.F, label: 'untyped stream', untyped: true }; // smallest listed width until typed
  }
  function shorelineBuffer(data, designations) {
    var kv = data.citations['kcc-22.400.120-B1'].key_values.standard_buffer_ft, best = null;
    designations.forEach(function (d) { if (typeof kv[d] === 'number' && (!best || kv[d] > best.ft)) best = { ft: kv[d], designation: d }; });
    return best;
  }
  function shorelineSetback(data) { return data.citations['kcc-22.400.120-B4'].key_values.additional_building_setback_ft; }
  function geoScreenDistance(data) { return data.citations['kcc-19.400.440'].key_values.screening_distance_ft; }

  function mappedType(code) {
    var c = String(code || '').trim();
    return (c === 'S' || c === 'F' || c === 'Np' || c === 'Ns' || c === 'N' || c === 'NOCH') ? c : 'U';
  }

  // ---- map constraints for the grid --------------------------------------------------------------
  function constraints(screening, facts, data) {
    var L = screening.layers, out = [];
    var inCity = !!facts.jurisdiction.city;
    function shapes(id, filter) {
      return (L[id] && L[id].features || []).filter(filter || function () { return true; }).map(function (f) { return f.shape; });
    }
    var cityNote = 'Inside city limits: the city sets its own buffers, which are not modelled here.';

    // wetlands
    var wet = shapes('wetland').concat(shapes('nwi'));
    if (wet.length) {
      out.push({ id: 'wetland', short: 'wetland', label: 'Mapped wetland', tier: 'core', shapes: wet, buffer_ft: 0, basis: 'County wetland inventory and National Wetlands Inventory. A delineation sets the real edge.' });
      if (!inCity) {
        var r = wetlandBufferRange(data, 'moderate'), sb = wetlandSetback(data);
        out.push({ id: 'wetland_buffer_min', short: 'wetland buffer', label: 'Wetland buffer, smallest standard width (' + r.min + ' ft) plus ' + sb + ' ft building setback', tier: 'buffer', shapes: wet, buffer_ft: r.min + sb,
          basis: 'KCC 19.200.220: single-family lots are moderate land-use intensity; ' + r.min + ' ft is the Category IV width.' });
        out.push({ id: 'wetland_buffer_max', short: 'possible wetland buffer', label: 'Wetland buffer if the wetland rates high (' + r.max + ' ft) plus ' + sb + ' ft setback', tier: 'review', shapes: wet, buffer_ft: r.max + sb,
          basis: 'KCC 19.200.220: ' + r.max + ' ft applies to Category I or II wetlands with a habitat score of 8 to 9. The category is unknown until the wetland is rated.' });
      }
    }

    // streams and small lakes
    var inUga = !!facts.jurisdiction.uga;
    var groups = {};
    (L.stream && L.stream.features || []).forEach(function (f) {
      var t = mappedType(f.attrs.FP_WTRTY_CD);
      (groups[t] = groups[t] || []).push(f.shape);
    });
    Object.keys(groups).forEach(function (t) {
      if (t === 'S' || t === 'NOCH') return;
      if (inCity) { out.push({ id: 'stream_' + t, short: 'stream', label: 'Mapped stream (' + t + ')', tier: 'core', shapes: groups[t], buffer_ft: 5, basis: cityNote }); return; }
      var b = streamBuffer(data, t, inUga), sb = data.citations['kcc-19.200.220-E'].key_values.building_setback_beyond_buffer_ft;
      out.push({ id: 'stream_' + t, short: 'stream buffer', label: 'Stream buffer, ' + b.label + ' (' + b.ft + ' ft) plus ' + sb + ' ft building setback', tier: 'buffer', shapes: groups[t], buffer_ft: b.ft + sb,
        basis: 'KCC 19.300.315, Table 19.300.315. Measured here from the mapped stream line, not from a located ordinary high water mark.' + (b.alt ? ' Inside a UGA an alternative ' + b.alt + ' ft width is available where the code criteria are met.' : '') });
      if (b.untyped) {
        out.push({ id: 'stream_' + t + '_max', short: 'possible stream buffer', label: 'Stream buffer if typed fish-bearing (' + b.upper + ' ft) plus ' + sb + ' ft setback', tier: 'review', shapes: groups[t], buffer_ft: b.upper + sb,
          basis: 'The stream has no water type on the county map. ' + b.ft + ' ft is the smallest width in Table 19.300.315; ' + b.upper + ' ft applies if it is typed F.' });
      }
    });
    var lakes = shapes('waterbody', function (f) { return String(f.attrs.FP_WTRTY_CD).trim() !== 'S'; });
    if (lakes.length) {
      out.push({ id: 'lake', short: 'pond or lake', label: 'Mapped pond or lake', tier: 'core', shapes: lakes, buffer_ft: 0, basis: 'WA DNR hydrography as served by the county.' });
      if (!inCity) {
        var lb = streamBuffers(data).lakes_less_than_20_acres_buffer_ft;
        out.push({ id: 'lake_buffer', short: 'lake buffer', label: 'Lake buffer, under 20 acres (' + lb + ' ft) plus 15 ft building setback', tier: 'buffer', shapes: lakes, buffer_ft: lb + 15, basis: 'KCC 19.300.315, Table 19.300.315.' });
      }
    }

    // geologic hazards
    var g = (L.geohazard && L.geohazard.classes) || {};
    Object.keys(g).forEach(function (c) {
      var high = /High/.test(c);
      var all = g[c].full.concat(g[c].partial);
      if (!all.length) return;
      out.push({ id: high ? 'geo_high' : 'geo_moderate', short: high ? 'high geologic hazard' : 'moderate geologic hazard',
        label: high ? 'Mapped high geologic hazard area' : 'Mapped moderate geologic hazard area',
        tier: high ? 'core' : 'review', shapes: g[c].full, partial_shapes: g[c].partial, buffer_ft: 0,
        basis: (high ? 'Building here depends on a geotechnical report and the slope setbacks in KCC 19.400.435. ' : 'A geological assessment is required (KCC 19.400.440); the area is not presumptively unbuildable. ') +
          'Sampled in cells of about ' + Math.round(L.geohazard.cell_ft) + ' ft because the county publishes this layer as one county-wide shape.' });
    });

    // shoreline
    var smpUpland = shapes('smp', function (f) { return f.attrs.ENVIRONMENT !== 'AQUATIC'; });
    var smpAquatic = shapes('smp', function (f) { return f.attrs.ENVIRONMENT === 'AQUATIC'; });
    var ohwm = shapes('marine_shore').concat(groups.S || []).concat(shapes('waterbody', function (f) { return String(f.attrs.FP_WTRTY_CD).trim() === 'S'; })).concat(smpAquatic);
    if (!inCity && facts.shoreline.upland_designations.length && ohwm.length) {
      var sbuf = shorelineBuffer(data, facts.shoreline.upland_designations);
      if (sbuf) {
        var ss = shorelineSetback(data);
        out.push({ id: 'shore_buffer', short: 'shoreline buffer', label: 'Shoreline buffer, ' + sbuf.designation + ' (' + sbuf.ft + ' ft) plus ' + ss + ' ft building setback', tier: 'buffer', shapes: ohwm, buffer_ft: sbuf.ft + ss,
          basis: 'KCC 22.400.120(B). Measured here from the mapped shoreline, which only approximates the ordinary high water mark. A reduced standard buffer may be available with mitigation.' });
      }
    }
    if (smpUpland.length) {
      out.push({ id: 'shore_jurisdiction', short: 'shoreline jurisdiction', label: 'Shoreline jurisdiction (mapped designation)', tier: 'review', shapes: smpUpland, buffer_ft: 0,
        basis: inCity ? cityNote : 'KCC 22.200.100: work here needs a shoreline permit or a written exemption.' });
    }

    // flood
    var floodway = shapes('flood', function (f) { return /FLOODWAY/i.test(f.attrs.ZONE_SUBTY || ''); });
    var sfha = shapes('flood', function (f) { return !/FLOODWAY/i.test(f.attrs.ZONE_SUBTY || ''); });
    if (floodway.length) out.push({ id: 'floodway', short: 'floodway', label: 'FEMA regulatory floodway', tier: 'core', shapes: floodway, buffer_ft: 0, basis: 'FEMA National Flood Hazard Layer, effective data.' });
    if (sfha.length) out.push({ id: 'sfha', short: 'flood zone', label: 'FEMA special flood hazard area', tier: 'review', shapes: sfha, buffer_ft: 0,
      basis: 'Building is allowed with a flood hazard permit, elevation above base flood and a habitat plan (KCC 15.12, 15.13).' });
    return out;
  }

  // ---- helpers for rules ---------------------------------------------------------------------------
  function constrainedPct(ctx) { return ctx.grid ? ctx.grid.totals.core.pct + ctx.grid.totals.buffer.pct : null; }
  function clearSqft(ctx) { return ctx.grid ? ctx.grid.totals.clear.sqft + ctx.grid.totals.review.sqft : null; }
  /** True when the lot has too little room outside mapped features and standard buffers to site the work. */
  function tight(ctx) {
    var clear = clearSqft(ctx);
    if (clear == null) return false;
    return clear < Math.max(6000, 2.5 * ctx.project.disturbance_sqft * 0.5) || constrainedPct(ctx) >= 80;
  }
  function range(ctx, id) { var f = ctx.data.fees[id]; return money(f.low) + ' to ' + money(f.high); }
  function money(n) { var s = n < 2000 ? 50 : n < 20000 ? 100 : 500; return '$' + (Math.round(n / s) * s).toLocaleString('en-US'); }

  var rules = [];
  function rule(id, agency, topic, fn) { rules.push({ id: id, agency: agency, topic: topic, evaluate: fn }); }

  // ================= jurisdiction =================
  rule('kitsap.city', 'kitsap-dcd', 'Jurisdiction', function (ctx) {
    var city = ctx.facts.jurisdiction.city;
    if (!city) return null;
    var kv = ctx.data.citations[CITY_CITE[city]].key_values;
    return {
      level: 'required', basis: 'documented', agency: CITY_AGENCY[city],
      title: 'Inside the City of ' + city + ': the city is the permitting authority',
      why: 'The parcel is inside city limits, so land use, critical areas, shoreline and building permits come from the city under its own code (critical areas: ' + kv.critical_areas + '; shoreline: ' + kv.shoreline_master_program + '; zoning: ' + kv.zoning + '). County code sections, county fees and county buffer widths in this tool do not apply. Mapped features are still shown because state and federal rules follow the feature, not the city line.',
      confirm: 'This version does not model city fees or city buffer widths. Use the city fee schedule for the bid.',
      flag: 'This lot is in the City of ' + city + '. Bid from the city fee schedule and code, not the county figures.',
      flag_weight: 20,
      citations: [CITY_CITE[city]]
    };
  });

  rule('kitsap.reservation', 'suquamish', 'Jurisdiction', function (ctx) {
    var j = ctx.facts.jurisdiction;
    if (j.status === 'unknown') return unknownFinding('Jurisdiction', 'City limits, reservation boundary or zoning');
    if (!j.reservation) {
      if (!j.off_reservation_trust) return null;
      return {
        level: 'required', basis: 'confirm', agency: /Klallam/i.test(j.off_reservation_trust) ? 'pgst' : 'suquamish',
        title: 'Mapped as off-reservation trust land (' + j.off_reservation_trust + ')',
        why: 'The state tribal lands compilation maps this location as off-reservation trust land. Land held in trust is generally under tribal and federal jurisdiction rather than county permitting. The layer is reference scale and is not a title record.',
        confirm: 'Confirm the trust status on title and with the tribe before quoting any county permit scope.',
        flag: 'Mapped as tribal trust land: county permitting may not apply at all. Confirm before quoting.', flag_weight: 25,
        citations: ['ecology-tribal-lands-layer', 'tribe-trust-vs-fee-permitting']
      };
    }
    var tribe = j.reservation.tribe === 'pgst' ? 'pgst' : 'suquamish';
    var name = tribe === 'pgst' ? "Port Gamble S'Klallam Tribe" : 'Suquamish Tribe';
    return {
      level: 'required', basis: 'confirm', agency: tribe,
      title: 'Inside the ' + j.reservation.name + ': establish land status before pricing permits',
      why: 'The parcel is inside the reservation boundary. The county boundary layer does not show whether a parcel is held in trust or in fee, and that decides which government issues which permit. ' +
        (j.tribal_zoning ? 'County zoning shows this parcel as Tribal Land, which points to tribal rather than county permitting. ' : 'County zoning shows a county zone here, which usually indicates fee land under county permitting, with the Tribe as an interested government. ') +
        'Neither tribe publishes a simple rule for this online, so it has to be confirmed directly.',
      confirm: 'Ask the ' + name + ' community development or planning office and the title company: is the parcel trust or fee, and which permits does the Tribe issue or review for it?',
      flag: 'The lot is inside the ' + j.reservation.name + '. Confirm trust or fee status with the ' + name + ' before quoting permit scope.',
      flag_weight: 18,
      citations: [tribe === 'pgst' ? 'tribe-pgst-planning' : 'tribe-suquamish-planning', 'tribe-trust-vs-fee-permitting']
    };
  });

  // ================= base county permits =================
  rule('kitsap.building', 'kitsap-dcd', 'Building permit', function (ctx) {
    if (!county(ctx) || !STRUCTURE[ctx.project.type]) return null;
    var p = ctx.project, fees = ctx.data.fees;
    var costs = [];
    void fees;
    var est = estimateBuildingPermit(ctx);
    costs.push({ fee: 'dcd-building-permit', low: est.low, high: est.high, note: est.note });
    if (p.demo) costs.push('dcd-demolition');
    if (p.water === 'well_new' || p.water === 'well_existing') costs.push('dcd-well-water');
    return {
      level: 'required', basis: 'documented',
      title: 'Building permit and plan review',
      why: 'This project (' + p.label.toLowerCase() + ') needs a county building permit. The application is routed to building, planning, development engineering, fire marshal and the health district, and each can add requirements listed elsewhere in this report.',
      citations: ['kcc-21.04.050', 'kcc-19.100.110'],
      costs: costs
    };
  });

  /** Building permit estimate from the published valuation method stored on the fee record. */
  function estimateBuildingPermit(ctx) {
    var f = ctx.data.fees['dcd-building-permit'], m = f.method, sq = ctx.project.new_sqft;
    var garage = ctx.project.type === 'accessory';
    var rate = garage ? m.rates.garage : m.rates.residential;
    var fee = sq * rate * m.multiplier * (1 + m.technology_surcharge) + m.flat;
    return { low: fee, high: fee, note: sq.toLocaleString() + ' sq ft at $' + rate + ' per sq ft ' + (garage ? 'garage' : 'residential') + ' valuation: ' + m.describe + '. Attached garages, decks and separate mechanical or plumbing permits add to this.' };
  }

  rule('kitsap.impact_fees', 'kitsap-dcd', 'Impact fees', function (ctx) {
    if (!county(ctx) || !ctx.project.new_dwelling) return null;
    var replacing = ctx.project.type === 'rebuild';
    var m = ctx.data.fees['kitsap-impact-fees'].method, sq = ctx.project.new_sqft, adu = ctx.project.type === 'adu';
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    var total = (adu ? m.roads_adu : m.roads_sfr) + clamp(sq * m.parks_per_sqft, m.parks_min, m.parks_max) + clamp(sq * m.schools_per_sqft, m.schools_min, m.schools_max);
    return {
      level: replacing ? 'possible' : 'required', basis: 'documented',
      title: 'Impact fees for a new dwelling unit',
      why: replacing ? 'A replacement dwelling normally receives credit for the unit it replaces. Confirm the credit before leaving these out.' :
        'Each new dwelling unit pays county road, park and school impact fees with the building permit. Park and school fees scale with floor area between a published minimum and maximum; an ADU pays half the road fee.',
      confirm: replacing ? 'Ask the county whether the existing dwelling earns a full impact fee credit.' : null,
      flag: replacing ? null : 'Impact fees for the new dwelling are about ' + money(total) + ', due with the building permit. Clients often miss these.',
      flag_weight: -10,
      citations: [],
      costs: [{ fee: 'kitsap-impact-fees', low: total, high: total, note: 'Roads $' + (adu ? m.roads_adu : m.roads_sfr).toLocaleString('en-US') + ', parks $' + m.parks_per_sqft + ' per sq ft, schools $' + m.schools_per_sqft + ' per sq ft, at ' + sq.toLocaleString() + ' sq ft' }]
    };
  });

  // ================= critical areas =================
  rule('kitsap.wetland', 'kitsap-dcd', 'Wetlands', function (ctx) {
    var w = ctx.facts.wetland, d = ctx.data;
    if (w.status === 'unknown') return unknownFinding('Wetlands', 'Wetlands', ['kcc-19.200.215']);
    if (w.status === 'none') return null;
    var review = wetlandReviewDistance(d), r = wetlandBufferRange(d, ctx.project.type === 'short_plat' ? 'high' : 'moderate'), sb = wetlandSetback(d);
    var cites = county(ctx) ? ['kcc-19.200.215', 'kcc-19.700.710', 'kcc-19.200.220', 'kcc-19.200.220-E'] : [];
    var out = [];
    var onParcel = w.status === 'on_parcel';
    var where = onParcel ? 'A wetland is mapped on the lot' : 'A wetland is mapped ' + ft(w.min_distance_ft) + ' to the ' + w.bearing;
    var within = onParcel || w.min_distance_ft <= r.max + sb;
    out.push({
      level: onParcel ? 'required' : within ? 'likely' : 'possible', basis: 'documented', agency: 'wetland-biologist',
      title: 'Wetland delineation and rating',
      why: where + '. ' + (county(ctx) ?
        'County code requires a wetland delineation report from a qualified wetlands specialist for development that could affect a wetland or its largest potential buffer, and inventory maps are checked out to ' + review + ' ft. The buffer for a single-family lot runs from ' + r.min + ' to ' + r.max + ' ft depending on the wetland category and habitat score, plus a ' + sb + ' ft building setback, so the rating decides how much of the lot is usable.' :
        'The city critical areas chapter will set the report and buffer requirements; a delineation is the usual starting point.') +
        (onParcel ? '' : ' An off-site wetland still counts: its buffer can reach onto this lot.'),
      flag: 'Add ' + range(ctx, 'pro-wetland-delineation') + ' for a wetland delineation and rating: ' + where.charAt(0).toLowerCase() + where.slice(1) + '.',
      citations: cites,
      costs: ['pro-wetland-delineation']
    });
    if (county(ctx)) {
      out.push({
        level: onParcel ? 'required' : within ? 'likely' : 'possible', basis: 'documented',
        title: 'County critical areas review of the wetland report',
        why: 'The county reviews the delineation, the rating and the proposed buffer as part of the permit. Reports stay valid for five years. The county fee schedule has no separate line for reviewing a critical area report; review beyond two cycles is billed hourly.',
        confirm: 'Ask the county whether a site evaluation or other review fee applies to the wetland report.',
        citations: ['kcc-19.100.110', 'kcc-19.700.705'],
        costs: [{ fee: 'dcd-site-evaluation', bucket: 'contingent' }]
      });
      if (within) {
        var squeeze = tight(ctx);
        out.push({
          level: squeeze ? 'likely' : 'possible', basis: 'documented', agency: 'wetland-biologist',
          title: 'Wetland mitigation report for buffer averaging or reduction',
          why: squeeze ? 'Mapped features and their standard buffers leave little room on this lot, so the design will probably need buffer averaging or a reduction, which requires a mitigation report.' :
            'Needed only if the footprint cannot stay outside the buffer and building setback once the wetland is rated.',
          citations: ['kcc-19.200.215', 'kcc-19.200.220'],
          costs: ['pro-wetland-mitigation-plan', 'dcd-buffer-reduction']
        });
      }
    }
    return out;
  });

  rule('kitsap.stream', 'kitsap-dcd', 'Streams and habitat', function (ctx) {
    var s = ctx.facts.stream, d = ctx.data;
    if (s.status === 'unknown') return unknownFinding('Streams and habitat', 'Streams and lakes', ['kcc-19.300.315']);
    var waters = s.streams.concat(s.lakes).filter(function (x) { return x.type !== 'S' && x.type !== 'NOCH'; });
    if (!waters.length) return null;
    var inUga = !!ctx.facts.jurisdiction.uga;
    var reach = waters.map(function (x) {
      var b = x.name !== undefined ? { ft: streamBuffers(d).lakes_less_than_20_acres_buffer_ft, label: 'lake or pond' } : streamBuffer(d, x.type, inUga);
      return { w: x, b: b, inside: x.distance_ft <= (b.upper || b.ft) + 15, firm: x.distance_ft <= b.ft + 15 };
    }).filter(function (x) { return x.inside; }).sort(function (a, b) { return a.w.distance_ft - b.w.distance_ft; });
    if (!reach.length) return null;
    var n = reach[0], out = [];
    var where = n.w.on_parcel ? 'crosses or touches the lot' : 'is mapped ' + ft(n.w.distance_ft) + ' to the ' + n.w.bearing;
    if (!county(ctx)) {
      return { level: 'likely', basis: 'confirm', agency: 'wetland-biologist', title: 'Stream or lake buffer under the city critical areas chapter', why: 'A ' + n.b.label + ' ' + where + '. The city sets the buffer width and report requirements.', citations: [], costs: ['pro-hmp'], bucket: 'contingent' };
    }
    out.push({
      level: n.firm ? 'required' : 'likely', basis: 'documented',
      title: 'Buffer for a ' + n.b.label + ': ' + n.b.ft + ' ft plus 15 ft building setback',
      why: 'A ' + n.b.label + ' ' + where + '. Table 19.300.315 sets a ' + n.b.ft + ' ft buffer for this water type' + (n.b.alt ? ' (an alternative ' + n.b.alt + ' ft width exists inside urban growth areas where the code criteria are met)' : '') +
        ', with buildings and hard surfaces a further 15 ft back. Widths for Type F, Np and Ns waters were increased when the 2024 critical areas update took effect on April 1, 2025, so older site plans for this lot may show smaller buffers.' +
        (n.b.untyped ? ' The water is untyped on the county map; ' + n.b.ft + ' ft is the smallest width in the table and ' + n.b.upper + ' ft applies if it is found to be fish-bearing.' : ''),
      flag: n.firm ? 'A ' + n.b.label + ' ' + where + ': keep buildings ' + (n.b.ft + 15) + ' ft from it, or budget a habitat management plan.' : null,
      citations: ['kcc-19.300.315', 'kcc-19.300.310'],
      costs: []
    });
    if (reach.some(function (x) { return x.b.untyped || x.w.type === 'N'; })) {
      out.push({
        level: 'possible', basis: 'workflow', agency: 'wetland-biologist',
        title: 'Water type verification',
        why: 'The mapped water type is ' + (n.b.untyped ? 'missing' : 'not split into perennial or seasonal') + '. A biologist can verify the type in the field; the result can move the buffer in either direction.',
        citations: ['kcc-19.300.310'],
        costs: ['pro-stream-typing']
      });
    }
    var squeeze = tight(ctx);
    out.push({
      level: squeeze ? 'likely' : 'possible', basis: 'documented', agency: 'wetland-biologist',
      title: 'Habitat management plan',
      why: squeeze ? 'Mapped features and their standard buffers leave little room on this lot. Reducing or averaging a stream buffer requires a habitat management plan prepared by a fish or wildlife biologist.' :
        'Required only if the design needs a stream buffer reduction or averaging, or if the county identifies a protected wildlife habitat on the lot.',
      citations: ['kcc-19.300.315-hmp'],
      costs: ['pro-hmp', 'dcd-buffer-reduction']
    });
    return out;
  });

  rule('kitsap.geohazard', 'kitsap-dcd', 'Geologic hazards', function (ctx) {
    var g = ctx.facts.geohazard, d = ctx.data;
    if (g.status === 'unknown') return unknownFinding('Geologic hazards', 'Geologically hazardous areas', ['kcc-19.400.440']);
    if (g.status === 'none') return null;
    var dist = geoScreenDistance(d);
    var cites = county(ctx) ? ['kcc-19.400.440', 'kcc-19.400.435', 'kcc-19.700.725'] : [];
    var grid = ctx.grid, hp = 0, mp = 0;
    if (grid) grid.constraints.forEach(function (c) { if (c.id === 'geo_high') hp = c.pct; if (c.id === 'geo_moderate') mp = c.pct; });
    var cov = function (p) { return p >= 1 ? 'about ' + Math.round(p) + '% of the lot' : 'a small part of the lot'; };
    if (g.high) {
      return {
        level: 'required', basis: 'documented', agency: 'geotech',
        title: 'Geotechnical report: mapped high geologic hazard',
        why: 'The county hazard map shows a high hazard area over ' + cov(hp) + (g.moderate ? ' and a moderate hazard area over ' + cov(mp) : '') + '. ' + (county(ctx) ?
          'A geological assessment is required for any activity in a potential hazard area, and where engineering or mitigation is needed it must be a geotechnical report by a geotechnical engineer. For a high landslide hazard the setback from the top of slope is the slope height plus the greater of one third of that height or 25 ft, unless the report supports less. The map does not say whether the hazard is landslide, erosion or seismic; the report settles that.' :
          'The city critical areas chapter sets the report requirement; a geotechnical report is the usual expectation on high hazard ground.'),
        flag: 'Add ' + range(ctx, 'pro-geotech-report') + ' for a geotechnical report: mapped high geologic hazard covers ' + cov(hp) + '.',
        flag_weight: 6,
        citations: cites,
        costs: ['pro-geotech-report']
      };
    }
    if (g.moderate) {
      return {
        level: 'required', basis: 'documented', agency: 'geotech',
        title: 'Geological assessment: mapped moderate geologic hazard',
        why: 'The county hazard map shows a moderate hazard area over ' + cov(mp) + '. ' + (county(ctx) ?
          'A geological assessment is required. Depending on what the geologist finds within ' + dist + ' ft, it is a stamped letter, a geological report, or a full geotechnical report if engineering is needed. Budget the letter or report and carry the full geotechnical report as a contingency.' :
          'The city critical areas chapter sets the report requirement.'),
        flag: 'Add ' + range(ctx, 'pro-geo-assessment') + ' for a geological assessment: mapped moderate geologic hazard covers ' + cov(mp) + '.',
        citations: cites,
        costs: ['pro-geo-assessment', { fee: 'pro-geotech-report', bucket: 'contingent', note: 'only if the assessment finds engineering or mitigation is needed' }]
      };
    }
    // mapped nearby but not on the lot
    return {
      level: 'likely', basis: 'documented', agency: 'geotech',
      title: 'Geological letter: hazard area mapped within ' + dist + ' ft',
      why: 'A ' + g.near_classes.join(' and ').toLowerCase() + ' hazard area is mapped within ' + dist + ' ft of the lot but not on it. The county screens hazards out to ' + dist + ' ft, and slope setbacks can reach across a property line.',
      citations: cites,
      costs: ['pro-geo-assessment']
    };
  });

  rule('kitsap.cara', 'kitsap-dcd', 'Aquifer recharge', function (ctx) {
    var c = ctx.facts.cara;
    if (!county(ctx)) return null;
    if (c.status === 'unknown') return unknownFinding('Aquifer recharge', 'Critical aquifer recharge areas', ['kcc-19.600.610']);
    if (!c.category_1 && !c.category_2) return null;
    var cat = c.category_1 ? 'Category I' : 'Category II';
    return {
      level: 'possible', basis: 'documented',
      title: cat + ' critical aquifer recharge area' + (c.names.length ? ' (' + c.names.join(', ') + ')' : ''),
      why: 'The lot is in a mapped ' + cat + ' aquifer recharge area. This matters only for the uses listed in Table 19.600.620 (activities that threaten groundwater). ' +
        (c.category_1 ? 'In Category I those uses are prohibited unless a waiver supported by a hydrogeological report is granted.' : 'In Category II the county, the health district and the water purveyor decide whether a hydrogeological report is needed.') +
        ' An ordinary house is not normally a listed use, so this is carried as a contingency.',
      confirm: 'Check the proposed use against Table 19.600.620 if it involves anything beyond a residence.',
      citations: ['kcc-19.600.610', 'kcc-19.600.615', 'kcc-19.700.730'],
      costs: ctx.project.type === 'short_plat' ? ['pro-hydrogeo'] : []
    };
  });

  // ================= flood =================
  rule('kitsap.flood', 'kitsap-dcd', 'Flood hazard', function (ctx) {
    var f = ctx.facts.flood;
    if (f.status === 'unknown') return unknownFinding('Flood hazard', 'FEMA flood zones', ['kcc-15.12.010']);
    if (!f.sfha_on_parcel) {
      if (!f.nearby) return null;
      return { level: 'possible', basis: 'workflow', agency: 'surveyor', title: 'Flood zone mapped next to the lot',
        why: 'A FEMA special flood hazard area is mapped within 100 ft but does not reach the lot on the effective map. Flood lines are drawn at coarse scale; confirm the building site elevation if it is low or near the water.', citations: ['cfr-44-60.3-permits'], costs: [] };
    }
    var fp = 0; if (ctx.grid) ctx.grid.constraints.forEach(function (c) { if (c.id === 'sfha' || c.id === 'floodway') fp += c.pct; });
    var zone = 'Zone ' + f.zones.join(', ') + (f.bfe_ft ? ', base flood elevation ' + f.bfe_ft + ' ft' : '');
    if (!county(ctx)) {
      return { level: 'required', basis: 'documented', agency: 'surveyor', title: 'Flood zone: elevation certificate', why: 'About ' + Math.round(fp) + '% of the lot is in a FEMA special flood hazard area (' + zone + '). The city applies its own flood ordinance under the federal minimums.', citations: ['cfr-44-60.3-permits', 'cfr-44-60.3-lowest-floor'], costs: ['pro-elevation-cert'] };
    }
    var out = [{
      level: 'required', basis: 'documented',
      title: 'Flood hazard development permit',
      why: 'About ' + Math.round(fp) + '% of the lot is in a FEMA special flood hazard area (' + zone + '). Development there needs a county flood permit showing the lowest floor elevation, and new homes must have the lowest floor at least one foot above base flood elevation.' +
        (f.coastal_high_hazard ? ' Part of the lot is a coastal high hazard (V) zone, which brings pile or column foundations and engineer certification.' : '') +
        (f.floodway ? ' Part of the lot is regulatory floodway, where new structures are generally not allowed.' : ''),
      flag: 'About ' + Math.round(fp) + '% of the lot is FEMA flood zone (' + zone + '): add an elevation certificate and a floodplain habitat plan if the building touches it.',
      citations: ['kcc-15.12.010', 'kcc-15.12.090', 'cfr-44-60.3-permits'],
      confirm: 'The county fee schedule lists no flood permit review fee. Ask whether one applies.',
      costs: []
    }, {
      level: 'required', basis: 'documented', agency: 'surveyor',
      title: 'Elevation certificate',
      why: 'The flood permit needs the lowest floor elevation certified against base flood elevation, before and after construction.',
      citations: ['kcc-15.12.010', 'cfr-44-60.3-lowest-floor'],
      costs: ['pro-elevation-cert']
    }, {
      level: 'required', basis: 'documented', agency: 'wetland-biologist',
      title: 'Floodplain habitat plan',
      why: 'Before development in the floodplain, the county requires a habitat plan by a qualified wildlife biologist showing compliance with the federal flood insurance program standards for listed species.',
      confirm: 'This section was checked against the county code as archived in December 2019. Confirm the current wording.',
      citations: ['kcc-15.13.010'],
      costs: ['pro-flood-habitat']
    }];
    return out;
  });

  // ================= shoreline =================
  rule('kitsap.shoreline', 'kitsap-dcd', 'Shoreline', function (ctx) {
    var s = ctx.facts.shoreline, p = ctx.project, d = ctx.data;
    if (s.status === 'unknown') return unknownFinding('Shoreline', 'Shoreline designations', ['kcc-22.200.100']);
    if (!s.in_jurisdiction) {
      if (s.marine && s.marine_distance_ft <= 250) {
        return { level: 'possible', basis: 'confirm', title: 'Shoreline jurisdiction not mapped on the lot, but the shore is ' + ft(s.marine_distance_ft) + ' away',
          why: 'Shoreline jurisdiction runs 200 ft landward of the ordinary high water mark located on the ground, plus associated wetlands. The mapped designation does not reach the lot, but the mapped shoreline is close enough that the line should be confirmed.',
          confirm: 'Ask the county whether any part of the lot is within 200 ft of the ordinary high water mark.', citations: ['kcc-22.200.100', 'rcw-90.58.030-shorelands'], costs: [] };
      }
      return null;
    }
    if (!county(ctx)) {
      return { level: 'required', basis: 'documented', agency: CITY_AGENCY[ctx.facts.jurisdiction.city], title: 'Shoreline permit or exemption from the city', why: 'Part of the lot is in shoreline jurisdiction. The city administers its own shoreline master program under the state Shoreline Management Act.', citations: ['rcw-90.58.140', 'rcw-90.58.030-shorelands'], costs: [] };
    }
    var up = s.upland_designations, buf = shorelineBuffer(d, up), ss = shorelineSetback(d);
    var sp = 0; if (ctx.grid) ctx.grid.constraints.forEach(function (c) { if (c.id === 'shore_buffer') sp = c.pct; });
    var desig = up.length ? up.join(' and ') : s.designations.join(' and ');
    var out = [];
    var thr = d.citations['rcw-90.58.030-substantial-development'].key_values.current_adjusted_threshold_usd;
    if (p.type === 'shoreline_structure') {
      out.push({
        level: 'required', basis: 'documented',
        title: 'Shoreline permit for a dock, bulkhead or similar structure',
        why: 'The lot is in shoreline jurisdiction (' + desig + '). A new pier or dock needs a shoreline substantial development permit and a pre-application meeting, and the applicant must first show that a mooring buoy and a joint-use dock are not feasible' +
          (up.indexOf('Natural') >= 0 ? '; next to a Natural designation a single-use dock is prohibited' : '') +
          '. New or enlarged hard shoreline armoring needs an administrative conditional use permit and a geotechnical analysis demonstrating need; soft stabilization needs a substantial development permit unless exempt. Conditional use permits and variances go to the Department of Ecology for the final decision.',
        flag: up.indexOf('Natural') >= 0 ? 'The shoreline is designated Natural: a single-use dock is prohibited here. Raise this before any design work.' : 'A dock or bulkhead here is a multi-agency shoreline permit: county, Ecology, WDFW, the Corps and usually DNR.',
        flag_weight: up.indexOf('Natural') >= 0 ? 25 : 8,
        citations: ['kcc-22.600.160', 'kcc-22.600.160-B1', 'kcc-22.600.175-A', 'kcc-22.600.175-C2', 'kcc-22.500.100-B', 'kcc-22.500.100-D'],
        costs: [d.fees['dcd-shoreline-sdp'] ? 'dcd-shoreline-sdp' : null, d.fees['dcd-shoreline-acup'] ? { fee: 'dcd-shoreline-acup', bucket: 'contingent', note: 'if hard armoring or another conditional use is proposed' } : null].filter(Boolean)
      }, {
        level: 'required', basis: 'documented', agency: 'shoreline-consultant',
        title: 'Shoreline application package and no-net-loss report',
        why: 'In-water and over-water proposals are applied for on the Joint Aquatic Resources Permit Application with habitat surveys and a report showing no net loss of shoreline ecological functions.',
        citations: ['kcc-22.600.160', 'kcc-22.500.100-C2'],
        costs: ['pro-jarpa', 'pro-shoreline-nnl']
      }, {
        level: 'likely', basis: 'documented', agency: 'geotech',
        title: 'Geotechnical analysis of need for shoreline stabilization',
        why: 'Required if the project includes new, enlarged or replacement hard armoring: the code allows it only where a geotechnical report demonstrates need.' + (s.armoring.length ? ' The county armoring inventory shows an existing structure on or next to this lot (' + s.armoring.map(function (a) { return String(a.type || 'structure').toLowerCase() + (a.material ? ', ' + String(a.material).toLowerCase() : ''); }).join('; ') + ').' : ''),
        citations: ['kcc-22.600.175-C2'],
        costs: ['pro-geotech-report']
      });
    } else {
      var exempt = (p.type === 'new_sfr' || p.type === 'rebuild' || p.type === 'addition' || p.type === 'adu' || p.type === 'accessory');
      out.push({
        level: 'required', basis: 'documented',
        title: exempt ? 'Shoreline exemption or substantial development permit' : 'Shoreline substantial development permit',
        why: 'Part of the lot is in shoreline jurisdiction (' + desig + '), which runs 200 ft landward of the ordinary high water mark. ' +
          (exempt ? 'An owner building a single-family home for their own use, no taller than 35 ft, is exempt from the substantial development permit but still needs a written statement of exemption and must meet every shoreline standard. A builder or investor building for sale does not get that exemption, and any other development worth more than $' + thr.toLocaleString() + ' needs the permit.' :
            'Development worth more than $' + thr.toLocaleString() + ' needs a shoreline substantial development permit, a Type III decision with a public hearing.') +
          (buf ? ' The standard buffer for ' + buf.designation + ' is ' + buf.ft + ' ft from the ordinary high water mark, plus a ' + ss + ' ft building setback' + (sp >= 1 ? '; measured from the mapped shoreline that covers about ' + Math.round(sp) + '% of the lot' : '') + '.' : ''),
        confirm: exempt ? 'Is the client the owner-occupant? If not, price the substantial development permit instead of the exemption.' : null,
        flag: buf ? 'Shoreline lot (' + buf.designation + '): ' + buf.ft + ' ft buffer plus ' + ss + ' ft setback from the water' + (sp >= 1 ? ', about ' + Math.round(sp) + '% of the lot' : '') + '. Owner-occupant gets an exemption letter; anyone else needs a shoreline permit.' : null,
        flag_weight: 5,
        citations: ['kcc-22.200.100', 'kcc-22.500.100-C', 'kcc-22.400.120-B1', 'kcc-22.400.120-B4', 'rcw-90.58.030-substantial-development', 'wsr-22-11-036'],
        costs: [d.fees['dcd-shoreline-exemption'] && exempt ? 'dcd-shoreline-exemption' : null,
          d.fees['dcd-shoreline-sdp'] ? (exempt ? { fee: 'dcd-shoreline-sdp', bucket: 'contingent', note: 'if the owner-occupant exemption does not apply' } : 'dcd-shoreline-sdp') : null].filter(Boolean)
      });
      var squeeze = tight(ctx) || sp >= 60;
      out.push({
        level: squeeze ? 'likely' : 'possible', basis: 'documented', agency: 'shoreline-consultant',
        title: 'Shoreline mitigation plan for a reduced buffer',
        why: squeeze ? 'The standard shoreline buffer and setback take up most of the usable part of this lot. Building closer relies on the reduced standard buffer' + reducedText(d, buf) + ', which requires a mitigation plan showing no net loss of shoreline ecological functions.' :
          'Needed only if the building cannot stay behind the standard buffer and setback.',
        citations: ['kcc-22.400.120-B2'],
        costs: ['pro-shoreline-nnl', 'dcd-buffer-reduction']
      });
    }
    return out;
  });
  function reducedText(d, buf) {
    if (!buf) return '';
    var v = d.citations['kcc-22.400.120-B2'].key_values.reduced_standard_buffer_ft[buf.designation];
    return v ? ' (' + (typeof v === 'number' ? v + ' ft' : v) + ' for ' + buf.designation + ')' : '';
  }

  // ================= site development and stormwater =================
  rule('kitsap.sdap', 'kitsap-dcd', 'Site development and stormwater', function (ctx) {
    if (!county(ctx)) return null;
    var p = ctx.project, d = ctx.data, f = ctx.facts;
    var t10 = d.citations['kcc-12.10.030'].key_values, a = d.citations['kcc-12.20.010-A'].key_values, b = d.citations['kcc-12.20.010-B'].key_values;
    var urban = !!f.jurisdiction.uga;
    var fullThreshold = urban ? b.inside_census_urban_areas.new_plus_replaced_hard_surface_sqft : Math.max(10000, 0.05 * f.parcel.area_sqft);
    var reasons = [], sdap = false, engineered = false;
    if (p.grading_cy >= t10.grading_volume_trigger_cubic_yards) { sdap = true; reasons.push(p.grading_cy + ' cu yd of grading meets the ' + t10.grading_volume_trigger_cubic_yards + ' cu yd threshold'); }
    if (p.hard_surface_sqft >= fullThreshold || p.grading_cy >= b.grading_cubic_yards) { sdap = true; engineered = true; reasons.push(p.hard_surface_sqft.toLocaleString() + ' sq ft of new and replaced hard surface meets the ' + Math.round(fullThreshold).toLocaleString() + ' sq ft threshold for Minimum Requirements 1 to 9'); }
    var inSetback = (f.wetland.status === 'on_parcel' || f.stream.status === 'on_parcel' || f.geohazard.high || f.shoreline.in_jurisdiction);
    if (inSetback && tight(ctx)) { sdap = true; reasons.push('clearing or grading is likely inside the mandatory setback of a steep slope, wetland, stream, lake or Puget Sound'); }
    var small = p.hard_surface_sqft >= a.MR1_5_hard_surface_sqft || p.disturbance_sqft >= a.MR1_5_land_disturbance_sqft;
    var out = [];
    if (sdap) {
      out.push({
        level: 'required', basis: 'documented',
        title: 'Site Development Activity Permit' + (engineered ? ' with engineered plans' : ''),
        why: 'Triggered because ' + reasons.join('; and ') + '.' + (engineered ? ' At this scale a licensed professional engineer must prepare the plans.' : ''),
        confirm: urban ? null : 'The hard-surface threshold depends on whether the lot is in a census-defined urban area. This tool treats lots outside urban growth areas as outside; confirm with development engineering.',
        flag: 'Add a Site Development Activity Permit' + (engineered ? ' with civil engineering' : '') + ': ' + reasons[0] + '.',
        citations: ['kcc-12.10.030', 'kcc-12.20.010-B', 'kcc-12.10.060'],
        costs: [sdapFee(p), engineered ? 'pro-civil-sdap' : { fee: 'pro-civil-sdap', bucket: 'contingent', note: 'if the county requires engineered plans' }]
      });
    } else if (small) {
      out.push({
        level: 'required', basis: 'documented',
        title: 'Stormwater site plan with the building permit (Minimum Requirements 1 to 5)',
        why: 'The project adds or replaces at least ' + a.MR1_5_hard_surface_sqft.toLocaleString() + ' sq ft of hard surface or disturbs at least ' + a.MR1_5_land_disturbance_sqft.toLocaleString() + ' sq ft, so Minimum Requirements 1 to 5 apply: a stormwater site plan, erosion control and on-site stormwater management. It stays below the thresholds for a separate Site Development Activity Permit as described (' +
          p.grading_cy + ' cu yd of grading, ' + p.hard_surface_sqft.toLocaleString() + ' sq ft of hard surface).',
        confirm: 'Grading of ' + t10.grading_volume_trigger_cubic_yards + ' cu yd or more, or any clearing inside a critical area setback, moves this to a Site Development Activity Permit.',
        citations: ['kcc-12.20.010-A', 'kcc-12.10.030'],
        costs: [{ fee: 'dcd-simplified-drainage', bucket: 'contingent', note: 'if the drainage design has to be engineered' }, { fee: 'pro-civil-sdap', bucket: 'contingent', note: 'if soils or slopes rule out the simple drainage worksheets' }]
      });
    }
    return out;
  });

  function sdapFee(p) {
    if (p.type === 'short_plat') return 'dcd-sdap-short-plat';
    if (STRUCTURE[p.type]) return 'dcd-sdap-sfr';
    return p.grading_cy > 5000 ? 'dcd-sdap-grading-3' : p.grading_cy > 500 ? 'dcd-sdap-grading-2' : p.grading_cy >= 150 ? 'dcd-sdap-grading-1' : 'dcd-sdap-minor';
  }

  // ================= septic, sewer and water =================
  rule('kitsap.wastewater', 'kphd', 'Septic and sewer', function (ctx) {
    var p = ctx.project, f = ctx.facts, d = ctx.data;
    var plumbed = p.new_dwelling || p.bedrooms > 0 || p.type === 'addition' || p.type === 'short_plat';
    if (!plumbed) return null;
    var dist = d.citations['kcc-13.12.020'].key_values.distance_to_sewer_main_ft;
    var sewerLikely = !!f.sewer.in_county_service_area || (f.sewer.main_distance_ft != null && f.sewer.main_distance_ft <= dist);
    var mode = p.wastewater;
    if (mode === 'unknown') {
      if (f.sewer.status === 'unknown') return unknownFinding('Septic and sewer', 'Sewer service area');
      mode = sewerLikely || f.parcel.assessor_sewer === 'Y' || f.jurisdiction.city ? 'sewer' : (f.parcel.vacant === false && (p.type === 'addition' || p.type === 'adu' || p.type === 'accessory' || p.type === 'rebuild') ? 'septic_existing' : 'septic_new');
      var guessed = true;
    }
    var out = [];
    if (mode === 'sewer') {
      var mustConnect = !!f.jurisdiction.uga && f.sewer.main_distance_ft != null && f.sewer.main_distance_ft <= dist;
      out.push({
        level: guessed && !sewerLikely ? 'likely' : 'required', basis: 'documented', agency: 'sewer-utility',
        title: 'Sewer availability and connection',
        why: (f.sewer.in_county_service_area ? 'The lot is in the county ' + f.sewer.in_county_service_area + ' sewer service area' : f.jurisdiction.city ? 'The lot is inside a city, where sewer is normally the city or district utility' : 'The assessor record flags sewer as available') +
          (f.sewer.main_distance_ft != null ? '; a county gravity main is mapped about ' + ft(f.sewer.main_distance_ft) + ' from the lot' : '') + '. ' +
          (mustConnect ? 'Inside an urban growth area, a building within ' + dist + ' ft of a public sewer must connect. ' : '') +
          'A new connection pays the utility connection charge, and the sewer utility has to confirm availability before the building permit.' + (p.new_dwelling && !f.sewer.in_county_service_area ? ' The lot is not in a county-operated sewer area, so the connection charge comes from the city or district utility and is not priced here.' : ''),
        confirm: guessed ? 'Wastewater was not specified; sewer is assumed from the ' + (sewerLikely ? 'sewer map' : 'assessor record') + '. Change it under project assumptions if the lot is on septic.' : null,
        citations: ['kcc-13.12.020'],
        costs: (p.new_dwelling && f.sewer.in_county_service_area ? ['sewer-connection'] : []).concat(STRUCTURE[p.type] && !f.jurisdiction.city ? [{ fee: 'kphd-building-clearance-sewered', agency: 'kphd' }] : [])
      });
      return out;
    }
    if (mode === 'septic_new') {
      out.push({
        level: 'required', basis: 'documented',
        title: 'Building Site Application for a new septic system',
        why: 'New construction on septic needs a Building Site Application approved by the health district before the building permit can issue. A licensed designer prepares it; it covers the septic system and the water supply, and fixes the drainfield and reserve area on the site plan.' +
          (ctx.facts.wetland.status !== 'none' || ctx.facts.stream.status !== 'none' ? ' Septic components carry their own setbacks from wells, surface water and slopes, on top of the critical area buffers above, so the drainfield location should be settled alongside the building footprint.' : ''),
        confirm: guessed ? 'Wastewater was not specified; a new septic system is assumed because no sewer is mapped. Change it under project assumptions if needed.' : null,
        flag: 'New septic: add ' + range(ctx, 'pro-septic-design') + ' for design plus the health district application fee, before construction cost.',
        citations: ['kphd-2025-01-s10-bsa', 'kphd-2025-01-table-1a', 'wac-246-272A-0210'],
        costs: ['kphd-bsa', 'kphd-sewage-permit']
      }, {
        level: 'required', basis: 'documented', agency: 'septic-designer',
        title: 'Septic design and soil evaluation',
        why: 'The Building Site Application has to be prepared by a licensed on-site sewage system designer or engineer, based on soil logs dug on the lot.',
        citations: ['kphd-2025-01-s10-bsa'],
        costs: ['pro-septic-design']
      });
      return out;
    }
    // existing septic
    var more = p.type === 'adu' || (p.bedrooms > 0 && p.type !== 'rebuild');
    out.push({
      level: 'required', basis: 'documented',
      title: more ? 'Health district review: added bedrooms or a second dwelling on an existing septic system' : 'Building Clearance for an existing septic system',
      why: more ? 'Adding bedrooms or another habitable structure beyond the permitted design capacity of the existing system requires a Building Site Application for a new or modified system, not just a clearance. Whether the existing system has capacity depends on its permit record.' :
        'A building permit on a lot served by septic needs a Building Clearance from the health district confirming the work does not encroach on the system or its reserve area.',
      confirm: guessed ? 'Wastewater was not specified; an existing septic system is assumed. Change it under project assumptions if needed.' : (more ? 'Pull the septic record: how many bedrooms is the system permitted for?' : null),
      flag: more ? 'Existing septic with added bedrooms: expect a septic redesign or expansion, not just a clearance.' : null,
      citations: ['kphd-2025-01-s11-building-clearance', 'kphd-policy-os-06'],
      costs: [d.fees['kphd-building-clearance'] ? 'kphd-building-clearance' : null,
        more || p.type === 'rebuild' ? { fee: 'pro-septic-design', bucket: 'contingent', note: p.type === 'rebuild' ? 'if the replacement home has more bedrooms than the system is permitted for, or the old system has no permit record' : 'if the existing system cannot take the added flow' } : null,
        more && d.fees['kphd-bsa'] ? { fee: 'kphd-bsa', bucket: 'contingent', note: 'if a new or modified system is required' } : null].filter(Boolean)
    });
    return out;
  });

  // ================= accessory dwelling units =================
  rule('kitsap.adu', 'kitsap-dcd', 'Land use', function (ctx) {
    if (!county(ctx) || ctx.project.type !== 'adu') return null;
    var f = ctx.facts, d = ctx.data, kv = d.citations['kcc-17.415-adu'].key_values, r = d.citations['kcc-17.415.015'].key_values;
    if (f.jurisdiction.uga) {
      return { level: 'possible', basis: 'documented', title: 'Urban ADU: construction permits only',
        why: 'Inside an urban growth area up to ' + kv.urban_max_ADUs_per_lot + ' accessory dwelling units are allowed per lot, and they must connect to urban sewer and water. No separate land use permit is listed in the county handout.',
        confirm: 'The urban size limit was not confirmed from code text. Check KCC 17.415.010.', citations: ['kcc-17.415-adu'], costs: [] };
    }
    return {
      level: 'required', basis: 'documented',
      title: 'Conditional use permit for a detached rural ADU',
      why: 'Outside urban growth areas only one accessory dwelling unit is allowed per lot. A detached one needs a conditional use permit on top of the construction permits, is limited to the smaller of 50% of the main home or 900 sq ft, must sit within 150 ft of the main home, and the owner must live in one of the two units. An attached ADU needs construction permits only.',
      confirm: ctx.project.new_sqft > 900 ? 'The assumed ADU is ' + ctx.project.new_sqft + ' sq ft, over the 900 sq ft rural limit.' : 'These limits come from the county ADU handout (February 2026) and a 2025 staff report quoting the code; confirm against KCC 17.415.015.',
      flag: 'Rural detached ADU: add a conditional use permit' + (d.fees['dcd-cup-adu'] ? ' (' + range(ctx, 'dcd-cup-adu') + ')' : '') + ' and its hearing timeline. Attaching the unit avoids it.',
      flag_weight: 8,
      citations: ['kcc-17.415-adu', 'kcc-17.415.015', 'kcc-21.04.050'],
      costs: d.fees['dcd-cup-adu'] ? ['dcd-cup-adu'] : []
    };
  });

  // ================= land division =================
  rule('kitsap.short_plat', 'kitsap-dcd', 'Land division', function (ctx) {
    if (!county(ctx) || ctx.project.type !== 'short_plat') return null;
    var f = ctx.facts, d = ctx.data, kv = d.citations['kcc-16.48.010'].key_values, lots = ctx.project.lots || 2;
    var max = f.jurisdiction.uga ? kv.max_lots_inside_UGA : kv.max_lots_outside_UGA;
    return [{
      level: 'required', basis: 'documented',
      title: 'Preliminary and final short plat',
      why: 'Dividing into ' + lots + ' lots is a short subdivision (up to ' + max + ' lots ' + (f.jurisdiction.uga ? 'inside' : 'outside') + ' an urban growth area). Each new lot must meet the zone density' + (f.parcel.zone_density ? ' (' + f.parcel.zone_density + ')' : '') + ', and the application is reviewed for access, drainage, septic or sewer for every lot, and critical areas across the whole parent parcel.',
      confirm: lots > max ? lots + ' lots exceeds the short plat limit here; this would be a full subdivision.' : 'Check that the zone density allows ' + lots + ' lots on ' + f.parcel.acres + ' acres before anything else.',
      citations: ['kcc-16.48.010', 'rcw-58.17.020', 'kcc-19.100.110'],
      costs: [d.fees['dcd-short-plat-prelim'] ? 'dcd-short-plat-prelim' : null, d.fees['dcd-short-plat-final'] ? 'dcd-short-plat-final' : null].filter(Boolean)
    }, {
      level: 'required', basis: 'documented', agency: 'surveyor',
      title: 'Boundary and topographic survey, plat preparation',
      why: 'A short plat is prepared and stamped by a professional land surveyor.',
      citations: ['rcw-58.17.020'],
      costs: ['pro-survey']
    }];
  });

  // ================= access and fire =================
  rule('kitsap.access', 'kitsap-pw', 'Access', function (ctx) {
    if (!county(ctx)) return null;
    var p = ctx.project, vacant = ctx.facts.parcel.vacant;
    if (!(p.new_dwelling || p.type === 'short_plat') || (vacant === false && p.type !== 'short_plat')) return null;
    return {
      level: vacant === true || p.type === 'short_plat' ? 'likely' : 'possible', basis: 'documented',
      title: 'Road approach permit',
      why: 'A new or altered driveway connection to a county road needs a road approach permit under the county road standards.' + (vacant === true ? ' The assessor shows no improvements on this lot, so a new approach is likely.' : ''),
      confirm: 'If the lot fronts a private road or already has a permitted approach, this drops out.',
      citations: ['kcc-11.22.070'],
      costs: ctx.data.fees['pw-road-approach'] ? ['pw-road-approach'] : []
    };
  });

  rule('kitsap.fire', 'fire-district', 'Fire access', function (ctx) {
    if (!county(ctx) || !ctx.project.new_dwelling) return null;
    var j = ctx.facts.jurisdiction;
    return {
      level: 'possible', basis: 'confirm', agency: 'fire-district',
      title: 'Fire apparatus access and water supply' + (j.fire_district ? ' (' + j.fire_district + ')' : ''),
      why: 'The county fire marshal reviews driveway grade, width and turnarounds and fire-flow for new dwellings under the locally amended fire code. Long or steep driveways and lots without hydrants can trigger access improvements, a water tank or residential sprinklers, which are construction costs rather than permit fees.',
      confirm: 'Driveway longer than 150 ft, steeper than about 12%, or no hydrant nearby? Ask the fire marshal what will be required. The access section was checked against the 2019 code text.',
      citations: ['kcc-14.04.730'],
      costs: []
    };
  });

  // ================= permit history =================
  rule('kitsap.history', 'kitsap-dcd', 'Permit history', function (ctx) {
    var P = ctx.facts.permits;
    if (!P || P.status === 'unknown') return unknownFinding('Permit history', 'County permit records');
    var redo = P.items.filter(function (i) { return (i.lapsed || /CANCELLED|WITHDRAWN|DENIED|RETURNED|REVOKED/.test(i.status)) && /site_development|shoreline|critical_area|land_use|land_division|residential_building|sepa|forest/.test(i.family); });
    var validity = ctx.data.citations['kcc-19.700.705'].key_values.report_validity_years;
    var out = [];
    if (redo.length) {
      var list = redo.slice(0, 5).map(function (i) { return i.type + ' ' + i.number + ' (' + i.status.toLowerCase() + (i.status_date ? ' ' + i.status_date.slice(0, 4) : '') + ')'; }).join('; ');
      out.push({
        level: 'likely', basis: 'workflow',
        title: redo.length + ' earlier permit' + (redo.length === 1 ? '' : 's') + ' on this lot lapsed or did not complete',
        why: 'County records show: ' + list + (redo.length > 5 ? '; and ' + (redo.length - 5) + ' more' : '') + '. An expired or withdrawn permit does not carry forward, so the work it covered needs a new application under current code, including the larger stream buffers in effect since April 2025. Critical area reports are valid for ' + validity + ' years, so studies done for those applications may also need to be redone.',
        confirm: 'Ask the owner for the old file: surveys and soil logs are often reusable even when the permit is not.',
        flag: redo.length + ' earlier permit' + (redo.length === 1 ? '' : 's') + ' on this lot lapsed or did not complete (' + redo[0].type + (redo.length > 1 ? ' and others' : '') + '). Assume a fresh application under current code.',
        flag_weight: 4,
        citations: ['kcc-19.700.705'],
        costs: []
      });
    }
    var forest = P.items.filter(function (i) { return i.family === 'forest'; });
    if (forest.length) {
      var yrs = ctx.data.citations['rcw-76.09.460'].key_values.moratorium_years;
      var recent = forest.filter(function (i) { var y = Number((i.issued || i.submitted || '').slice(0, 4)); return y && (new Date().getFullYear() - y) <= yrs; });
      out.push({
        level: recent.length ? 'likely' : 'possible', basis: 'documented',
        title: 'Timber harvest on record: check for a development moratorium',
        why: 'County records show ' + forest.length + ' timber harvest or forest practice permit' + (forest.length === 1 ? '' : 's') + ' on this lot (' + forest.slice(0, 3).map(function (i) { return i.type + ' ' + (i.issued || i.submitted || '').slice(0, 4); }).join(', ') + '). Land harvested without a conversion approval is subject to a ' + yrs + '-year moratorium on development permits, which only the county commissioners can lift.',
        confirm: 'Ask the county whether a moratorium is recorded against the parcel.',
        flag: recent.length ? 'Timber harvest within the last ' + yrs + ' years is on record. Check for a development moratorium before taking the job.' : null,
        flag_weight: 20,
        citations: ['rcw-76.09.460', 'kcc-18.16.180'],
        costs: []
      });
    }
    return out;
  });

  return { rules: rules, constraints: constraints, _internals: { wetlandBufferRange: wetlandBufferRange, streamBuffer: streamBuffer, shorelineBuffer: shorelineBuffer, tight: tight } };
});
