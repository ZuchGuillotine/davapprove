/*
 * Parcel screening: runs every layer in a jurisdiction pack against one parcel and returns
 * raw, attributable results. No interpretation happens here; that is the rule engine's job.
 *
 * Layer statuses:
 *   on_parcel  the mapped feature touches the parcel
 *   nearby     the mapped feature is within the layer's search distance of the parcel
 *   none       the layer was checked and nothing is mapped within the search distance
 *   unknown    the layer could not be checked (network, service error, truncated result)
 * "none" is a statement about the map only. It is never a clearance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'), require('./arcgis.js'));
  else root.BidScreen = factory(root.BidGeo, root.BidArcgis);
})(typeof self !== 'undefined' ? self : this, function (Geo, Arc) {
  'use strict';

  function unionRings(features) {
    var rings = [];
    features.forEach(function (f) { if (f.geometry && f.geometry.rings) rings = rings.concat(f.geometry.rings); });
    return { rings: rings };
  }

  function llBBox(geom) {
    var b = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
    geom.rings.forEach(function (r) {
      r.forEach(function (p) {
        if (p[0] < b.xmin) b.xmin = p[0];
        if (p[1] < b.ymin) b.ymin = p[1];
        if (p[0] > b.xmax) b.xmax = p[0];
        if (p[1] > b.ymax) b.ymax = p[1];
      });
    });
    return b;
  }

  function expandEnvelope(env, feet, lat) {
    var dy = feet / Geo.FT_PER_DEG_LAT;
    var dx = feet / (Geo.FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    return { xmin: env.xmin - dx, ymin: env.ymin - dy, xmax: env.xmax + dx, ymax: env.ymax + dy };
  }

  /** Points strictly inside the parcel, used for "which district is this in" questions so that
   *  neighbours that merely share a boundary line are not reported. */
  function interiorPoints(parcelShape, proj, want) {
    var b = parcelShape.bbox, pts = [];
    for (var n = 5; n <= 40 && pts.length < (want || 9); n *= 2) {
      pts = [];
      var sx = (b[2] - b[0]) / n, sy = (b[3] - b[1]) / n;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var p = [b[0] + (i + 0.5) * sx, b[1] + (j + 0.5) * sy];
        if (Geo.pointInPolygon(p, parcelShape)) pts.push(p);
      }
    }
    // thin to a manageable multipoint
    var stride = Math.max(1, Math.floor(pts.length / 25));
    return pts.filter(function (_, k) { return k % stride === 0; }).map(function (p) { return proj.toLL(p); });
  }

  function buildParcel(features, extra) {
    var geom = unionRings(features);
    if (!geom.rings.length) throw new Error('Parcel has no polygon geometry in the county parcel layer.');
    var env = llBBox(geom);
    var proj = Geo.makeProjector((env.xmin + env.xmax) / 2, (env.ymin + env.ymax) / 2);
    var shape = Geo.shapeFromEsri(geom, proj);
    var c = Geo.centroid(shape);
    var parcel = {
      geometry: geom,
      envelope: env,
      proj: proj,
      shape: shape,
      area_sqft: Geo.area(shape),
      centroid_xy: c,
      centroid_ll: proj.toLL(c),
      polygon_count: features.length
    };
    parcel.acres_gis = parcel.area_sqft / 43560;
    parcel.interior_points = interiorPoints(shape, proj, 9);
    Object.keys(extra || {}).forEach(function (k) { parcel[k] = extra[k]; });
    return parcel;
  }

  function runFeatureLayer(layer, parcel) {
    var env = expandEnvelope(parcel.envelope, layer.search_ft || 0, parcel.centroid_ll[1]);
    var params = {
      geometry: env,
      where: layer.where || '1=1',
      outFields: (layer.fields || ['*']).join(','),
      geometryPrecision: 7
    };
    if (layer.max_offset_ft) params.maxAllowableOffset = layer.max_offset_ft / Geo.FT_PER_DEG_LAT;
    return Arc.query(layer.url, params, { timeoutMs: layer.timeout_ms }).then(function (r) {
      var feats = r.features.map(function (f) {
        var shape = Geo.shapeFromEsri(f.geometry, parcel.proj);
        if (!shape) return null;
        var d = Geo.shapeDistance(parcel.shape, shape);
        var ref = shape.type === 'point' ? shape.rings[0][0] : nearestVertex(shape, parcel.centroid_xy);
        return {
          attrs: f.attributes,
          geometry: f.geometry,
          shape: shape,
          distance_ft: d,
          on_parcel: d === 0,
          bearing: Geo.compass(parcel.centroid_xy, ref)
        };
      }).filter(Boolean).filter(function (f) { return f.distance_ft <= (layer.search_ft || 0) + 0.5; });
      feats.sort(function (a, b) { return a.distance_ft - b.distance_ft; });
      var status = !feats.length ? 'none' : feats[0].on_parcel ? 'on_parcel' : 'nearby';
      var res = { id: layer.id, kind: 'features', status: status, features: feats, search_ft: layer.search_ft || 0 };
      if (r.exceeded) {
        // The server cut the list short, so absence cannot be trusted.
        res.truncated = true;
        if (status === 'none') { res.status = 'unknown'; res.error = 'Result truncated by the map service.'; }
      }
      return res;
    });
  }

  function nearestVertex(shape, pt) {
    var best = null, bd = Infinity;
    shape.rings.forEach(function (r) {
      r.forEach(function (p) {
        var d = (p[0] - pt[0]) * (p[0] - pt[0]) + (p[1] - pt[1]) * (p[1] - pt[1]);
        if (d < bd) { bd = d; best = p; }
      });
    });
    return best;
  }

  function runAttributeLayer(layer, parcel) {
    var geom = { points: parcel.interior_points, spatialReference: { wkid: 4326 } };
    return Arc.query(layer.url, {
      geometry: geom, geometryType: 'esriGeometryMultipoint',
      where: layer.where || '1=1',
      outFields: (layer.fields || ['*']).join(','),
      returnGeometry: false
    }, { timeoutMs: layer.timeout_ms }).then(function (r) {
      var seen = {}, feats = [];
      r.features.forEach(function (f) {
        var key = JSON.stringify(f.attributes);
        if (!seen[key]) { seen[key] = true; feats.push({ attrs: f.attributes, on_parcel: true, distance_ft: 0 }); }
      });
      return { id: layer.id, kind: 'attributes', status: feats.length ? 'on_parcel' : 'none', features: feats, search_ft: 0 };
    });
  }

  function runProbeLayer(layer, parcel) {
    var near = expandEnvelope(parcel.envelope, layer.search_ft || 0, parcel.centroid_ll[1]);
    // One cheap question first: is anything mapped on or near the parcel at all?
    return Arc.query(layer.url, {
      geometry: near, where: layer.where || '1=1', outFields: layer.class_field,
      returnGeometry: false, returnDistinctValues: true
    }, { timeoutMs: layer.timeout_ms }).then(function (r) {
      var nearClasses = uniq(r.features.map(function (f) { return String(f.attributes[layer.class_field]); }));
      if (!nearClasses.length) return { id: layer.id, kind: 'probe', status: 'none', classes: {}, near_classes: [], search_ft: layer.search_ft || 0 };
      return Arc.probeCoverage(layer.url, parcel.envelope, {
        classField: layer.class_field, where: layer.where, maxDepth: layer.max_depth || 4, timeoutMs: layer.timeout_ms
      }).then(function (p) {
        var classes = {}, any = false;
        Object.keys(p.classes).forEach(function (c) {
          var toShape = function (e) {
            var a = parcel.proj.toXY([e.xmin, e.ymin]), b = parcel.proj.toXY([e.xmax, e.ymax]);
            return Geo.rectShape(a[0], a[1], b[0], b[1]);
          };
          var full = p.classes[c].full.map(toShape), partial = p.classes[c].partial.map(toShape);
          // keep only rectangles that actually reach the parcel polygon
          full = full.filter(function (s) { return Geo.shapeDistance(parcel.shape, s) === 0; });
          partial = partial.filter(function (s) { return Geo.shapeDistance(parcel.shape, s) === 0; });
          if (full.length || partial.length) any = true;
          classes[c] = { full: full, partial: partial, full_env: p.classes[c].full, partial_env: p.classes[c].partial };
        });
        return {
          id: layer.id, kind: 'probe', status: any ? 'on_parcel' : 'nearby', classes: classes,
          near_classes: nearClasses, search_ft: layer.search_ft || 0,
          requests: p.requests, truncated: p.truncated,
          cell_ft: Math.max(parcel.shape.bbox[2] - parcel.shape.bbox[0], parcel.shape.bbox[3] - parcel.shape.bbox[1]) / Math.pow(2, p.max_depth)
        };
      });
    });
  }

  /** Raster layers answer /identify one point at a time; sample a few interior points and keep every value. */
  function runIdentifyLayer(layer, parcel) {
    var pts = [parcel.centroid_ll].concat(parcel.interior_points).slice(0, layer.samples || 5);
    var e = expandEnvelope(parcel.envelope, 200, parcel.centroid_ll[1]);
    var tasks = pts.map(function (p) {
      return function () {
        return Arc.getJson(layer.url.replace(/\/\d+$/, '') + '/identify', {
          f: 'json', geometry: { x: p[0], y: p[1], spatialReference: { wkid: 4326 } }, geometryType: 'esriGeometryPoint', sr: 4326,
          tolerance: 1, mapExtent: [e.xmin, e.ymin, e.xmax, e.ymax].join(','), imageDisplay: '400,400,96',
          layers: 'all:' + layer.url.match(/\/(\d+)$/)[1], returnGeometry: false
        }, { timeoutMs: layer.timeout_ms }).then(function (j) {
          return (j.results || []).map(function (r) { return r.attributes && (r.attributes['Raster.Value'] || r.attributes['Pixel Value'] || r.attributes['UniqueValue.Pixel Value'] || r.value); });
        });
      };
    });
    return Arc.pool(tasks, 3).then(function (lists) {
      var vals = [];
      lists.forEach(function (l) { l.forEach(function (v) { var n = Number(v); if (isFinite(n)) vals.push(n); }); });
      if (!vals.length) return { id: layer.id, kind: 'identify', status: 'unknown', error: 'The raster service returned no value at the sampled points.', features: [], values: [] };
      return { id: layer.id, kind: 'identify', status: 'on_parcel', features: [], values: vals, max: Math.max.apply(null, vals), search_ft: 0 };
    });
  }

  function uniq(a) { var s = {}; return a.filter(function (v) { return s[v] ? false : (s[v] = true); }); }

  function runTable(table, parcel) {
    var where = table.where(parcel);
    if (!where) return Promise.resolve({ id: table.id, status: 'none', rows: [] });
    return Arc.query(table.url, {
      where: where, outFields: (table.fields || ['*']).join(','), returnGeometry: false,
      orderByFields: table.order_by
    }).then(function (r) {
      return { id: table.id, status: r.features.length ? 'found' : 'none', rows: r.features.map(function (f) { return f.attributes; }), truncated: r.exceeded };
    });
  }

  function guard(id, kind, promise) {
    return promise.catch(function (err) {
      return { id: id, kind: kind, status: 'unknown', error: String((err && err.message) || err), features: [], rows: [], classes: {} };
    });
  }

  /**
   * Screen one parcel. `parcel` comes from pack.resolveParcel(). Progress callback receives
   * (done, total, layerLabel).
   */
  function screenParcel(pack, parcel, opts) {
    opts = opts || {};
    var layers = pack.layers.filter(function (l) { return !opts.only || opts.only.indexOf(l.id) >= 0; });
    var tables = pack.tables || [];
    var total = layers.length + tables.length, done = 0;
    function tick(label) { done++; if (opts.onProgress) opts.onProgress(done, total, label); }

    var layerTasks = layers.map(function (layer) {
      return function () {
        var run = layer.kind === 'attributes' ? runAttributeLayer : layer.kind === 'probe' ? runProbeLayer : layer.kind === 'identify' ? runIdentifyLayer : runFeatureLayer;
        return guard(layer.id, layer.kind, run(layer, parcel)).then(function (res) {
          res.layer = layer;
          res.checked_at = new Date().toISOString();
          tick(layer.label);
          return res;
        });
      };
    });
    var tableTasks = tables.map(function (t) {
      return function () {
        return guard(t.id, 'table', runTable(t, parcel)).then(function (res) { res.table = t; tick(t.label); return res; });
      };
    });

    return Arc.pool(layerTasks.concat(tableTasks), opts.concurrency || 6).then(function (results) {
      var out = { pack_id: pack.id, parcel: parcel, layers: {}, tables: {}, screened_at: new Date().toISOString() };
      results.forEach(function (r) {
        if (r.kind === 'table' || r.table) out.tables[r.id] = r; else out.layers[r.id] = r;
      });
      return out;
    });
  }

  return {
    buildParcel: buildParcel,
    screenParcel: screenParcel,
    expandEnvelope: expandEnvelope,
    interiorPoints: interiorPoints
  };
});
