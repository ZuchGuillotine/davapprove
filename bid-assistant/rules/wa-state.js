/*
 * Rule set: Washington State and regional agencies. Reused by every Washington county pack.
 * See rules/wa-kitsap.js for the meaning of finding.basis.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['wa-state'] = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var rules = [];
  function rule(id, agency, topic, fn) { rules.push({ id: id, agency: agency, topic: topic, evaluate: fn }); }
  function ft(n) { return Math.round(n) + ' ft'; }

  rule('wa.hpa', 'wdfw', 'Work in or near water', function (ctx) {
    var p = ctx.project, f = ctx.facts;
    if (p.in_water) {
      var land = ctx.helpers.landContext(f, p);
      var fish = f.shoreline.forage_fish || [];
      var names = { smelt: 'surf smelt', sandlance: 'Pacific sand lance', herring: 'Pacific herring' };
      return {
        level: land.mode === 'tribal' || land.mode === 'federal' ? 'possible' : 'required', basis: land.mode === 'tribal' || land.mode === 'federal' ? 'confirm' : 'documented', authority_role: 'Hydraulic / fish habitat permit',
        title: 'Hydraulic Project Approval',
        confirm: 'Confirm WDFW jurisdiction and the hydraulic scope, especially on tribal or federal lands. Applies to freshwater as well as marine work; county permit history is not the trigger.',
        why: 'Work that uses, diverts, obstructs or changes the natural flow or bed of state waters needs a Hydraulic Project Approval from WDFW before construction. There is no application fee.' +
          (fish.length ? ' The county habitat layers show documented ' + fish.map(function (k) { return names[k]; }).join(' and ') + ' spawning on or next to this shoreline, which usually means restricted in-water work windows and a spawning survey.' : '') +
          (f.shoreline.eelgrass ? ' Eelgrass is mapped along this shoreline, which constrains dock location and design.' : ''),
        flag: fish.length ? 'Forage fish spawning is documented on this beach: in-water work windows will limit when a dock or bulkhead can be built.' : null,
        citations: ['rcw-77.55.021', 'rcw-77.55.011'],
        costs: ['wdfw-hpa']
      };
    }
    var crossing = f.stream.streams.filter(function (s) { return s.on_parcel && s.type !== 'NOCH'; });
    if (crossing.length && (p.new_dwelling || p.type === 'short_plat' || p.type === 'clearing')) {
      return {
        level: 'possible', basis: 'documented',
        title: 'Hydraulic Project Approval if the driveway or utilities cross the stream',
        why: 'A stream is mapped on the lot. A culvert, bridge, utility crossing or bank work in it needs a Hydraulic Project Approval. If everything stays out of the channel and banks, none is needed.',
        citations: ['rcw-77.55.021', 'rcw-77.55.011'],
        costs: []
      };
    }
    return null;
  });

  rule('wa.aquatic_lands', 'dnr', 'Work in or near water', function (ctx) {
    if (!ctx.project.in_water) return null;
    var sh = ctx.facts.shoreline;
    var mapped = sh.state_aquatic ? ' The DNR layer maps state aquatic land near the lot. This does not establish ownership at the proposed work location.' : sh.aquatic_status === 'unknown' ? ' The DNR aquatic land layer could not be read.' : ' No state aquatic land was returned by this screening; title still needs confirmation.';
    return {
      level: sh.state_aquatic ? 'likely' : 'possible', basis: 'confirm',
      authority_role: 'Aquatic land-use permission',
      title: 'State-owned aquatic lands: marine or freshwater authorization',
      why: 'DNR manages state-owned aquatic lands in marine waters, lakes and rivers. Permission to occupy those lands is separate from construction permits. Private recreational docks may qualify for conditional rent-free use, but that does not waive other approvals.' + mapped,
      confirm: 'Ask DNR which bedlands or shorelands the proposed footprint occupies, whether recreational permission applies and what title, registration or use-authorization evidence is needed. No mapped state land is not a title clearance.',
      citations: ['dnr-aquatic-scope', 'rcw-79.105.430'],
      costs: ['dnr-aquatic']
    };
  });

  rule('wa.shoreline_ecology', 'ecology', 'Shoreline', function (ctx) {
    var s = ctx.facts.shoreline, p = ctx.project;
    if (!s.in_jurisdiction) return null;
    var days = ctx.data.citations['wac-173-27-190'].key_values.wait_days_after_filing;
    if (p.type === 'shoreline_structure') {
      return {
        level: 'required', basis: 'documented',
        title: 'Ecology review of the shoreline permit',
        why: 'Local shoreline permits are filed with the Department of Ecology. Construction cannot start until ' + days + ' days after filing, and Ecology makes the final decision on shoreline conditional use permits and variances. No Ecology fee was found for this review.',
        citations: ['wac-173-27-190', 'rcw-90.58.140'],
        costs: []
      };
    }
    return {
      level: 'possible', basis: 'documented',
      title: 'Ecology filing if a shoreline permit is needed',
      why: 'If the project needs a shoreline substantial development permit, conditional use permit or variance rather than an exemption, the decision is filed with Ecology and construction cannot start until ' + days + ' days after filing.',
      citations: ['wac-173-27-190', 'rcw-90.58.140'],
      costs: []
    };
  });

  rule('wa.cswgp', 'ecology', 'Construction stormwater authority', function (ctx) {
    var p = ctx.project, land = ctx.helpers.landContext(ctx.facts, p);
    var kv = ctx.data.citations['cfr-40-122.26'].key_values;
    if (p.disturbance_sqft < kv.disturbance_acres * kv.square_feet_per_acre && !p.common_plan) return null;
    var out = [];
    function route(agency, label, fee, level) {
      out.push({ agency: agency, level: level, basis: 'confirm', authority_role: 'Construction stormwater permit',
        title: label + ' Construction Stormwater General Permit',
        why: 'The disturbance or larger common-plan assumption triggers a stormwater coverage check. EPA handles Indian Country and federal operators in Washington; Ecology handles applicable state-jurisdiction projects. Surface-water discharge and permit eligibility still need confirmation.',
        confirm: 'Confirm the operator, Indian Country status, discharge route and common-plan acreage. These are alternative authorities; do not add both permit routes to the bid.',
        citations: ['cfr-40-122.26', 'ecology-cswgp', 'epa-wa-construction-stormwater'], costs: [fee] });
    }
    if (p.federal_operator || land.mode === 'tribal') route('epa', 'EPA', 'epa-cgp-review', 'likely');
    else if (land.mode === 'state') route('ecology', 'Ecology', 'ecology-cswgp', 'likely');
    else { route('ecology', 'Ecology: confirm authority for', 'ecology-cswgp', 'possible'); route('epa', 'EPA: confirm authority for', 'epa-cgp-review', 'possible'); }
    return out;
  });

  rule('wa.sepa', 'kitsap-dcd', 'Environmental review', function (ctx) {
    var p = ctx.project, f = ctx.facts, d = ctx.data;
    var land = ctx.helpers.landContext(f, p);
    if (f.jurisdiction.city || land.mode === 'tribal' || land.mode === 'federal' || f.jurisdiction.status === 'unknown') {
      if (!p.in_water && !p.common_plan && p.type !== 'short_plat') return null;
      return { agency: 'ecology', level: 'possible', basis: 'confirm', authority_role: 'Lead-agency identification', title: 'Confirm environmental-review lead and jurisdiction',
        why: 'County records do not establish the SEPA lead or the applicability of state review on tribal or federal land. A city, state or other eligible entity may lead; a federal action may also have its own review.',
        confirm: 'Ask the relevant permitting authorities which environmental-review process and lead apply before pricing a county checklist.', citations: ['sepa-lead-routing', 'rcw-43.21C.030'], costs: [] };
    }
    var local = d.citations['kcc-18.04.090'].key_values;
    var reasons = [];
    if (p.in_water) reasons.push('the work is wholly or partly on lands covered by water, where the minor new construction exemptions do not apply');
    var units = f.jurisdiction.uga ? local.dwelling_units_inside_UGA : local.dwelling_units_outside_UGA;
    if (p.type === 'short_plat' && p.lots > units) reasons.push(p.lots + ' lots exceeds the local exemption of ' + units + ' dwelling units');
    if (p.grading_cy > local.fill_or_excavation_cubic_yards) reasons.push(p.grading_cy + ' cu yd of fill or excavation exceeds the local ' + local.fill_or_excavation_cubic_yards + ' cu yd exemption');
    if (!reasons.length) return null;
    return {
      level: 'required', basis: 'documented',
      title: 'SEPA environmental checklist',
      why: 'State environmental review applies because ' + reasons.join('; and ') + '. Confirm the lead agency; county fees below are a preliminary allowance for a county-led review.',
      confirm: 'Local thresholds were checked against the 2019 county code text. Confirm they are current.',
      citations: ['wac-197-11-800-1', 'wac-197-11-800-1b', 'kcc-18.04.090', 'rcw-43.21C.030'],
      costs: ['dcd-sepa', 'pro-sepa']
    };
  });

  rule('wa.forest', 'dnr', 'Tree clearing', function (ctx) {
    if (!ctx.project.tree_clearing) return null;
    var county = !ctx.facts.jurisdiction.city;
    return {
      level: 'likely', basis: 'documented',
      title: 'Forest practices: conversion to a non-forestry use',
      why: 'Harvesting timber on land being converted to another use is a Class IV-General forest practice, which needs an approved application and SEPA review rather than an ordinary harvest notification. ' +
        (county ? 'In Kitsap County the county issues timber harvest permits for conversions and reviews them against the critical areas code. ' : '') +
        'Harvesting without declaring the conversion puts a six-year moratorium on development permits for the parcel.',
      confirm: 'How much merchantable timber comes off the site? Small clearing for a home site within an approved building permit is often handled inside that permit.',
      flag: 'Forested lot: clear trees under a conversion approval, not an ordinary harvest notice, or the parcel can be locked out of permits for six years.',
      flag_weight: 6,
      citations: ['rcw-76.09.050', 'wac-222-16-050', 'rcw-76.09.460', 'rcw-76.09.470'].concat(county ? ['kcc-18.16.180'] : []),
      costs: county ? ['dcd-timber-harvest', { fee: 'dnr-fpa-conversion', bucket: 'contingent', note: 'if DNR rather than the county processes the application' }] : ['dnr-fpa-conversion']
    };
  });

  rule('wa.demolition', 'pscaa', 'Demolition', function (ctx) {
    if (!ctx.project.demo) return null;
    var yr = ctx.facts.parcel.oldest_year_built;
    return [{
      level: 'required', basis: 'documented',
      title: 'Asbestos survey and demolition notification',
      why: 'Before any demolition, an asbestos survey by an AHERA-certified building inspector is required, and a notification must be filed with the Puget Sound Clean Air Agency before work starts.' + (yr ? ' The oldest building on the assessor record dates from ' + yr + '.' : ''),
      flag: 'Demolition: add an asbestos survey and clean air agency notification before the tear-down, plus abatement if asbestos is found.',
      citations: ['pscaa-reg3-4.02', 'pscaa-reg3-4.03'],
      costs: ['pscaa-notification']
    }, {
      level: 'required', basis: 'documented', agency: 'asbestos-inspector',
      title: 'Asbestos survey',
      why: 'The survey must be done by an AHERA-certified building inspector for a demolition. Abatement, if needed, is a separate construction cost.',
      citations: ['pscaa-reg3-4.02'],
      costs: ['pro-asbestos-survey']
    }];
  });

  rule('wa.electrical', 'lni', 'Trade permits', function (ctx) {
    var p = ctx.project;
    if (!(p.new_sqft > 0)) return null;
    var m = ctx.data.fees['lni-electrical'].method;
    var fee = m.first_1300 + Math.max(0, Math.ceil((p.new_sqft - 1300) / 500)) * m.per_additional_500;
    return {
      level: 'required', basis: 'documented',
      title: 'Electrical permit and inspection',
      why: 'Electrical work is permitted and inspected by the Department of Labor and Industries, not the county. The electrical contractor usually pulls it; it is listed so it is not double-counted or missed.',
      confirm: 'Some cities run their own electrical inspection. Unincorporated Kitsap uses L&I.',
      citations: ['rcw-19.28.101'],
      costs: [{ fee: 'lni-electrical', low: p.new_dwelling ? fee : m.first_1300 * 0.6, high: fee, note: 'New-residence schedule: $' + m.first_1300 + ' for the first 1,300 sq ft plus $' + m.per_additional_500 + ' per additional 500 sq ft. Temporary power and service changes are extra.' }]
    };
  });

  rule('wa.highway', 'wsdot', 'Access', function (ctx) {
    var a = ctx.facts.access || {}, p = ctx.project;
    if (!p.state_highway_access) {
      if (a.state_route && (p.new_dwelling || p.type === 'short_plat') && ctx.facts.parcel.vacant !== false) {
        return {
          level: 'possible', basis: 'documented',
          title: 'State highway access permit if the driveway connects to ' + a.state_route,
          why: a.state_route + ' is mapped about ' + ft(a.state_route_distance_ft) + ' from the lot. A new or changed driveway onto a state highway needs a WSDOT access connection permit; access from a side road does not.',
          confirm: 'Where will the driveway connect?',
          citations: ['rcw-47.50.040'],
          costs: ['wsdot-access']
        };
      }
      return null;
    }
    return {
      level: 'required', basis: 'documented',
      title: 'State highway access connection permit',
      why: 'A new or changed driveway onto a state highway needs an access connection permit from WSDOT in addition to any county approach permit.',
      citations: ['rcw-47.50.040'],
      costs: ['wsdot-access']
    };
  });

  rule('wa.water', 'water-purveyor', 'Water supply', function (ctx) {
    var p = ctx.project, f = ctx.facts;
    if (!p.new_dwelling) return null;
    var mode = p.water;
    if (mode === 'well_new' || mode === 'well_existing') {
      return {
        level: 'required', basis: 'documented', agency: f.jurisdiction.city ? 'water-purveyor' : 'kphd',
        title: 'Evidence of adequate water supply: private well',
        why: 'A building permit for a home needs evidence of an adequate potable water supply. For a private well that means a well meeting health district siting and water quality standards; a household well is exempt from a water right permit up to 5,000 gallons a day. The health district reviews the water supply as part of the Building Site Application.' + (mode === 'well_new' ? ' Drilling the well is a construction cost not included here.' : ''),
        citations: ['rcw-19.27.097', 'rcw-90.44.050'],
        costs: []
      };
    }
    var known = mode === 'public';
    return {
      level: known ? 'required' : 'likely', basis: 'documented',
      title: 'Water availability letter and new service connection',
      why: 'A building permit for a home needs evidence of an adequate potable water supply, normally a letter from the water purveyor confirming it will serve the lot.' +
        (f.parcel.assessor_water === 'Y' ? ' The assessor record flags public water as available here.' : f.parcel.assessor_water === 'N' ? ' The assessor record does not flag public water here, so a well may be the only option.' : '') +
        ' A new meter carries a capital facilities charge and an installation charge that together often exceed every permit fee on the job.',
      confirm: known ? 'Which purveyor serves the lot, and is there already a meter?' : 'Water source was not specified. Find out whether a purveyor serves the lot or a well is needed.',
      flag: f.parcel.vacant === true ? 'Vacant lot: a new water meter can run ' + ctx.helpers.rangeText('water-connection') + ' with the larger purveyors. Find out who serves it and whether a meter exists.' : null,
      flag_weight: -5,
      citations: ['rcw-19.27.097'],
      costs: f.parcel.vacant === false ? [] : [{ fee: 'water-connection', bucket: known && f.parcel.vacant === true ? 'base' : 'contingent' }]
    };
  });

  rule('wa.archaeology', 'dahp', 'Cultural resources', function (ctx) {
    var p = ctx.project, f = ctx.facts;
    if (!(p.disturbance_sqft > 0)) return null;
    var nearWater = f.shoreline.in_jurisdiction || (f.shoreline.marine && f.shoreline.marine_distance_ft <= 250) || f.stream.streams.some(function (s) { return s.on_parcel && (s.type === 'F' || s.type === 'S'); });
    var risk = f.cultural && f.cultural.risk;
    var RISK = { 1: 'low risk', 2: 'moderately low risk', 3: 'moderate risk, survey recommended', 4: 'high risk, survey highly advised', 5: 'very high risk, survey highly advised' };
    if (risk) {
      return {
        level: risk >= 4 ? 'likely' : 'possible', basis: 'workflow',
        title: 'Cultural resources: state model rates this location ' + RISK[risk].split(',')[0],
        why: 'The state archaeology office publishes a risk model for where archaeological resources are likely. The highest value sampled on this lot is ' + risk + ' of 5 (' + RISK[risk] + '). The model is a probability map, not a record of known sites, which are confidential. Knowingly disturbing an archaeological site without a state permit is unlawful, and anyone who uncovers human remains must stop work and notify the coroner and law enforcement.' +
          (risk >= 4 ? ' Tribes and the state archaeology office are notified of shoreline, SEPA and federal permit applications, and at this risk level a survey request is common.' : ''),
        confirm: risk >= 3 ? 'Ask the county at pre-application whether a cultural resources survey will be required.' : null,
        flag: risk >= 4 ? 'The state archaeology model rates this lot ' + RISK[risk].split(',')[0] + '. Carry ' + ctx.helpers.rangeText('pro-arch-survey') + ' for a cultural resources survey.' : null,
        flag_weight: -8,
        citations: ['dahp-risk-model', 'rcw-27.53.060', 'rcw-27.44.055', 'rcw-68.50.645'],
        costs: risk >= 3 ? [{ fee: 'pro-arch-survey', bucket: 'contingent' }] : []
      };
    }
    return {
      level: 'possible', basis: nearWater ? 'workflow' : 'documented',
      title: nearWater ? 'Cultural resources: survey may be requested near the water' : 'Cultural resources: inadvertent discovery duties',
      why: 'Knowingly disturbing an archaeological site without a state permit is unlawful, and anyone who uncovers human remains during ground disturbance must stop work and notify the coroner and law enforcement. Site locations are confidential, so this tool cannot check for recorded sites. ' +
        (nearWater ? 'Shorelines and stream corridors are where recorded sites concentrate, and tribes and the state archaeology office are notified of shoreline, SEPA and federal permit applications; a cultural resources survey is a common request on such sites.' :
          'For an upland lot with no federal permit this is usually limited to an inadvertent discovery plan kept on site.'),
      confirm: nearWater ? 'Ask the county at pre-application whether a cultural resources survey will be required, or request a records check from the state archaeology office.' : null,
      citations: ['rcw-27.53.060', 'rcw-27.44.055', 'rcw-68.50.645'],
      costs: nearWater ? ['pro-arch-survey'] : []
    };
  });

  var independent = {
    'wa.hpa': ['rcw-77.55.021', 'rcw-77.55.011'],
    'wa.aquatic_lands': ['dnr-aquatic-scope', 'rcw-79.105.430'],
    'wa.cswgp': ['epa-wa-construction-stormwater', 'cfr-40-122.26'],
    'wa.shoreline_ecology': ['wac-173-27-190', 'rcw-90.58.140'],
    'wa.sepa': ['sepa-lead-routing']
  };
  rules.forEach(function (r) { if (independent[r.id]) { r.independent = true; r.citations = independent[r.id]; r.check_label = r.topic + ' (' + r.agency + ')'; } });
  return { rules: rules };
});
