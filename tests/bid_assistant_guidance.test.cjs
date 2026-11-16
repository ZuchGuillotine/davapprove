const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('../web/node_modules/jsdom');
const Guidance = require('../bid-assistant/lib/guidance');
const Engine = require('../bid-assistant/lib/engine');
const data = require('../bid-assistant/build').load();
const county = {packId:'wa-kitsap',facts:{jurisdiction:{status:'none',trust_status:'none',county:'Kitsap'}}};
const base = {hard_surface_sqft:0,disturbance_sqft:0,grading_cy:0,land_status:'unknown'};
const rows = (p,c=county,d=data)=>Guidance.notices({...base,...p},d,c);
for (const [field,threshold] of [['hard_surface_sqft',2000],['disturbance_sqft',7000],['grading_cy',150],['disturbance_sqft',43560]]) {
 const check=n=>rows({[field]:n}).rows.find(r=>r.field===field&&r.threshold===threshold);
 assert.equal(check(threshold-1).reached,false); assert.equal(check(threshold).reached,true); assert.equal(check(threshold+1).reached,true);
 for(const value of ['',-1,'bad',Infinity]) assert.equal(check(value).value,null,'missing/invalid values do not mean zero');
}
assert.match(rows({disturbance_sqft:7000}).rows[1].effect,/alone is not a separate SDAP/);
assert.match(rows({grading_cy:150}).rows.at(-1).status,/Threshold reached/);
assert.match(rows({grading_cy:150},{packId:'wa-kitsap'}).rows.at(-1).status,/jurisdiction unconfirmed/);
assert.equal(rows({grading_cy:150},{...county,facts:{jurisdiction:{status:'unknown'}}}).scope,'unknown');
assert.equal(rows({grading_cy:150},{...county,facts:{jurisdiction:{trust_status:'none'}}}).scope,'unknown');
assert.equal(rows({grading_cy:150},{...county,facts:{jurisdiction:{status:'none',trust_status:'unknown'}}}).scope,'unknown');
for(const facts of [{city:'Bremerton'},{reservation:{name:'Example'}},{military:true},{tribal_zoning:true},{off_reservation_trust:'Example'},{tribal_names:['Example']}]) {
 assert.equal(rows({grading_cy:200},{...county,facts:{jurisdiction:{...county.facts.jurisdiction,...facts}}}).rows.length,0);
}
for(const land_status of ['tribal','exclusive_federal']) assert.equal(rows({land_status}).scope,'other');
for(const packId of ['wa-king','wa-skagit']) assert.equal(rows({grading_cy:200},{...county,packId}).rows.length,0);
assert.equal(rows({},county,{citations:{}}).rows.length,0);
assert.match(rows({},county,{citations:{}}).message,/unavailable/);
const custom=JSON.parse(JSON.stringify(data));custom.citations['kitsap-guidance-sdap'].key_values.grading_cy=175;
assert.equal(rows({grading_cy:150},county,custom).rows.at(-1).reached,false,'threshold values come from cited data');

const dom=new JSDOM(fs.readFileSync(require.resolve('../bid-assistant/index.html'),'utf8'));
const doc=dom.window.document;
// Match the dynamically generated agency controls without booting GIS services.
Object.keys(Engine.SCOPE_FIELDS).forEach(key=>{
 const label=doc.createElement('label');label.textContent=Engine.SCOPE_FIELDS[key].label;
 const select=doc.createElement('select');select.id='a-'+key;label.appendChild(select);doc.getElementById('agency-scope-fields').appendChild(label);
});
Guidance.mount(doc);Guidance.mount(doc);
assert.equal(doc.querySelectorAll('.assumption-help-toggle').length,Object.keys(Guidance.HELP).length,'every assumption has one help toggle');
for(const key of Object.keys(Guidance.HELP)) {
 const input=doc.getElementById('a-'+key), help=doc.getElementById('help-'+key), btn=help.previousElementSibling;
 assert.equal(btn.type,'button');assert.equal(btn.getAttribute('aria-expanded'),'false');assert(help.hidden);
 assert.equal(btn.getAttribute('aria-controls'),help.id);assert(input.getAttribute('aria-describedby').includes(help.id));
 btn.click();assert.equal(btn.getAttribute('aria-expanded'),'true');assert(!help.hidden);
 btn.click();assert(help.hidden);
}
Guidance.update(doc,{...base,grading_cy:150},data,county);
assert.equal(doc.querySelectorAll('#triggers-grading_cy .reached').length,1);
assert.match(doc.getElementById('assumption-trigger-summary').textContent,/thresholds reached/);
assert.equal(doc.querySelector('#triggers-grading_cy a').href,'https://ecode360.com/49506095');
assert(doc.getElementById('a-grading_cy').getAttribute('aria-describedby').includes('triggers-grading_cy'));
Guidance.update(doc,{...base,grading_cy:149},data,county);assert.equal(doc.querySelectorAll('#triggers-grading_cy .reached').length,0);
Guidance.update(doc,base,data,{packId:'wa-king'});assert.equal(doc.querySelectorAll('.assumption-trigger').length,0);
assert.match(doc.getElementById('assumption-threshold-note').textContent,/not applied/);
dom.window.close();
console.log('Assumption guidance: sourced boundaries, jurisdiction isolation, unknown inputs, accessible expansion and updates pass.');
