/* Credentials stay in the authenticated app shell, never in the assessment frame. */
(function () {
  'use strict';
  var pending = new Map();
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== 'davapprove-bids-result') return;
    var item = pending.get(event.data.requestId);
    if (!item) return;
    pending.delete(event.data.requestId); clearTimeout(item.timer);
    if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result);
  });
  function request(operation, payload) {
    if (parent === window) return Promise.reject(new Error('Open the signed-in workspace to save and retrieve bids.'));
    var requestId = crypto.randomUUID();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { pending.delete(requestId); reject(new Error('The workspace did not respond. Check your connection and reopen the workspace before retrying.')); }, 45000);
      pending.set(requestId, { resolve: resolve, reject: reject, timer: timer });
      parent.postMessage({channel:'davapprove-bids',requestId:requestId,operation:operation,payload:payload}, location.origin);
    });
  }
  window.BidAccount = {request:request};
})();
