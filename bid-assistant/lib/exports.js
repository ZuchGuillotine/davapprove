/* Self-contained parcel-scale export. No tiles, account secrets or network requests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidExports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function agencyName(value) { return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160) : ''; }
  function number(value) { return Number(value).toFixed(2); }
  function color(value, fallback) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : fallback; }
  function mapSvg(parcel, grid, screening, options) {
    options = options || {};
    if (!parcel || !parcel.shape || !grid) return '';
    var bb = parcel.shape.bbox, width = bb[2] - bb[0], height = bb[3] - bb[1];
    if (!bb.every(Number.isFinite) || width <= 0 || height <= 0) return '';
    // Fit the actual parcel in a fixed viewport with 12% context on each side.
    // This is independent of the interactive map's last pan, zoom and layer visibility.
    var scale = Math.min(920 / (width * 1.24), 480 / (height * 1.24));
    var cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    function xy(point) { return [500 + (point[0] - cx) * scale, 350 - (point[1] - cy) * scale]; }
    function path(rings, closed) {
      return rings.map(function (ring) {
        return ring.map(function (p, i) { var q = xy(p); return (i ? 'L' : 'M') + number(q[0]) + ',' + number(q[1]); }).join(' ') + (closed ? ' Z' : '');
      }).join(' ');
    }
    var parcelPath = path(parcel.shape.rings, true);
    var agency = agencyName(options.agency) || 'Prepared by: agency not specified';
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750" role="img" aria-labelledby="map-title map-description">',
      '<title id="map-title">' + escape(options.title || 'Parcel screening map') + '</title>',
      '<desc id="map-description">Parcel-fit public GIS snapshot. North up; approximate scale. Buffers and layout unconfirmed. No survey or approval.</desc>',
      '<rect width="1000" height="750" fill="#fff"/>',
      '<g font-family="Arial, sans-serif" fill="#243a32">',
      '<text x="30" y="35" font-size="' + Math.min(23, 1500 / agency.length) + '" font-weight="bold">' + escape(agency) + '</text>',
      '<text x="30" y="63" font-size="17">' + escape((options.title || 'Parcel screening map').slice(0, 95)) + '</text>',
      '<text x="30" y="85" font-size="13">Early bid · buffers &amp; layout unconfirmed</text>',
      '<defs><clipPath id="map-viewport"><rect x="30" y="110" width="940" height="480"/></clipPath><clipPath id="map-parcel"><path d="' + parcelPath + '" clip-rule="evenodd"/></clipPath></defs>',
      '<rect x="30" y="110" width="940" height="480" fill="#f6f7f3" stroke="#bbb"/>',
      '<g clip-path="url(#map-viewport)">'];
    Object.keys(screening.layers || {}).forEach(function (id) {
      var layer = screening.layers[id], style = layer.layer && layer.layer.style;
      if (!style) return;
      (layer.features || []).forEach(function (feature) {
        var geometry = feature.geometry || {}, rings = geometry.rings || geometry.paths;
        if (!rings) return;
        var projected = rings.map(function (ring) { return ring.map(parcel.proj.toXY); });
        out.push('<path d="' + path(projected, !!geometry.rings) + '" fill="' + (geometry.rings ? color(style.fill || style.color, '#90a4ae') : 'none') + '" fill-opacity="0.2" fill-rule="evenodd" stroke="' + color(style.color, '#6f7b82') + '" stroke-width="1.5"><title>' + escape(layer.layer.label) + '</title></path>');
      });
    });
    out.push('<g clip-path="url(#map-parcel)">');
    var colors = { core: '#d1242f', buffer: '#e08e0b', review: '#8250df', clear: options.incomplete ? '#7c8790' : '#6f9b7d' };
    grid.cells.forEach(function (cell) {
      var point = xy([cell.x - grid.step_ft / 2, cell.y + grid.step_ft / 2]);
      out.push('<rect x="' + number(point[0]) + '" y="' + number(point[1]) + '" width="' + number(grid.step_ft * scale + 0.1) + '" height="' + number(grid.step_ft * scale + 0.1) + '" fill="' + (colors[cell.cls] || '#7c8790') + '" fill-opacity="0.45"/>');
    });
    out.push('</g><path d="' + parcelPath + '" fill="none" stroke="#172e24" stroke-width="3"/></g>');
    var target = 150 / scale, magnitude = Math.pow(10, Math.floor(Math.log10(target)));
    var feet = [5, 2, 1].map(function (n) { return n * magnitude; }).find(function (n) { return n <= target; }) || magnitude;
    out.push('<path d="M50,565 v8 h' + number(feet * scale) + ' v-8" stroke="#172e24" fill="none" stroke-width="2"/><text x="50" y="553" font-size="12">Approx. ' + escape(feet) + ' ft</text><text x="938" y="135" font-size="17">N ↑</text>');
    [['#d1242f', 'Mapped feature'], ['#e08e0b', 'Indicative buffer'], ['#8250df', 'Study / review'], [colors.clear, options.incomplete ? 'Unresolved area' : 'Potential siting · unconfirmed']].forEach(function (item, i) {
      var x = 30 + i * 235;
      out.push('<rect x="' + x + '" y="610" width="12" height="12" fill="' + item[0] + '"/><text x="' + (x + 18) + '" y="621" font-size="12">' + item[1] + '</text>');
    });
    out.push('<text x="30" y="650" font-size="13">' + (options.incomplete ? 'Coverage incomplete. Unresolved areas are not cleared for building.' : 'Public GIS screening only. Potential siting is not a buildable-area determination.') + '</text>',
      '<text x="30" y="673" font-size="12">No aerial basemap. Not a survey, delineation or agency decision. Boundaries and scale are approximate.</text>',
      '<text x="30" y="696" font-size="12">Snapshot: ' + escape(screening.screened_at || 'date unavailable') + ' · Parcel: ' + escape(parcel.account_no || parcel.parcel_key || 'unknown') + '</text>',
      '<text x="30" y="723" font-size="11" fill="#61736a">Prepared with Davapprove · Public GIS sources and coverage details in the accompanying assessment</text>', '</g></svg>');
    return out.join('');
  }
  return { agencyName: agencyName, mapSvg: mapSvg };
});
