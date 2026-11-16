/* Plain-language scenario guidance. Thresholds come from the citation library. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidGuidance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var HELP = {
    new_sqft: 'The floor area of the proposed new building or addition. This is different from the ground covered by roofs, driveways and patios. Replace the project-type example with your actual concept.',
    construction_value: 'The estimated value of work used to calculate permit fees. The agency may use its own valuation table instead of the contractor’s bid. This is not the total land or property value.',
    prior_planning_review: 'Bainbridge may credit an earlier planning or zoning review. Select yes only when you have a prior review to discuss with the city; a saved assessment does not establish the credit.',
    hard_surface_sqft: 'Ground covered by new or replaced roofs, paving, patios and other hard surfaces. Include the driveway and walks, not just the building footprint. Permeable paving can still count. New and replaced areas may be treated differently for redevelopment.',
    disturbance_sqft: 'The total ground area affected by clearing, excavation, fill, grading or construction compaction, including access and utility work. Count each affected area once; this is not the building floor area or the whole lot unless all of it will be disturbed.',
    grading_cy: 'Cut is soil excavated; fill is soil placed. Enter the combined cut-plus-fill volume, not the net amount hauled off site. Site and drainage design help establish this estimate; a flat-looking site can still need significant earthwork.',
    bedrooms: 'Bedrooms added by the proposal. Bedroom capacity can affect septic design and some fees. An existing septic system is not automatically approved for extra bedrooms; confirm capacity with the health authority.',
    lots: 'The proposed number of lots resulting from a division. Each lot needs a feasible access, water, wastewater and site layout. This does not establish that subdivision is allowed.',
    wastewater: 'Septic treats wastewater on the property; public sewer sends it to a utility. Existing septic capacity and reserve area need confirmation, and a nearby sewer line does not prove a connection is available.',
    water: 'Identify the drinking-water source. A nearby public main does not establish service capacity; a well requires water availability, location and health review. Leave this unknown until the provider or health authority confirms it.',
    demo: 'Removing an existing building can involve a demolition permit, utility disconnection and air-quality or asbestos requirements. It is separate from approval of the replacement building.',
    in_water: 'The ordinary high water mark is a regulatory boundary identified from site conditions, not today’s waterline or a map edge. Work near or below it may involve shoreline review, the Corps, WDFW and aquatic-land permission. Leave uncertain agency answers open.',
    tree_clearing: 'Removing forest cover can require clearing or forest-practice review, even before building work. Coordinate trees, access, septic reserve areas and stormwater design before clearing.',
    state_highway_access: 'A direct connection to a state highway may require Washington State Department of Transportation (WSDOT) access approval. A county driveway approval does not establish state highway access rights.',
    waterbody: 'Marine means saltwater or tidal waters; freshwater includes streams, lakes and wetlands. The setting helps route checks but does not decide ownership, federal jurisdiction or the permit boundary.',
    fill_discharge: 'Examples include placing soil, rock or dredged material into water or wetlands. The U.S. Army Corps of Engineers evaluates federal fill permits. A dock can involve navigable-water review without necessarily involving fill.',
    navigability: 'Section 10 is the Corps’ authority for work in federally navigable waters. This is a legal determination, not whether you can float a boat there. Use unknown unless supported by a determination for the location.',
    waters_us: 'Waters of the United States is the federal jurisdiction test relevant to a fill discharge. A wetland shown on a county map does not settle that question. The Corps or appropriate federal agency must establish it.',
    land_status: 'Authority depends on the actual work and discharge location. Tribal/Indian Country and exclusive federal jurisdiction may change permitting and water-quality certification routes. Treaty consultation and land permission are different; a reservation map alone does not decide all authority.',
    flood_work: 'Is any proposed work in the floodplain, the area exposed to the mapped flood? Check the proposed footprint, not just whether part of the parcel touches the map. An absent or failed map result is not proof of no flood risk.',
    floodway_work: 'The regulatory floodway is the river channel and adjacent area reserved to carry flood flows. Work there can require hydraulic engineering and restrictions beyond ordinary floodplain review.',
    floodway_designation: 'Some river reaches have an adopted regulatory floodway and others do not. No floodway polygon on the parcel does not prove the reach lacks a floodway. Confirm the effective FEMA map and local floodplain administrator’s interpretation.',
    flood_rise_ft: 'Enter a change in flood-water elevation only from a hydraulic study. Blank means unknown; zero means a reported no-rise result, not a certification. FEMA map-change review and local construction permission are separate.',
    federal_nexus: 'Federal funding, permits or another federal action can involve endangered-species and historic-property consultation. The federal lead agency identifies the consultation needed; not every agency approves every project.',
    federal_operator: 'Select this when a federal agency operates the project, not merely because it provides funding. This can change whether EPA or the state administers construction stormwater permitting.',
    common_plan: 'A site can be part of a larger coordinated development or sale even when built in phases or divided among owners. Stormwater permitting may count the larger plan’s disturbance, so a smaller individual lot is not automatically exempt.',
    floodplain_modification: 'Examples include changing a channel, embankment, flood storage or drainage route. These changes can need local floodplain review and hydraulic analysis before construction.'
  };
  function num(v) { return v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null; }
  function format(v) { return v.toLocaleString('en-US'); }
  function contextStatus(context, project) {
    var j = context.facts && context.facts.jurisdiction;
    if (context.packId !== 'wa-kitsap') return 'other';
    if (j && (j.city || j.reservation || j.tribal_zoning || j.military || j.off_reservation_trust || (j.tribal_names || []).length)) return 'other';
    if (project.land_status === 'tribal' || project.land_status === 'exclusive_federal') return 'other';
    return j && j.status && j.status !== 'unknown' && (j.trust_status === 'none' || project.land_status === 'state_local') ? 'county' : 'unknown';
  }
  function notices(project, data, context) {
    var scope = contextStatus(context, project), c = data.citations;
    if (scope === 'other') return { scope: scope, rows: [], message: 'Kitsap County thresholds are not applied to this jurisdiction. Confirm the city, county, Tribal or federal requirements for the work location.' };
    var sw = c['kitsap-guidance-stormwater'], sd = c['kitsap-guidance-sdap'], gr = c['kitsap-guidance-grading'];
    if (!sw || !sd || !gr) return { scope: 'unknown', rows: [], message: 'Threshold reference unavailable. Confirm stormwater and grading requirements with the permitting authority.' };
    var rows = [
      { field: 'hard_surface_sqft', threshold: sw.key_values.hard_surface_sqft, unit: 'sq ft', effect: 'stormwater Minimum Requirements 1–5 (site planning, erosion controls and on-site management). This alone does not establish a separate SDAP.', source: sw },
      { field: 'disturbance_sqft', threshold: sw.key_values.disturbance_sqft, unit: 'sq ft', effect: 'stormwater Minimum Requirements 1–5. Disturbance at this level alone is not a separate SDAP trigger.', source: sw },
      { field: 'disturbance_sqft', threshold: gr.key_values.engineered_grading_disturbance_sqft, unit: 'sq ft', effect: 'engineered grading plan for grading projects. Confirm SDAP scope and any separate construction stormwater permit.', source: gr },
      { field: 'grading_cy', threshold: sd.key_values.grading_cy, unit: 'cu yd', effect: 'Site Development Activity Permit (SDAP), subject to applicable grading exemptions. Confirm engineered-plan requirements.', source: sd }
    ];
    rows.forEach(function (r) {
      r.value = num(project[r.field]); r.reached = r.value != null && r.value >= r.threshold;
      r.status = r.value == null ? 'Enter an estimate' : r.reached ? (scope === 'county' ? 'Threshold reached' : 'Scenario threshold reached · jurisdiction unconfirmed') : 'Below this threshold · other triggers may apply';
      r.label = 'At ' + format(r.threshold) + ' ' + r.unit + ' or more: ' + r.effect;
    });
    return { scope: scope, rows: rows, message: 'Unincorporated Kitsap screening only. Slopes, drainage connections or diversions, sensitive-area setbacks, surface area and vegetation conversion can trigger review independently. Numeric thresholds are not permission to clear or build.' };
  }
  function mount(doc) {
    Object.keys(HELP).forEach(function (key) {
      var input = doc.getElementById('a-' + key);
      if (!input || doc.getElementById('help-' + key)) return;
      var label = input.closest('label'), wrapper = doc.createElement('div');
      wrapper.className = 'assumption-field'; label.parentNode.insertBefore(wrapper, label); wrapper.appendChild(label);
      var button = doc.createElement('button'); button.type = 'button'; button.className = 'assumption-help-toggle'; button.textContent = '?';
      var name = label.cloneNode(true); Array.prototype.forEach.call(name.querySelectorAll('input, select'), function (el) { el.remove(); });
      button.setAttribute('aria-label', 'Explain ' + name.textContent.trim());
      button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'help-' + key);
      var help = doc.createElement('div'); help.id = 'help-' + key; help.className = 'assumption-help'; help.hidden = true; help.textContent = HELP[key];
      button.addEventListener('click', function () { help.hidden = !help.hidden; button.setAttribute('aria-expanded', String(!help.hidden)); });
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), help.id].filter(Boolean).join(' '));
      wrapper.appendChild(button); wrapper.appendChild(help);
    });
  }
  function update(doc, project, data, context) {
    var result = notices(project, data, context), fields = ['hard_surface_sqft', 'disturbance_sqft', 'grading_cy'];
    fields.forEach(function (key) {
      var input = doc.getElementById('a-' + key); if (!input) return;
      var target = doc.getElementById('triggers-' + key);
      if (!target) { target = doc.createElement('div'); target.id = 'triggers-' + key; target.className = 'assumption-triggers'; input.closest('.assumption-field').appendChild(target); input.setAttribute('aria-describedby', input.getAttribute('aria-describedby') + ' ' + target.id); }
      target.replaceChildren();
      result.rows.filter(function (r) { return r.field === key; }).forEach(function (r) {
        var box = doc.createElement('div'); box.className = 'assumption-trigger' + (r.reached ? ' reached' : '');
        var status = doc.createElement('strong'); status.textContent = r.status; box.appendChild(status);
        var text = doc.createElement('p'); text.textContent = r.label; box.appendChild(text);
        var source = doc.createElement('a'); source.href = r.source.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = r.source.citation + ' · checked ' + r.source.fetched; box.appendChild(source);
        if (r.source.related_url) { var related = doc.createElement('a'); related.href = r.source.related_url; related.target = '_blank'; related.rel = 'noopener noreferrer'; related.textContent = ' · Grading exemptions'; box.appendChild(related); }
        target.appendChild(box);
      });
    });
    var note = doc.getElementById('assumption-threshold-note'); if (note) note.textContent = result.message;
    var summary = doc.getElementById('assumption-trigger-summary');
    if (summary) { var count = result.rows.filter(function (r) { return r.reached; }).length; summary.textContent = count ? 'Planning thresholds reached' + (result.scope === 'unknown' ? ' · jurisdiction unconfirmed' : '') : 'Check site-specific triggers'; summary.classList.toggle('reached', count > 0); }
    Object.keys(HELP).forEach(function (key) { var input = doc.getElementById('a-' + key); if (input && input.closest('.assumption-field')) input.closest('.assumption-field').hidden = input.closest('label').hidden; });
  }
  return { HELP: HELP, notices: notices, mount: mount, update: update };
});
