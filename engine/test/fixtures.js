'use strict';
/* Synthetic county responses: no network. Values are made up; rules and fees are real. */
const path = require('node:path');
const Screen = require(path.join(__dirname, '../../bid-assistant/lib/screen.js'));

const PARCEL_KEY = '123456';
const ADDRESS = '1 SYNTHETIC RD';

function syntheticParcel(key = PARCEL_KEY) {
  return Screen.buildParcel([{ geometry: { rings: [[[-122.65, 47.6], [-122.649, 47.6], [-122.649, 47.601], [-122.65, 47.601], [-122.65, 47.6]]] } }], { parcel_key: key, rp_acct_id: Number(key) });
}

/** deps for createEngine. options: { outage: layer id to fail, hits: search hits per county id, down: county ids whose lookups fail } */
function fakeDeps(options = {}) {
  const calls = { screens: 0 };
  const deps = {
    calls,
    preparePack(pack) {
      const down = (options.down || []).includes(pack.id);
      pack.search = async (q) => { if (down) throw new Error('Timed out contacting county'); return /synth/i.test(q) ? (options.hits || {})[pack.id] || [] : []; };
      pack.parcelById = async (key) => {
        if (down) throw new Error('Timed out contacting county');
        if (!/^\d{1,7}$/.test(key)) throw new Error('Invalid assessor account ID');
        return key === '999' ? null : syntheticParcel(key);
      };
      return pack;
    },
    Screen: {
      async screenParcel(pack, parcel) {
        calls.screens++;
        const layers = Object.fromEntries(pack.layers.map((l) => [l.id, { id: l.id, layer: l, kind: l.kind, status: 'none', features: [], classes: {}, near_classes: [], values: [] }]));
        if (layers.zoning) layers.zoning = { ...layers.zoning, status: 'on_parcel', features: [{ attrs: { ZONEBREV: 'RR', ZONE_DESCRIPTION: 'Rural Residential' } }] };
        if (options.outage && layers[options.outage]) layers[options.outage] = { ...layers[options.outage], status: 'unknown', error: 'Synthetic outage' };
        const tables = Object.fromEntries((pack.tables || []).map((t) => [t.id, { id: t.id, table: t, status: 'none', rows: [] }]));
        if (tables.land) tables.land = { ...tables.land, status: 'found', rows: [{ ACRES: 2, TOT_IMPROV: 0, NUM_DWELL: 0 }] };
        if (tables.address) tables.address = { ...tables.address, status: 'found', rows: [{ SITUS_ADDR: ADDRESS, ACCT_NO: 'TEST-123' }] };
        return { pack_id: pack.id, parcel, layers, tables, screened_at: '2026-11-23T00:00:00Z' };
      },
    },
  };
  return deps;
}

module.exports = { fakeDeps, PARCEL_KEY, ADDRESS };
