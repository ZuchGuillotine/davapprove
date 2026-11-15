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
   return Screen.buildParcel(features,{parcel_key:String(a[pc.key]),county:config.county,state:'WA',situs:pc.address.map(function(k){return a[k];}).filter(Boolean).join(' ')});
  }
  function parcelById(id){
   if(!/^[A-Za-z0-9-]+$/.test(String(id)))return Promise.reject(new Error('Invalid parcel identifier'));
   return Arc.query(pc.url,{where:pc.key+" = '"+Arc.sqlString(String(id).toUpperCase())+"'",outFields:fields}).then(function(r){if(r.exceeded)throw new Error('Parcel geometry was truncated');return from(r.features);});
  }
  function parcelAtPoint(lon,lat){return Arc.query(pc.url,{geometry:{x:lon,y:lat},outFields:pc.key,returnGeometry:false}).then(function(r){if(r.features.length!==1)throw new Error('Select an unambiguous point inside the parcel');return parcelById(r.features[0].attributes[pc.key]);});}
  function search(input){
   var s=String(input||'').trim().toUpperCase().split(',')[0].replace(/\s+/g,' ');
   if(!s)return Promise.resolve([]);
   var terms={NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW',AVENUE:'AVE',STREET:'ST',ROAD:'RD',DRIVE:'DR',COURT:'CT',PLACE:'PL',BOULEVARD:'BLVD',LANE:'LN',HIGHWAY:'HWY',PARKWAY:'PKWY'};
   var expand={};Object.keys(terms).forEach(function(k){expand[terms[k]]=k;});
   var aliases=pc.address.length===1?terms:expand;
   s=s.replace(/\b[A-Z]+\b\.?/g,function(word){var clean=word.replace(/\.$/,'');return aliases[clean]||clean;});
   var where;
   if(/^(P\d+|\d[\d-]{5,})$/.test(s))where=pc.key+" = '"+Arc.sqlString(s.replace(/-/g,''))+"'";
   else if(pc.address.length===1)where="UPPER("+pc.address[0]+") LIKE '"+Arc.sqlString(s)+"%'";
   else {var parts=s.split(' '),n=parts.shift();where=pc.address[0]+" = '"+Arc.sqlString(n)+"' AND UPPER("+pc.address[1]+") LIKE '"+Arc.sqlString(parts.join(' '))+"%'";}
   return Arc.query(pc.url,{where:where,outFields:fields,returnGeometry:false,resultRecordCount:12}).then(function(r){return r.features.map(function(f){return {parcel_key:String(f.attributes[pc.key]),label:pc.address.map(function(k){return f.attributes[k];}).filter(Boolean).join(' ')||'Parcel '+f.attributes[pc.key],sublabel:config.county+' parcel '+f.attributes[pc.key]};});});
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
   f.parcel.zone_code=z.map(function(a){return a.CURRZONE||a.ZONING_CODE||a.LUD_ZONING;}).filter(Boolean).join(' / ')||null;
   f.parcel.zone_name=z.map(function(a){return a.ZONING_LABEL;}).filter(Boolean).join(' / ')||null;
   f.parcel.situs=s.parcel.situs||null;f.parcel.vacant=null;f.parcel.dwellings=null;f.parcel.improvements=null;
   f.jurisdiction.military=z.some(function(a){return /military/i.test(String(a.ZONING_LABEL||''));});
   f.stream.streams=(s.layers.stream&&s.layers.stream.features||[]).map(function(x){return {type:x.attrs.StreamType||'unknown',on_parcel:x.on_parcel,distance_ft:x.distance_ft,bearing:x.bearing};});
   f.stream.nearest=f.stream.streams[0]||null;f.stream.types=f.stream.streams.map(function(x){return x.type;});
   // No mapped waterbody/SMP/landslide source is not a negative result.
   f.stream.status=s.layers.stream?s.layers.stream.status:'unknown';
   var g=s.layers.geohazard;f.geohazard.status=g?g.status:'unknown';f.geohazard.high=!!(g&&g.features.some(function(x){return x.on_parcel;}));f.geohazard.classes=f.geohazard.high?['Potential landslide']:[];
   f.permits={status:'unknown',items:[],error:'Permit history is outside this lightweight regional screening.'};
   f.regional={id:config.id,unconfirmed_buffers:true,districts:['dike','drainage'].reduce(function(out,k){var l=s.layers[k];if(l&&l.features.length)out.push(k);return out;},[])};
   return f;
  }
  return {id:config.id,name:config.county+' County, Washington',county:config.county,state:'WA',center:config.center,zoom:config.zoom,rule_sets:['federal','wa-state','wa-regional'],constraint_ruleset:'wa-regional',layers:layers,tables:[],search:search,parcelById:parcelById,parcelAtPoint:parcelAtPoint,deriveFacts:deriveFacts,examples:config.examples||[]};
 }
 return {create:create};
});
