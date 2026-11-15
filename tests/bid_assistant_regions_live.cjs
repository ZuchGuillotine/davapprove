/* Optional network smoke test. Queries public parcel IDs, situs and boundary fields only. */
const assert = require('node:assert/strict');
const Factory = require('../bid-assistant/packs/wa-regional.js');
const Arc = require('../bid-assistant/lib/arcgis.js');
const fixtures = [
 ['wa-king','0942000810','Seattle'], ['wa-king','3225059199','Bellevue'],
 ['wa-king','7202030010','Redmond'], ['wa-king','3885808355','Kirkland'],
 ['wa-king','9265000290','Federal Way'], ['wa-king','7816200060','Auburn'],
 ['wa-king','2923039044',null], ['wa-skagit','P54174','Mount Vernon'],
 ['wa-skagit','P55008','Anacortes'], ['wa-skagit','P72740','Burlington'],
 ['wa-skagit','P100062','Sedro-Woolley'], ['wa-skagit','P73175',null]
];
(async()=>{
 for (const [id,key,expected] of fixtures) {
  const config = require('../bid-assistant/data/regions/'+id+'.json'), pack = Factory.create(config), start = Date.now();
  const parcel = await pack.parcelById(key); assert(parcel,key);
  const response = await Arc.query(config.city.url,{geometry:{points:parcel.interior_points},geometryType:'esriGeometryMultipoint',outFields:config.city.fields.join(','),returnGeometry:false},{timeoutMs:8000});
  assert(!response.exceeded,'truncated boundary lookup');
  const names = response.features.map(f=>f.attributes).filter(a=>!config.city.uninc_field||Number(a[config.city.uninc_field])!==1).map(a=>a.NAME);
  if(expected)assert.deepEqual(names.map(n=>n.toLowerCase()),[expected.toLowerCase()]);else assert.equal(names.length,0);
  console.log('PASS',id,key,expected||'unincorporated',Date.now()-start+'ms');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
