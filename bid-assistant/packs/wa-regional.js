/* County adapters share statewide evidence, never Kitsap fee jurisdiction or buffer rules. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../lib/arcgis.js'),require('../lib/screen.js'),require('./wa-kitsap.js'));
 else root.BidRegionalPack=factory(root.BidArcgis,root.BidScreen,root.BidPacks['wa-kitsap']);
})(typeof self!=='undefined'?self:this,function(Arc,Screen,Base){
 'use strict';
 function create(config){
  var shared=['tribal_lands','state_route','arch_risk','nwi','aquatic_own','flood'];
  var layers=[Object.assign({id:'city',label:'Municipal boundaries',kind:'attributes',group:'jurisdiction',publisher:config.county+' County GIS'},config.city)]
   .concat(config.layers).concat(Base.layers.filter(function(l){return shared.indexOf(l.id)>=0;}))
   .map(function(l){return Object.assign({},l,{timeout_ms:8000});});
  var pc=config.parcel, fields=pc.fields.join(',');
  function from(features){
   if(!features.length)return null;
   var a=features[0].attributes;
   // Some condominium tax IDs repeat the same ground polygon for stacked records.
   // Duplicate rings cancel under even/odd containment and would erase district probes.
   var seen={};features=features.filter(function(f){var key=JSON.stringify(f.geometry);if(seen[key])return false;seen[key]=true;return true;});
   var parcel=Screen.buildParcel(features,{parcel_key:String(a[pc.key]),county:config.county,state:'WA',situs:pc.address.map(function(k){return a[k];}).filter(Boolean).join(' ')});
   if(!parcel.interior_points.length)throw new Error('Parcel geometry could not establish an interior location. Select another parcel or confirm the county geometry before estimating jurisdiction fees.');
   return parcel;
  }
  function parcelById(id){
   if(!/^[A-Za-z0-9-]+$/.test(String(id)))return Promise.reject(new Error('Invalid parcel identifier'));
   return Arc.query(pc.url,{where:pc.key+" = '"+Arc.sqlString(String(id).toUpperCase())+"'",outFields:fields}).then(function(r){if(r.exceeded)throw new Error('Parcel geometry was truncated');return from(r.features);});
  }
  function parcelAtPoint(lon,lat){return Arc.query(pc.url,{geometry:{x:lon,y:lat},outFields:pc.key,returnGeometry:false}).then(function(r){if(r.exceeded||r.features.length!==1)throw new Error('Select an unambiguous point inside the parcel');return parcelById(r.features[0].attributes[pc.key]);});}
  function search(input){
   var raw=String(input||'').trim().toUpperCase(), s=Arc.normalizeAddress(raw);
   if(s.length<3)return Promise.resolve([]);
   var isId=/^(P\d+|\d[\d-]{5,})$/.test(raw), where;
   if(isId)where=pc.key+" = '"+Arc.sqlString(raw.replace(/-/g,''))+"'";
   else {
    var house=/^(\d+)\s/.exec(s);
    var words=house?s.split(' ').slice(1).filter(function(w){return !/^(N|S|E|W|NE|NW|SE|SW|AVE|ST|RD|DR|CT|PL|BLVD|LN|HWY|PKWY|CIR|TER)$/.test(w);}):[];
    var street=words.length?"%"+Arc.sqlString(words.join('%')):"";
    if(pc.address.length===1)where="UPPER("+pc.address[0]+") LIKE '"+Arc.sqlString(house?house[1]+' ':s)+street+"%'";
    else if(house)where=pc.address[0]+" = '"+house[1]+"'"+(words.length?" AND UPPER("+pc.address[1]+") LIKE '"+street+"%'":"");
    else where="UPPER("+pc.address[1]+") LIKE '"+Arc.sqlString(s)+"%'";
   }
   function query(w){return Arc.query(pc.url,{where:w,outFields:fields,returnGeometry:false,resultRecordCount:100},{timeoutMs:5000,noRetry:true});}
   return query(where).then(function(r){
    if(!isId && house && words.length && !r.features.length && !r.exceeded)return query(pc.address.length===1?"UPPER("+pc.address[0]+") LIKE '"+house[1]+" %'":pc.address[0]+" = '"+house[1]+"'");
    return r;
   }).then(function(r){
    var seen={},hits=r.features.map(function(f){var label=pc.address.map(function(k){return f.attributes[k];}).filter(Boolean).join(' ');return {parcel_key:String(f.attributes[pc.key]),label:label||'Parcel '+f.attributes[pc.key],sublabel:config.county+' parcel '+f.attributes[pc.key],score:isId?1:Arc.addressScore(s,label)};})
     .filter(function(h){if(seen[h.parcel_key]||h.score<.65)return false;seen[h.parcel_key]=true;return true;}).sort(function(a,b){return b.score-a.score;});
    var limited=r.exceeded||hits.length>12;hits=hits.slice(0,12);hits.truncated=limited;return hits;
   });
  }
  function deriveFacts(s){
   // Reuse the established neutral fact shape for shared state/federal layers. Replace all
   // county-specific interpretations before rules can see them.
   var f=Base.deriveFacts(s),c=s.layers.city,attrs=(c&&c.features||[]).map(function(x){return x.attrs;}),names=[];
   attrs.forEach(function(a){if(config.city.uninc_field&&Number(a[config.city.uninc_field])===1)return;var n=String(a.NAME||'').trim();n=Object.keys(config.profiles).find(function(k){return k.toLowerCase()===n.toLowerCase();})||n;if(names.indexOf(n)<0)names.push(n);});
   var unknown=!c||c.status==='unknown'||c.truncated||names.length>1||names.indexOf('')>=0;
   // King's layer includes unincorporated polygons. No response cannot establish county authority.
   if(config.city.uninc_field&&(!attrs.length||attrs.some(function(a){return a.UNINC==null||(Number(a.UNINC)===1&&a.NAME!==config.county+' County');})))unknown=true;
   f.jurisdiction.county=config.county;f.jurisdiction.city=names.length===1?names[0]:null;f.jurisdiction.status=unknown?'unknown':names.length?'on_parcel':'none';
   f.jurisdiction.reservation=null;f.jurisdiction.tribal_zoning=false;f.jurisdiction.uga=null;
   f.jurisdiction.military=false;f.jurisdiction.fire_district=null;f.jurisdiction.water_district=null;
   var z=(s.layers.zoning&&s.layers.zoning.features||[]).map(function(x){return x.attrs;});
   f.parcel.zone_code=z.map(function(a){return a.CURRZONE||a.ZONING_CODE||a.LUD_ZONING||a.ZONING;}).filter(Boolean).join(' / ')||null;
   f.parcel.zone_name=z.map(function(a){return a.ZONING_LABEL;}).filter(Boolean).join(' / ')||null;
   f.parcel.situs=s.parcel.situs||null;f.parcel.vacant=null;f.parcel.dwellings=null;f.parcel.improvements=null;
   var military=s.layers.military;
   f.jurisdiction.military=!!(military&&military.features.some(function(x){return x.on_parcel;}))||z.some(function(a){return /military/i.test(String(a.ZONING_LABEL||''));});
   // A failed military boundary check cannot establish an ordinary local fee route.
   if(config.layers.some(function(l){return l.id==='military';})&&(!military||military.status==='unknown'||military.truncated))f.jurisdiction.status='unknown';
   f.stream.streams=(s.layers.stream&&s.layers.stream.features||[]).map(function(x){return {type:x.attrs.StreamType||'unknown',on_parcel:x.on_parcel,distance_ft:x.distance_ft,bearing:x.bearing};});
   f.stream.nearest=f.stream.streams[0]||null;f.stream.types=f.stream.streams.map(function(x){return x.type;});
   // No mapped waterbody/SMP/landslide source is not a negative result.
   f.stream.status=s.layers.stream?s.layers.stream.status:'unknown';
   var g=s.layers.geohazard;f.geohazard.status=g?g.status:'unknown';f.geohazard.high=!!(g&&g.features.some(function(x){return x.on_parcel;}));f.geohazard.classes=f.geohazard.high?['Potential landslide']:[];
   f.permits={status:'unknown',items:[],error:'Permit history is outside this lightweight regional screening.'};
   f.regional={id:config.id,unconfirmed_buffers:true,districts:['dike','drainage'].reduce(function(out,k){var l=s.layers[k];if(l&&l.features.length)out.push(k);return out;},[])};
   if(config.id==='wa-pierce'){
    var volcanic=s.layers.volcanic,electric=s.layers.electric,smp=s.layers.smp;
    f.regional.volcanic=!!(volcanic&&volcanic.features.some(function(x){return x.on_parcel;}));
    f.regional.volcanic_status=volcanic&&!volcanic.truncated?volcanic.status:'unknown';
    f.regional.military_status=military&&!military.truncated?military.status:'unknown';
    var providers=electric?(electric.features||[]).map(function(x){return x.attrs.PURVEYOR;}).filter(Boolean):[];
    f.regional.electrical_provider=electric&&electric.status!=='unknown'&&!electric.truncated&&providers.length===1?providers[0]:null;
    f.shoreline.designations=(smp&&smp.features||[]).filter(function(x){return x.on_parcel;}).map(function(x){return x.attrs.ENV_DES;}).filter(Boolean);
    f.shoreline.in_jurisdiction=f.shoreline.designations.length>0;
    f.shoreline.upland_designations=f.shoreline.designations.filter(function(x){return x!=='Aquatic';});
    // County SMP inventory does not settle a city's shoreline jurisdiction.
    f.shoreline.status=!f.jurisdiction.city&&smp&&!smp.truncated?smp.status:'unknown';
   }
   return f;
  }
  return {id:config.id,name:config.county+' County, Washington',county:config.county,state:'WA',center:config.center,zoom:config.zoom,rule_sets:['federal','wa-state','wa-regional'],constraint_ruleset:'wa-regional',layers:layers,tables:[],search:search,parcelById:parcelById,parcelAtPoint:parcelAtPoint,deriveFacts:deriveFacts,examples:config.examples||[]};
 }
 return {create:create};
});
