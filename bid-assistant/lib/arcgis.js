/*
 * Minimal ArcGIS REST client. Uses the global fetch (browser, or Node 18+). No dependencies.
 *
 * Design rule: a failed or timed-out request is reported as an error and never as "nothing
 * found". Callers turn errors into an explicit "could not check" result.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidArcgis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 30000;

  /** GET/POST JSON with one automatic retry, since public map servers drop requests now and then. */
  function getJson(url, params, opts) {
    opts = opts || {};
    return getJsonOnce(url, params, opts).catch(function (err) {
      if (opts.noRetry) throw err;
      // Second attempt goes through the same-origin relay when one is configured. Some public
      // servers answer server-to-server requests but refuse or drop browser cross-origin ones.
      var second = proxyPrefix ? Object.assign({}, opts, { viaProxy: true }) : opts;
      return new Promise(function (resolve) { setTimeout(resolve, 600); }).then(function () { return getJsonOnce(url, params, second); });
    });
  }

  var proxyPrefix = null;
  /** Configure a same-origin relay, e.g. '/proxy?url='. Pass null to turn it off. */
  function setProxy(prefix) { proxyPrefix = prefix || null; }

  function getJsonOnce(url, params, opts) {
    var qs = Object.keys(params || {})
      .filter(function (k) { return params[k] !== undefined && params[k] !== null; })
      .map(function (k) {
        var v = params[k];
        if (typeof v === 'object') v = JSON.stringify(v);
        return encodeURIComponent(k) + '=' + encodeURIComponent(v);
      })
      .join('&');
    var full = url + (qs ? (url.indexOf('?') >= 0 ? '&' : '?') + qs : '');
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || DEFAULT_TIMEOUT_MS) : null;
    // POST keeps long geometries out of the URL; ArcGIS accepts form-encoded queries.
    var usePost = full.length > 1800;
    var target = opts.viaProxy && proxyPrefix ? proxyPrefix + encodeURIComponent(usePost ? url : full) : null;
    var req = usePost
      ? fetch(target || url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs, signal: ctrl && ctrl.signal })
      : fetch(target || full, { signal: ctrl && ctrl.signal });
    return req
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + hostOf(url));
        return res.json();
      })
      .then(function (json) {
        if (json && json.error) {
          throw new Error((json.error.message || 'ArcGIS error') + ' (' + hostOf(url) + ')');
        }
        return json;
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new Error('Timed out contacting ' + hostOf(url));
        throw err;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^/]+)/.exec(url);
    return m ? m[1] : url;
  }

  /** Query a layer or table. Geometry is requested in lon/lat (EPSG:4326). */
  function query(layerUrl, params, opts) {
    var p = { f: 'json', where: '1=1', outFields: '*', returnGeometry: true, outSR: 4326 };
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    if (p.geometry && typeof p.geometry === 'object' && !p.geometryType) {
      p.geometryType = 'xmin' in p.geometry ? 'esriGeometryEnvelope' : 'rings' in p.geometry ? 'esriGeometryPolygon' : 'esriGeometryPoint';
    }
    if (p.geometry && !p.inSR) p.inSR = 4326;
    if (p.geometry && !p.spatialRel) p.spatialRel = 'esriSpatialRelIntersects';
    return getJson(layerUrl.replace(/\/$/, '') + '/query', p, opts).then(function (json) {
      return {
        features: json.features || [],
        exceeded: !!json.exceededTransferLimit
      };
    });
  }

  /** Run tasks with bounded concurrency. Each task is a function returning a promise. */
  function pool(tasks, limit) {
    var i = 0, results = new Array(tasks.length);
    function next() {
      if (i >= tasks.length) return Promise.resolve();
      var idx = i++;
      return tasks[idx]().then(function (r) { results[idx] = r; return next(); });
    }
    var runners = [];
    for (var k = 0; k < Math.min(limit, tasks.length); k++) runners.push(next());
    return Promise.all(runners).then(function () { return results; });
  }

  /**
   * Coverage probe for layers whose polygons are too large to download (for example a
   * county-wide hazard class stored as one multipolygon). Asks the server attribute-only
   * questions about progressively smaller rectangles:
   *   - "intersects": some part of this rectangle is inside a feature of the class
   *   - "within":     the whole rectangle is inside a single feature of the class
   * Returns, per class value, rectangles that are fully inside ("full") and rectangles at the
   * finest level that are only partly inside ("partial"). Envelope is lon/lat.
   */
  function probeCoverage(layerUrl, envelope, opts) {
    opts = opts || {};
    var field = opts.classField;
    var maxDepth = opts.maxDepth || 4;
    var maxRequests = opts.maxRequests || 260;
    var requests = 0, truncated = false;
    var out = {}; // class -> { full: [env], partial: [env] }

    function ask(env, rel, where) {
      requests++;
      return query(layerUrl, {
        geometry: env, spatialRel: rel, where: where || opts.where || '1=1',
        outFields: field, returnGeometry: false, returnDistinctValues: true
      }, opts).then(function (r) {
        var seen = {};
        r.features.forEach(function (f) { seen[String(f.attributes[field])] = true; });
        return Object.keys(seen);
      });
    }
    function bucket(cls) { return out[cls] || (out[cls] = { full: [], partial: [] }); }

    function visit(env, depth, classes) {
      // classes: class values still unresolved for this rectangle (null = all)
      var where = classes ? whereIn(field, classes, opts.where) : null;
      return ask(env, 'esriSpatialRelIntersects', where).then(function (hit) {
        if (!hit.length) return null;
        if (depth >= maxDepth) {
          // Finest level: record the rectangle as touched without asking whether it is
          // wholly inside. Halves the request count; the caller treats it as constrained.
          hit.forEach(function (c) { bucket(c).partial.push(env); });
          return null;
        }
        return ask(env, 'esriSpatialRelWithin', whereIn(field, hit, opts.where)).then(function (inside) {
          inside.forEach(function (c) { bucket(c).full.push(env); });
          var open = hit.filter(function (c) { return inside.indexOf(c) < 0; });
          if (!open.length) return null;
          if (depth >= maxDepth || requests >= maxRequests) {
            if (depth < maxDepth) truncated = true;
            open.forEach(function (c) { bucket(c).partial.push(env); });
            return null;
          }
          var mx = (env.xmin + env.xmax) / 2, my = (env.ymin + env.ymax) / 2;
          var kids = [
            { xmin: env.xmin, ymin: env.ymin, xmax: mx, ymax: my },
            { xmin: mx, ymin: env.ymin, xmax: env.xmax, ymax: my },
            { xmin: env.xmin, ymin: my, xmax: mx, ymax: env.ymax },
            { xmin: mx, ymin: my, xmax: env.xmax, ymax: env.ymax }
          ];
          return pool(kids.map(function (k) { return function () { return visit(k, depth + 1, open); }; }), 4);
        });
      });
    }

    return visit(envelope, 0, null).then(function () {
      return { classes: out, requests: requests, truncated: truncated, max_depth: maxDepth };
    });
  }

  function whereIn(field, values, base) {
    var list = values.map(function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; }).join(',');
    var w = field + ' IN (' + list + ')';
    return base && base !== '1=1' ? '(' + base + ') AND ' + w : w;
  }

  function sqlString(s) {
    return String(s).replace(/'/g, "''");
  }

  // Normalize common postal aliases before ranking. Search is a candidate suggestion,
  // never an automatic statement that two different parcels are the same property.
  var addressTerms = {NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW',AVENUE:'AVE',STREET:'ST',ROAD:'RD',DRIVE:'DR',COURT:'CT',PLACE:'PL',BOULEVARD:'BLVD',LANE:'LN',HIGHWAY:'HWY',PARKWAY:'PKWY',CIRCLE:'CIR',TERRACE:'TER'};
  function normalizeAddress(value) {
    return String(value || '').toUpperCase().split(',')[0].replace(/[^A-Z0-9 ]/g,' ').trim().split(/\s+/).map(function(w){return addressTerms[w]||w;}).join(' ');
  }
  function addressScore(query, address) {
    var a=normalizeAddress(query), b=normalizeAddress(address);
    if (b.indexOf(a)===0) return 1;
    // Do not suggest another house number as a spelling correction.
    var house=/^\d+/.exec(a), other=/^\d+/.exec(b);
    if(house && (!other || house[0]!==other[0]))return 0;
    b=b.slice(0,a.length);
    var prev=Array.from({length:b.length+1},function(_,i){return i;});
    for(var i=1;i<=a.length;i++) {var row=[i];for(var j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}
    return 1-prev[b.length]/Math.max(a.length,b.length,1);
  }

  return { normalizeAddress: normalizeAddress, addressScore: addressScore, setProxy: setProxy, getJson: getJson, query: query, pool: pool, probeCoverage: probeCoverage, sqlString: sqlString, hostOf: hostOf };
});
