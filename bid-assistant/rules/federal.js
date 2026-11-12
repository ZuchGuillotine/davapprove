(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['federal'] = factory();
})(typeof self !== 'undefined' ? self : this, function () { return { rules: [] }; });
