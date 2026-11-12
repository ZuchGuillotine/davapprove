(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['wa-kitsap'] = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function constraints(screening) {
    var L = screening.layers, out = [];
    function shapes(id) { return (L[id] && L[id].features || []).map(function (f) { return f.shape; }); }
    out.push({ id: 'wetland', label: 'Mapped wetland', tier: 'core', shapes: shapes('wetland'), buffer_ft: 0 });
    out.push({ id: 'wetland_buf', label: 'Wetland buffer (stub 100 ft)', tier: 'buffer', shapes: shapes('wetland'), buffer_ft: 100 });
    out.push({ id: 'stream_buf', label: 'Stream buffer (stub 100 ft)', tier: 'buffer', shapes: shapes('stream'), buffer_ft: 100 });
    var g = L.geohazard && L.geohazard.classes || {};
    Object.keys(g).forEach(function (c) {
      out.push({ id: 'geo_' + c, label: c, tier: /High/.test(c) ? 'core' : 'review', shapes: g[c].full, partial_shapes: g[c].partial, buffer_ft: 0 });
    });
    return out;
  }
  return { rules: [], constraints: constraints };
});
