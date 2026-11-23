/* Data-driven local bidding rules; all rates and formula parameters live in fees.json. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else(root.BidRuleSets=root.BidRuleSets||{})['wa-regional']=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function price(f,p){
  var m=f.method,v=p.construction_value,n;
  if(!m)return f.confidence==='unsourced'?{fee:f.id,unpriced:true}:{fee:f.id};
  if(m.type==='valuation'){
   if(!(v>0))return {fee:f.id,unpriced:true,note:'Enter construction valuation to calculate this fee; it is not included in the subtotal yet.'};
   var b=m.brackets.filter(function(b){return b.up_to==null||v<=b.up_to;})[0];
   if(!b)return {fee:f.id,unpriced:true,note:'Valuation exceeds the verified table range. Request a quote.'};
   n=b.base+Math.max(0,(m.prorated?(v-b.over)/b.step:Math.ceil((v-b.over)/b.step)))*b.rate;
   var base=n, factor=p.new_dwelling?(m.new_dwelling_factor||1):1;
   var plan=Math.max(base*m.plan_ratio,m.plan_min||0);
   if(m.round_components)n=Math.round(base*factor)+Math.round(plan*factor);
   else n=(base*(m.permit_factor==null?1:m.permit_factor)+plan)*factor;
   if(m.automation_ratio)n+=Math.max(m.automation_min,base*m.automation_ratio);
   n=n*(1+m.technology_ratio)+m.flat;
  }else if(m.type==='hourly_allowance'){return {fee:f.id,low:m.rate*m.hours_low,high:m.rate*m.hours_high,note:f.note};}
  else if(m.type==='area'){if(!(p.new_sqft>0))return {fee:f.id,unpriced:true};n=m.base+Math.min(m.cap==null?Infinity:m.cap,m.per_sqft*p.new_sqft);}
  else if(m.type==='area_table'){
   var rows=m.rows,area=p.new_sqft;
   if(area<rows[0].sqft||area>rows[rows.length-1].sqft)return {fee:f.id,unpriced:true,note:'Floor area is outside the published example range. Request an agency estimate.'};
   var i=rows.findIndex(function(x){return x.sqft>=area;}),hi=rows[i],lo=rows[Math.max(0,i-1)];
   n=lo.fee+(hi.sqft===lo.sqft?0:(area-lo.sqft)/(hi.sqft-lo.sqft)*(hi.fee-lo.fee));n*=1+(m.technology_ratio||0);
  }
  else if(m.type==='skagit_disturbance'){
   var row=m.levels.filter(function(b){return p.hard_surface_sqft<=b.surface&&p.grading_cy<=b.volume;})[0];
   if(!row)return {fee:f.id,unpriced:true,note:'Site work exceeds verified fee bands; obtain a county estimate.'};
   n=row.fee||(p.hard_surface_sqft>0&&p.grading_cy>0?row.both:p.hard_surface_sqft>0?row.drainage:row.grading);n*=1+m.technology_ratio;
  }else return {fee:f.id,unpriced:true,note:'Unrecognized fee method; request a quote.'};
  n=Math.round(n*100)/100;return {fee:f.id,low:n,high:n,note:f.note};
 }
 function critical(f){return f.wetland.count>0||f.stream.streams.length>0||f.geohazard.high;}
 function matches(t,p,f){
  var structure=p.new_sqft>0,home=p.type==='new_sfr'||p.type==='rebuild';
  if(t.indexOf('conditional_')===0)t=t.slice('conditional_'.length);
  return {structure:structure,home:home,new_home:p.type==='new_sfr',sewer_home:home&&p.wastewater==='sewer',adu:p.type==='adu',addition:p.type==='addition',other_structure:structure&&!home&&p.type!=='adu',new_structure:structure&&p.type!=='addition',development:p.disturbance_sqft>0,critical:critical(f),wetland:f.wetland.count>0,geohazard:f.geohazard.high||!!(f.regional&&f.regional.volcanic),flood:f.flood.sfha_on_parcel,shoreline:p.in_water||f.shoreline.in_jurisdiction}[t]||false;
 }
 function local(ctx){
  var f=ctx.facts,p=ctx.project,d=ctx.data,r=d.region,j=f.jurisdiction,land=ctx.helpers.landContext(f,p);
  if(!r)return [];
  var uncertain=j.status==='unknown'||land.mode==='unknown'||land.mode==='tribal'||land.mode==='federal'||land.conflict||(j.tribal_names||[]).length;
  var profile=uncertain?null:r.profiles[j.city||'County'];
  var out=[{agency:profile?profile.agency:r.id,level:uncertain?'unknown':'likely',basis:'confirm',title:uncertain?'Confirm local / tribal permitting authority':(j.city||r.county+' County')+' building, land-use and civil review',why:uncertain?'Boundary or land-status evidence does not establish an ordinary county/city fee route. County rates have been withheld.':profile?'Use this jurisdiction’s fee schedule. Building review, planning, site engineering and specialist permits are separate scopes; the priced lines below are a subtotal.':'The map identifies '+j.city+'. Its fees are not yet transcribed; county rates do not apply as a substitute.',confirm:'Confirm zoning, allowed use, lot legality, setbacks, agricultural/resource-land restrictions, critical areas, shoreline jurisdiction, drainage, fire access and utility service before fixing a bid.',citations:[r.id+'-gis'].concat(profile?profile.citations:[]),costs:profile?profile.fees.filter(function(x){return matches(x.trigger,p,f);}).map(function(x){var c=price(d.fees[x.fee],p);if(x.trigger.indexOf('conditional_')===0)c.bucket='contingent';return c;}):[{fee:r.fallback_fee,unpriced:true}]}];
  if(p.new_dwelling)out.push({agency:profile?profile.agency:r.id,level:'possible',basis:'confirm',title:'Impact fees, service connections and capacity charges',why:'School boundaries, utility districts, dwelling size, replacement credits and prior payments change these costs. Published allowances, where available, are listed separately. Remaining charges require scoping; a mailing city does not identify the utility provider.',citations:profile?profile.citations:[r.id+'-gis'],costs:[{fee:r.id+'-impact',unpriced:true},{fee:r.id+'-utility',unpriced:true}]});
  if(p.new_sqft>0)out.push({agency:profile?profile.agency:r.id,level:'likely',basis:'confirm',title:'Separate trade, civil and access permits',why:'Mechanical/plumbing scope, road access, drainage improvements and utility work can add separate permits and professional costs. Confirm which items are already included in the contractor bid.',citations:profile?profile.citations:[r.id+'-gis'],costs:[{fee:r.id+'-trades',unpriced:true}]});
  var specialistCosts=f.wetland.count||f.stream.streams.length?[price(d.fees[r.id+'-ecologist'],p)]:[];
  if(specialistCosts.length&&d.fees[r.id+'-ecology-full'])specialistCosts.push({fee:r.id+'-ecology-full',unpriced:true});
  if(f.geohazard.high||f.regional.volcanic)specialistCosts.push(price(d.fees[r.id+'-geotech'],p));
  out.push({agency:profile?profile.agency:r.id,level:critical(f)?'likely':'unknown',basis:'confirm',title:'Siting constraints and specialist reports remain provisional',why:r.coverage_note,confirm:'Locate wetland and stream edges, verify geology and agricultural restrictions, and obtain the applicable city/county buffer requirements. Gray map cells are unresolved, not buildable. Prior permit validity and reuse require an agency records check.',citations:(profile?profile.citations:[]).concat([r.id+'-gis',r.id+'-consultants']).concat(d.citations[r.id+'-geotech-source']?[r.id+'-geotech-source']:[]),costs:specialistCosts});
  var septicFee=p.type==='adu'&&r.septic_adu_fee?r.septic_adu_fee:r.id+'-septic';
  if(p.new_dwelling && p.wastewater!=='sewer')out.push({agency:r.health_agency,level:p.wastewater==='unknown'?'possible':'likely',basis:'confirm',title:'On-site sewage feasibility and health approval',why:'Health authority approval of new or modified septic systems is separate from building review. Existing-system capacity and reserve area must be checked; a permit history snapshot is not an approval for added bedrooms.',citations:[r.id+'-septic-fees'],costs:[{fee:septicFee,unpriced:p.wastewater!=='septic_new',note:p.wastewater==='septic_new'?d.fees[septicFee].note:'Existing system or wastewater route is unconfirmed; request a health-authority reuse/capacity review quote.'}]});
  if(!j.city && !uncertain) out.push({agency:r.id,level:'possible',basis:'confirm',title:'County critical-area code and vesting check',why:r.critical_area_note,citations:[r.id+'-critical-code'],costs:[]});
  if(new Date().toISOString().slice(0,10)>r.valid_through) out.push({agency:r.id,level:'unknown',basis:'confirm',title:'County fee sources need a new schedule review',why:'This reference pack is past its review date. Displayed figures are historical allowances; confirm current agency fees before issuing a bid.',citations:[r.id+'-county-source'],costs:[]});
  if(r.id==='wa-pierce'){
   if(f.regional.volcanic||f.regional.volcanic_status==='unknown')out.push({agency:profile?profile.agency:r.id,level:f.regional.volcanic?'likely':'unknown',basis:'confirm',title:'Volcanic / lahar hazard and evacuation review',why:f.regional.volcanic?'The county volcanic-hazard inventory intersects this parcel. Confirm the applicable municipal or county development restrictions, evacuation route and geotechnical scope. A mapped lahar area is not itself a blanket construction prohibition.':'The volcanic-hazard request did not establish coverage. Lahar risk remains unresolved.',citations:[r.id+'-gis',r.id+'-critical-code'],costs:[]});
   if(f.regional.military_status==='unknown'||j.military)out.push({agency:'wa-pierce-military',level:j.military?'likely':'unknown',basis:'confirm',title:'Military land and installation coordination',why:'Verify installation boundaries, federal land status and authority with JBLM before using ordinary local permitting assumptions. Nearby land may also have airfield compatibility restrictions.',citations:[r.id+'-military'],costs:[]});
  }
  if(r.id==='wa-skagit'){
   if((f.regional.districts||[]).length) out.push({agency:r.id,level:'likely',basis:'confirm',title:'Mapped dike / drainage district involvement',why:'Mapped assessment districts: '+f.regional.districts.join(', ')+'. District drainage, access and facility permissions may apply inside cities as well as unincorporated areas. Ask the district to confirm scope and charges.',citations:[r.id+'-gis'],costs:[{fee:r.id+'-district',unpriced:true}]});
   if(!j.city)out.push({agency:r.id,level:/AG|NRL/i.test(f.parcel.zone_code||'')?'likely':'possible',basis:'confirm',title:'Agricultural/resource-land siting and district review',why:'Agricultural zoning can restrict the usable building location even when the lot appears clear. Dike and drainage districts may separately control connections, drainage and work near their facilities. Mapped district hits: '+((f.regional.districts||[]).join(', ')||'none returned; service and easements still need confirmation')+'.',citations:[r.id+'-agriculture',r.id+'-gis'],costs:[]});
   if((j.tribal_names||[]).some(function(n){return /swinomish/i.test(n);}))out.push({agency:'swinomish',level:'likely',basis:'confirm',title:'Swinomish coordinated or exclusive land-use jurisdiction',why:'Confirm the work location and land status under the County/Tribe agreement. A fee-simple parcel is not automatically county-only; do not add both agencies’ full permit schedules.',citations:[r.id+'-swinomish'],costs:[]});
  }
  return out;
 }
 function constraints(s){
  return ['wetland','nwi','stream','geohazard','flood','volcanic','smp'].map(function(id){var l=s.layers[id],shapes=(l&&l.features||[]).map(function(f){return f.shape;}).filter(Boolean);return {id:id,short:id,label:'Mapped '+id+' footprint; buffers unconfirmed',tier:['geohazard','flood','volcanic'].indexOf(id)>=0?'review':'core',shapes:shapes,buffer_ft:0,basis:'Inventory geometry only. No regulatory buffer or approval is implied.'};}).filter(function(c){return c.shapes.length;});
 }
 return {rules:[{id:'regional.local',agency:'water-purveyor',topic:'Local permitting and bidding',evaluate:local}],constraints:constraints,price:price,matches:matches};
});
