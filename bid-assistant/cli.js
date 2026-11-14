#!/usr/bin/env node
/*
 * Command-line bid screening. Same engine and data as the web page.
 *
 *   node bid-assistant/cli.js "6042 Watauga Beach Dr E" --type new_sfr
 *   node bid-assistant/cli.js 1186246 --type adu --json
 *   node bid-assistant/cli.js --point -122.5526,47.5868 --type shoreline_structure
 *
 * Options: --type <project type>  --json  --wastewater septic_new|septic_existing|sewer
 *          --water public|well_new|well_existing  --demo  --in-water  --tree-clearing
 *          --new-sqft N --hard-surface N --disturbance N --grading N --bedrooms N --lots N
 */
const Geo = require('./lib/geo.js');
const Screen = require('./lib/screen.js');
const Engine = require('./lib/engine.js');
const Report = require('./lib/report.js');
const DATA = require('./data/data.js');
const PACKS = { 'wa-kitsap': require('./packs/wa-kitsap.js') };
const RULESETS = {
  federal: require('./rules/federal.js'),
  'wa-state': require('./rules/wa-state.js'),
  'wa-kitsap': require('./rules/wa-kitsap.js')
};

function parseArgs(argv) {
  const out = { _: [], project: {} };
  const map = { 'new-sqft': 'new_sqft', 'hard-surface': 'hard_surface_sqft', disturbance: 'disturbance_sqft', grading: 'grading_cy', bedrooms: 'bedrooms', lots: 'lots', wastewater: 'wastewater', water: 'water', type: 'type' };
  Object.keys(Engine.SCOPE_FIELDS).concat(['flood_rise_ft']).forEach(key => { map[key.replace(/_/g, '-')] = key; });
  const flags = { demo: 'demo', 'in-water': 'in_water', 'tree-clearing': 'tree_clearing', 'state-highway': 'state_highway_access' };
  ['federal_nexus', 'federal_operator', 'common_plan', 'floodplain_modification'].forEach(key => { flags[key.replace(/_/g, '-')] = key; });
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (k === 'json') out.json = true;
    else if (k === 'pack') out.pack = argv[++i];
    else if (k === 'point') out.point = argv[++i].split(',').map(Number);
    else if (flags[k]) out.project[flags[k]] = true;
    else if (map[k]) out.project[map[k]] = argv[++i];
    else throw new Error('Unknown option ' + a);
  }
  return out;
}

async function run(argv) {
  const args = parseArgs(argv);
  const pack = PACKS[args.pack || 'wa-kitsap'];
  if (!pack) throw new Error('Unknown pack ' + args.pack);
  let parcel;
  if (args.point) parcel = await pack.parcelAtPoint(args.point[0], args.point[1]);
  else {
    const q = args._.join(' ');
    if (!q) throw new Error('Give an address, tax account number or --point lon,lat');
    const hits = await pack.search(q);
    if (!hits.length) throw new Error('No parcel matched "' + q + '"');
    if (hits.length > 1 && !args.json) console.error('Multiple matches; using the first:\n' + hits.map((h) => '  ' + h.label + ' · ' + h.sublabel).join('\n'));
    parcel = await pack.parcelById(hits[0].parcel_key);
  }
  if (!parcel) throw new Error('No tax parcel found');
  const screening = await Screen.screenParcel(pack, parcel, {});
  const facts = pack.deriveFacts(screening);
  const constraints = RULESETS[pack.id].constraints(screening, facts, DATA, Engine.normaliseProject(args.project));
  const grid = Geo.gridAnalyze(parcel.shape, constraints, { targetSamples: 3000 });
  const rules = pack.rule_sets.flatMap((id) => RULESETS[id].rules);
  const report = Engine.evaluate({ facts, project: args.project, grid, rules, data: DATA });
  if (args.json) {
    const lean = { ...grid, cells: undefined };
    console.log(JSON.stringify({ facts, report, grid: lean, layers: Object.fromEntries(Object.entries(screening.layers).map(([k, v]) => [k, { status: v.status, error: v.error || null }])) }, null, 1));
  } else {
    console.log(Report.memo(report, facts, grid, screening, DATA));
  }
}

if (require.main === module) run(process.argv.slice(2)).catch((e) => { console.error('Error: ' + e.message); process.exit(1); });
module.exports = { run, parseArgs };
