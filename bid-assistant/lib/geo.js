/*
 * Planar geometry for parcel screening. No dependencies; runs in the browser and in Node.
 *
 * Everything here is planning-level. Inputs are lon/lat from public GIS layers whose own
 * positional accuracy is tens of feet at best, so results are rounded and must never be
 * presented as a survey, a delineation or a buildable-area determination.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FT_PER_DEG_LAT = 364567.2; // mean feet per degree of latitude (WGS84, mid-latitudes)

  /** Local equirectangular projection to feet. Error is far below GIS source error at parcel scale. */
  function makeProjector(lon0, lat0) {
    var kx = FT_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
    var ky = FT_PER_DEG_LAT;
    return {
      origin: [lon0, lat0],
      toXY: function (ll) { return [(ll[0] - lon0) * kx, (ll[1] - lat0) * ky]; },
      toLL: function (xy) { return [xy[0] / kx + lon0, xy[1] / ky + lat0]; }
    };
  }

  /** Convert an Esri JSON geometry (already in lon/lat) into a projected shape. */
  function shapeFromEsri(geom, proj) {
    if (!geom) return null;
    var conv = function (line) { return line.map(function (p) { return proj.toXY(p); }); };
    if (geom.rings) return withBBox({ type: 'polygon', rings: geom.rings.map(conv) });
    if (geom.paths) return withBBox({ type: 'polyline', rings: geom.paths.map(conv) });
    if (typeof geom.x === 'number') return withBBox({ type: 'point', rings: [[proj.toXY([geom.x, geom.y])]] });
    return null;
  }

  function rectShape(xmin, ymin, xmax, ymax) {
    return withBBox({ type: 'polygon', rings: [[[xmin, ymin], [xmin, ymax], [xmax, ymax], [xmax, ymin], [xmin, ymin]]] });
  }

  function withBBox(shape) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    shape.rings.forEach(function (r) {
      r.forEach(function (p) {
        if (p[0] < b[0]) b[0] = p[0];
        if (p[1] < b[1]) b[1] = p[1];
        if (p[0] > b[2]) b[2] = p[0];
        if (p[1] > b[3]) b[3] = p[1];
      });
    });
    shape.bbox = b;
    return shape;
  }

  function ringSignedArea(ring) {
    var a = 0;
    for (var i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return a / 2;
  }

  /** Area of a polygon shape. Holes have opposite winding to shells, so the signed sum is correct. */
  function area(shape) {
    if (!shape || shape.type !== 'polygon') return 0;
    var a = 0;
    shape.rings.forEach(function (r) { a += ringSignedArea(r); });
    return Math.abs(a);
  }

  function centroid(shape) {
    var cx = 0, cy = 0, a = 0;
    shape.rings.forEach(function (ring) {
      for (var i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        var f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        cx += (ring[j][0] + ring[i][0]) * f;
        cy += (ring[j][1] + ring[i][1]) * f;
        a += f;
      }
    });
    if (Math.abs(a) < 1e-9) return [(shape.bbox[0] + shape.bbox[2]) / 2, (shape.bbox[1] + shape.bbox[3]) / 2];
    return [cx / (3 * a), cy / (3 * a)];
  }

  /** Even-odd rule across all rings, which handles holes and multipart polygons. */
  function pointInPolygon(pt, shape) {
    if (shape.type !== 'polygon') return false;
    var x = pt[0], y = pt[1], b = shape.bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    var inside = false;
    for (var r = 0; r < shape.rings.length; r++) {
      var ring = shape.rings[r];
      for (var i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  function distSqPointSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len = dx * dx + dy * dy;
    var t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }

  /** Distance from a point to the linework of a shape (boundary for polygons). */
  function distPointToLinework(pt, shape) {
    var best = Infinity;
    for (var r = 0; r < shape.rings.length; r++) {
      var ring = shape.rings[r];
      if (ring.length === 1) {
        var d0 = (ring[0][0] - pt[0]) * (ring[0][0] - pt[0]) + (ring[0][1] - pt[1]) * (ring[0][1] - pt[1]);
        if (d0 < best) best = d0;
        continue;
      }
      for (var i = 1; i < ring.length; i++) {
        var d = distSqPointSeg(pt[0], pt[1], ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }

  /** Distance from a point to a shape: zero when inside a polygon. */
  function distPointToShape(pt, shape) {
    if (shape.type === 'polygon' && pointInPolygon(pt, shape)) return 0;
    return distPointToLinework(pt, shape);
  }

  function segsIntersect(a, b, c, d) {
    function o(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    var d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function bboxGap(a, b) {
    var dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
    var dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Minimum distance between two shapes; zero when they touch, cross or one contains the other. */
  function shapeDistance(a, b) {
    var i, r, best = Infinity;
    // containment
    if (a.type === 'polygon' && pointInPolygon(b.rings[0][0], a)) return 0;
    if (b.type === 'polygon' && pointInPolygon(a.rings[0][0], b)) return 0;
    // vertex-to-linework both ways (exact for non-crossing shapes)
    for (r = 0; r < a.rings.length; r++) for (i = 0; i < a.rings[r].length; i++) {
      var d = distPointToLinework(a.rings[r][i], b);
      if (d < best) best = d;
    }
    for (r = 0; r < b.rings.length; r++) for (i = 0; i < b.rings[r].length; i++) {
      var d2 = distPointToLinework(b.rings[r][i], a);
      if (d2 < best) best = d2;
    }
    if (best === 0) return 0;
    // crossing segments
    for (var ra = 0; ra < a.rings.length; ra++) {
      var A = a.rings[ra];
      for (var ia = 1; ia < A.length; ia++) {
        var sx0 = Math.min(A[ia - 1][0], A[ia][0]), sx1 = Math.max(A[ia - 1][0], A[ia][0]);
        var sy0 = Math.min(A[ia - 1][1], A[ia][1]), sy1 = Math.max(A[ia - 1][1], A[ia][1]);
        if (sx1 < b.bbox[0] || sx0 > b.bbox[2] || sy1 < b.bbox[1] || sy0 > b.bbox[3]) continue;
        for (var rb = 0; rb < b.rings.length; rb++) {
          var B = b.rings[rb];
          for (var ib = 1; ib < B.length; ib++) {
            if (segsIntersect(A[ia - 1], A[ia], B[ib - 1], B[ib])) return 0;
          }
        }
      }
    }
    return best;
  }

  /** Compass bearing label of a point relative to a centre, 8-way. */
  function compass(from, to) {
    var ang = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
    var names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    return names[Math.round(((ang + 360) % 360) / 45) % 8];
  }

  /**
   * Sample the parcel on a regular grid and classify every sample against a list of constraints.
   *
   * constraint = { id, label, tier: 'core'|'buffer'|'review', shapes: [shape], buffer_ft: number,
   *                partial_shapes: [shape] (optional: coarse cells only partly inside the constraint) }
   *
   *  - 'core'   : the mapped feature itself (wetland polygon, mapped high hazard, floodway/SFHA)
   *  - 'buffer' : a regulatory buffer or setback measured from a mapped feature
   *  - 'review' : an area that triggers a study or review but is not a presumptive no-build area
   *
   * Returns per-constraint coverage, a combined classification per sample, and N/S/E/W quadrant
   * summaries split at the parcel centroid.
   */
  function gridAnalyze(parcel, constraints, opts) {
    opts = opts || {};
    var target = opts.targetSamples || 2500;
    var b = parcel.bbox, w = b[2] - b[0], h = b[3] - b[1];
    var step = Math.max(opts.minStep || 4, Math.sqrt((w * h) / target));
    var c = centroid(parcel);
    var quads = { NW: newQ(), NE: newQ(), SW: newQ(), SE: newQ() };
    var per = {};
    constraints.forEach(function (k) { per[k.id] = { id: k.id, label: k.label, tier: k.tier, samples: 0, partial: 0 }; });
    var cells = [], total = 0, tally = { core: 0, buffer: 0, review: 0, clear: 0 };
    var order = { core: 3, buffer: 2, review: 1, clear: 0 };

    for (var y = b[1] + step / 2; y < b[3]; y += step) {
      for (var x = b[0] + step / 2; x < b[2]; x += step) {
        var pt = [x, y];
        if (!pointInPolygon(pt, parcel)) continue;
        total++;
        var cls = 'clear', hits = [];
        for (var i = 0; i < constraints.length; i++) {
          var k = constraints[i], hit = false, partial = false;
          var buf = k.buffer_ft || 0;
          for (var s = 0; s < k.shapes.length && !hit; s++) {
            var sh = k.shapes[s], sb = sh.bbox;
            if (x < sb[0] - buf || x > sb[2] + buf || y < sb[1] - buf || y > sb[3] + buf) continue;
            if (buf === 0) hit = sh.type === 'polygon' && pointInPolygon(pt, sh);
            else hit = distPointToShape(pt, sh) <= buf;
          }
          if (!hit && k.partial_shapes) {
            for (var p = 0; p < k.partial_shapes.length && !partial; p++) {
              if (pointInPolygon(pt, k.partial_shapes[p])) partial = true;
            }
          }
          if (hit || partial) {
            per[k.id].samples++;
            if (partial && !hit) per[k.id].partial++;
            hits.push(k.id);
            if (order[k.tier] > order[cls]) cls = k.tier;
          }
        }
        tally[cls]++;
        var q = (y >= c[1] ? 'N' : 'S') + (x >= c[0] ? 'E' : 'W');
        quads[q].total++;
        quads[q][cls]++;
        hits.forEach(function (id) { quads[q].by[id] = (quads[q].by[id] || 0) + 1; });
        cells.push({ x: x, y: y, cls: cls, hits: hits });
      }
    }

    var cellArea = step * step;
    var parcelArea = area(parcel);
    // scale sample counts to the true polygon area so percentages and square feet agree
    var scale = total ? parcelArea / (total * cellArea) : 0;
    var out = {
      step_ft: step,
      samples: total,
      parcel_sqft: parcelArea,
      centroid: c,
      cells: cells,
      totals: {},
      constraints: [],
      quadrants: {}
    };
    ['core', 'buffer', 'review', 'clear'].forEach(function (t) {
      out.totals[t] = { pct: total ? (100 * tally[t]) / total : 0, sqft: tally[t] * cellArea * scale };
    });
    constraints.forEach(function (k) {
      var p = per[k.id];
      out.constraints.push({
        id: k.id, label: k.label, tier: k.tier,
        pct: total ? (100 * p.samples) / total : 0,
        sqft: p.samples * cellArea * scale,
        includes_coarse_cells: p.partial > 0
      });
    });
    Object.keys(quads).forEach(function (qk) {
      var Q = quads[qk];
      out.quadrants[qk] = {
        share_of_parcel_pct: total ? (100 * Q.total) / total : 0,
        sqft: Q.total * cellArea * scale,
        core_pct: Q.total ? (100 * Q.core) / Q.total : 0,
        buffer_pct: Q.total ? (100 * Q.buffer) / Q.total : 0,
        review_pct: Q.total ? (100 * Q.review) / Q.total : 0,
        clear_pct: Q.total ? (100 * Q.clear) / Q.total : 0,
        constrained_pct: Q.total ? (100 * (Q.core + Q.buffer)) / Q.total : 0,
        by: Object.keys(Q.by).map(function (id) { return { id: id, pct: (100 * Q.by[id]) / Q.total }; })
          .sort(function (m, n) { return n.pct - m.pct; })
      };
    });
    return out;

    function newQ() { return { total: 0, core: 0, buffer: 0, review: 0, clear: 0, by: {} }; }
  }

  return {
    FT_PER_DEG_LAT: FT_PER_DEG_LAT,
    makeProjector: makeProjector,
    shapeFromEsri: shapeFromEsri,
    rectShape: rectShape,
    withBBox: withBBox,
    area: area,
    centroid: centroid,
    pointInPolygon: pointInPolygon,
    distPointToShape: distPointToShape,
    distPointToLinework: distPointToLinework,
    shapeDistance: shapeDistance,
    bboxGap: bboxGap,
    compass: compass,
    gridAnalyze: gridAnalyze
  };
});
