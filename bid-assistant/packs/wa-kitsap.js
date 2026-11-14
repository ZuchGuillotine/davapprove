/*
 * Jurisdiction pack: Kitsap County, Washington.
 *
 * A pack is the only place that knows a county's map services and field names. It turns
 * raw layer hits into the jurisdiction-neutral "facts" the rule engine consumes, so adding a
 * county means writing another pack, not touching the engine.
 *
 * Layer endpoints were inspected and queried on 2026-11-12. See docs/BID_ASSISTANT.md for the
 * verification notes on each one.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/arcgis.js'), require('../lib/screen.js'));
  else (root.BidPacks = root.BidPacks || {})['wa-kitsap'] = factory(root.BidArcgis, root.BidScreen);
})(typeof self !== 'undefined' ? self : this, function (Arc, Screen) {
  'use strict';

  var AGOL = 'https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/';
  var ENVIRO = 'https://psearch.kitsap.gov/arcgis/rest/services/DCD/EnviroPlanning/MapServer/';
  var NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/';
  function fs(name, n) { return AGOL + name + '/FeatureServer/' + (n || 0); }

  var COUNTY = 'Kitsap County GIS';
  var layers = [
    // ---- who has jurisdiction -------------------------------------------------------------
    { id: 'city', group: 'jurisdiction', kind: 'attributes', label: 'Incorporated city limits', publisher: COUNTY,
      url: fs('Incorporated_City_Limit_Outlines'), fields: ['NAME'] },
    { id: 'uga', group: 'jurisdiction', kind: 'attributes', label: 'Urban growth areas', publisher: COUNTY,
      url: fs('Designated_Urban_Growth_Areas'), fields: ['GMA_JURISDICTION'] },
    { id: 'reservation', group: 'jurisdiction', kind: 'attributes', label: 'Reservation boundaries', publisher: COUNTY,
      url: fs('Reservation_Boundaries'), fields: ['RESERVATION'],
      caveat: 'Shows the exterior reservation boundary only. It does not distinguish trust land from fee land.' },
    { id: 'zoning', group: 'jurisdiction', kind: 'attributes', label: 'Zoning designations', publisher: COUNTY,
      url: fs('Zoning_Designations'), fields: ['GMA_JURISDICTION', 'ZONEBREV', 'ZONE_DESCRIPTION', 'ZONING_DENSITY_DESCRIPTION'] },
    { id: 'fire_district', group: 'jurisdiction', kind: 'attributes', label: 'Fire districts', publisher: COUNTY,
      url: fs('Fire_District_Outlines'), fields: ['DISTRICT'] },
    { id: 'water_district', group: 'jurisdiction', kind: 'attributes', label: 'Water districts', publisher: COUNTY,
      url: fs('Water_District_Outlines'), fields: ['DISTRICT'],
      caveat: 'Only special-purpose water districts are mapped. Kitsap PUD, city and private Group A/B systems are not in this layer.' },
    { id: 'sewer_area', group: 'jurisdiction', kind: 'attributes', label: 'County sewer service areas', publisher: COUNTY,
      url: fs('Sewer_Service_Area'), fields: ['SYSTEM'],
      caveat: 'County-operated sewer systems only. City and district sewer service is not in this layer.' },
    { id: 'sewer_main', group: 'jurisdiction', kind: 'features', label: 'County sewer gravity mains', publisher: COUNTY,
      url: fs('Sewer_Gravity_Mains'), fields: ['DIAMETER', 'LIFECYCLESTATUS', 'JURISDICTION'], search_ft: 250,
      style: { color: '#7a5c99', weight: 2, dash: '2 4' } },
    { id: 'airport', group: 'jurisdiction', kind: 'attributes', label: 'Airport overlay', publisher: COUNTY,
      url: fs('Airport_Overlay'), fields: ['zone', 'airportnam'] },

    { id: 'tribal_lands', group: 'jurisdiction', kind: 'attributes', label: 'Reservation and off-reservation trust lands (state compilation)', publisher: 'WA Department of Ecology',
      url: 'https://gis.ecology.wa.gov/serverext/rest/services/Authoritative/ECY/MapServer/10', where: "LAND_TYPE IN ('RES','OOF')", fields: ['LAND_TYPE', 'TRIBAL_NM1', 'TRIBAL_NM2'],
      caveat: 'Reference-scale compilation. Not a title record; trust status of a parcel must be confirmed.' },
    { id: 'state_route', group: 'jurisdiction', kind: 'features', label: 'State highways', publisher: 'WSDOT',
      url: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/StateRoutes/MapServer/0', fields: ['StateRouteNumber', 'RT_TYPEA'], search_ft: 75,
      caveat: 'Centreline only. Frontage is inferred from the centreline lying within 75 ft of the lot.', style: { color: '#cf222e', weight: 3, dash: '8 5' } },
    { id: 'arch_risk', group: 'jurisdiction', kind: 'identify', label: 'Archaeological risk assessment model', publisher: 'WA Department of Archaeology and Historic Preservation',
      url: 'https://wisaard.dahp.wa.gov/server/rest/services/Archaeological_Risk_Assessment_Model/MapServer/0', samples: 5,
      caveat: 'A statewide probability model, not recorded site locations, which are confidential.' },

    // ---- critical areas -------------------------------------------------------------------
    { id: 'wetland', group: 'critical', kind: 'features', label: 'Mapped wetlands (county inventory)', publisher: COUNTY,
      url: fs('Kitsap_County_Wetlands'), fields: ['SOURCE', 'MODIFIED'], search_ft: 315,
      caveat: 'Compiled from NWI, DNR and parcel-map sources. Inventory maps miss many wetlands and do not show category; only a delineation and rating establish the regulated edge and buffer.',
      style: { color: '#1f8a70', fill: '#1f8a70', fillOpacity: 0.45 } },
    { id: 'nwi', group: 'critical', kind: 'features', label: 'National Wetlands Inventory', publisher: 'U.S. Fish and Wildlife Service',
      url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0',
      where: "WETLAND_TYPE NOT IN ('Estuarine and Marine Deepwater','Estuarine and Marine Wetland','Lake','Riverine')", fields: ['ATTRIBUTE', 'WETLAND_TYPE'], search_ft: 315, max_offset_ft: 2, timeout_ms: 45000,
      caveat: 'Reconnaissance-level photo interpretation, often from old imagery. It under-maps forested wetlands and is not a delineation. Freshwater types only: tidal shore and open water classes are left to the shoreline checks.',
      style: { color: '#0e8a6a', fill: '#3fb68b', fillOpacity: 0.3, dash: '3 3' } },
    { id: 'stream', group: 'critical', kind: 'features', label: 'Streams with water type', publisher: COUNTY + ' (WA DNR and Wild Fish Conservancy typing)',
      url: fs('Updated_Streams_Layer_WFL1', 0), fields: ['FP_WTRTY_CD', 'FP_WTRTY_NM', 'DataSource'], search_ft: 315,
      caveat: 'Mapped stream position and water type are modelled or field-typed to varying standards. A water type can be changed by field verification.',
      style: { color: '#1f6feb', weight: 3 } },
    { id: 'waterbody', group: 'critical', kind: 'features', label: 'Lakes and ponds (WAC 222-16-030 water types)', publisher: 'Kitsap County DCD (WA DNR hydrography)',
      url: ENVIRO + '36', fields: ['WB_GNIS_NM', 'FP_WTRTY_CD', 'WB_HYDR_FTR_CD'], search_ft: 315,
      style: { color: '#1f6feb', fill: '#1f6feb', fillOpacity: 0.3 } },
    { id: 'geohazard', group: 'critical', kind: 'probe', label: 'Geologically hazardous areas', publisher: COUNTY,
      url: fs('Geologically_Hazardous_Areas'), class_field: 'DESCRIPTION', search_ft: 200, max_depth: 4,
      caveat: 'The county publishes each hazard class as a single county-wide polygon, so coverage is sampled on a grid across the parcel rather than drawn exactly. The map does not say whether the hazard is landslide, erosion or seismic.',
      style: { High: '#c0392b', Moderate: '#e08e0b' } },
    { id: 'cara1', group: 'critical', kind: 'attributes', label: 'Critical aquifer recharge areas, Category I', publisher: COUNTY,
      url: fs('Category_I_Critical_Aquifer_Recharge_Areas'), fields: ['SIGNIFICANT_RECHARGE_AREAS', 'FIVE_YR_TOT', 'TENYR_TOT_GROUPA_SOILS'] },
    { id: 'cara2', group: 'critical', kind: 'attributes', label: 'Critical aquifer recharge areas, Category II', publisher: COUNTY,
      url: fs('Category_II_Critical_Aquifer_Recharge_Areas'), fields: ['LABEL', 'SHALLOW_AQUIFERS'] },

    // ---- shoreline ------------------------------------------------------------------------
    { id: 'smp', group: 'shoreline', kind: 'features', label: 'Shoreline Master Program environment designations', publisher: COUNTY,
      url: fs('Shoreline_Master_Plan_Environmental_Designations'), fields: ['ENVIRONMENT'], search_ft: 100,
      caveat: 'Designation polygons approximate shoreline jurisdiction. Jurisdiction is set by the ordinary high water mark located on the ground, plus associated wetlands and floodways.',
      style: { color: '#8250df', fill: '#8250df', fillOpacity: 0.12, weight: 1 } },
    { id: 'marine_shore', group: 'shoreline', kind: 'features', label: 'Marine shoreline (shoreform segments)', publisher: 'Kitsap County DCD',
      url: ENVIRO + '42', fields: ['C_TYPE', 'H_TYPE', 'CELL_TYPE'], search_ft: 250,
      caveat: 'Used as an approximate marine ordinary high water line for measuring shoreline buffers. Not a surveyed OHWM.',
      style: { color: '#0a3069', weight: 3 } },
    { id: 'armoring', group: 'shoreline', kind: 'features', label: 'Existing shoreline armoring (field inventory)', publisher: 'Kitsap County DCD',
      url: ENVIRO + '53', fields: ['TYPE', 'MATERIAL', 'CONDITION', 'GPS_DATE'], search_ft: 40,
      caveat: 'Field inventory dated 2008 or earlier for most segments; structures may have changed since.',
      style: { color: '#57606a', weight: 4 } },
    { id: 'feeder_bluff', group: 'shoreline', kind: 'features', label: 'Coastal landforms and feeder bluffs', publisher: 'Kitsap County DCD (Coastal Geologic Services 2013)',
      url: ENVIRO + '25', fields: ['SHORETYPE', 'LANDSLIDE', 'TOE_EROSION'], search_ft: 100,
      style: { color: '#bc4c00', weight: 3, dash: '6 4' } },
    { id: 'smelt', group: 'shoreline', kind: 'features', label: 'Surf smelt spawning beaches', publisher: 'Kitsap County DCD (WDFW marine resources)',
      url: ENVIRO + '20', fields: [], search_ft: 150, style: { color: '#d4a72c', weight: 4 } },
    { id: 'sandlance', group: 'shoreline', kind: 'features', label: 'Pacific sand lance spawning beaches', publisher: 'Kitsap County DCD (WDFW marine resources)',
      url: ENVIRO + '21', fields: [], search_ft: 150, style: { color: '#d4a72c', weight: 4 } },
    { id: 'herring', group: 'shoreline', kind: 'features', label: 'Pacific herring spawning areas', publisher: 'Kitsap County DCD (WDFW marine resources)',
      url: ENVIRO + '28', fields: [], search_ft: 150, style: { color: '#d4a72c', fill: '#d4a72c', fillOpacity: 0.2 } },
    { id: 'eelgrass', group: 'shoreline', kind: 'features', label: 'Eelgrass', publisher: 'Kitsap County DCD',
      url: ENVIRO + '22', fields: [], search_ft: 150, style: { color: '#2da44e', weight: 4 } },

    { id: 'aquatic_own', group: 'shoreline', kind: 'features', label: 'Mapped state aquatic lands (tidelands and bedlands)', publisher: 'WA Department of Natural Resources',
      url: 'https://gis.dnr.wa.gov/site3/rest/services/Aquatics/Washington_State_Aquatic_Lands_and_Boundaries/MapServer/1', where: "OWNER_AGENT_NM LIKE '%STATE OF WASHINGTON%'", fields: ['AQPRCL_TYPE_CD'], search_ft: 150, max_offset_ft: 3, timeout_ms: 45000,
      caveat: 'Marine and freshwater aquatic lands, compiled from deeds and plats, not survey grade. Ownership at the proposed work footprint must be confirmed on title.' },

    // ---- flood ----------------------------------------------------------------------------
    { id: 'flood', group: 'flood', kind: 'features', label: 'FEMA special flood hazard areas', publisher: 'FEMA National Flood Hazard Layer',
      url: NFHL + '28', where: "SFHA_TF = 'T'", fields: ['FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DFIRM_ID'], search_ft: 100, max_offset_ft: 2, timeout_ms: 45000,
      caveat: 'Effective FIRM data. Letters of map change and preliminary maps are not reflected.',
      style: { color: '#0969da', fill: '#54aeff', fillOpacity: 0.35, weight: 1 } }
  ];

  var tables = [
    { id: 'land', label: 'Assessor land record', url: fs('Land_with_Zoning_and_Acreage'),
      fields: ['ACRES', 'PROP_CLASS', 'ZONE_CODE', 'NUM_DWELL', 'NUM_COMM', 'NUM_OTHER', 'TOT_IMPROV', 'WATER', 'SEWER'],
      where: function (p) { return p.rp_acct_id ? 'RP_ACCT_ID = ' + Number(p.rp_acct_id) : null; } },
    { id: 'buildings', label: 'Assessor building records', url: fs('Building_Information'),
      fields: ['IMPROV_TYP', 'YEAR_BUILT', 'STORIES', 'FLR_TOT_SF', 'BEDROOMS', 'FULL_BATHS', 'BLDG_TYP', 'USE_DESC'],
      where: function (p) { return p.rp_acct_id ? 'RP_ACCT_ID = ' + Number(p.rp_acct_id) : null; } },
    { id: 'address', label: 'Situs address', url: fs('Parcel_Address'),
      fields: ['ACCT_NO', 'SITUS_ADDR', 'SITUS_CITY', 'SITUS_ZIP_CODE'],
      where: function (p) { return p.rp_acct_id ? 'RP_ACCT_ID = ' + Number(p.rp_acct_id) : null; } },
    // Applicant names are deliberately not requested.
    { id: 'permits', label: 'County permit history', url: fs('Permits'),
      fields: ['PERMIT_NO', 'TYPE_CODE', 'STATUS', 'STATUS_DATE', 'SUBMITTED_DATE', 'ISSUED_DATE', 'EXPIRATION_DATE', 'PARENT_PERMIT_NO'],
      order_by: 'SUBMITTED_DATE DESC',
      where: function (p) { return p.rp_acct_id ? 'RP_ACCT_ID = ' + Number(p.rp_acct_id) + ' OR LD_ACCT_ID = ' + Number(p.rp_acct_id) : null; } }
  ];

  var PARCELS = fs('Tax_Parcel_lot_polygons');
  var PARCEL_FIELDS = 'RP_ACCT_ID,APN,PID';

  function parcelFromFeatures(features) {
    if (!features.length) return null;
    var id = features[0].attributes.RP_ACCT_ID;
    return Screen.buildParcel(features, { rp_acct_id: id, parcel_key: String(id), county: 'Kitsap', state: 'WA' });
  }

  function parcelById(rpAcctId) {
    return Arc.query(PARCELS, { where: 'RP_ACCT_ID = ' + Number(rpAcctId), outFields: PARCEL_FIELDS }).then(function (r) {
      return parcelFromFeatures(r.features);
    });
  }

  function parcelAtPoint(lon, lat) {
    return Arc.query(PARCELS, { geometry: { x: lon, y: lat }, outFields: PARCEL_FIELDS, returnGeometry: false }).then(function (r) {
      var hit = r.features.filter(function (f) { return f.attributes.RP_ACCT_ID > 0; })[0];
      if (!hit) return null;
      // An account can own several polygons; fetch them all so the parcel is whole.
      return parcelById(hit.attributes.RP_ACCT_ID);
    });
  }

  /** Free-text search: tax account number (12-3456-789-0123 style), assessor account ID, or situs address. */
  function search(text) {
    var t = String(text || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!t) return Promise.resolve([]);
    var ADDR = fs('Parcel_Address');
    var where;
    if (/^\d{6,7}$/.test(t)) where = 'RP_ACCT_ID = ' + Number(t);
    else if (/^[\d-]{10,}$/.test(t)) where = "ACCT_NO = '" + Arc.sqlString(t) + "'";
    else {
      // strip city/state/zip the user may have typed after a comma
      var street = t.split(',')[0].replace(/[^A-Z0-9 #/-]/g, '');
      where = "SITUS_ADDR LIKE '" + Arc.sqlString(street) + "%'";
    }
    return Arc.query(ADDR, {
      where: where, outFields: 'RP_ACCT_ID,ACCT_NO,SITUS_ADDR,SITUS_CITY', returnGeometry: false,
      resultRecordCount: 12, orderByFields: 'SITUS_ADDR'
    }).then(function (r) {
      return r.features.map(function (f) {
        var a = f.attributes;
        return {
          parcel_key: String(a.RP_ACCT_ID),
          label: (a.SITUS_ADDR || 'No situs address') + (a.SITUS_CITY ? ', ' + a.SITUS_CITY : ''),
          sublabel: 'Tax account ' + a.ACCT_NO
        };
      });
    });
  }

  var CITY_NAMES = { BI: 'Bainbridge Island', BR: 'Bremerton', PB: 'Poulsbo', PO: 'Port Orchard' };
  var RESERVATIONS = {
    'Port Madison': { tribe: 'suquamish', name: 'Port Madison Indian Reservation' },
    'S`Klallam': { tribe: 'pgst', name: "Port Gamble S'Klallam Reservation" }
  };
  var FIRE = {
    '1': 'Central Kitsap Fire & Rescue', '2': 'Bainbridge Island Fire Department', '7': 'South Kitsap Fire & Rescue',
    '10': 'North Kitsap Fire & Rescue', '18': 'Poulsbo Fire Department', 'MCF2': 'North Mason Regional Fire Authority'
  };
  var SEWER = { CK: 'Central Kitsap', K: 'Kingston', M: 'Manchester', Suquamish: 'Suquamish', 'Miller Bay': 'Miller Bay', NYC: 'Navy Yard City' };

  function attrsOf(res) { return res && res.features ? res.features.map(function (f) { return f.attrs; }) : []; }
  function st(res) { return res ? res.status : 'unknown'; }

  /** Stream water type code as mapped -> regulatory type used by the buffer table. */
  function streamType(code) {
    var c = String(code || '').trim();
    if (c === 'S' || c === 'F' || c === 'Np' || c === 'Ns') return c;
    if (c === 'N') return 'N';       // non-fish, perennial vs seasonal not determined
    if (c === 'NOCH') return 'NOCH'; // mapped as no channel
    return 'U';                      // U, X, blank: untyped
  }

  /**
   * Turn a screening into jurisdiction-neutral facts. Every fact carries its own status so the
   * engine can tell "mapped", "not mapped" and "could not check" apart.
   */
  function deriveFacts(screening) {
    var L = screening.layers, T = screening.tables, p = screening.parcel;
    var land = (T.land && T.land.rows[0]) || {};
    var addr = (T.address && T.address.rows[0]) || {};
    var bldgs = (T.buildings && T.buildings.rows) || [];
    var dwellings = bldgs.filter(function (b) { return /DWELL|MH|MOBILE/i.test(String(b.IMPROV_TYP || '') + String(b.BLDG_TYP || '')); });
    var years = bldgs.map(function (b) { return b.YEAR_BUILT; }).filter(Boolean);

    var cityCode = attrsOf(L.city).map(function (a) { return a.NAME; })[0];
    var zoning = attrsOf(L.zoning);
    var res = attrsOf(L.reservation).map(function (a) { return RESERVATIONS[a.RESERVATION] || { tribe: null, name: a.RESERVATION }; })[0];
    var uga = attrsOf(L.uga).map(function (a) { return a.GMA_JURISDICTION; }).filter(function (n) { return !/^City of /.test(n); })[0];

    var streams = (L.stream && L.stream.features || []).map(function (f) {
      return { type: streamType(f.attrs.FP_WTRTY_CD), mapped_code: f.attrs.FP_WTRTY_CD, source: f.attrs.DataSource, distance_ft: f.distance_ft, on_parcel: f.on_parcel, bearing: f.bearing };
    });
    var lakes = (L.waterbody && L.waterbody.features || []).map(function (f) {
      return { type: streamType(f.attrs.FP_WTRTY_CD), name: f.attrs.WB_GNIS_NM || null, distance_ft: f.distance_ft, on_parcel: f.on_parcel, bearing: f.bearing };
    });
    var smp = (L.smp && L.smp.features || []);
    var designations = uniq(smp.filter(function (f) { return f.on_parcel; }).map(function (f) { return title(f.attrs.ENVIRONMENT); }));
    var marine = L.marine_shore && L.marine_shore.features || [];
    var flood = L.flood && L.flood.features || [];
    var geo = L.geohazard || {};
    var geoClasses = Object.keys(geo.classes || {}).filter(function (c) { return geo.classes[c].full.length || geo.classes[c].partial.length; })
      .map(function (c) { return c.replace(/ Hazard Area$/, ''); });

    var wetAll = (L.wetland && L.wetland.features || []).concat(L.nwi && L.nwi.features || []).sort(function (a, b) { return a.distance_ft - b.distance_ft; });
    var wetStatus = worst([st(L.wetland), st(L.nwi)]);
    // one source answering is enough to report a mapped wetland; "unknown" only if nothing was found and a source failed
    if (wetAll.length) wetStatus = wetAll[0].on_parcel ? 'on_parcel' : 'nearby';
    var trust = attrsOf(L.tribal_lands);
    var tribalNames = uniq(trust.reduce(function (out, a) { return out.concat([a.TRIBAL_NM1, a.TRIBAL_NM2].filter(Boolean)); }, []));
    var routes = (L.state_route && L.state_route.features || []);
    var stateAquatic = (L.aquatic_own && L.aquatic_own.features || []).length > 0;

    var facts = {
      parcel: {
        key: p.parcel_key,
        account_no: addr.ACCT_NO || null,
        situs: addr.SITUS_ADDR ? addr.SITUS_ADDR + (addr.SITUS_CITY ? ', ' + addr.SITUS_CITY : '') : null,
        acres: land.ACRES || round(p.acres_gis, 2),
        assessor_acres: land.ACRES || null,
        acres_gis: round(p.acres_gis, 2),
        area_sqft: Math.round(p.area_sqft),
        zone_code: (zoning[0] && zoning[0].ZONEBREV) || land.ZONE_CODE || null,
        zone_name: zoning[0] ? zoning[0].ZONE_DESCRIPTION : null,
        zone_density: zoning[0] ? zoning[0].ZONING_DENSITY_DESCRIPTION : null,
        split_zoned: uniq(zoning.map(function (z) { return z.ZONEBREV; })).length > 1,
        dwellings: typeof land.NUM_DWELL === 'number' ? land.NUM_DWELL : dwellings.length,
        improvements: typeof land.TOT_IMPROV === 'number' ? land.TOT_IMPROV : bldgs.length,
        vacant: T.land && T.land.status === 'found' ? !(land.TOT_IMPROV > 0) : (T.buildings && T.buildings.status !== 'unknown' ? bldgs.length === 0 : null),
        oldest_year_built: years.length ? Math.min.apply(null, years) : null,
        bedrooms: dwellings.reduce(function (n, b) { return n + (b.BEDROOMS || 0); }, 0) || null,
        assessor_water: land.WATER || null,   // assessor's "public water available" flag
        assessor_sewer: land.SEWER || null
      },
      jurisdiction: {
        status: worst([st(L.city), st(L.reservation), st(L.zoning)]),
        county: 'Kitsap',
        city: cityCode ? (CITY_NAMES[cityCode] || cityCode) : null,
        uga: uga || null,
        reservation: res || null,
        tribal_zoning: zoning.some(function (z) { return z.ZONEBREV === 'T'; }) || designations.indexOf('Tribal') >= 0,
        military: zoning.some(function (z) { return z.ZONEBREV === 'MIL'; }),
        fire_district: attrsOf(L.fire_district).map(function (a) { return FIRE[a.DISTRICT] || 'Fire District ' + a.DISTRICT; })[0] || null,
        water_district: attrsOf(L.water_district).map(function (a) { return 'Water District ' + a.DISTRICT; })[0] || null,
        airport_overlay: attrsOf(L.airport).map(function (a) { return a.airportnam; })[0] || null,
        trust_status: st(L.tribal_lands),
        tribal_names: tribalNames,
        off_reservation_trust: trust.filter(function (a) { return a.LAND_TYPE === 'OOF'; }).map(function (a) { return a.TRIBAL_NM1; })[0] || null
      },
      sewer: {
        status: worst([st(L.sewer_area), st(L.sewer_main)]),
        in_county_service_area: attrsOf(L.sewer_area).map(function (a) { return SEWER[a.SYSTEM] || a.SYSTEM; })[0] || null,
        main_distance_ft: L.sewer_main && L.sewer_main.features[0] ? round(L.sewer_main.features[0].distance_ft, 0) : null,
        assessor_flag: land.SEWER || null
      },
      wetland: {
        status: wetStatus,
        on_parcel: wetStatus === 'on_parcel',
        min_distance_ft: wetAll[0] ? round(wetAll[0].distance_ft, 0) : null,
        bearing: wetAll[0] ? wetAll[0].bearing : null,
        count: wetAll.length,
        sources: [L.wetland && L.wetland.features.length ? 'county inventory' : null, L.nwi && L.nwi.features.length ? 'National Wetlands Inventory' : null].filter(Boolean),
        partial_check: wetAll.length === 0 ? false : (st(L.wetland) === 'unknown' || st(L.nwi) === 'unknown')
      },
      access: {
        status: st(L.state_route),
        state_route: routes[0] ? (routes[0].attrs.RT_TYPEA || 'SR') + ' ' + routes[0].attrs.StateRouteNumber : null,
        state_route_distance_ft: routes[0] ? round(routes[0].distance_ft, 0) : null
      },
      cultural: {
        status: st(L.arch_risk),
        risk: L.arch_risk && L.arch_risk.max ? L.arch_risk.max : null
      },
      stream: {
        status: worst([st(L.stream), st(L.waterbody)]),
        streams: streams,
        lakes: lakes,
        nearest: streams.concat(lakes).sort(function (a, b) { return a.distance_ft - b.distance_ft; })[0] || null,
        types: uniq(streams.concat(lakes).map(function (s) { return s.type; }))
      },
      shoreline: {
        status: worst([st(L.smp), st(L.marine_shore)]),
        in_jurisdiction: designations.length > 0,
        designations: designations,
        upland_designations: designations.filter(function (d) { return d !== 'Aquatic'; }),
        marine: marine.length > 0 && marine[0].distance_ft <= 250,
        marine_distance_ft: marine[0] ? round(marine[0].distance_ft, 0) : null,
        marine_bearing: marine[0] ? marine[0].bearing : null,
        waterfront: marine.length > 0 && marine[0].distance_ft <= 25,
        armoring: (L.armoring && L.armoring.features || []).map(function (f) { return { type: f.attrs.TYPE, material: f.attrs.MATERIAL, condition: f.attrs.CONDITION, distance_ft: round(f.distance_ft, 0) }; }),
        armoring_status: st(L.armoring),
        feeder_bluff: (L.feeder_bluff && L.feeder_bluff.features || []).map(function (f) { return f.attrs.SHORETYPE; }),
        forage_fish: ['smelt', 'sandlance', 'herring'].filter(function (k) { return L[k] && L[k].features.length; }),
        forage_fish_status: worst([st(L.smelt), st(L.sandlance), st(L.herring)]),
        eelgrass: !!(L.eelgrass && L.eelgrass.features.length),
        aquatic_status: st(L.aquatic_own),
        state_aquatic: stateAquatic
      },
      geohazard: {
        status: st(L.geohazard),
        classes: geoClasses,
        high: geoClasses.indexOf('High') >= 0,
        moderate: geoClasses.indexOf('Moderate') >= 0,
        near_classes: (geo.near_classes || []).map(function (c) { return c.replace(/ Hazard Area$/, ''); }),
        cell_ft: geo.cell_ft ? round(geo.cell_ft, 0) : null
      },
      flood: {
        status: st(L.flood),
        sfha_on_parcel: flood.some(function (f) { return f.on_parcel; }),
        zones: uniq(flood.filter(function (f) { return f.on_parcel; }).map(function (f) { return f.attrs.FLD_ZONE; })),
        coastal_high_hazard: flood.some(function (f) { return f.on_parcel && /^V/.test(f.attrs.FLD_ZONE); }),
        floodway: flood.some(function (f) { return f.on_parcel && /FLOODWAY/i.test(f.attrs.ZONE_SUBTY || ''); }),
        bfe_ft: flood.filter(function (f) { return f.on_parcel && f.attrs.STATIC_BFE > -9000; }).map(function (f) { return f.attrs.STATIC_BFE; })[0] || null,
        nearby: flood.length > 0 && !flood.some(function (f) { return f.on_parcel; })
      },
      cara: {
        status: worst([st(L.cara1), st(L.cara2)]),
        category_1: st(L.cara1) === 'on_parcel',
        category_2: st(L.cara2) === 'on_parcel',
        names: uniq(attrsOf(L.cara1).map(function (a) { return a.SIGNIFICANT_RECHARGE_AREAS; }).filter(function (n) { return n && n !== '0'; }))
      },
      permits: summarisePermits(T.permits)
    };
    return facts;
  }

  var OPEN = { ACTIVE: 1, OPEN: 1, PENDING: 1, ISSUED: 1, 'RE-ISSUED': 1, APPROVED: 1, INACTIVE: 1, 'BOND MAINTENANCE': 1 };
  function summarisePermits(t) {
    if (!t || t.status === 'unknown') return { status: 'unknown', error: t && t.error, items: [] };
    var now = Date.now();
    var items = t.rows.map(function (r) {
      var expired = r.STATUS === 'EXPIRED' || (r.EXPIRATION_DATE && r.EXPIRATION_DATE < now && OPEN[r.STATUS] && r.STATUS !== 'APPROVED');
      return {
        number: r.PERMIT_NO, type: r.TYPE_CODE, status: r.STATUS,
        submitted: iso(r.SUBMITTED_DATE), issued: iso(r.ISSUED_DATE), status_date: iso(r.STATUS_DATE), expires: iso(r.EXPIRATION_DATE),
        lapsed: !!expired,
        open: !!OPEN[r.STATUS] && !expired,
        family: permitFamily(r.TYPE_CODE)
      };
    });
    return {
      status: t.status, truncated: !!t.truncated, items: items,
      lapsed: items.filter(function (i) { return i.lapsed; }),
      open: items.filter(function (i) { return i.open; }),
      cancelled: items.filter(function (i) { return /CANCELLED|WITHDRAWN|DENIED|RETURNED|REVOKED/.test(i.status); })
    };
  }

  /** Coarse grouping of county permit type codes, for "has this been done before" hints. */
  function permitFamily(code) {
    var c = String(code || '').toUpperCase();
    if (/^SDAP|GRAD/.test(c)) return 'site_development';
    if (/SHORELINE|SSDP|SCUP|SVAR|^S-|BULKHEAD|DOCK|PIER/.test(c)) return 'shoreline';
    if (/CAO|CRITICAL|CABR|CAV|WETLAND|BUFFER/.test(c)) return 'critical_area';
    if (/SEPA/.test(c)) return 'sepa';
    if (/TIMBER|FPA|COHP|FOREST/.test(c)) return 'forest';
    if (/DEMO/.test(c)) return 'demolition';
    if (/^(P |F )?(SP|LL|PLAT|SUB)|SHORT|BLA|BSP/.test(c)) return 'land_division';
    if (/CUP|VAR|ZVAR|ACUP/.test(c)) return 'land_use';
    if (/^R-|^ATS-R|^MH/.test(c)) return 'residential_building';
    if (/^C-|^ATS-C/.test(c)) return 'commercial_building';
    if (/ADDRESS/.test(c)) return 'addressing';
    if (/ROAD|ROW|APPROACH/.test(c)) return 'road';
    return 'other';
  }

  function iso(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : null; }
  function round(n, d) { var k = Math.pow(10, d || 0); return Math.round(n * k) / k; }
  function uniq(a) { var s = {}; return a.filter(function (v) { return v == null || s[v] ? false : (s[v] = true); }); }
  function title(s) { return String(s || '').toLowerCase().replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
  function worst(list) { return list.indexOf('unknown') >= 0 ? 'unknown' : list.indexOf('on_parcel') >= 0 ? 'on_parcel' : list.indexOf('nearby') >= 0 ? 'nearby' : 'none'; }

  return {
    id: 'wa-kitsap',
    name: 'Kitsap County, Washington',
    state: 'WA',
    county: 'Kitsap',
    center: [47.64, -122.65],
    zoom: 10,
    rule_sets: ['federal', 'wa-state', 'wa-kitsap'],
    layers: layers,
    tables: tables,
    search: search,
    parcelById: parcelById,
    parcelAtPoint: parcelAtPoint,
    deriveFacts: deriveFacts,
    permitFamily: permitFamily,
    streamType: streamType,
    examples: [
      { parcel_key: '2403947', label: 'Vacant 6 acres, pond and wetland', type: 'new_sfr' },
      { parcel_key: '1248699', label: 'Hood Canal waterfront, dock', type: 'shoreline_structure' },
      { parcel_key: '1414234', label: 'Hansville beach lot, flood zone', type: 'rebuild' },
      { parcel_key: '1224310', label: 'Rural lot, detached ADU', type: 'adu' },
      { parcel_key: '1375559', label: 'Inside Port Madison Reservation', type: 'new_sfr' },
      { parcel_key: '1139955', label: 'Inside Bremerton city limits', type: 'addition' }
    ]
  };
});
