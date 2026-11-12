/* Bid assistant UI. Plain DOM; no framework. */
(function () {
  'use strict';

  var Geo = window.BidGeo, Screen = window.BidScreen, Engine = window.BidEngine, Report = window.BidReport;
  var DATA = window.BID_DATA, PACKS = window.BidPacks, RULESETS = window.BidRuleSets;

  var state = {
    pack: PACKS['wa-kitsap'],
    parcel: null, screening: null, facts: null, grid: null, constraints: null, report: null,
    overrides: {},      // fee id -> { low, high, excluded }
    busy: false
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
    baseLayers['Aerial'].addTo(map);
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
    buffer: { color: '#e08e0b', label: 'Regulatory buffer or setback' },
    review: { color: '#8250df', label: 'Triggers a study or review' },
    clear: { color: '#2da44e', label: 'No mapped constraint' }
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
      if (c.cls === 'clear') return;
      var a = p.proj.toLL([c.x - half, c.y - half]), b = p.proj.toLL([c.x + half, c.y + half]);
      L.rectangle([ll(a), ll(b)], { stroke: false, fillColor: TIER_STYLE[c.cls].color, fillOpacity: c.cls === 'review' ? 0.28 : 0.5, renderer: canvas, interactive: false }).addTo(gridGroup);
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
    ['core', 'buffer', 'review'].forEach(function (t) {
      if (state.grid.totals[t].pct > 0) items.push('<li><i style="background:' + TIER_STYLE[t].color + ';opacity:.7"></i>' + TIER_STYLE[t].label + '</li>');
    });
    Object.keys(s.layers).forEach(function (id) {
      var r = s.layers[id];
      if (r.kind !== 'features' || !r.features.length || !r.layer.style) return;
      var line = !r.features[0].geometry.rings;
      items.push('<li><i class="' + (line ? 'line' : '') + '" style="background:' + r.layer.style.color + '"></i>' + esc(r.layer.label) + '</li>');
    });
    items.unshift('<li><i class="outline"></i>Parcel boundary (assessor)</li>');
    $('legend').innerHTML = '<ul>' + items.join('') + '</ul><p>Map positions are approximate. Not a survey.</p>';
    $('legend').hidden = false;
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
    var q = $('q').value.trim();
    if (!q) return;
    setStatus('Searching county parcel records&hellip;', 'busy');
    state.pack.search(q).then(function (hits) {
      var ul = $('suggestions');
      if (!hits.length) { ul.hidden = true; setStatus('No parcel matched &ldquo;' + esc(q) + '&rdquo;. Try the house number and street name only, a tax account number, or click the parcel on the map.', 'warn'); return; }
      if (hits.length === 1) { ul.hidden = true; pick(hits[0]); return; }
      setStatus('');
      ul.innerHTML = hits.map(function (h, i) { return '<li><button type="button" data-i="' + i + '"><b>' + esc(h.label) + '</b><span>' + esc(h.sublabel) + '</span></button></li>'; }).join('');
      ul.hidden = false;
      ul.onclick = function (e) { var b = e.target.closest('button'); if (b) { ul.hidden = true; pick(hits[Number(b.dataset.i)]); } };
    }).catch(function (err) { setStatus('Parcel search failed: ' + esc(err.message), 'error'); });
  }
  function pick(hit) {
    $('q').value = hit.label;
    loadParcel(function () { return state.pack.parcelById(hit.parcel_key); }, hit.label);
  }

  function loadParcel(getParcel, what) {
    if (state.busy) return;
    state.busy = true; state.overrides = {};
    $('results').hidden = true; $('intro').hidden = true; $('legend').hidden = true;
    setStatus('Finding the parcel for ' + esc(what) + '&hellip;', 'busy');
    getParcel().then(function (parcel) {
      if (!parcel) { state.busy = false; setStatus('No tax parcel found at ' + esc(what) + '. It may be right-of-way, water or an untaxed tract.', 'warn'); return null; }
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
        state.busy = false;
        setStatus('');
        evaluate();
        drawAnalysis();
      });
    }).catch(function (err) {
      state.busy = false;
      setStatus('Could not complete the screening: ' + esc(err.message), 'error');
      if (window.console) console.error(err);
    });
  }

  function readProject() {
    var p = { type: $('ptype').value };
    ['new_sqft', 'hard_surface_sqft', 'disturbance_sqft', 'grading_cy', 'bedrooms', 'lots'].forEach(function (k) { p[k] = $('a-' + k).value; });
    ['wastewater', 'water'].forEach(function (k) { p[k] = $('a-' + k).value; });
    ['demo', 'in_water', 'tree_clearing', 'state_highway_access'].forEach(function (k) { p[k] = $('a-' + k).checked; });
    return p;
  }
  function fillAssumptions(type) {
    var p = Engine.normaliseProject({ type: type });
    ['new_sqft', 'hard_surface_sqft', 'disturbance_sqft', 'grading_cy', 'bedrooms', 'lots'].forEach(function (k) { $('a-' + k).value = p[k]; });
    ['demo', 'in_water', 'tree_clearing', 'state_highway_access'].forEach(function (k) { $('a-' + k).checked = !!p[k]; });
  }

  function rules() {
    var out = [];
    state.pack.rule_sets.forEach(function (id) { out = out.concat(RULESETS[id].rules); });
    return out;
  }

  function evaluate() {
    if (!state.facts) return;
    state.report = Engine.evaluate({ facts: state.facts, project: readProject(), grid: state.grid, rules: rules(), data: DATA });
    applyOverrides();
    render();
  }

  function applyOverrides() {
    state.report.costs.items.forEach(function (c) {
      var o = state.overrides[c.fee];
      if (!o) return;
      if (o.low != null) c.low = o.low;
      if (o.high != null) c.high = o.high;
      c.excluded = !!o.excluded;
      c.edited = o.low != null || o.high != null;
    });
    state.report.costs.totals = Engine.totals(state.report.costs.items);
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
    html.push(renderFlags(r, f, g));
    html.push(renderAgencies(r));
    html.push(renderCosts(r));
    html.push(renderConstraints(g, f));
    html.push(renderPermits(f));
    html.push(renderChecks(state.screening));
    html.push(renderLimits());
    $('results').innerHTML = html.join('');
    $('results').hidden = false;
    $('btn-print').disabled = false; $('btn-copy').disabled = false;
  }

  function renderParcelCard(f) {
    var p = f.parcel, j = f.jurisdiction;
    var where = j.city ? 'City of ' + j.city : 'Unincorporated Kitsap County' + (j.uga ? ' (' + j.uga + ')' : '');
    var bits = [
      ['Tax account', p.account_no || p.key],
      ['Size', p.acres + ' ac (' + p.area_sqft.toLocaleString() + ' sq ft mapped)'],
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
    return '<div class="tiles">' +
      tile('Agencies and districts', String(firm), maybe ? 'plus ' + maybe + ' possible' : 'required or likely') +
      tile('Add to the bid', range(t.base.low, t.base.high), splitText(t) || 'permit fees and studies, required or likely') +
      tile('Contingency', t.contingent.high ? range(t.contingent.low, t.contingent.high) : '$0', 'only if a possible trigger is confirmed') +
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
    var flags = Report.flags(r, f, g);
    if (!flags.length) return '';
    return '<div class="card flags"><h2>Say this in the client meeting</h2><ul>' +
      flags.map(function (x) { return '<li class="' + x.level + '">' + esc(x.text) + '</li>'; }).join('') + '</ul></div>';
  }

  function renderAgencies(r) {
    var byId = {}; r.findings.forEach(function (f) { byId[f.id] = f; });
    var tiers = {};
    r.agencies.forEach(function (a) { (tiers[a.tier] = tiers[a.tier] || []).push(a); });
    var out = ['<div class="card agencies"><h2>Who is involved <span class="hint">' + r.agencies.length + ' parties for a ' + esc(r.project.label.toLowerCase()) + '</span></h2>'];
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
      return '<details class="cite' + (c.verified ? '' : ' unverified') + '"><summary>' + esc(c.citation) + '</summary>' +
        '<blockquote>' + (c.excerpt ? '&ldquo;' + esc(c.excerpt) + '&rdquo;' : esc(c.summary || '')) + '</blockquote>' +
        '<p><a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title || c.citation) + '</a>' +
        (c.verified_against && c.verified_against !== c.url ? ' · <a href="' + esc(c.verified_against) + '" target="_blank" rel="noopener">text as checked</a>' : '') +
        ' <span class="hint">' + (c.verified ? 'quote matched to source ' + esc(c.fetched || '') : 'not verified against source text') + (c.source_currency && !/^current/.test(c.source_currency) ? ' · ' + esc(c.source_currency.replace(/^possibly_outdated: /, 'may be outdated: ')) : '') + '</span></p></details>';
    }).join('');
    var costs = f.costs.map(function (c) { return '<li>' + esc(c.label) + ' <b>' + range(c.low, c.high) + '</b>' + (c.bucket === 'contingent' ? ' <span class="hint">contingency' + (c.note ? ': ' + esc(c.note) : '') + '</span>' : '') + '</li>'; }).join('');
    return '<div class="finding">' +
      '<h4>' + badge(f.level) + ' ' + esc(f.title) + (f.basis && f.basis !== 'documented' ? ' <span class="basis">' + (f.basis === 'workflow' ? 'recommended step' : 'needs agency answer') + '</span>' : '') + '</h4>' +
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
        var src = c.source ? '<a href="' + esc(c.source.url) + '" target="_blank" rel="noopener" title="' + esc(c.source.title + (c.source.date ? ' · ' + c.source.date : '')) + '">' + (c.basis === 'published' ? 'published fee' : 'market range') + '</a>' : (c.confidence === 'unsourced' ? '<b class="unsourced">placeholder, no source</b>' : 'market range');
        return '<tr class="' + (c.excluded ? 'excluded' : '') + '" data-fee="' + esc(c.fee) + '">' +
          '<td><input type="checkbox" class="inc" ' + (c.excluded ? '' : 'checked') + ' aria-label="Include"></td>' +
          '<td><b>' + esc(c.label) + '</b><small>' + esc(c.payee || '') + (c.note ? ' · ' + esc(c.note) : '') + '</small></td>' +
          '<td><span class="kind ' + c.kind + '">' + KIND_LABEL[c.kind] + '</span><small>' + src + (c.edited ? ' · edited' : '') + '</small></td>' +
          '<td class="num"><input type="number" class="lo" min="0" step="50" value="' + Math.round(c.low) + '" aria-label="Low"></td>' +
          '<td class="num"><input type="number" class="hi" min="0" step="50" value="' + Math.round(c.high) + '" aria-label="High"></td></tr>';
      }).join('');
    };
    var t = r.costs.totals;
    var base = rows('base'), cont = rows('contingent');
    return '<div class="card costs"><h2>What to add to the bid</h2>' +
      '<p class="hint">Permit fees and pre-construction studies only. Construction, design fees, utility extensions and mitigation work are not included. Edit any number; untick a line the client is handling.</p>' +
      '<table><thead><tr><th></th><th>Item</th><th>Type</th><th class="num">Low</th><th class="num">High</th></tr></thead>' +
      '<tbody>' + (base || '<tr><td colspan="5" class="hint">Nothing triggered.</td></tr>') + '</tbody>' +
      '<tfoot><tr><td></td><td colspan="2">Base estimate (required and likely)</td><td class="num">' + money(t.base.low) + '</td><td class="num">' + money(t.base.high) + '</td></tr></tfoot></table>' +
      (cont ? '<h3>Contingencies <span class="hint">carry these as allowances or exclusions until confirmed</span></h3><table><tbody>' + cont + '</tbody><tfoot><tr><td></td><td colspan="2">If every contingency lands</td><td class="num">' + money(t.contingent.low) + '</td><td class="num">' + money(t.contingent.high) + '</td></tr></tfoot></table>' : '') +
      '</div>';
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
    return '<div class="card constraints"><h2>Where the lot is constrained</h2>' +
      '<div class="quads">' + qs + '</div>' +
      '<p>' + pct(constrained) + ' of the lot is inside a mapped feature or its standard buffer. About <b>' + acres(g.totals.clear.sqft + g.totals.review.sqft) + '</b> is outside them' +
      (g.totals.review.pct > 0 ? ', of which ' + acres(g.totals.review.sqft) + ' still triggers a study or review' : '') + '.</p>' +
      (rows ? '<table><thead><tr><th>Constraint</th><th class="num">Share of lot</th><th class="num">Area</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="hint">No mapped constraint reaches this lot.</p>') +
      '<p class="hint">Quadrants split the lot at its centre point. Buffers are the standard code widths measured from mapped features, before any averaging, reduction or increase. Zoning setbacks, septic and drainfield reserve areas, easements and slopes not on the hazard map are not included. This is not a buildable-area determination.</p></div>';
  }

  function renderPermits(f) {
    var P = f.permits;
    if (P.status === 'unknown') return '<div class="card permits"><h2>Permit history</h2><p class="unknown">County permit records could not be read' + (P.error ? ': ' + esc(P.error) : '') + '. Check the county permit portal.</p></div>';
    if (!P.items.length) return '<div class="card permits"><h2>Permit history</h2><p>No county permit records are linked to this tax account. City permits, health district records and state or federal approvals are not in this dataset.</p></div>';
    var rows = P.items.slice(0, 40).map(function (i) {
      var flag = i.lapsed ? '<span class="badge required">Lapsed</span>' : i.open ? '<span class="badge likely">Open</span>' : '';
      return '<tr><td>' + esc(i.number) + '</td><td>' + esc(i.type) + (i.project ? '<small>' + esc(i.project) + '</small>' : '') + '</td><td>' + esc(i.status) + ' ' + flag + '</td><td>' + esc(i.submitted || '') + '</td><td>' + esc(i.expires || '') + '</td></tr>';
    }).join('');
    return '<div class="card permits"><h2>Permit history <span class="hint">' + P.items.length + ' county records</span></h2>' +
      '<table><thead><tr><th>Permit</th><th>Type</th><th>Status</th><th>Submitted</th><th>Expires</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">From the county permit table, keyed to this tax account. A finaled or approved permit covers the design that was approved then; a new or changed project generally needs its own review. City, health district, state and federal records are not included.</p></div>';
  }

  var STATUS_LABEL = { on_parcel: 'On the parcel', nearby: 'Nearby', none: 'Not mapped here', unknown: 'Could not check', found: 'Found' };
  function renderChecks(s) {
    var rows = Object.keys(s.layers).map(function (id) {
      var r = s.layers[id], l = r.layer;
      var detail = r.status === 'unknown' ? esc(r.error || '') : r.kind === 'features' && r.features.length ? (r.features[0].on_parcel ? '' : Math.round(r.features[0].distance_ft) + ' ft ' + r.features[0].bearing) : '';
      return '<tr class="' + r.status + '"><td>' + esc(l.label) + '<small>' + esc(l.publisher) + (l.caveat ? ' · ' + esc(l.caveat) : '') + '</small></td><td><span class="st ' + r.status + '">' + STATUS_LABEL[r.status] + '</span>' + (detail ? '<small>' + detail + '</small>' : '') + '</td><td class="num">' + (r.search_ft ? r.search_ft + ' ft' : 'parcel') + '</td></tr>';
    }).join('');
    var unknown = Object.keys(s.layers).filter(function (id) { return s.layers[id].status === 'unknown'; }).length;
    return '<details class="card checks"' + (unknown ? ' open' : '') + '><summary><h2>What was checked <span class="hint">' + Object.keys(s.layers).length + ' map layers' + (unknown ? ', ' + unknown + ' could not be read' : '') + '</span></h2></summary>' +
      '<table><thead><tr><th>Layer</th><th>Result</th><th class="num">Search</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="hint">&ldquo;Not mapped here&rdquo; describes the map, not the ground. Screened ' + esc(s.screened_at.slice(0, 16).replace('T', ' ')) + ' UTC.</p></details>';
  }

  function renderLimits() {
    return '<div class="card limits"><h2>How to use this</h2><ul>' +
      '<li><b>Required</b> means a code trigger is met by the project itself or by a feature mapped on the lot. <b>Likely</b> means a mapped feature is close enough that the code calls for review. <b>Possible</b> depends on something maps cannot show.</li>' +
      '<li>Agency fees are copied from published fee schedules with their effective dates. Consultant costs are market ranges, not quotes.</li>' +
      '<li>Nothing here is an approval, a determination or legal advice. Agencies decide; maps are often wrong at the scale of a single lot.</li>' +
      '<li>Code text and fees checked ' + esc(DATA.meta.research_date) + '. Map layers are read live.</li>' +
      '</ul></div>';
  }

  // ---------------------------------------------------------------- events
  function onCostEdit(e) {
    var tr = e.target.closest('tr[data-fee]');
    if (!tr) return;
    var id = tr.dataset.fee, o = state.overrides[id] || (state.overrides[id] = {});
    if (e.target.classList.contains('inc')) o.excluded = !e.target.checked;
    if (e.target.classList.contains('lo')) o.low = Math.max(0, Number(e.target.value) || 0);
    if (e.target.classList.contains('hi')) o.high = Math.max(0, Number(e.target.value) || 0);
    if (o.low != null && o.high != null && o.high < o.low) o.high = o.low;
    evaluate();
  }

  function copyMemo() {
    var text = Report.memo(state.report, state.facts, state.grid, state.screening, DATA);
    var done = function () { toast('Bid memo copied to the clipboard.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { toast('Copy failed. Use Print instead.'); }
      document.body.removeChild(ta);
    }
  }

  function init() {
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

    $('search-form').addEventListener('submit', onSearch);
    sel.addEventListener('change', function () { fillAssumptions(sel.value); evaluate(); });
    $('assumptions').addEventListener('change', evaluate);
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
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-example]');
      if (a) { e.preventDefault(); $('q').value = a.dataset.example; onSearch(); }
    });
    if (params.parcel) loadParcel(function () { return state.pack.parcelById(params.parcel); }, 'parcel ' + params.parcel);
    window.BidApp = { state: state };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
