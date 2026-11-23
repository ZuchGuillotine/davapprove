const assert=require('node:assert/strict');
const build=require('../bid-assistant/build.js');
const Registry=require('../bid-assistant/lib/regions.js');
const Factory=require('../bid-assistant/packs/wa-regional.js');
const Engine=require('../bid-assistant/lib/engine.js');
const Screen=require('../bid-assistant/lib/screen.js');
const Regional=require('../bid-assistant/rules/wa-regional.js');
const State=require('../bid-assistant/rules/wa-state.js');
const Federal=require('../bid-assistant/rules/federal.js');
const outputs=build.regionOutputs();
function data(id){const p=JSON.parse(Object.values(outputs).find(s=>s.startsWith('{')&&JSON.parse(s).region.id===id));const base=build.load();return {...base,region:p.region,meta:{...base.meta,reference_revision:p.revision},routing:p.routing,citations:{...base.citations,...p.citations},fees:{...base.fees,...p.fees},agencies:{...base.agencies,...p.agencies}};}
function sample(d,city,opts={}){
 const pack=Factory.create(d.region),parcel=Screen.buildParcel([{geometry:{rings:[[[-122.4,48.4],[-122.399,48.4],[-122.399,48.401],[-122.4,48.401],[-122.4,48.4]]]}}],{parcel_key:'TEST',situs:'Synthetic site'});
 const layers=Object.fromEntries(pack.layers.map(l=>[l.id,{id:l.id,layer:l,status:'none',features:[],classes:{},near_classes:[]}]));
 layers.city.features=city?[{attrs:{NAME:city,UNINC:0}}]:d.region.id==='wa-king'?[{attrs:{NAME:'King County',UNINC:1}}]:[];
 layers.city.status=layers.city.features.length?'on_parcel':'none';Object.assign(layers.city,opts.city||{});
 if(opts.tribe)layers.tribal_lands={status:'on_parcel',features:[{attrs:{TRIBAL_NM1:opts.tribe,LAND_TYPE:'RES'}}]};
 const screening={pack_id:pack.id,parcel,layers,tables:{},screened_at:'2026-11-15T12:00:00Z'},facts=pack.deriveFacts(screening);
 return {pack,screening,facts};
}
function report(d,city,p={},opts={}){const s=sample(d,city,opts);return Engine.evaluate({facts:s.facts,project:{type:'new_sfr',construction_value:550000,...p},rules:[...Federal.rules,...State.rules,...Regional.rules],data:d});}
(async()=>{
 const base=build.load(), manifest={regions:{}};
 for(const [path,s] of Object.entries(outputs))if(path.endsWith('.json')){const p=JSON.parse(s);manifest.regions[p.region.id]={url:path,revision:p.revision};}
 let calls=0;const loader=Registry.create(base,manifest,async url=>{calls++;return{ok:true,json:async()=>JSON.parse(outputs[url])};});
 const [a,b]=await Promise.all([loader.load('wa-king'),loader.load('wa-king')]);assert.equal(a,b);assert.equal(calls,1);assert(!base.region);assert(!a.fees['wa-skagit-county-building']);
 const sk=await loader.load('wa-skagit');assert(!sk.fees['wa-king-county-building']);assert.equal(calls,2);assert.equal(await loader.load('wa-kitsap'),base);
 await assert.rejects(loader.load('../../secrets'),/Unsupported/);
 let attempts=0;const retry=Registry.create(base,manifest,async url=>{if(++attempts===1)throw Error('offline');return {ok:true,json:async()=>JSON.parse(outputs[url])};});await assert.rejects(retry.load('wa-king'));await retry.load('wa-king');assert.equal(attempts,2);
 const mismatch=Registry.create(base,manifest,async()=>({ok:true,json:async()=>({schema_version:1,region:{id:'wa-skagit'},revision:'wrong'})}));await assert.rejects(mismatch.load('wa-king'),/mismatch/);
 for(const id of ['wa-king','wa-skagit','wa-pierce']){
  const d=data(id);
  for(const city of [null,...Object.keys(d.region.profiles).filter(n=>n!=='County'),'Unpriced City']){
   for(const type of Object.keys(Engine.PROJECT_TYPES)){
    const r=report(d,city,{type,demo:true,tree_clearing:true});
    assert(!JSON.stringify(r).includes('Rule could not be evaluated'),id+' '+city+' '+type);
    for(const f of r.findings){for(const c of f.citations)assert(d.citations[c],c);assert(d.agencies[f.agency],f.agency);assert(!['kitsap-dcd','kphd'].includes(f.agency),f.title);}
   }
  }
  for(const city of [null,...Object.keys(d.region.profiles).filter(n=>n!=='County')]){
   const r=report(d,city);assert(r.findings.some(f=>f.title.includes('building, land-use')));
  }
  const unknown=report(d,null,{}, {city:{status:'unknown'}});
  assert(!unknown.costs.items.some(x=>x.fee===id+'-county-building' && !x.unpriced));
  const tribal=report(d,null,{}, {tribe:id==='wa-skagit'?'Swinomish':'Muckleshoot'});
  assert(!tribal.costs.items.some(x=>x.fee===id+'-county-building' && !x.unpriced));
  const missingLand=sample(d,null);missingLand.facts.jurisdiction.trust_status='unknown';
  const missingReport=Engine.evaluate({facts:missingLand.facts,project:{type:'new_sfr',construction_value:550000},rules:[...State.rules,...Regional.rules],data:d});
  assert(!missingReport.costs.items.some(x=>[id+'-county-building','lni-electrical'].includes(x.fee)&&!x.unpriced));
  assert.equal(sample(d,null).facts.jurisdiction.city,null);
  assert.equal(sample(d,null,{city:{truncated:true}}).facts.jurisdiction.status,'unknown');
  assert.equal(sample(d,'Seattle',{city:{features:[{attrs:{NAME:'Seattle'}},{attrs:{NAME:'Bellevue'}}]}}).facts.jurisdiction.status,'unknown');
  assert.equal(sample(d,null).facts.permits.status,'unknown');
  assert(!sample(d,null).pack.tables.length);
  for(const layer of sample(d,null).pack.layers)assert(!layer.fields||!layer.fields.some(x=>/owner|applicant|\*/i.test(x)));
 }
 const kd=data('wa-king'),sd=data('wa-skagit');
 assert.equal(sample(sd,'MOUNT VERNON').facts.jurisdiction.city,'Mount Vernon');
 assert.equal(sample(sd,'SEDRO-WOOLLEY').facts.jurisdiction.city,'Sedro-Woolley');
 assert.equal(sample(kd,'SEATTLE').facts.jurisdiction.city,'Seattle');
 const wrongBase=Registry.create({...base,meta:{...base.meta,shared_revision:'stale'}},manifest,async url=>({ok:true,json:async()=>JSON.parse(outputs[url])}));
 await assert.rejects(wrongBase.load('wa-king'),/revision mismatch/);
 assert.throws(()=>build.validateMethod({id:'bad',method:{type:'unknown'}}),/Unknown fee method/);
 assert.throws(()=>build.validateMethod({id:'bad',method:{type:'hourly_allowance',rate:551,hours_low:30,hours_high:10}}),/Invalid hourly range/);
 const seattleAllowance=report(kd,'Seattle').costs.items.find(c=>c.fee==='wa-king-seattle-landuse');
 assert.equal(seattleAllowance.bucket,'contingent');assert.equal(seattleAllowance.low,5510);assert.equal(seattleAllowance.high,16530);
 const district=sample(sd,'Mount Vernon');district.facts.regional.districts=['dike'];
 const districtReport=Engine.evaluate({facts:district.facts,project:{type:'new_sfr'},rules:Regional.rules,data:sd});
 assert(districtReport.costs.items.some(c=>c.fee==='wa-skagit-district'&&c.unpriced));
 for(const d of [kd,sd]) for(const f of Object.values(d.fees).filter(f=>f.region===d.region.id&&f.method?.type==='valuation')){
  for(const b of f.method.brackets) for(const v of [b.over+1,b.up_to].filter(v=>v>0)) {
   const c=Regional.price(f,{construction_value:v,new_dwelling:true});assert(Number.isFinite(c.low)&&c.low>=0,f.id+' '+v);
  }
 }
 const Arc=require('../bid-assistant/lib/arcgis.js'),originalQuery=Arc.query,queries=[];
 try {
  Arc.query=async(url,params)=>{queries.push(params);return {features:[],exceeded:false};};
  await Factory.create(kd.region).search('600 4th Avenue, Seattle');
  assert.match(queries.pop().where,/600 %/);
  await Factory.create(sd.region).search('833 S Spruce St, Burlington');
  assert.match(queries.pop().where,/ = '833'/);
  assert.equal(Arc.addressScore('833 S Spruce St', '833 SOUTH SPRUCE STREET'),1);
  await Factory.create(sd.region).search("100 O'Brien Rd");
  const query=queries.pop();assert.match(query.where,/ = '100'/);assert(!query.where.includes("O'Brien"));assert(!/owner|applicant|\*/i.test(query.outFields));
 } finally {Arc.query=originalQuery;}
 const fees=(d,id,p)=>Regional.price(d.fees[id],Engine.normaliseProject(p));
 assert.equal(fees(kd,'wa-king-county-building',{new_sqft:2400}).low,14032);
 assert.equal(fees(sd,'wa-skagit-county-building',{construction_value:550000}).low,7323.57);
 assert.equal(fees(sd,'wa-skagit-county-building',{construction_value:0}).unpriced,true);
 assert.equal(fees(sd,'wa-skagit-county-drainage',{hard_surface_sqft:4500,grading_cy:120}).low,1343.75);
 assert.equal(fees(sd,'wa-skagit-county-drainage',{hard_surface_sqft:4500,grading_cy:600}).low,2660.63);
 assert.equal(fees(kd,'wa-king-redmond-building',{construction_value:100000}).low,3414.05);
 assert.equal(report(kd,'Seattle').findings.find(f=>/electrical permit and inspection/.test(f.title)).agency,'wa-king-seattle');
 assert.equal(report(sd,'Burlington').findings.find(f=>f.title==='Electrical permit and inspection').agency,'lni');
 assert(report(sd,null,{demo:true}).findings.some(f=>f.agency==='nwcaa'));
 assert(!report(sd,null,{demo:true}).findings.some(f=>f.agency==='pscaa'));
 const pd=data('wa-pierce');
 assert.equal(base.meta.jurisdictions.find(j=>j.id==='wa-pierce').available,true);
 assert(!base.fees['wa-pierce-tacoma-building']);assert(!pd.fees['wa-king-seattle-building']);
 assert.deepEqual(pd.fees['wa-king-auburn-building'],kd.fees['wa-king-auburn-building'],'cross-county city uses one source record');
 assert.equal(fees(pd,'wa-pierce-county-building',{new_sqft:2400}).low,4733.47);
 for(const area of [0,1499,3001])assert.equal(fees(pd,'wa-pierce-county-building',{new_sqft:area}).unpriced,true);
 const expected={tacoma:18372.75,lakewood:7350.75,puyallup:5727.56,'university-place':7344.53,'bonney-lake':6998.04,'gig-harbor':7953,fife:11431.8,sumner:5727.56};
 for(const [city,total] of Object.entries(expected))assert.equal(fees(pd,'wa-pierce-'+city+'-building',{construction_value:550000}).low,total,city);
 assert.equal(fees(pd,'wa-pierce-tacoma-surcharges',{construction_value:550000}).low,2799.14);
 assert.equal(fees(kd,'wa-king-kirkland-building',{construction_value:550000}).low,9083.52);
 assert.equal(fees(kd,'wa-king-kirkland-trades',{construction_value:550000}).low,1403.82);
 assert.equal(fees(kd,'wa-king-kirkland-impact-park',{new_sqft:2400}).low,10481.56);
 assert.equal(fees(kd,'wa-king-kirkland-impact-transport',{new_sqft:2400}).low,9130.03);
 assert.equal(fees(kd,'wa-king-kirkland-impact-fire',{new_sqft:2400}).low,1800);
 assert.equal(fees(kd,'wa-king-kirkland-building',{construction_value:0}).unpriced,true);
 assert.equal(fees(pd,'wa-pierce-university-place-building',{construction_value:500}).low,92.12,'minimum plan review plus permit/support');
 assert.equal(report(pd,'Tacoma', {type:'addition'}).costs.items.find(c=>c.fee==='wa-pierce-tacoma-building-addition').unpriced,true);
 assert(!report(kd,'Kirkland',{type:'rebuild'}).costs.items.some(c=>c.fee==='wa-king-kirkland-impact-school'));
 assert(!report(pd,null,{wastewater:'septic_new'}).costs.items.some(c=>c.fee==='wa-pierce-county-sewer'));
 assert.equal(report(pd,'Puyallup',{type:'adu',wastewater:'septic_new'}).costs.items.find(c=>c.fee==='wa-pierce-septic-adu').low,1620);
 assert.equal(report(kd,'Kirkland').costs.items.find(c=>c.fee==='wa-king-kirkland-planning').bucket,'contingent');
 assert(!report(kd,'Kirkland').costs.items.some(c=>c.fee==='wa-king-electrical'),'priced home electrical is not also a quote gap');
 function changedReport(mutator){const s=sample(pd,null);mutator(s.screening.layers);s.facts=s.pack.deriveFacts(s.screening);return {s,r:Engine.evaluate({facts:s.facts,project:{type:'new_sfr',construction_value:550000},rules:[...Federal.rules,...State.rules,...Regional.rules],data:pd})};}
 for(const change of [l=>{l.military.status='unknown';},l=>{l.military.truncated=true;},l=>{l.military.features=[{attrs:{NAME:'JBLM'},on_parcel:true}];l.military.status='on_parcel';}]){
  const {r}=changedReport(change);assert(!r.costs.items.some(c=>c.fee==='wa-pierce-county-building'&&!c.unpriced));assert(r.findings.some(f=>f.agency==='wa-pierce-military'));
 }
 for(const [provider,agency] of [['Tacoma Power','tacoma-power'],['Puget Sound Energy','lni'],[null,'tacoma-power']]){
  const {r}=changedReport(l=>{l.electric.features=provider?[{attrs:{PURVEYOR:provider},on_parcel:true}]:[];l.electric.status=provider?'on_parcel':'unknown';});
  assert(r.findings.some(f=>f.agency===agency&&/electrical|Electrical/.test(f.title)));
  if(agency==='tacoma-power')assert(!r.costs.items.some(c=>c.fee==='lni-electrical'&&!c.unpriced));
 }
 const hazards=changedReport(l=>{l.volcanic.features=[{attrs:{CASE_1:1},on_parcel:true}];l.volcanic.status='on_parcel';l.geohazard.features=[{attrs:{},on_parcel:true}];l.geohazard.status='on_parcel';});
 assert(hazards.r.findings.some(f=>/lahar/.test(f.title)));assert(hazards.r.costs.items.some(c=>c.fee==='wa-pierce-geotech'&&!c.unpriced));
 const wet=changedReport(l=>{l.wetland.features=[{attrs:{},distance_ft:0,on_parcel:true}];l.wetland.status='on_parcel';});
 assert(wet.r.costs.items.some(c=>c.fee==='wa-pierce-ecology-full'&&c.unpriced));
 const dock=report(pd,'Tacoma',{type:'shoreline_structure',in_water:true});assert(dock.findings.some(f=>f.agency==='usace'));assert(dock.findings.some(f=>f.agency==='wdfw'));assert(dock.findings.some(f=>f.agency==='puyallup'||f.agency==='nisqually'));
 for(const d of [pd,kd])for(const fee of Object.values(d.fees).filter(f=>f.region===d.region.id)){assert(fee.source?.url?.startsWith('https://'),fee.id);}
 // Repeated stacked condo geometry must not cancel the parcel's interior district probes.
 try {
  const geometry={rings:[[[-122.4,47.2],[-122.399,47.2],[-122.399,47.201],[-122.4,47.201],[-122.4,47.2]]]};
  const feature={attributes:{TaxParcelNumber:'9009660010',Site_Address:'Synthetic civic site'},geometry};
  Arc.query=async()=>({features:[feature,JSON.parse(JSON.stringify(feature))],exceeded:false});
  const p=await Factory.create(pd.region).parcelById('9009660010');assert(p.interior_points.length>0);assert.equal(p.polygon_count,1);
  Arc.query=async()=>({features:[feature],exceeded:true});await assert.rejects(Factory.create(pd.region).parcelAtPoint(-122.4,47.2),/unambiguous/);
 }finally{Arc.query=originalQuery;}
 console.log('PASS: county pack isolation, retry/revision checks, city/tribal/error routing, price fixtures and all regional project types.');
})().catch(e=>{console.error(e);process.exitCode=1;});
