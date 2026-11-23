/* Same-origin report transport for the hosted workspace. */
(function () {
  'use strict';

  async function request(route, payload) {
    var response = await fetch('/beta-api/' + route, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store'
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'The assessment could not be loaded.');
    return result;
  }

  function pack(meta) {
    return Object.assign({}, meta, {
      search: async function (query) {
        var result = await request('search', { query: query, county: meta.id });
        return Object.assign(result.hits, { truncated: result.truncated });
      },
      parcelById: function (parcel) { return Promise.resolve({ parcel: String(parcel) }); },
      parcelAtPoint: function (lng, lat) { return Promise.resolve({ point: [lng, lat] }); }
    });
  }

  window.BidHosted = {
    start: async function () {
      var metadata = await request('meta');
      return {
        packs: Object.fromEntries(metadata.counties.map(function (county) { return [county.id, pack(county)]; })),
        scopeItems: metadata.scopeItems
      };
    },
    report: function (payload) { return request('report', payload); }
  };
})();
