/* Public, immutable reference packs. Only a selected county is fetched; failures are retryable. */
(function(root,factory){
 if(typeof module==='object'&&module.exports) module.exports=factory();
 else root.BidRegions=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function create(base, manifest, fetcher) {
  var pending={};
  function load(id){
   if(id==='wa-kitsap') return Promise.resolve(base);
   var entry=manifest.regions[id];
   if(!entry) return Promise.reject(new Error('Unsupported county: '+id));
   if(pending[id]) return pending[id];
   pending[id]=fetcher(entry.url).then(function(r){if(!r.ok)throw new Error('County source pack unavailable ('+r.status+')');return r.json();}).then(function(pack){
    if(pack.schema_version!==1||!pack.region||pack.region.id!==id||pack.revision!==entry.revision||pack.shared_revision!==base.meta.shared_revision)throw new Error('County source revision mismatch. Refresh this page.');
    var d={meta:Object.assign({},base.meta,{reference_revision:pack.revision,municipal_fees_checked:pack.region.checked}),region:pack.region,routing:pack.routing||base.routing};
    ['citations','fees','agencies'].forEach(function(k){d[k]=Object.assign({},base[k],pack[k]);});return d;
   }).catch(function(e){delete pending[id];throw e;});
   return pending[id];
  }
  return {load:load};
 }
 return {create:create};
});
