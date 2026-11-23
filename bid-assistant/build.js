#!/usr/bin/env node
/*
 * Bundles the research data (JSON, the reviewable source of truth) into data/data.js so the
 * page works from a plain file or any static host, and validates it on the way.
 *
 *   node bid-assistant/build.js           write data/data.js
 *   node bid-assistant/build.js --check   fail if data/data.js is out of date
 */
const fs = require('node:fs');
const path = require('node:path');
const D = path.join(__dirname, 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

function validateMethod(f) {
  const m = f.method;
  if (!m) return;
  const number = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const requireNumbers = (obj, keys) => { for (const key of keys) if (!number(obj[key])) throw new Error('Invalid fee method '+f.id+': '+key); };
  if (m.type === 'valuation') {
    requireNumbers(m, ['plan_ratio','technology_ratio','flat']);
    if (!Array.isArray(m.brackets) || !m.brackets.length) throw new Error('Missing valuation brackets '+f.id);
    let previous = 0;
    m.brackets.forEach((b,i) => {
      requireNumbers(b, ['over','base','step','rate']);
      if (!b.step || b.over > previous || (b.up_to === null ? i !== m.brackets.length-1 : !number(b.up_to) || b.up_to <= previous)) throw new Error('Invalid valuation bands '+f.id);
      previous = b.up_to;
    });
    for (const k of ['permit_factor','new_dwelling_factor','automation_min','automation_ratio','plan_min']) if (m[k] != null) requireNumbers(m,[k]);
  } else if (m.type === 'area') { requireNumbers(m,['base','per_sqft']); if(m.cap!=null) requireNumbers(m,['cap']); }
  else if(m.type === 'area_table') {
    requireNumbers(m,['technology_ratio']);
    if(!Array.isArray(m.rows)||m.rows.length<2)throw new Error('Missing area examples '+f.id);
    let last=0;
    for(const row of m.rows){requireNumbers(row,['sqft','fee']);if(row.sqft<=last)throw new Error('Invalid area examples '+f.id);last=row.sqft;}
  }
  else if (m.type === 'hourly_allowance') {
    requireNumbers(m,['rate','hours_low','hours_high']);
    if (m.hours_high < m.hours_low) throw new Error('Invalid hourly range '+f.id);
  } else if (m.type === 'skagit_disturbance') {
    requireNumbers(m,['technology_ratio']);
    if (!m.levels.length) throw new Error('Missing disturbance levels '+f.id);
    for (const b of m.levels) requireNumbers(b,b.fee == null ? ['surface','volume','drainage','grading','both'] : ['surface','volume','fee']);
  } else throw new Error('Unknown fee method '+f.id);
}

function load(region) {
  const inRegion = record => !record.region || (Array.isArray(record.region) ? record.region.includes(region) : record.region === region);
  const meta = read('meta.json');
  const citations = {}, fees = {}, agencies = {};
  const seen = {citations:new Set(),fees:new Set(),agencies:new Set()};
  for (const c of read('citations.json')) {
    if (seen.citations.has(c.id)) throw new Error('Duplicate citation id ' + c.id);
    seen.citations.add(c.id);
    for (const k of ['id', 'jurisdiction', 'citation', 'url', 'fetched']) if (!c[k]) throw new Error('Citation ' + c.id + ' is missing ' + k);
    if (!/^https:\/\//.test(c.url)) throw new Error('Citation ' + c.id + ' needs an https URL');
    if (c.verified && !c.excerpt) throw new Error('Citation ' + c.id + ' is marked verified but has no excerpt');
    if (inRegion(c)) citations[c.id] = c;
  }
  for (const f of read('fees.json')) {
    if (seen.fees.has(f.id)) throw new Error('Duplicate fee id ' + f.id);
    seen.fees.add(f.id);
    for (const k of ['id', 'label', 'kind', 'basis', 'payee']) if (!f[k]) throw new Error('Fee ' + f.id + ' is missing ' + k);
    if (!(typeof f.low === 'number' && typeof f.high === 'number' && f.low >= 0 && f.high >= f.low)) throw new Error('Fee ' + f.id + ' has a bad range');
    if (!['agency_fee', 'professional', 'impact_fee', 'utility'].includes(f.kind)) throw new Error('Fee ' + f.id + ' has unknown kind ' + f.kind);
    if (!['published', 'market'].includes(f.basis)) throw new Error('Fee ' + f.id + ' has unknown basis ' + f.basis);
    if (f.basis === 'published' && !(f.source && /^https:\/\//.test(f.source.url || ''))) throw new Error('Published fee ' + f.id + ' needs a source URL');
    if (f.region) validateMethod(f);
    if (inRegion(f)) fees[f.id] = f;
  }
  for (const a of read('agencies.json')) {
    if (seen.agencies.has(a.id)) throw new Error('Duplicate agency id ' + a.id);
    seen.agencies.add(a.id);
    if (!['local', 'tribal', 'state', 'federal', 'utility', 'professional'].includes(a.tier)) throw new Error('Agency ' + a.id + ' has unknown tier');
    if (inRegion(a)) agencies[a.id] = a;
  }
  const routing = read('agency-routing.json');
  for (const contact of routing.tribal_contacts) {
    if (!agencies[contact.agency] || !citations[contact.citation]) throw new Error('Unresolved tribal contact source: ' + contact.agency);
  }
  const result = { meta, citations, fees, agencies, routing };
  meta.shared_revision = require('node:crypto').createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0,16);
  return result;
}

function render(data) {
  return '/* Generated by build.js from data/*.json. Do not edit by hand. */\n' +
    '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.BID_DATA = factory();\n})(typeof self !== \'undefined\' ? self : this, function () {\n  return ' +
    JSON.stringify(data, null, 1) + ';\n});\n';
}

function regionOutputs() {
  const crypto = require('node:crypto');
  const outputs = {}, manifest = { schema_version: 1, regions: {} };
  for (const file of fs.readdirSync(path.join(D, 'regions')).filter(x => x.endsWith('.json')).sort()) {
    const region = read('regions/' + file), full = load(region.id), base = load();
    if (region.schema_version !== 1 || !region.id || !region.checked || !region.valid_through) throw new Error('Invalid county profile');
    const pack = { schema_version: 1, shared_revision: base.meta.shared_revision, region };
    for (const key of ['citations','fees','agencies']) pack[key] = Object.fromEntries(Object.entries(full[key]).filter(([id]) => !base[key][id]));
    for (const p of Object.values(region.profiles)) {
      if (!full.agencies[p.agency]) throw new Error('Missing profile agency '+p.id);
      for (const id of p.citations) if (!full.citations[id]) throw new Error('Missing citation '+id);
      for (const row of p.fees) {
        if (!full.fees[row.fee]) throw new Error('Missing fee '+row.fee);
        if (!['structure','home','new_home','sewer_home','adu','addition','other_structure','new_structure','development','critical','wetland','geohazard','flood','shoreline'].includes(row.trigger.replace(/^conditional_/,''))) throw new Error('Unknown fee trigger '+row.trigger);
      }
    }
    if (!full.fees[region.fallback_fee] || !full.agencies[region.health_agency]) throw new Error('Missing county fallback or health agency '+region.id);
    if (region.routing) {
      for (const contact of region.routing.tribal_contacts) if (!full.agencies[contact.agency] || !full.citations[contact.citation]) throw new Error('Unresolved regional tribal contact '+contact.agency);
      for (const match of region.routing.tribal_name_matches) { if (!full.agencies[match.agency]) throw new Error('Unresolved tribal match '+match.agency); new RegExp(match.pattern,'i'); }
      pack.routing = region.routing;
    }
    const revision = crypto.createHash('sha256').update(JSON.stringify(pack)).digest('hex').slice(0,16);
    pack.revision = revision;
    const name = region.id + '.' + revision + '.json';
    outputs['bundles/' + name] = JSON.stringify(pack);
    manifest.regions[region.id] = { revision, url: 'data/bundles/' + name, checked: region.checked };
  }
  outputs['regions.js'] = '/* Generated county manifest. */\n(function(root){if(typeof module==="object"&&module.exports)module.exports='+JSON.stringify(manifest)+';else root.BID_REGIONS='+JSON.stringify(manifest)+';})(typeof self!=="undefined"?self:this);\n';
  return outputs;
}

if (require.main === module) {
  for (const [name, text] of Object.entries(regionOutputs())) {
    const file = path.join(D,name);
    if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file,'utf8') !== text) throw new Error('Stale county bundle: '+name); }
    else { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file,text); }
  }
  const out = path.join(D, 'data.js');
  const text = render(load());
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== text) { console.error('data/data.js is out of date. Run: node bid-assistant/build.js'); process.exit(1); }
    console.log('data/data.js is up to date.');
  } else {
    fs.writeFileSync(out, text);
    const d = load();
    console.log('Wrote data/data.js: ' + Object.keys(d.citations).length + ' citations, ' + Object.keys(d.fees).length + ' fee lines, ' + Object.keys(d.agencies).length + ' agencies.');
  }
}
module.exports = { load, render, regionOutputs, validateMethod };
