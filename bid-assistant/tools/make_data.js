#!/usr/bin/env node
/*
 * Turns the research files in data/research/ into the two files the tool reads:
 *   data/citations.json  (code citation library, unchanged apart from dropping scratch paths)
 *   data/fees.json       (the fee and cost lines the rules reference)
 * The mapping below is the reviewable link between a line in a bid and its published source.
 * Run: node bid-assistant/tools/make_data.js && node bid-assistant/build.js
 */
const fs = require('node:fs');
const path = require('node:path');
const D = path.join(__dirname, '..', 'data');
const R = JSON.parse(fs.readFileSync(path.join(D, 'research', 'fees_research.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(D, 'research', 'citations_research.json'), 'utf8'));

// ---- citations
const citations = C.map((c) => {
  const o = { ...c };
  delete o.raw_file; delete o.excerpt_words;
  return o;
});
fs.writeFileSync(path.join(D, 'citations.json'), JSON.stringify(citations, null, 1) + '\n');

// ---- fees
const pub = {};
for (const f of [...R.agency_fees, ...R.impact_and_connection_fees]) pub[f.id] = f;
const pro = {};
for (const f of R.consultant_costs) pro[f.id] = f;

function src(f) { return { title: f.source_title, url: f.source_url, date: f.effective_date || null, excerpt: f.excerpt || null }; }
function need(id) { const f = pub[id]; if (!f || !f.verified) throw new Error('Research item missing or unverified: ' + id); return f; }

/** A published line: amounts default to the research amounts; several research lines can be summed. */
function published(id, label, payee, ids, opt = {}) {
  const parts = ids.map(need);
  const low = opt.low != null ? opt.low : parts.reduce((n, f) => n + f.amount_low, 0);
  const high = opt.high != null ? opt.high : parts.reduce((n, f) => n + (f.amount_high == null ? f.amount_low : f.amount_high), 0);
  return { id, label, kind: opt.kind || 'agency_fee', basis: 'published', payee, low, high, unit: opt.unit || 'flat', note: opt.note || null,
    source: src(parts[0]), components: parts.map((f) => ({ item: f.item, low: f.amount_low, high: f.amount_high, source_url: f.source_url, effective: f.effective_date })), method: opt.method || undefined, confidence: 'high' };
}
/** A consultant line. Unsourced items are kept, visibly marked, because a bid needs a placeholder. */
function market(id, label, payee, rid) {
  const f = pro[rid];
  if (!f) throw new Error('Consultant item missing: ' + rid);
  const sourced = f.amount_low != null;
  const est = f.unsourced_analyst_estimate || {};
  const s = (f.sources || [])[0];
  return { id, label, kind: 'professional', basis: 'market', payee, low: sourced ? f.amount_low : est.low, high: sourced ? f.amount_high : est.high, unit: 'per project',
    confidence: sourced ? f.confidence : 'unsourced',
    note: sourced ? null : 'Placeholder estimate with no published source. Get a quote.',
    source: sourced && s ? { title: s.title, url: s.url, date: s.date || null, excerpt: s.quote || null } : null,
    sources: (f.sources || []).map((x) => ({ title: x.title, url: x.url, date: x.date || null, quote: x.quote || null })) };
}

const DCD = 'Kitsap County DCD', KPHD = 'Kitsap Public Health District';
const bvdRes = need('kitsap-dcd-bvd-new-residential').amount_low, bvdGar = need('kitsap-dcd-bvd-garage').amount_low;
const baseFee = need('kitsap-dcd-base-application-fee').amount_low, sbcc = need('kitsap-dcd-sbcc-surcharge').amount_low;
const roads = need('kitsap-impact-roads-sfr'), roadsAdu = need('kitsap-impact-roads-adu'), parks = need('kitsap-impact-parks'), schools = need('kitsap-impact-schools');
const elec = need('li-electrical-sfr-new');

const fees = [
  published('dcd-building-permit', 'Building permit and plan review', DCD, ['kitsap-dcd-building-permit-fee-multiplier', 'kitsap-dcd-bvd-new-residential', 'kitsap-dcd-bvd-garage', 'kitsap-dcd-base-application-fee', 'kitsap-dcd-sbcc-surcharge', 'kitsap-dcd-technology-surcharge'],
    { low: 0, high: 0, unit: 'formula', note: 'Computed from the published formula; the county does not print worked totals.',
      method: { multiplier: 0.0224, technology_surcharge: 0.03, flat: baseFee + sbcc, rates: { residential: bvdRes, garage: bvdGar },
        describe: 'floor area x valuation rate x 0.0224, plus 3% technology surcharge, $' + baseFee + ' base fee and $' + sbcc + ' state surcharge' } }),
  published('kitsap-impact-fees', 'Road, park and school impact fees', 'Kitsap County', ['kitsap-impact-roads-sfr', 'kitsap-impact-roads-adu', 'kitsap-impact-parks', 'kitsap-impact-schools'],
    { kind: 'impact_fee', low: 0, high: 0, unit: 'formula',
      method: { roads_sfr: roads.amount_low, roads_adu: roadsAdu.amount_low, parks_per_sqft: 0.45, parks_min: parks.amount_low, parks_max: parks.amount_high, schools_per_sqft: 0.86, schools_min: schools.amount_low, schools_max: schools.amount_high } }),
  published('dcd-sdap-sfr', 'Site Development Activity Permit, single-family', DCD, ['kitsap-dcd-sdap-sfr'], { high: 3278, note: 'Flat fee plus base fee and surcharge at submittal. Inspections are billed hourly on top.' }),
  published('dcd-sdap-minor', 'Site Development Activity Permit, minor grading', DCD, ['kitsap-dcd-sdap-minor-grading'], { note: 'Inspections are billed hourly on top.' }),
  published('dcd-sdap-grading-1', 'Site Development Activity Permit, grading 150 to 500 cu yd', DCD, ['kitsap-dcd-sdap-grading-1'], { note: 'Inspections are billed hourly on top.' }),
  published('dcd-sdap-grading-2', 'Site Development Activity Permit, grading 500 to 5,000 cu yd', DCD, ['kitsap-dcd-sdap-grading-2'], { note: 'Inspections are billed hourly on top.' }),
  published('dcd-sdap-grading-3', 'Site Development Activity Permit, grading over 5,000 cu yd', DCD, ['kitsap-dcd-sdap-grading-3'], { note: 'Inspections are billed hourly on top.' }),
  published('dcd-sdap-short-plat', 'Site Development Activity Permit, short plat', DCD, ['kitsap-dcd-sdap-short-plat'], { note: 'Inspections are billed hourly on top.' }),
  published('dcd-simplified-drainage', 'Simplified drainage review, engineered', DCD, ['kitsap-dcd-simplified-drainage-review']),
  published('dcd-buffer-reduction', 'Critical area or shoreline buffer reduction', DCD, ['kitsap-dcd-buffer-reduction'], { note: 'Covers two review cycles; further review is hourly.' }),
  published('dcd-critical-area-variance', 'Critical area variance or reasonable use exception', DCD, ['kitsap-dcd-critical-area-variance'], { note: 'Includes the hearing examiner fee.' }),
  published('dcd-site-evaluation', 'Site evaluation', DCD, ['kitsap-dcd-site-evaluation']),
  published('dcd-staff-consultation', 'Staff consultation', DCD, ['kitsap-dcd-staff-consultation'], { note: 'Credited to an application filed within 12 months.' }),
  published('dcd-sepa', 'SEPA checklist review', DCD, ['kitsap-dcd-sepa']),
  published('dcd-shoreline-exemption', 'Shoreline exemption', DCD, ['kitsap-dcd-shoreline-exemption']),
  published('dcd-shoreline-sdp', 'Shoreline substantial development permit', DCD, ['kitsap-dcd-ssdp']),
  published('dcd-shoreline-acup', 'Shoreline administrative conditional use permit', DCD, ['kitsap-dcd-shoreline-acup']),
  published('dcd-cup-adu', 'Conditional use permit for an ADU', DCD, ['kitsap-dcd-acup-adu', 'kitsap-dcd-cup-adu'],
    { low: need('kitsap-dcd-acup-adu').amount_low, high: need('kitsap-dcd-cup-adu').amount_high, note: 'Low end is the administrative permit; high end is the hearing examiner permit with its hearing fee.' }),
  published('dcd-short-plat-prelim', 'Preliminary short plat', DCD, ['kitsap-dcd-short-plat-prelim']),
  published('dcd-short-plat-final', 'Final short plat', DCD, ['kitsap-dcd-short-plat-final']),
  published('dcd-demolition', 'Demolition permit', DCD, ['kitsap-dcd-demolition']),
  published('dcd-timber-harvest', 'County timber harvest permit', DCD, ['kitsap-dcd-timber-harvest']),
  published('dcd-well-water', 'Building permit supplied by a well', DCD, ['kitsap-dcd-well-water-fee']),
  published('pw-road-approach', 'Road approach permit', DCD, ['kitsap-dcd-road-approach'], { low: 0, note: 'Waived when filed with a building permit.' }),
  published('kphd-bsa', 'Building Site Application, single-family', KPHD, ['kphd-bsa-sfr-public-water', 'kphd-bsa-sfr-private-water'],
    { low: need('kphd-bsa-sfr-public-water').amount_low, high: need('kphd-bsa-sfr-private-water').amount_low, note: 'Low end on public water, high end on a private well. A 2027 increase was in draft when checked.' }),
  published('kphd-sewage-permit', 'Septic installation permit', KPHD, ['kphd-sewage-permit']),
  published('kphd-building-clearance', 'Building Clearance, residential on septic', KPHD, ['kphd-building-clearance-residential']),
  published('kphd-building-clearance-sewered', 'Building Clearance, sewered lot', KPHD, ['kphd-building-clearance-sewered']),
  published('sewer-connection', 'County sewer connection: newcomer assessment, permit and side service', 'Kitsap County Public Works Sewer Utility', ['kitsap-sewer-newcomer', 'kitsap-sewer-permit', 'kitsap-sewer-side-service'], { kind: 'utility', note: 'County-operated systems only. City and district utilities set their own charges.' }),
  published('water-connection', 'New water service connection (Kitsap PUD and Silverdale Water as examples)', 'Water purveyor', ['kpud-cfc-5-8', 'kpud-sic-5-8', 'swd-cfc-5-8', 'swd-sic-5-8'],
    { kind: 'utility', low: need('swd-cfc-5-8').amount_low + need('swd-sic-5-8').amount_low, high: need('swd-cfc-5-8').amount_low + need('swd-sic-5-8').amount_high,
      note: 'Range spans Kitsap PUD ($' + (need('kpud-cfc-5-8').amount_low + need('kpud-sic-5-8').amount_low).toLocaleString('en-US') + ') and Silverdale Water for a 5/8 inch meter. Other purveyors differ; the purveyor for this lot is not mapped.' }),
  published('lni-electrical', 'Electrical permit, new residence', 'WA Labor and Industries', ['li-electrical-sfr-new'], { low: 0, high: 0, unit: 'formula', method: { first_1300: elec.amount_low, per_additional_500: 38.2 } }),
  published('ecology-cswgp', 'Construction Stormwater General Permit, 1 to 5 acres', 'WA Department of Ecology', ['ecology-cswgp-1-5ac'], { note: 'Annual fee while the permit is open.' }),
  published('dnr-fpa-conversion', 'Forest practices application, conversion', 'WA Department of Natural Resources', ['dnr-fpa-conversion']),
  published('dnr-aquatic', 'Aquatic use authorization application', 'WA Department of Natural Resources', ['dnr-aquatic-application'], { note: 'Application fee only. Rent or other charges may apply.' }),
  published('pscaa-notification', 'Asbestos and demolition notification, single-family', 'Puget Sound Clean Air Agency', ['pscaa-asbestos-sfr'], { note: 'Confirm the amount at filing; the posted fee table is old.' }),
  published('wsdot-access', 'State highway access connection permit', 'WSDOT', ['wsdot-access-connection']),
  published('usace-permit', 'Department of the Army permit fee', 'U.S. Army Corps of Engineers', ['usace-permit-fee'], { low: 0, note: 'No fee for nationwide and other general permits; $10 for an individual non-commercial permit.' }),
  published('wdfw-hpa', 'Hydraulic Project Approval application', 'WA Department of Fish and Wildlife', ['wdfw-hpa'], { note: 'No application fee; the fee statute expired in 2017.' }),

  market('pro-geotech-report', 'Geotechnical report', 'Geotechnical engineer', 'geotech-report-steep-slope'),
  market('pro-geo-assessment', 'Geological assessment letter or report', 'Geologist or geotechnical engineer', 'geological-assessment-letter'),
  market('pro-wetland-delineation', 'Wetland delineation and rating report', 'Wetland specialist', 'wetland-delineation-rating'),
  market('pro-wetland-mitigation-plan', 'Wetland buffer mitigation plan', 'Wetland specialist', 'wetland-buffer-mitigation-plan'),
  market('pro-stream-typing', 'Stream or wetland reconnaissance', 'Biologist', 'wetland-reconnaissance'),
  market('pro-hmp', 'Habitat management plan', 'Fish or wildlife biologist', 'habitat-management-plan'),
  market('pro-shoreline-nnl', 'Shoreline no-net-loss or mitigation report', 'Shoreline consultant', 'shoreline-nnl-mitigation-report'),
  market('pro-bio-eval', 'Biological evaluation for a Corps permit', 'Biologist', 'biological-evaluation-corps'),
  market('pro-jarpa', 'Joint aquatic permit application preparation', 'Shoreline consultant', 'jarpa-prep-permit-expediting'),
  market('pro-survey', 'Boundary and topographic survey', 'Land surveyor', 'boundary-topo-survey-combined'),
  market('pro-elevation-cert', 'FEMA elevation certificate', 'Land surveyor', 'elevation-certificate'),
  market('pro-flood-habitat', 'Floodplain habitat assessment', 'Biologist', 'floodplain-habitat-assessment'),
  market('pro-septic-design', 'Septic design and soil logs', 'Septic designer', 'septic-design'),
  market('pro-civil-sdap', 'Civil engineering for site development and drainage', 'Civil engineer', 'civil-engineering-sdap'),
  market('pro-arch-survey', 'Archaeological survey', 'Archaeologist', 'archaeological-survey'),
  market('pro-asbestos-survey', 'Asbestos survey before demolition', 'AHERA building inspector', 'asbestos-survey-pre-demo'),
  market('pro-hydrogeo', 'Hydrogeological report', 'Hydrogeologist', 'hydrogeological-report-cara'),
  market('pro-sepa', 'SEPA checklist preparation', 'Consultant', 'sepa-checklist-prep')
];
fs.writeFileSync(path.join(D, 'fees.json'), JSON.stringify(fees, null, 1) + '\n');
console.log('Wrote ' + citations.length + ' citations and ' + fees.length + ' fee lines.');
