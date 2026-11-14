/* Bid assistant UI. Plain DOM; no framework. */
(function () {
  'use strict';

  var Geo = window.BidGeo, Screen = window.BidScreen, Engine = window.BidEngine, Report = window.BidReport;
  var DATA = window.BID_DATA, PACKS = window.BidPacks, RULESETS = window.BidRuleSets;

  var state = {
    pack: PACKS['wa-kitsap'],
    parcel: null, screening: null, facts: null, grid: null, constraints: null, report: null,
    overrides: {},      // fee id -> { low, high, excluded }
    busy: false, draftId: null
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Engine.roundMoney(n).toLocaleString('en-US'); }
  function range(lo, hi) { return Engine.roundMoney(lo) === Engine.roundMoney(hi) ? money(lo) : money(lo) + ' to ' + money(hi); }
  function pct(n) { return n > 0 && n < 1 ? '<1%' : Math.round(n) + '%'; }
  function acres(sqft) { var a = sqft / 43560; return a >= 0.1 ? a.toFixed(2) + ' ac' : Math.round(sqft).toLocaleString() + ' sq ft'; }

  // ---------------------------------------------------------------- map
  var map, baseLayers, parcelLayer, overlayGroup, gridGroup, quadGroup, canvas;

  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: true }).setView(state.pack.center, state.pack.zoom);
    canvas = L.canvas({ padding: 0.3 });
    baseLayers = {
      'Aerial': L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: 'Imagery: Esri, Maxar, Earthstar Geographics and the GIS User Community'
      }),
      'Topo (USGS)': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 16, attribution: 'USGS The National Map'
      }),
      'Streets (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors'
      })
    };
    baseLayers['Topo (USGS)'].addTo(map);
    overlayGroup = L.layerGroup().addTo(map);
    gridGroup = L.layerGroup().addTo(map);
    quadGroup = L.layerGroup().addTo(map);
    parcelLayer = L.layerGroup().addTo(map);
    L.control.layers(baseLayers, {
      'Constraint grid': gridGroup, 'Mapped features': overlayGroup, 'Quadrants': quadGroup
    }, { collapsed: true }).addTo(map);
    L.control.scale({ metric: false }).addTo(map);
    map.attributionControl.setPrefix('');
    map.on('click', function (e) {
      if (state.busy) return;
      if (map.getZoom() < 14) { toast('Zoom in closer to pick a parcel.'); return; }
      loadParcel(function () { return state.pack.parcelAtPoint(e.latlng.lng, e.latlng.lat); }, 'the clicked location');
    });
  }

  function ll(p) { return [p[1], p[0]]; }
  function ringsToLatLngs(rings) { return rings.map(function (r) { return r.map(ll); }); }

  function drawParcel(parcel) {
    parcelLayer.clearLayers(); overlayGroup.clearLayers(); gridGroup.clearLayers(); quadGroup.clearLayers();
    var poly = L.polygon(ringsToLatLngs(parcel.geometry.rings), { color: '#ffd33d', weight: 3, fill: false, interactive: false });
    L.polygon(ringsToLatLngs(parcel.geometry.rings), { color: '#111', weight: 6, opacity: 0.55, fill: false, interactive: false }).addTo(parcelLayer);
    poly.addTo(parcelLayer);
    map.fitBounds(poly.getBounds().pad(0.45));
  }

  var TIER_STYLE = {
    core: { color: '#d1242f', label: 'Mapped feature' },
    buffer: { color: '#e08e0b', label: 'Indicative buffer or setback' },
    review: { color: '#8250df', label: 'Triggers a study or review' },
    clear: { color: '#6f9b7d', label: 'Potential siting area · unconfirmed' }
  };

  function drawAnalysis() {
    overlayGroup.clearLayers(); gridGroup.clearLayers(); quadGroup.clearLayers();
    var s = state.screening, p = state.parcel, g = state.grid;
    // mapped features
    Object.keys(s.layers).forEach(function (id) {
      var res = s.layers[id], layer = res.layer, st = layer.style;
      if (!st) return;
      if (res.kind === 'features') {
        res.features.forEach(function (f) {
          var tip = esc(layer.label) + (f.on_parcel ? ' (on parcel)' : ' (' + Math.round(f.distance_ft) + ' ft away)');
          var shape;
          if (f.geometry.rings) shape = L.polygon(ringsToLatLngs(f.geometry.rings), { color: st.color, weight: st.weight || 1.5, fillColor: st.fill || st.color, fillOpacity: st.fillOpacity == null ? 0.25 : st.fillOpacity, renderer: canvas });
          else if (f.geometry.paths) shape = L.polyline(ringsToLatLngs(f.geometry.paths), { color: st.color, weight: st.weight || 3, dashArray: st.dash || null, renderer: canvas });
          if (shape) shape.bindTooltip(tip, { sticky: true }).addTo(overlayGroup);
        });
      }
    });
    // constraint grid
    var half = g.step_ft / 2;
    g.cells.forEach(function (c) {
      var a = p.proj.toLL([c.x - half, c.y - half]), b = p.proj.toLL([c.x + half, c.y + half]);
      L.rectangle([ll(a), ll(b)], { stroke: false, fillColor: c.cls === 'clear' && incompleteMap() ? '#7c8790' : TIER_STYLE[c.cls].color, fillOpacity: c.cls === 'clear' ? 0.25 : c.cls === 'review' ? 0.28 : 0.5, renderer: canvas, interactive: false }).addTo(gridGroup);
    });
    // quadrant cross and labels
    var bb = p.shape.bbox, c0 = g.centroid;
    var cross = [[[bb[0], c0[1]], [bb[2], c0[1]]], [[c0[0], bb[1]], [c0[0], bb[3]]]];
    cross.forEach(function (seg) {
      L.polyline(seg.map(function (xy) { return ll(p.proj.toLL(xy)); }), { color: '#fff', weight: 1.5, dashArray: '4 6', opacity: 0.9, interactive: false }).addTo(quadGroup);
    });
    var pos = { NW: [(bb[0] + c0[0]) / 2, (bb[3] + c0[1]) / 2], NE: [(bb[2] + c0[0]) / 2, (bb[3] + c0[1]) / 2], SW: [(bb[0] + c0[0]) / 2, (bb[1] + c0[1]) / 2], SE: [(bb[2] + c0[0]) / 2, (bb[1] + c0[1]) / 2] };
    Object.keys(pos).forEach(function (q) {
      var Q = g.quadrants[q];
      if (Q.share_of_parcel_pct < 3) return;
      var cls = Q.constrained_pct >= 85 ? 'bad' : Q.constrained_pct >= 40 ? 'warn' : 'ok';
      L.marker(ll(p.proj.toLL(pos[q])), {
        interactive: false,
        icon: L.divIcon({ className: 'quad-label ' + cls, html: '<b>' + q + ' ' + pct(Q.constrained_pct) + '</b>', iconSize: [62, 20], iconAnchor: [31, 10] })
      }).addTo(quadGroup);
    });
    renderLegend();
  }

  function renderLegend() {
    var s = state.screening, items = [];
    ['core', 'buffer', 'review', 'clear'].forEach(function (t) {
      if (t === 'clear' && incompleteMap()) { items.push('<li><i style="background:#7c8790"></i>Unresolved area · coverage incomplete</li>'); return; }
      if (state.grid.totals[t].pct > 0) items.push('<li><i style="background:' + TIER_STYLE[t].color + ';opacity:.7"></i>' + TIER_STYLE[t].label + '</li>');
    });
    Object.keys(s.layers).forEach(function (id) {
      var r = s.layers[id];
      if (r.kind !== 'features' || !r.features.length || !r.layer.style) return;
      var line = !r.features[0].geometry.rings;
      items.push('<li><i class="' + (line ? 'line' : '') + '" style="background:' + r.layer.style.color + '"></i>' + esc(r.layer.label) + '</li>');
    });
    items.unshift('<li><i class="outline"></i>Parcel boundary (assessor)</li>');
    $('legend').innerHTML = '<ul>' + items.join('') + '</ul><p>Sampled screening cells. Not a legal building envelope.</p>';
    $('legend').hidden = false;
  }

  function incompleteMap() {
    return state.facts.jurisdiction.status === 'unknown' || !!state.facts.jurisdiction.city || !!state.facts.jurisdiction.reservation || !!state.facts.jurisdiction.off_reservation_trust ||
      (state.facts.jurisdiction.tribal_names || []).length > 0 || ['tribal', 'exclusive_federal'].indexOf(readProject().land_status) >= 0 ||
      Object.keys(state.screening.layers).some(function (id) { var r = state.screening.layers[id]; return r.status === 'unknown' || r.truncated; });
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll('#search-form input, #search-form select, #search-form button, #bid-details input, #bid-details textarea, #btn-new, #saved-bids').forEach(function (el) { el.disabled = busy; });
    ['btn-print', 'btn-copy', 'btn-save', 'btn-refresh'].forEach(function (id) { $(id).disabled = busy || !state.report; });
  }

  // ---------------------------------------------------------------- search and run
  function setStatus(html, kind) {
    var el = $('status');
    if (!html) { el.hidden = true; return; }
    el.hidden = false; el.className = 'status ' + (kind || ''); el.innerHTML = html;
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function onSearch(ev) {
    if (ev) ev.preventDefault();
    if (state.busy) return;
    var q = $('q').value.trim();
    if (!q) return;
    setBusy(true);
    setStatus('Searching county parcel records&hellip;', 'busy');
    state.pack.search(q).then(function (hits) {
      setBusy(false);
      var ul = $('suggestions');
      if (!hits.length) { ul.hidden = true; setStatus('No parcel matched &ldquo;' + esc(q) + '&rdquo;. Try the house number and street name only, a tax account number, or click the parcel on the map.', 'warn'); return; }
      if (hits.length === 1) { ul.hidden = true; pick(hits[0]); return; }
      setStatus('');
      ul.innerHTML = hits.map(function (h, i) { return '<li><button type="button" data-i="' + i + '"><b>' + esc(h.label) + '</b><span>' + esc(h.sublabel) + '</span></button></li>'; }).join('');
      ul.hidden = false;
      ul.onclick = function (e) { var b = e.target.closest('button'); if (b) { ul.hidden = true; pick(hits[Number(b.dataset.i)]); } };
    }).catch(function (err) { setBusy(false); setStatus('Parcel search failed: ' + esc(err.message), 'error'); });
  }
  function pick(hit) {
    $('q').value = hit.label;
    loadParcel(function () { return state.pack.parcelById(hit.parcel_key); }, hit.label);
  }

  function loadParcel(getParcel, what, refreshing) {
    if (state.busy) return;
    state.report = null; state.facts = null; state.constraintLand = null;
    setBusy(true);
    if (!refreshing) { state.overrides = {}; state.draftId = null; $('bid-title').value = ''; $('bid-notes').value = ''; }
    $('results').hidden = true; $('intro').hidden = true; $('legend').hidden = true;
    $('bid-details').hidden = true;
    overlayGroup.clearLayers(); gridGroup.clearLayers(); quadGroup.clearLayers(); parcelLayer.clearLayers();
    $('map-coverage').textContent = 'Reading public map layers. Siting area is not yet assessed.';
    setStatus('Finding the parcel for ' + esc(what) + '&hellip;', 'busy');
    getParcel().then(function (parcel) {
      if (!parcel) { setBusy(false); setStatus('No tax parcel found at ' + esc(what) + '. It may be right-of-way, water or an untaxed tract.', 'warn'); return null; }
      state.parcel = parcel;
      drawParcel(parcel);
      location.hash = 'parcel=' + encodeURIComponent(parcel.parcel_key) + '&type=' + $('ptype').value;
      return Screen.screenParcel(state.pack, parcel, {
        onProgress: function (done, total, label) {
          setStatus('<div class="bar"><span style="width:' + Math.round((100 * done) / total) + '%"></span></div>Reading map layers: ' + done + ' of ' + total + ' <span class="hint">' + esc(label) + '</span>', 'busy');
        }
      }).then(function (screening) {
        state.screening = screening;
        state.facts = state.pack.deriveFacts(screening);
        state.constraints = RULESETS[state.pack.id].constraints(screening, state.facts, DATA);
        state.grid = Geo.gridAnalyze(parcel.shape, state.constraints, { targetSamples: 3000 });
        state.draftId = state.draftId || crypto.randomUUID();
        setBusy(false);
        setStatus('');
        evaluate();
        drawAnalysis();
      });
    }).catch(function (err) {
      setBusy(false);
      setStatus('Could not complete the screening: ' + esc(err.message), 'error');
      if (window.console) console.error(err);
    });
  }

  function readProject() {
    var p = { type: $('ptype').value };
    ['new_sqft', 'construction_value', 'hard_surface_sqft', 'disturbance_sqft', 'grading_cy', 'bedrooms', 'lots'].forEach(function (k) { p[k] = $('a-' + k).value; });
    ['wastewater', 'water', 'prior_planning_review'].forEach(function (k) { p[k] = $('a-' + k).value; });
    ['demo', 'in_water', 'tree_clearing', 'state_highway_access'].forEach(function (k) { p[k] = $('a-' + k).checked; });
    Object.keys(Engine.SCOPE_FIELDS).forEach(function (k) { p[k] = $('a-' + k).value; });
    ['federal_nexus', 'federal_operator', 'common_plan', 'floodplain_modification'].forEach(function (k) { p[k] = $('a-' + k).checked; });
    p.flood_rise_ft = $('a-flood_rise_ft').value;
    return p;
  }
  function fillAssumptions(type, saved) {
    var p = Engine.normaliseProject(saved || { type: type });
    ['new_sqft', 'construction_value', 'hard_surface_sqft', 'disturbance_sqft', 'grading_cy', 'bedrooms', 'lots'].forEach(function (k) { $('a-' + k).value = p[k]; });
    ['demo', 'in_water', 'tree_clearing', 'state_highway_access'].forEach(function (k) { $('a-' + k).checked = !!p[k]; });
    ['water', 'wastewater', 'prior_planning_review'].forEach(function (k) { $('a-' + k).value = p[k]; });
    Object.keys(Engine.SCOPE_FIELDS).forEach(function (k) { $('a-' + k).value = p[k]; });
    ['federal_nexus', 'federal_operator', 'common_plan', 'floodplain_modification'].forEach(function (k) { $('a-' + k).checked = p[k]; });
    $('a-flood_rise_ft').value = p.flood_rise_ft == null ? '' : p.flood_rise_ft;
    $('agency-assumptions').open = p.in_water;
  }

  function rules() {
    var out = [];
    state.pack.rule_sets.forEach(function (id) { out = out.concat(RULESETS[id].rules); });
    return out;
  }

  function evaluate() {
    if (!state.facts) return;
    var land = readProject().land_status;
    if (state.constraintLand !== land) {
      state.constraints = RULESETS[state.pack.id].constraints(state.screening, state.facts, DATA, readProject());
      state.grid = Geo.gridAnalyze(state.parcel.shape, state.constraints, { targetSamples: 3000 });
      state.constraintLand = land;
      drawAnalysis();
    }
    state.report = Engine.evaluate({ facts: state.facts, project: readProject(), grid: state.grid, rules: rules(), data: DATA });
    applyOverrides();
    render();
    saveBid();
  }

  function applyOverrides() {
    state.report = Engine.applyOverrides(state.report, state.overrides);
  }

  // ---------------------------------------------------------------- render
  var LEVEL_LABEL = { required: 'Required', likely: 'Likely', possible: 'Possible', unknown: 'Could not check' };
  var TIER_LABEL = { local: 'Local', tribal: 'Tribal', state: 'State', federal: 'Federal', utility: 'Utilities and districts', professional: 'Professionals to hire' };

  function badge(level) { return '<span class="badge ' + level + '">' + LEVEL_LABEL[level] + '</span>'; }

  function render() {
    var r = state.report, f = state.facts, g = state.grid;
    var html = [];
    html.push(renderParcelCard(f));
    html.push(renderHeadline(r, g));
    html.push(renderIndependent(r));
    html.push(renderFlags(r, f, g));
    html.push(renderCosts(r));
    html.push(renderAgencies(r));
    html.push(renderConstraints(g, f));
    html.push(renderPermits(f));
    html.push(renderChecks(state.screening));
    html.push(renderLimits());
    $('results').innerHTML = html.join('');
    $('results').hidden = false;
    $('btn-print').disabled = false; $('btn-copy').disabled = false;
    $('btn-save').disabled = false; $('btn-refresh').disabled = false;
    $('bid-details').hidden = false;
    if (!$('bid-title').value) $('bid-title').value = f.parcel.situs || 'Parcel ' + f.parcel.key;
    $('snapshot-status').textContent = 'Map snapshot: ' + new Date(state.screening.screened_at).toLocaleString() + '. Refresh maps to check for changes. No design revision has been approved.';
    $('map-coverage').textContent = incompleteMap() ? 'Coverage incomplete: some layers or local buffers are unresolved. Gray cells are not cleared for building.' : 'Potential siting cells exclude the mapped constraints shown. Zoning, agriculture, septic reserves and easements remain to be confirmed.';
    document.querySelector('.map-heading').classList.toggle('incomplete', incompleteMap());
  }

  function renderParcelCard(f) {
    var p = f.parcel, j = f.jurisdiction;
    var where = j.status === 'unknown' ? 'Jurisdiction could not be confirmed' : j.city ? 'City of ' + j.city : 'Unincorporated Kitsap County' + (j.uga ? ' (' + j.uga + ')' : '');
    var bits = [
      ['Tax account', p.account_no || p.key],
      ['Size', (p.assessor_acres != null ? p.assessor_acres + ' ac assessor; ' : '') + acres(p.area_sqft) + ' mapped'],
      ['Jurisdiction', where + (j.reservation ? ', inside ' + j.reservation.name : '')],
      ['Zoning', p.zone_code ? p.zone_code + (p.zone_name ? ' · ' + p.zone_name : '') + (p.split_zoned ? ' (split zoned)' : '') : 'Not found'],
      ['On the lot now', p.vacant === true ? 'No assessed improvements' : p.vacant === false ? (p.dwellings + ' dwelling' + (p.dwellings === 1 ? '' : 's') + (p.oldest_year_built ? ', oldest built ' + p.oldest_year_built : '')) : 'Unknown'],
      ['Fire district', j.fire_district || 'Not mapped']
    ];
    return '<div class="card parcel"><h2>' + esc(p.situs || 'Parcel ' + p.key) + '</h2><dl>' +
      bits.map(function (b) { return '<div><dt>' + b[0] + '</dt><dd>' + esc(b[1]) + '</dd></div>'; }).join('') + '</dl></div>';
  }

  function renderHeadline(r, g) {
    var t = r.costs.totals;
    var firm = r.agencies.filter(function (a) { return a.tier !== 'professional' && (a.level === 'required' || a.level === 'likely'); }).length;
    var maybe = r.agencies.filter(function (a) { return a.tier !== 'professional' && (a.level === 'possible' || a.level === 'unknown'); }).length;
    var constrained = g.totals.core.pct + g.totals.buffer.pct;
    return '<div class="tiles" id="bid-summary">' +
      tile('Agencies and districts', String(firm), maybe ? 'plus ' + maybe + ' possible' : 'required or likely') +
      tile('Priced base allowance', range(t.base.low, t.base.high), (t.unpriced.length ? t.unpriced.length + ' items still need quotes. ' : '') + (splitText(t) || 'required or likely items with prices')) +
      tile('Additional allowances', t.contingent.high ? range(t.contingent.low, t.contingent.high) : 'None priced', 'possible triggers; alternatives may not all apply') +
      tile('Lot inside mapped constraints', pct(constrained), acres(g.totals.clear.sqft + g.totals.review.sqft) + ' outside mapped features and buffers') +
      '</div>';
  }
  function splitText(t) {
    var names = { agency_fee: 'agency fees', professional: 'studies', impact_fee: 'impact fees', utility: 'utility hookups' };
    return Object.keys(names).filter(function (k) { return t.by_kind[k] && t.by_kind[k].base.high; })
      .map(function (k) { return names[k] + ' ' + money((t.by_kind[k].base.low + t.by_kind[k].base.high) / 2); }).join(', ');
  }
  function tile(label, value, sub) { return '<div class="tile"><span>' + label + '</span><b>' + value + '</b><small>' + sub + '</small></div>'; }

  function renderFlags(r, f, g) {
    var flags = Report.flags(r, f, g, state.screening);
    if (!flags.length) return '';
    return '<div class="card flags"><h2>Say this in the client meeting</h2><ul>' +
      flags.map(function (x) { return '<li class="' + x.level + '">' + esc(x.text) + '</li>'; }).join('') + '</ul></div>';
  }

  function renderIndependent(r) {
    var labels = { follow_up: 'Scope to confirm below', unknown: 'Unresolved coverage', no_trigger: 'No trigger in supplied inputs' };
    return '<details class="card independent" id="bid-independent"><summary><h2>Agency checks beyond county records</h2></summary>' +
      '<p class="hint">Checks run from the proposed activity and independent agency sources. No trigger is not a clearance. Tribal contacts are preliminary; the lead agency and Tribes must confirm the full affected-tribe list.</p>' +
      '<table><thead><tr><th>Program</th><th>Screening result</th></tr></thead><tbody>' + (r.independent_checks || []).map(function (check) {
        return '<tr><td>' + esc(check.label) + '<small>' + check.citations.map(function (id) { var c = DATA.citations[id]; return '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.citation) + '</a>'; }).join(' · ') + '</small></td><td>' + labels[check.status] + '</td></tr>';
      }).join('') + '</tbody></table><p class="hint">Agency routing checked ' + esc(DATA.routing.checked) + '. Detailed roles and follow-up questions are under Agencies &amp; code. New study and review costs without a checked price remain quote-needed.</p></details>';
  }

  function renderAgencies(r) {
    var byId = {}; r.findings.forEach(function (f) { byId[f.id] = f; });
    var tiers = {};
    r.agencies.forEach(function (a) { (tiers[a.tier] = tiers[a.tier] || []).push(a); });
    var out = ['<div class="card agencies" id="bid-agencies"><h2>Agencies, professionals &amp; code <span class="hint">' + r.agencies.length + ' parties for a ' + esc(r.project.label.toLowerCase()) + '</span></h2>'];
    ['local', 'tribal', 'state', 'federal', 'utility', 'professional'].forEach(function (t) {
      if (!tiers[t]) return;
      out.push('<h3>' + TIER_LABEL[t] + '</h3>');
      tiers[t].forEach(function (a) {
        out.push('<details class="agency ' + a.level + '"' + (a.level === 'required' ? ' open' : '') + '><summary>' + badge(a.level) + '<b>' + esc(a.name) + '</b><span class="role">' + esc(a.role || '') + '</span></summary>');
        a.findings.forEach(function (fid) { out.push(renderFinding(byId[fid])); });
        if (a.url) out.push('<p class="hint"><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.url.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a>' + (a.phone ? ' · ' + esc(a.phone) : '') + '</p>');
        out.push('</details>');
      });
    });
    out.push('</div>');
    return out.join('');
  }

  function renderFinding(f) {
    var cites = f.citations.map(function (id) {
      var c = DATA.citations[id];
      return '<details class="cite' + (c.verified ? '' : ' unverified') + '"><summary>' + esc(c.citation) + (!c.verified || /^possibly_outdated/.test(c.source_currency || '') ? ' · verify current text' : '') + '</summary>' +
        '<blockquote>' + (c.excerpt ? '&ldquo;' + esc(c.excerpt) + '&rdquo;' : esc(c.summary || '')) + '</blockquote>' +
        '<p><a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title || c.citation) + '</a>' +
        (c.verified_against && c.verified_against !== c.url ? ' · <a href="' + esc(c.verified_against) + '" target="_blank" rel="noopener">text as checked</a>' : '') +
        ' <span class="hint">' + (c.verified ? 'quote matched to source ' + esc(c.fetched || '') : 'not verified against source text') + (c.source_currency && !/^current/.test(c.source_currency) ? ' · ' + esc(c.source_currency.replace(/^possibly_outdated: /, 'may be outdated: ')) : '') + '</span></p></details>';
    }).join('');
    var costs = f.costs.map(function (c) { return '<li>' + esc(c.label) + ' <b>' + (c.excluded ? 'excluded from bid' : c.unpriced ? 'Quote needed' : range(c.low, c.high)) + '</b>' + (c.edited ? ' · your allowance' : '') + (c.bucket === 'contingent' ? ' <span class="hint">contingency' + (c.note ? ': ' + esc(c.note) : '') + '</span>' : '') + '</li>'; }).join('');
    return '<div class="finding">' +
      '<h4>' + badge(f.level) + ' ' + esc(f.title) + (f.basis && f.basis !== 'documented' ? ' <span class="basis">' + (f.basis === 'workflow' ? 'recommended step' : 'needs agency answer') + '</span>' : '') + '</h4>' +
      (f.authority_role ? '<p class="authority-role">' + esc(f.authority_role) + ' · source checked ' + esc(f.research_date) + '</p>' : '') +
      '<p>' + esc(f.why) + '</p>' +
      (f.confirm ? '<p class="confirm"><b>Confirm:</b> ' + esc(f.confirm) + '</p>' : '') +
      (costs ? '<ul class="fcosts">' + costs + '</ul>' : '') +
      (cites ? '<div class="cites">' + cites + '</div>' : '') +
      '</div>';
  }

  var KIND_LABEL = { agency_fee: 'Agency fee', professional: 'Consultant', impact_fee: 'Impact fee', utility: 'Utility' };
  function renderCosts(r) {
    var rows = function (bucket) {
      return r.costs.items.filter(function (c) { return c.bucket === bucket; }).map(function (c) {
        var src = c.source ? '<a href="' + esc(c.source.url) + '" target="_blank" rel="noopener">' + (c.basis === 'published' ? 'Published fee' : 'Market estimate') + '</a><small>' + esc(c.source.date || '') + (c.source.checked ? ' · checked ' + esc(c.source.checked) : '') + '</small>' : '<b class="unsourced">Quote needed · no published source</b>';
        return '<tr class="' + (c.excluded ? 'excluded' : '') + '" data-fee="' + esc(c.fee) + '">' +
          '<td><input type="checkbox" class="inc" ' + (c.excluded ? '' : 'checked') + ' aria-label="Include ' + esc(c.label) + '"></td>' +
          '<td><b>' + esc(c.label) + '</b><small>' + esc(c.payee || '') + (c.note ? ' · ' + esc(c.note) : '') + '</small>' +
          '<span class="kind ' + c.kind + '">' + KIND_LABEL[c.kind] + '</span><small>' + src + '</small>' +
          (c.edited ? '<small>Your allowance. Reference: ' + (c.confidence === 'unsourced' ? 'unpriced' : range(c.reference_low, c.reference_high)) + '</small>' : '') +
          '<input class="cost-note" aria-label="Quote or exclusion note for ' + esc(c.label) + '" placeholder="Quote reference / exclusion reason" value="' + esc(c.override_note || '') + '">' +
          (state.overrides[c.fee] ? '<button type="button" class="reset-cost">Reset to reference</button>' : '') + '</td>' +
          '<td class="num"><input type="number" class="lo" min="0" step="any" placeholder="Quote" value="' + (c.unpriced ? '' : Engine.roundMoney(c.low)) + '" aria-label="Low for ' + esc(c.label) + '"></td>' +
          '<td class="num"><input type="number" class="hi" min="0" step="any" placeholder="Quote" value="' + (c.unpriced ? '' : Engine.roundMoney(c.high)) + '" aria-label="High for ' + esc(c.label) + '"></td></tr>';
      }).join('');
    };
    var t = r.costs.totals;
    function table(body, label, total) { return '<table><thead><tr><th>Use</th><th>Item &amp; source</th><th class="num">Low $</th><th class="num">High $</th></tr></thead><tbody>' + body + '</tbody><tfoot><tr><td></td><td>' + label + '</td><td class="num">' + money(total.low) + '</td><td class="num">' + money(total.high) + '</td></tr></tfoot></table>'; }
    var base = rows('base'), cont = rows('contingent');
    return '<div class="card costs" id="bid-costs"><h2>Build the permitting allowance</h2>' +
      '<p class="hint">Permit fees, technical studies and listed connection charges. Add your own quote or range; uncheck work priced elsewhere. Sources remain attached when you edit. Construction, architectural design, utility extensions and mitigation work are excluded.</p>' +
      (incompleteMap() ? '<p class="coverage-callout">Partial scope: unresolved map coverage or local rules can add requirements and costs. This is a priced subtotal, not a complete project budget.</p>' : '') +
      (t.unpriced.length ? '<p class="unpriced-callout"><b>' + t.unpriced.length + ' items need a quote.</b> Unpriced work is outside these subtotals. Enter allowances before presenting a complete bid.</p>' : '') +
      table(base || '<tr><td colspan="4">No base items priced.</td></tr>', 'Priced base subtotal', t.base) +
      (cont ? '<h3>Additional allowances</h3><p class="hint">Possible triggers and alternative scopes. Confirm which apply before adding them together.</p>' + table(cont, 'If all listed allowances apply', t.contingent) : '') +
      '<p class="hint">Excluding a cost does not remove its requirement. Some agency review fees are unpublished and require an agency quote.</p></div>';
  }

  function renderConstraints(g, f) {
    var qs = ['NW', 'NE', 'SW', 'SE'].map(function (q) {
      var Q = g.quadrants[q];
      if (Q.share_of_parcel_pct < 1) return '<div class="q empty"><b>' + q + '</b><span>not part of lot</span></div>';
      var cls = Q.constrained_pct >= 85 ? 'bad' : Q.constrained_pct >= 40 ? 'warn' : 'ok';
      var top = Q.by.filter(function (b) { return b.pct >= 10; }).slice(0, 2).map(function (b) { return labelOf(b.id); }).join(', ');
      return '<div class="q ' + cls + '"><b>' + q + '</b><span class="big">' + pct(Q.constrained_pct) + '</span><span>constrained</span>' + (top ? '<small>' + esc(top) + '</small>' : '') + '</div>';
    }).join('');
    function labelOf(id) { var k = state.constraints.filter(function (c) { return c.id === id; })[0]; return k ? k.short || k.label : id; }
    var rows = g.constraints.filter(function (c) { return c.pct > 0; }).sort(function (a, b) { return b.pct - a.pct; }).map(function (c) {
      var k = state.constraints.filter(function (x) { return x.id === c.id; })[0];
      return '<tr><td><i class="sw" style="background:' + TIER_STYLE[c.tier].color + '"></i>' + esc(c.label) + (k.basis ? '<small>' + esc(k.basis) + '</small>' : '') + '</td><td class="num">' + pct(c.pct) + '</td><td class="num">' + acres(c.sqft) + '</td></tr>';
    }).join('');
    var constrained = g.totals.core.pct + g.totals.buffer.pct;
    return '<div class="card constraints" id="bid-constraints"><h2>Preliminary site envelope</h2><p class="hint">Early bid · buffers and layout unconfirmed</p>' +
      (incompleteMap() ? '<p class="coverage-callout">Coverage incomplete. Percentages describe returned features only; remaining areas have not been cleared for siting.</p>' : '') +
      '<div class="quads">' + qs + '</div>' +
      '<p>' + pct(constrained) + ' of the lot is inside a mapped feature or its standard buffer. About <b>' + acres(g.totals.clear.sqft + g.totals.review.sqft) + '</b> is outside them' +
      (g.totals.review.pct > 0 ? ', of which ' + acres(g.totals.review.sqft) + ' still triggers a study or review' : '') + '.</p>' +
      (rows ? '<table><thead><tr><th>Constraint</th><th class="num">Share of lot</th><th class="num">Area</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="hint">' + (incompleteMap() ? 'No constraints returned from the completed checks; other coverage remains unresolved.' : 'No mapped constraint reaches this lot.') + '</p>') +
      '<p class="hint">Quadrants split the lot at its centre point. Buffers are the standard code widths measured from mapped features, before any averaging, reduction or increase. Zoning setbacks, septic and drainfield reserve areas, easements and slopes not on the hazard map are not included. This is not a buildable-area determination.</p></div>';
  }

  function renderPermits(f) {
    var P = f.permits;
    if (P.status === 'unknown') return '<div class="card permits" id="bid-permits"><h2>Permit reuse check</h2><p class="unknown">County permit records could not be read' + (P.error ? ': ' + esc(P.error) : '') + '. Check the county permit portal.</p></div>';
    if (!P.items.length) return '<div class="card permits" id="bid-permits"><h2>Permit reuse check</h2><p>No county permit records are linked to this tax account. City permits, health district records and state or federal approvals are not in this dataset.</p></div>';
    var rows = P.items.slice(0, 40).map(function (i) {
      var flag = i.lapsed ? '<span class="badge required">Lapsed record</span>' : i.open ? '<span class="badge likely">Open record · confirm validity</span>' : '';
      return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.type) + '' + '</td><td>' + esc(i.status) + ' ' + flag + '</td><td>' + esc(i.submitted || '') + '</td><td>' + esc(i.expires || '') + '</td></tr>';
    }).join('');
    return '<div class="card permits" id="bid-permits"><h2>Permit reuse check <span class="hint">' + P.items.length + ' county records</span></h2>' +
      '<table><thead><tr><th>Permit</th><th>Type</th><th>Status</th><th>Submitted</th><th>Expires</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (P.truncated ? '<p class="coverage-callout">The permit service returned only part of the history. Missing rows are unknown.</p>' : '') + '<p class="hint">From the county permit table, keyed to this tax account. A finaled or approved permit covers the design that was approved then; a new or changed project generally needs its own review. City, health district, state and federal records are not included.</p></div>';
  }

  var STATUS_LABEL = { on_parcel: 'On the parcel', nearby: 'Nearby', none: 'Not mapped here', unknown: 'Could not check', found: 'Found' };
  function renderChecks(s) {
    var rows = Object.keys(s.layers).map(function (id) {
      var r = s.layers[id], l = r.layer;
      var detail = r.status === 'unknown' ? esc(r.error || '') : r.kind === 'features' && r.features.length ? (r.features[0].on_parcel ? '' : Math.round(r.features[0].distance_ft) + ' ft ' + r.features[0].bearing) : '';
      return '<tr class="' + r.status + '"><td>' + esc(l.label) + '<small>' + esc(l.publisher) + (l.caveat ? ' · ' + esc(l.caveat) : '') + '</small></td><td><span class="st ' + r.status + '">' + (r.truncated ? 'Partial result · incomplete' : STATUS_LABEL[r.status]) + '</span>' + (detail ? '<small>' + detail + '</small>' : '') + '</td><td class="num">' + (r.search_ft ? r.search_ft + ' ft' : 'parcel') + '</td></tr>';
    }).join('');
    rows += Object.keys(s.tables).map(function (id) {
      var r = s.tables[id];
      return '<tr class="' + r.status + '"><td>' + esc(r.table.label) + '</td><td>' + (r.truncated ? 'Partial result · incomplete' : r.status === 'none' ? 'No linked rows' : STATUS_LABEL[r.status]) + (r.error ? '<small>' + esc(r.error) + '</small>' : '') + '</td><td>account</td></tr>';
    }).join('');
    var unknown = Object.values(s.layers).concat(Object.values(s.tables)).filter(function (r) { return r.status === 'unknown' || r.truncated; }).length;
    return '<details class="card checks"' + (unknown ? ' open' : '') + '><summary><h2>What was checked <span class="hint">' + Object.keys(s.layers).length + ' map layers' + (unknown ? ', ' + unknown + ' could not be read' : '') + '</span></h2></summary>' +
      '<table><thead><tr><th>Layer</th><th>Result</th><th class="num">Search</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">&ldquo;Not mapped here&rdquo; describes the map, not the ground. Screened ' + esc(s.screened_at.slice(0, 16).replace('T', ' ')) + ' UTC.</p></details>';
  }

  function renderLimits() {
    return '<div class="card limits"><h2>How to use this</h2><ul>' +
      '<li><b>Required</b> means a code trigger is met by the project itself or by a feature mapped on the lot. <b>Likely</b> means a mapped feature is close enough that the code calls for review. <b>Possible</b> depends on something maps cannot show.</li>' +
      '<li>Agency fees are copied from published fee schedules with their effective dates. Consultant costs are market ranges, not quotes.</li>' +
      '<li>Nothing here is an approval, a determination or legal advice. Agencies decide; maps are often wrong at the scale of a single lot.</li>' +
      '<li>Research baseline ' + esc(DATA.meta.research_date) + '; individual sources show later checks. Maps use the dated snapshot above; refresh for current coverage.</li>' +
      '</ul></div>';
  }

  // ---------------------------------------------------------------- events
  function onCostEdit(e) {
    var tr = e.target.closest('tr[data-fee]');
    if (!tr) return;
    var id = tr.dataset.fee, o = Object.assign({}, state.overrides[id] || {});
    if (e.target.classList.contains('inc')) o.excluded = !e.target.checked;
    if (e.target.classList.contains('cost-note')) o.note = e.target.value;
    if (e.target.classList.contains('lo') || e.target.classList.contains('hi')) {
      var lo = tr.querySelector('.lo').value, hi = tr.querySelector('.hi').value;
      if (lo === '' || hi === '' || !Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi)) || Number(lo) < 0 || Number(hi) < Number(lo)) {
        setStatus('Enter both low and high amounts; high must be at least low. Your previous saved allowance is unchanged.', 'warn'); return;
      }
      o.low = Number(lo); o.high = Number(hi);
    }
    state.overrides[id] = o;
    setStatus(''); evaluate();
  }

  function draftOptions() {
    var drafts = window.BidDrafts.list(localStorage);
    $('saved-bids').innerHTML = '<option value="">Open a saved bid…</option>' + drafts.map(function (d) {
      return '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>';
    }).join('');
    $('saved-bids').value = state.draftId || '';
  }
  function saveBid() {
    if (!state.report || state.busy) return;
    try {
      state.draftId = state.draftId || crypto.randomUUID();
      window.BidDrafts.save(localStorage, window.BidDrafts.snapshot(state, readProject(), $('bid-title').value, $('bid-notes').value));
      draftOptions();
      $('save-status').textContent = 'Saved in this browser · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      history.replaceState(null, '', '#draft=' + encodeURIComponent(state.draftId));
    } catch (err) { $('save-status').textContent = 'Not saved: ' + err.message + ' Use Copy bid memo to keep a copy.'; }
  }
  function openDraft(id) {
    if (state.busy) return;
    try {
      var d = window.BidDrafts.list(localStorage).find(function (x) { return x.id === id; });
      if (!d || !PACKS[d.screening.pack_id]) throw new Error('This saved bid or jurisdiction is unavailable.');
      state.pack = PACKS[d.screening.pack_id]; state.draftId = d.id;
      state.parcel = Screen.buildParcel([{ geometry: d.parcel.geometry }], d.parcel);
      state.screening = d.screening; state.screening.parcel = state.parcel; state.constraintLand = null;
      state.overrides = d.overrides || {};
      state.facts = state.pack.deriveFacts(state.screening);
      state.constraints = RULESETS[state.pack.id].constraints(state.screening, state.facts, DATA);
      state.grid = Geo.gridAnalyze(state.parcel.shape, state.constraints, { targetSamples: 3000 });
      $('ptype').value = d.project.type; fillAssumptions(d.project.type, d.project);
      $('q').value = state.facts.parcel.situs || state.parcel.parcel_key;
      $('bid-title').value = d.title; $('bid-notes').value = d.notes;
      $('intro').hidden = true;
      setStatus('Saved map snapshot reopened; refresh maps for current coverage. Prices use the loaded source library.', 'warn');
      evaluate(); drawParcel(state.parcel); drawAnalysis();
    } catch (err) { setStatus('Could not reopen this bid: ' + esc(err.message), 'error'); }
  }
  function newBid() {
    if (state.busy) return;
    state.parcel = state.screening = state.facts = state.grid = state.report = state.draftId = null;
    state.overrides = {}; $('q').value = ''; $('bid-title').value = ''; $('bid-notes').value = '';
    $('results').hidden = $('bid-details').hidden = $('legend').hidden = true;
    $('intro').hidden = false; $('suggestions').hidden = true;
    $('saved-bids').value = ''; $('ptype').value = 'new_sfr'; fillAssumptions('new_sfr');
    parcelLayer.clearLayers(); overlayGroup.clearLayers(); gridGroup.clearLayers(); quadGroup.clearLayers();
    $('map-coverage').textContent = 'Choose a parcel to see mapped constraints and potential siting areas.';
    document.querySelector('.map-heading').classList.remove('incomplete');
    $('save-status').textContent = 'Drafts stay in this browser';
    setStatus(''); setBusy(false); history.replaceState(null, '', location.pathname); $('q').focus();
  }

  function copyMemo() {
    var text = Report.memo(state.report, state.facts, state.grid, state.screening, DATA, { title: $('bid-title').value, notes: $('bid-notes').value });
    var done = function () { toast('Bid memo copied to the clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) done(); else toast('Copy failed. Use Print instead.'); } catch (err) { toast('Copy failed. Use Print instead.'); }
      document.body.removeChild(ta);
    }
  }

  function init() {
    $('agency-scope-fields').innerHTML = Object.keys(Engine.SCOPE_FIELDS).map(function (key) {
      var field = Engine.SCOPE_FIELDS[key];
      return '<label>' + esc(field.label) + '<select id="a-' + key + '">' + Object.keys(field.choices).map(function (value) { return '<option value="' + value + '">' + esc(field.choices[value]) + '</option>'; }).join('') + '</select></label>';
    }).join('');
    var sel = $('ptype');
    Object.keys(Engine.PROJECT_TYPES).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = Engine.PROJECT_TYPES[k].label; sel.appendChild(o);
    });
    var js = $('jurisdiction');
    DATA.meta.jurisdictions.forEach(function (j) {
      var o = document.createElement('option'); o.value = j.id; o.textContent = j.name + (j.available ? '' : ' (planned)'); o.disabled = !j.available; js.appendChild(o);
    });
    var params = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (params.type && Engine.PROJECT_TYPES[params.type]) sel.value = params.type;
    fillAssumptions(sel.value);
    initMap();
    // If the page is served by bid-assistant/server.js, use its relay as a fallback for map
    // servers that refuse cross-origin browser requests.
    if (/^https?:$/.test(location.protocol)) {
      fetch('proxy/ping').then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) { if (t === 'ok') window.BidArcgis.setProxy('proxy?url='); }).catch(function () {});
    }

    $('search-form').addEventListener('submit', onSearch);
    sel.addEventListener('change', function () { fillAssumptions(sel.value); evaluate(); });
    $('assumptions').addEventListener('change', evaluate);
    $('agency-assumptions').addEventListener('change', evaluate);
    $('results').addEventListener('change', onCostEdit);
    $('btn-print').addEventListener('click', function () { window.print(); });
    // Closed <details> do not print, so open them for the print run and restore afterwards.
    var reopened = [];
    window.addEventListener('beforeprint', function () {
      reopened = Array.prototype.filter.call(document.querySelectorAll('#results details:not([open])'), function (d) { return !d.classList.contains('cite'); });
      reopened.forEach(function (d) { d.open = true; });
      map.invalidateSize();
    });
    window.addEventListener('afterprint', function () { reopened.forEach(function (d) { d.open = false; }); reopened = []; map.invalidateSize(); });
    $('btn-copy').addEventListener('click', copyMemo);
    $('btn-save').addEventListener('click', saveBid);
    $('btn-new').addEventListener('click', newBid);
    $('btn-refresh').addEventListener('click', function () { var key = state.parcel.parcel_key; loadParcel(function () { return state.pack.parcelById(key); }, 'parcel ' + key, true); });
    $('saved-bids').addEventListener('change', function () { if (this.value) openDraft(this.value); });
    $('bid-title').addEventListener('change', saveBid); $('bid-notes').addEventListener('change', saveBid);
    document.querySelector('.section-nav').addEventListener('click', function (e) { var a = e.target.closest('a'); if (a) { e.preventDefault(); var el = $(a.hash.slice(1)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
    $('results').addEventListener('click', function (e) { if (e.target.classList.contains('reset-cost')) { delete state.overrides[e.target.closest('tr').dataset.fee]; evaluate(); } });
    try { draftOptions(); } catch (err) { $('save-status').textContent = err.message; }

    $('examples').innerHTML = state.pack.examples.map(function (x, i) { return '<a href="#" data-example="' + i + '">' + esc(x.label) + '</a>'; }).join(' · ');
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-example]');
      if (!a) return;
      e.preventDefault();
      if (state.busy) return;
      var x = state.pack.examples[Number(a.dataset.example)];
      sel.value = x.type; fillAssumptions(x.type); $('q').value = '';
      loadParcel(function () { return state.pack.parcelById(x.parcel_key); }, x.label);
    });
    if (params.draft) openDraft(params.draft);
    else if (params.parcel) loadParcel(function () { return state.pack.parcelById(params.parcel); }, 'parcel ' + params.parcel);
    window.BidApp = { state: state };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
