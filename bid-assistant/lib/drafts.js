/* Browser-local bid drafts. Store only screening inputs/results, never permit documents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BidDrafts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'davapprove.bid-drafts.v1';
  function list(storage) {
    var raw = storage.getItem(KEY);
    if (!raw) return [];
    var items = JSON.parse(raw);
    if (!Array.isArray(items) || items.some(function (d) { return d.version !== 1 || !d.id || !d.screening || !d.parcel; })) {
      throw new Error('Saved bids could not be read. Existing storage has been preserved.');
    }
    return items;
  }
  function snapshot(state, project, title, notes) {
    var p = state.parcel;
    var parcel = { geometry: p.geometry };
    ['parcel_key', 'rp_acct_id', 'account_no', 'situs'].forEach(function (key) { if (p[key] != null) parcel[key] = p[key]; });
    var screening = { pack_id: state.pack.id, layers: state.screening.layers, tables: state.screening.tables, screened_at: state.screening.screened_at };
    // Metadata contains function-valued queries; the active pack supplies those when refreshed.
    return JSON.parse(JSON.stringify({ version: 1, id: state.draftId, title: title || state.facts.parcel.situs || 'Parcel ' + p.parcel_key,
      notes: notes || '', saved_at: new Date().toISOString(), stage: 'early_bid', approved_revision: null,
      parcel: parcel, screening: screening, project: project, overrides: state.overrides }, function (key, value) {
        return /^(OWNER|APPLICANT|PROJECT_NAME)/i.test(key) ? undefined : value;
      }));
  }
  function save(storage, draft) {
    var items = list(storage).filter(function (d) { return d.id !== draft.id; });
    items.unshift(draft);
    // Let quota errors propagate. Never claim the draft saved or silently drop earlier bids.
    storage.setItem(KEY, JSON.stringify(items));
    return draft;
  }
  function remove(storage, id) {
    storage.setItem(KEY, JSON.stringify(list(storage).filter(function (d) { return d.id !== id; })));
  }
  return { list: list, snapshot: snapshot, save: save, remove: remove };
});
