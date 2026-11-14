/* Independent federal and treaty-resource screening. County permit records are never an input. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['federal'] = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var rules = [];
  function rule(id, agency, label, citations, fn) {
    rules.push({ id: id, agency: agency, topic: label, check_label: label, independent: true, citations: citations, evaluate: fn });
  }
  function water(ctx) { return ctx.helpers.waterContext(ctx.facts, ctx.project); }
  function corpsPotential(ctx) {
    var w = water(ctx);
    return (w.work && w.navigation !== 'no') || (w.fill !== 'no' && (w.work || w.mapped || w.fill === 'yes'));
  }
  function followUp(level, role, title, why, confirm, citations, costs) {
    return { level: level, basis: level === 'required' ? 'documented' : 'confirm', authority_role: role,
      title: title, why: why, confirm: confirm, citations: citations, costs: costs || [] };
  }

  rule('us.section10', 'usace', 'Corps: structures / navigable waters', ['usace-section10-scope'], function (ctx) {
    var w = water(ctx);
    if (!w.work || w.navigation === 'no') return null;
    return followUp(w.navigation === 'yes' ? 'required' : 'possible', 'Permit authority', 'Corps Section 10: structures or work in navigable water',
      'Section 10 addresses structures or work in or affecting navigable waters, including navigable inland waters. ' +
      (w.navigation === 'yes' ? 'The water setting or supplied scope indicates navigable water.' : 'Navigability has not been established for this work location.') +
      ' A general permit may provide authorization only if all its terms and current regional conditions are met.',
      'Ask the Seattle District to confirm navigability, the proposed footprint and the permit route. Freshwater does not mean non-navigable. A county permit does not establish Corps authorization.',
      ['usace-section10-scope'], ['usace-permit']);
  });

  rule('us.section404', 'usace', 'Corps: dredged / fill discharge', ['usace-section404-scope'], function (ctx) {
    var p = ctx.project, w = water(ctx);
    if (w.fill === 'no') return null;
    if (!w.work && !w.mapped && w.fill !== 'yes') {
      if (w.missing && p.disturbance_sqft > 0) return followUp('unknown', 'Jurisdiction check', 'Corps Section 404: aquatic coverage unresolved',
        'An aquatic map check did not complete. Absence of a mapped wetland or channel cannot rule out a discharge into federal waters.',
        'Confirm whether the footprint places dredged or fill material in a water or wetland and ask the Corps about jurisdiction.', ['usace-section404-scope']);
      return null;
    }
    if (w.waters === 'no') return followUp('possible', 'Jurisdiction check', 'Verify reported non-federal waters before excluding Corps review',
      'The intake reports non-jurisdictional waters. This tool has not verified a Corps jurisdictional determination or its coverage of the proposed discharge. State and tribal water protections may still apply.',
      'Record the Corps determination reference in the bid notes and confirm the state or tribal authorization route.', ['usace-section404-scope']);
    return followUp(w.fill === 'yes' && w.waters === 'yes' ? 'required' : 'possible', 'Permit authority', 'Corps Section 404: dredged or fill discharge',
      'Section 404 concerns discharge of dredged or fill material into waters of the United States. It is separate from Section 10. A dock, wetland map or shoreline address alone does not establish that a discharge or federal jurisdiction exists.',
      'Confirm discharge activities, federal waters jurisdiction, exemptions and authorization with the Corps. Do not infer a Section 404 permit from pile-supported construction alone.',
      ['usace-section404-scope'], ['usace-permit']);
  });

  rule('us.consultations', 'services', 'Federal species and historic-property review', ['usc-16-1536', 'usc-54-306108', 'cfr-36-800.2'], function (ctx) {
    if (!corpsPotential(ctx) && !ctx.project.federal_nexus) return null;
    var definite = ctx.project.federal_nexus || (water(ctx).work && water(ctx).navigation === 'yes');
    return [followUp(definite ? 'likely' : 'possible', 'Consulting agencies', 'Federal species review: NOAA Fisheries / U.S. Fish and Wildlife Service',
      'A federal permit, funding or other federal action can trigger listed-species review. The lead federal agency determines effects and the consultation route; a separate consultation with both Services is not automatic.',
      'Ask the federal lead which species, habitat and biological documentation apply. Carry an allowance for a biological evaluation until scope is agreed.',
      ['usc-16-1536'], ['pro-bio-eval']), Object.assign(followUp('possible', 'Historic-preservation review', 'Federal historic-property review and tribal cultural interests',
      'A federal undertaking can require historic-property identification and consultation. A low archaeological risk score and a location outside a reservation do not complete this review.',
      'Ask the federal lead and the appropriate historic-preservation officials which Tribes and studies to include. Applicant outreach does not substitute for federal consultation.',
      ['usc-54-306108', 'cfr-36-800.2'], [{ fee: 'pro-arch-survey', bucket: 'contingent' }]), { agency: 'dahp' })];
  });

  rule('us.tribal', 'treaty-tribes', 'Affected Tribes and treaty resources', ['usace-tribal-consultation'], function (ctx) {
    var w = water(ctx), p = ctx.project, land = ctx.helpers.landContext(ctx.facts, p);
    if (!w.work && !corpsPotential(ctx) && !p.federal_nexus && land.mode !== 'tribal') return null;
    var out = [followUp('possible', 'Consultation / rights-holder identification', 'Identify affected Tribes for this waterbody and activity',
      'Treaty-resource and cultural interests can extend beyond reservation boundaries. County records and this contact shortlist cannot establish all affected Tribes. ' + ctx.data.routing.tribal_contact_limit,
      'Ask the Corps or other federal lead to identify affected Tribes and consultation needs. Confirm directly with relevant tribal natural-resources and cultural-resources offices. Distinguish consultation from tribal permits, certification and land consent.',
      ['usace-tribal-consultation'])];
    out[0].flag = 'Confirm the affected-tribe list and each Tribe’s role before fixing the aquatic-work bid; reservation boundaries alone are insufficient.';
    out[0].flag_weight = 18;
    ctx.data.routing.tribal_contacts.forEach(function (contact) {
      out.push(Object.assign(followUp('possible', 'Preliminary tribal contact', 'Regional contact: ' + ctx.data.agencies[contact.agency].name,
        contact.reason + ' This is a starting contact, not a determination that this Tribe issues a permit for the proposal.',
        'Confirm the Tribe’s interest in the particular waterbody and activity and ask the lead agency about additional affected Tribes.',
        [contact.citation, 'usace-tribal-consultation']), { agency: contact.agency }));
    });
    return out;
  });

  rule('us.water_quality', 'ecology', 'Water-quality certification authority', ['ecology-401-authority', 'epa-401-authority', 'pgst-401-authority'], function (ctx) {
    var p = ctx.project, w = water(ctx);
    if (!corpsPotential(ctx) && !(p.federal_nexus && (w.work || w.fill === 'yes'))) return null;
    var land = ctx.helpers.landContext(ctx.facts, p), out = [];
    function cert(agency, label, level, detail, cites) {
      out.push(Object.assign(followUp(level, 'Certification authority — confirm scope', 'Section 401: ' + label,
        'A federal license or permit for an activity that may discharge into federal waters needs certification or waiver from the authority at the discharge location. ' + detail,
        'Confirm discharge potential, jurisdiction and any existing general-permit certification with the federal lead and proposed certifier. These are alternative routes, not separate certifications to add together.',
        cites, [{ fee: 'pro-water-quality', bucket: 'contingent', note: 'One application-support allowance across alternative certifiers; agency charges remain to be confirmed.' }]), { agency: agency }));
    }
    if (land.mode === 'state' || land.mode === 'unknown') cert('ecology', 'Washington Ecology', land.mode === 'state' ? 'likely' : 'possible',
      'Ecology is the candidate for waters under state jurisdiction. Parcel zoning alone does not establish the discharge jurisdiction.', ['ecology-401-authority']);
    if (land.mode === 'tribal' || land.mode === 'unknown') {
      var pgst = land.tribes.indexOf('pgst') >= 0;
      cert(pgst ? 'pgst' : 'treaty-tribes', pgst ? 'Port Gamble S’Klallam Tribe' : 'authorized tribal government', pgst ? 'likely' : 'possible',
        pgst ? 'EPA recognizes this Tribe’s certification authority for waters within its approved jurisdiction. The proposed discharge location still needs confirmation.' : 'A Tribe with the necessary certification authority may be the certifier. Treaty fishing interests alone do not establish Section 401 jurisdiction.',
        pgst ? ['pgst-401-authority', 'ecology-401-authority'] : ['ecology-401-authority', 'epa-401-authority']);
    }
    if (land.mode === 'federal' || land.mode === 'unknown' || (land.mode === 'tribal' && (land.tribes.length !== 1 || land.tribes[0] !== 'pgst'))) cert('epa', 'EPA Region 10', land.mode === 'federal' ? 'likely' : 'possible',
      'EPA acts on lands of exclusive federal jurisdiction and where the state or Tribe lacks certification authority. EPA must confirm the actual route; a reservation polygon is not that decision.', ['epa-401-authority']);
    return out;
  });

  rule('us.coastal_consistency', 'ecology', 'Federal coastal consistency', ['usc-16-1456'], function (ctx) {
    if (!corpsPotential(ctx) && !ctx.project.federal_nexus) return null;
    return followUp('possible', 'Coastal consistency review', 'Federal coastal consistency with Washington’s coastal program',
      'A covered federal license or permit affecting coastal uses or resources can require state consistency review. A water-quality certification and a local shoreline permit are distinct processes.',
      'Ask Ecology whether consistency certification or an existing programmatic concurrence covers this activity and location.', ['usc-16-1456']);
  });

  rule('us.fema', 'fema', 'FEMA / community floodplain review', ['fema-hydraulic-review', 'fema-conditional-revision', 'cfr-44-60.3-permits'], function (ctx) {
    var p = ctx.project, f = ctx.facts.flood || {}, kv = ctx.data.citations['fema-hydraulic-review'].key_values;
    var proposed = p.flood_work === 'yes' || p.floodway_work === 'yes' || p.floodplain_modification;
    if (!f.sfha_on_parcel && !proposed && f.status !== 'unknown') return null;
    if (f.status === 'unknown' && !proposed) return followUp('unknown', 'Floodplain standards / map review', 'FEMA flood coverage could not be established',
      'The independent FEMA layer did not answer. County permit history cannot resolve whether this project affects a floodplain or floodway.',
      'Check the effective FEMA map and local floodplain administrator before excluding flood studies or map-revision costs.', ['cfr-44-60.3-permits', 'fema-conditional-revision']);
    var inFloodway = p.floodway_work === 'yes';
    var mappedFloodway = !!f.floodway && p.floodway_work !== 'no';
    var floodWork = p.flood_work !== 'no' || proposed;
    var studied = (f.zones || []).some(function (z) { return z === 'AE' || /^A\d+$/.test(z); });
    var clomr = p.flood_rise_ft != null && ((inFloodway && p.flood_rise_ft > kv.floodway_max_rise_ft) ||
      (p.flood_work === 'yes' && p.floodway_work !== 'yes' && p.floodway_designation === 'no' && !f.floodway && studied && p.flood_rise_ft > kv.without_floodway_max_rise_ft));
    var out = [followUp('possible', 'Standards administered by the community', 'Floodplain permit is local; FEMA map review is a separate check',
      'The community administers floodplain development permits under NFIP standards. FEMA is not the routine building-permit office. A parcel overlap does not establish that the proposed footprint is in the floodplain.',
      'Confirm the work footprint, effective floodway and any map changes with the local floodplain administrator. A LOMA is not a construction permit and lenders may still require insurance.', ['cfr-44-60.3-permits', 'fema-hydraulic-review'])];
    if (floodWork && (inFloodway || mappedFloodway || proposed || p.grading_cy > 0)) {
      out.push(Object.assign(followUp(inFloodway ? 'required' : 'possible', 'Technical study for floodplain review', 'Hydraulic analysis / floodway no-rise demonstration',
        'Floodway encroachment requires a hydraulic demonstration against the federal no-rise standard unless the conditional revision route applies. Outside an adopted floodway, applicable studied-zone rules limit cumulative increases to ' + kv.without_floodway_max_rise_ft + ' ft. Local standards may be stricter.',
        'Scope a hydraulic study with the floodplain administrator and engineer. Enter a professional quote; no study price is invented.',
        ['fema-hydraulic-review'], ['pro-hydraulic-analysis']), { agency: 'civil-engineer' }));
      out.push(followUp(clomr ? 'required' : 'possible', 'Conditional map revision — community submits', 'FEMA conditional map revision (CLOMR) and follow-up revision',
        (clomr ? 'The supplied work location and estimated rise exceed a federal encroachment threshold. ' : 'Whether the proposal exceeds a federal encroachment threshold has not been established. ') +
        'Where that threshold is exceeded, the community must obtain conditional FEMA approval before permitting. Completed changes need as-built information and applicable final map revision.',
        'Confirm the hydraulic results and community submission route. A CLOMR is not local development permission. Obtain the applicable FEMA review fee and engineering quote.',
        ['fema-hydraulic-review', 'fema-conditional-revision'], ['fema-map-review']));
    }
    return out;
  });
  return { rules: rules };
});
