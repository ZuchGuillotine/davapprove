/*
 * Rule set: federal agencies. Reused by every pack.
 * See rules/wa-kitsap.js for the meaning of finding.basis.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.BidRuleSets = root.BidRuleSets || {})['federal'] = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var rules = [];
  function rule(id, agency, topic, fn) { rules.push({ id: id, agency: agency, topic: topic, evaluate: fn }); }

  rule('us.corps', 'usace', 'Work in or near water', function (ctx) {
    var p = ctx.project, f = ctx.facts;
    if (p.in_water) {
      var marine = f.shoreline.marine;
      return [{
        level: 'required', basis: 'documented',
        title: 'Corps of Engineers permit' + (marine ? ' (Section 10 and Section 404)' : ' (Section 404)'),
        why: (marine ? 'Structures and work in navigable waters, which include Puget Sound and Hood Canal, need Corps authorization under Section 10 of the Rivers and Harbors Act. ' : '') +
          'Placing dredged or fill material in waters of the United States, including many wetlands, needs a Section 404 permit. Residential docks and bank work are often covered by a nationwide or regional general permit, which carries no fee but still triggers the consultations listed below.',
        flag: 'In-water work brings a federal permit with endangered species and tribal consultation. Allow many months, not weeks.',
        flag_weight: 10,
        citations: marine ? ['usc-33-403', 'usc-33-1344'] : ['usc-33-1344'],
        costs: ['usace-permit']
      }, {
        level: 'required', basis: 'documented', agency: 'services',
        title: 'Endangered Species Act consultation',
        why: 'Before issuing a permit the Corps must ensure the action is not likely to jeopardize listed species or their critical habitat, which it does by consulting NOAA Fisheries and the U.S. Fish and Wildlife Service. The applicant supplies a biological evaluation.',
        citations: ['usc-16-1536'],
        costs: ['pro-bio-eval']
      }, {
        level: 'required', basis: 'documented', agency: 'treaty-tribes',
        title: 'Tribal consultation and historic properties review',
        why: 'A Corps permit is a federal undertaking. The Corps must take into account effects on historic properties and consult Indian tribes that attach religious and cultural significance to places that may be affected, and it coordinates with treaty tribes on fishing rights. In Kitsap County that includes the Suquamish and Port Gamble S\'Klallam Tribes, among others.',
        confirm: 'Early, direct contact with the tribes\' natural resources and cultural resources staff shortens the federal review.',
        citations: ['usc-54-306108', 'cfr-36-800.2', 'tribe-pgst-cultural-resources', 'tribe-suquamish-archaeology'],
        costs: [{ fee: 'pro-arch-survey', bucket: 'contingent', note: 'if the Corps or a tribe asks for a cultural resources survey' }]
      }, {
        level: 'required', basis: 'documented', agency: 'ecology',
        title: 'Water quality certification and coastal zone consistency',
        why: 'A federal permit for an activity that may discharge into navigable waters needs a Section 401 water quality certification from the state, and in the coastal zone the applicant certifies consistency with the state coastal program. Both are handled by Ecology, usually through the same joint application; many nationwide permits are pre-certified.',
        citations: ['usc-33-1341', 'usc-16-1456'],
        costs: []
      }];
    }
    // upland project with wetland on the lot: only if fill is proposed
    if (f.wetland.status === 'on_parcel' && ctx.grid && (ctx.grid.totals.core.pct + ctx.grid.totals.buffer.pct) >= 80) {
      return {
        level: 'possible', basis: 'documented',
        title: 'Corps permit if any wetland is filled',
        why: 'A wetland is mapped on the lot and little of the lot lies outside mapped features and buffers. If the design fills any part of a wetland that is a water of the United States, a Section 404 permit is needed, with the federal consultations that come with it. Staying out of the wetland avoids this entirely.',
        citations: ['usc-33-1344'],
        costs: []
      };
    }
    return null;
  });

  rule('us.fema', 'fema', 'Flood hazard', function (ctx) {
    var f = ctx.facts.flood;
    if (f.status !== 'on_parcel' || !f.sfha_on_parcel) return null;
    return {
      level: 'possible', basis: 'workflow',
      title: 'Flood map standards; optional map amendment',
      why: 'FEMA does not issue the permit. The local government applies the federal floodplain standards as a condition of the community\'s flood insurance eligibility. If the building site is actually above base flood elevation, a Letter of Map Amendment from FEMA (no fee) can remove the insurance requirement, supported by an elevation certificate.',
      citations: ['cfr-44-60.3-permits', 'cfr-44-60.3-lowest-floor'],
      costs: []
    };
  });

  return { rules: rules };
});
