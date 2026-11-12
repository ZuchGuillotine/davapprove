/* Geometry checks for the bid assistant. Pure functions, no network. */
const assert = require('node:assert');
const path = require('node:path');
const Geo = require(path.join(__dirname, '../bid-assistant/lib/geo.js'));

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
const poly = (pts) => Geo.withBBox({ type: 'polygon', rings: [pts.concat([pts[0]])] });
const line = (pts) => Geo.withBBox({ type: 'polyline', rings: [pts] });

// projection: one degree of latitude is about 69 miles; round trip is exact
const proj = Geo.makeProjector(-122.6, 47.6);
near(proj.toXY([-122.6, 47.601])[1], 364.6, 0.5, 'latitude feet');
near(proj.toXY([-122.599, 47.6])[0], 364.567 * Math.cos(47.6 * Math.PI / 180), 0.5, 'longitude feet');
const rt = proj.toLL(proj.toXY([-122.5987, 47.6021]));
near(rt[0], -122.5987, 1e-9); near(rt[1], 47.6021, 1e-9);

// a 200 x 100 ft lot
const lot = poly([[0, 0], [200, 0], [200, 100], [0, 100]]);
near(Geo.area(lot), 20000, 1e-6, 'area');
assert.deepStrictEqual(Geo.centroid(lot).map(Math.round), [100, 50]);
assert.equal(Geo.pointInPolygon([10, 10], lot), true);
assert.equal(Geo.pointInPolygon([210, 10], lot), false);

// holes are excluded from area and from containment
const donut = Geo.withBBox({ type: 'polygon', rings: [
  [[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]],
  [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]
] });
near(Geo.area(donut), 10000 - 400, 1e-6, 'donut area');
assert.equal(Geo.pointInPolygon([50, 50], donut), false);
assert.equal(Geo.pointInPolygon([20, 20], donut), true);

// distances
near(Geo.distPointToShape([250, 50], lot), 50, 1e-9);
assert.equal(Geo.distPointToShape([50, 50], lot), 0);
near(Geo.shapeDistance(lot, poly([[260, 0], [300, 0], [300, 50], [260, 50]])), 60, 1e-9, 'separate polygons');
assert.equal(Geo.shapeDistance(lot, poly([[150, 50], [300, 50], [300, 80], [150, 80]])), 0, 'overlapping polygons');
assert.equal(Geo.shapeDistance(lot, poly([[50, 20], [60, 20], [60, 30], [50, 30]])), 0, 'contained polygon');
assert.equal(Geo.shapeDistance(lot, line([[-50, 50], [250, 50]])), 0, 'stream crossing the lot');
assert.equal(Geo.shapeDistance(lot, line([[100, -50], [100, 150]])), 0, 'crossing with no vertex inside');
near(Geo.shapeDistance(lot, line([[-50, 130], [250, 130]])), 30, 1e-9, 'stream 30 ft north');
assert.equal(Geo.compass([0, 0], [0, 10]), 'north');
assert.equal(Geo.compass([0, 0], [10, -10]), 'southeast');

// grid: a stream along the south edge with a 25 ft buffer covers the bottom quarter of the lot
const stream = line([[-10, 0], [210, 0]]);
const wet = poly([[150, 60], [200, 60], [200, 100], [150, 100]]); // 2,000 sq ft in the NE corner
const grid = Geo.gridAnalyze(lot, [
  { id: 'wet', label: 'wetland', tier: 'core', shapes: [wet], buffer_ft: 0 },
  { id: 'buf', label: 'stream buffer', tier: 'buffer', shapes: [stream], buffer_ft: 25 }
], { targetSamples: 5000, minStep: 1 });
near(grid.parcel_sqft, 20000, 1e-6);
near(grid.totals.buffer.pct, 25, 1.0, 'buffer share');
near(grid.totals.core.pct, 10, 1.0, 'core share');
near(grid.totals.clear.pct, 65, 1.5, 'clear share');
near(grid.totals.core.sqft + grid.totals.buffer.sqft + grid.totals.clear.sqft + grid.totals.review.sqft, 20000, 1, 'areas sum to the lot');
near(grid.quadrants.SW.constrained_pct, 50, 2, 'SW half inside stream buffer');
near(grid.quadrants.NW.constrained_pct, 0, 0.01, 'NW clear');
near(grid.quadrants.NE.constrained_pct, 40, 2.5, 'NE has the wetland');
assert.equal(grid.quadrants.NE.by[0].id, 'wet');
near(grid.constraints.find((c) => c.id === 'wet').sqft, 2000, 150, 'wetland area');

// tier precedence: where core and buffer overlap, the cell is core
const g2 = Geo.gridAnalyze(lot, [
  { id: 'a', label: 'a', tier: 'buffer', shapes: [lot], buffer_ft: 0 },
  { id: 'b', label: 'b', tier: 'core', shapes: [wet], buffer_ft: 0 },
  { id: 'c', label: 'c', tier: 'review', shapes: [lot], buffer_ft: 0 }
], { targetSamples: 2000, minStep: 1 });
near(g2.totals.core.pct + g2.totals.buffer.pct, 100, 1e-6);
near(g2.totals.core.pct, 10, 1.0);
assert.equal(g2.totals.review.pct, 0);
near(g2.constraints.find((c) => c.id === 'c').pct, 100, 1e-6, 'per-constraint coverage is independent of precedence');

// coarse probe cells count as constrained and are flagged
const g3 = Geo.gridAnalyze(lot, [{ id: 'haz', label: 'hazard', tier: 'core', shapes: [], partial_shapes: [Geo.rectShape(0, 0, 100, 100)], buffer_ft: 0 }], { targetSamples: 2000, minStep: 1 });
near(g3.totals.core.pct, 50, 1.0);
assert.equal(g3.constraints[0].includes_coarse_cells, true);

console.log('PASS: bid assistant geometry (projection, area, containment, distance, grid coverage, quadrants).');
