import type { ReactNode } from "react";
import {
  BatteryCharging, BrickWall, Droplets, Fan, Fence, Flame, Hammer, House, HousePlus, LayoutGrid,
  Minus, Plus, PlugZap, RotateCcw, Sun, AppWindow, Trees, Warehouse, Waves, Zap, Grid2x2, Bath,
} from "lucide-react";
import type { Estimator, ProjectBrief as Brief } from "../bidEngine";

export type Variant = "pro" | "plain";
type SiteWork = "light" | "typical" | "heavy";

/** Everything the describer collects. toProject() turns it into the engine's project input. */
export type BriefState = {
  type: string;
  new_sqft: number;
  bedrooms: number;
  lots: number;
  site: SiteWork;
  hard_surface_sqft: number;
  disturbance_sqft: number;
  grading_cy: number;
  water: string;
  wastewater: string;
  demo: boolean;
  tree_clearing: boolean;
  in_water: boolean;
  state_highway_access: boolean;
  federal_nexus: boolean;
  common_plan: boolean;
  floodplain_modification: boolean;
  construction_value: string;
  scope_items: string[];
};

const TYPES: Record<string, { icon: ReactNode; plain: string; hint: string; sizes?: number[]; rooms?: boolean }> = {
  new_sfr: { icon: <House />, plain: "Build a new home", hint: "Single-family house", sizes: [1500, 2000, 2500, 3000, 4000], rooms: true },
  adu: { icon: <HousePlus />, plain: "Add an ADU or backyard cottage", hint: "Detached accessory dwelling", sizes: [400, 600, 800, 1000], rooms: true },
  addition: { icon: <Hammer />, plain: "Add on or remodel", hint: "Addition or major remodel", sizes: [0, 200, 400, 600, 1000], rooms: true },
  accessory: { icon: <Warehouse />, plain: "Garage, shop or outbuilding", hint: "Accessory building", sizes: [400, 720, 1200, 2000] },
  rebuild: { icon: <RotateCcw />, plain: "Tear down and rebuild", hint: "Demolish and build new", sizes: [1500, 2000, 2500, 3000, 4000], rooms: true },
  shoreline_structure: { icon: <Waves />, plain: "Dock, bulkhead or shoreline work", hint: "In or beside the water" },
  short_plat: { icon: <LayoutGrid />, plain: "Divide the lot", hint: "Short plat into new lots" },
  clearing: { icon: <Trees />, plain: "Clear or grade land", hint: "Site work only" },
};

const SCOPE_ICONS: Record<string, ReactNode> = {
  solar: <Sun />, battery: <BatteryCharging />, ev_charger: <PlugZap />, electrical_service: <Zap />,
  heat_pump: <Fan />, water_heater: <Flame />, plumbing: <Bath />, roof: <Grid2x2 />,
  windows: <AppWindow />, deck: <LayoutGrid />, retaining_wall: <BrickWall />, fence: <Fence />,
};

const SITE_FACTOR: Record<SiteWork, number> = { light: 0.5, typical: 1, heavy: 2 };

export function defaultBrief(estimator: Estimator, type = "new_sfr", keep?: Partial<BriefState>): BriefState {
  const d = estimator.projectTypes[type] as any;
  return {
    type,
    new_sqft: d.new_sqft,
    bedrooms: d.bedrooms,
    lots: d.lots || 0,
    site: "typical",
    hard_surface_sqft: d.hard_surface_sqft,
    disturbance_sqft: d.disturbance_sqft,
    grading_cy: d.grading_cy,
    water: keep?.water || "unknown",
    wastewater: keep?.wastewater || "unknown",
    demo: !!d.demo,
    tree_clearing: !!d.tree_clearing,
    in_water: !!d.in_water,
    state_highway_access: keep?.state_highway_access || false,
    federal_nexus: keep?.federal_nexus || false,
    common_plan: keep?.common_plan || false,
    floodplain_modification: keep?.floodplain_modification || false,
    construction_value: keep?.construction_value || "",
    scope_items: keep?.scope_items || [],
  };
}

export function toProject(state: BriefState): Brief {
  const project: Brief = {
    type: state.type,
    new_sqft: state.new_sqft,
    bedrooms: state.bedrooms,
    lots: state.lots,
    hard_surface_sqft: state.hard_surface_sqft,
    disturbance_sqft: state.disturbance_sqft,
    grading_cy: state.grading_cy,
    water: state.water,
    wastewater: state.wastewater,
    demo: state.demo,
    tree_clearing: state.tree_clearing,
    in_water: state.in_water,
    state_highway_access: state.state_highway_access,
    federal_nexus: state.federal_nexus,
    common_plan: state.common_plan,
    floodplain_modification: state.floodplain_modification,
  };
  if (state.construction_value.trim() && Number(state.construction_value) > 0) project.construction_value = Number(state.construction_value);
  if (state.scope_items.length) project.scope_items = [...state.scope_items];
  return project;
}

function Choice({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (value: string) => void }) {
  return <div className="brief-field">
    <span className="brief-label" id={`choice-${label.replace(/\W+/g, "-")}`}>{label}</span>
    <div className="choice-row" role="radiogroup" aria-labelledby={`choice-${label.replace(/\W+/g, "-")}`}>
      {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} className={`choice ${value === key ? "on" : ""}`} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  </div>;
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <div className="brief-field">
    <span className="brief-label">{label}</span>
    <div className="stepper">
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus size={16} /></button>
      <output aria-live="polite" aria-label={label}>{value}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={16} /></button>
    </div>
  </div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" aria-pressed={checked} className={`chip ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>{label}</button>;
}

function NumberInput({ label, value, onChange, unit }: { label: string; value: number; onChange: (value: number) => void; unit: string }) {
  return <label className="brief-number">{label}
    <span><input type="number" min="0" inputMode="numeric" value={value} onChange={event => onChange(Math.max(0, Number(event.target.value) || 0))} />{unit}</span>
  </label>;
}

export default function ProjectBrief({ estimator, variant, value, onChange }: { estimator: Estimator; variant: Variant; value: BriefState; onChange: (value: BriefState) => void }) {
  const pro = variant === "pro";
  const meta = TYPES[value.type];
  const defaults = estimator.projectTypes[value.type];
  const set = (patch: Partial<BriefState>) => onChange({ ...value, ...patch });
  function setSite(site: SiteWork) {
    const f = SITE_FACTOR[site];
    set({ site, hard_surface_sqft: Math.round(defaults.hard_surface_sqft * f), disturbance_sqft: Math.round(defaults.disturbance_sqft * f), grading_cy: Math.round(defaults.grading_cy * f) });
  }
  function toggleScope(id: string) {
    set({ scope_items: value.scope_items.includes(id) ? value.scope_items.filter(item => item !== id) : [...value.scope_items, id] });
  }
  const sizeLabel = value.type === "addition" ? "New floor area added" : "New building size";

  return <div className="brief">
    <section className="brief-section">
      <h3>{pro ? "What's the project?" : "What do you want to do?"}</h3>
      <div className="type-grid" role="radiogroup" aria-label="Project type">
        {Object.keys(TYPES).filter(key => estimator.projectTypes[key]).map(key => <button key={key} type="button" role="radio" aria-checked={value.type === key}
          className={`type-tile ${value.type === key ? "on" : ""}`} onClick={() => onChange(defaultBrief(estimator, key, value))}>
          {TYPES[key].icon}
          <b>{pro ? estimator.projectTypes[key].label : TYPES[key].plain}</b>
          {!pro && <small>{TYPES[key].hint}</small>}
        </button>)}
      </div>
    </section>

    {(meta?.sizes || meta?.rooms || value.type === "short_plat") && <section className="brief-section">
      <h3>{pro ? "Size" : "How big?"}</h3>
      {meta?.sizes && <div className="brief-field">
        <span className="brief-label">{sizeLabel}</span>
        <div className="choice-row" role="radiogroup" aria-label={sizeLabel}>
          {meta.sizes.map(size => <button key={size} type="button" role="radio" aria-checked={value.new_sqft === size} className={`choice ${value.new_sqft === size ? "on" : ""}`} onClick={() => set({ new_sqft: size })}>
            {size === 0 ? "Remodel only" : `${size.toLocaleString()} sq ft`}
          </button>)}
        </div>
        {pro && <NumberInput label="Exact size" value={value.new_sqft} unit="sq ft" onChange={new_sqft => set({ new_sqft })} />}
      </div>}
      {meta?.rooms && <Stepper label={value.type === "addition" ? "Bedrooms added" : "Bedrooms"} value={value.bedrooms} min={0} max={8} onChange={bedrooms => set({ bedrooms })} />}
      {value.type === "short_plat" && <Stepper label="New lots" value={value.lots} min={2} max={9} onChange={lots => set({ lots })} />}
    </section>}

    <section className="brief-section">
      <h3>{pro ? "Utilities" : "How is the property served?"}</h3>
      <Choice label="Water" value={value.water} onChange={water => set({ water })} options={[["public", "Public water"], ["well_existing", "Existing well"], ["well_new", "New well"], ["unknown", "Not sure"]]} />
      <Choice label={pro ? "Wastewater" : "Sewer or septic"} value={value.wastewater} onChange={wastewater => set({ wastewater })} options={[["sewer", "Public sewer"], ["septic_existing", "Existing septic"], ["septic_new", "New septic"], ["unknown", "Not sure"]]} />
    </section>

    <section className="brief-section">
      <h3>{pro ? "Site work" : "How much site work?"}</h3>
      <Choice label={pro ? "Paving, roof area, clearing and grading" : "Digging, paving and clearing"} value={value.site} onChange={site => setSite(site as SiteWork)}
        options={[["light", "Light"], ["typical", "Typical"], ["heavy", "Heavy"]]} />
      {pro ? <details className="brief-details">
        <summary>Adjust site numbers</summary>
        <p className="hint">Planning assumptions, not measurements. Stormwater and grading thresholds depend on these numbers; the full report explains each one.</p>
        <div className="brief-numbers">
          <NumberInput label="New or replaced hard surface" value={value.hard_surface_sqft} unit="sq ft" onChange={hard_surface_sqft => set({ hard_surface_sqft })} />
          <NumberInput label="Land disturbed" value={value.disturbance_sqft} unit="sq ft" onChange={disturbance_sqft => set({ disturbance_sqft })} />
          <NumberInput label="Grading, cut plus fill" value={value.grading_cy} unit="cu yd" onChange={grading_cy => set({ grading_cy })} />
        </div>
      </details> : <p className="hint">We assume about {value.hard_surface_sqft.toLocaleString()} sq ft of new roof and paving and {value.disturbance_sqft.toLocaleString()} sq ft of disturbed ground.</p>}
      <div className="brief-field">
        <span className="brief-label">{pro ? "Site conditions" : "Will the project…"}</span>
        <div className="chip-row">
          <Toggle label={pro ? "Demolition of an existing structure" : "Tear down an existing building"} checked={value.demo} onChange={demo => set({ demo })} />
          <Toggle label={pro ? "Clearing of forested land" : "Clear trees or forest"} checked={value.tree_clearing} onChange={tree_clearing => set({ tree_clearing })} />
          <Toggle label={pro ? "Work at or below the high water line" : "Work in or at the water's edge"} checked={value.in_water} onChange={in_water => set({ in_water })} />
          <Toggle label={pro ? "Driveway onto a state highway" : "Add a driveway onto a state highway"} checked={value.state_highway_access} onChange={state_highway_access => set({ state_highway_access })} />
        </div>
      </div>
    </section>

    <section className="brief-section">
      <h3>{pro ? "Systems and upgrades" : "Anything else in the project?"}</h3>
      <p className="hint">Pick everything that applies. These help us flag permits; some are not priced yet and are listed separately.</p>
      <div className="scope-grid">
        {Object.entries(estimator.scopeItems).map(([id, item]) => <button key={id} type="button" aria-pressed={value.scope_items.includes(id)} className={`scope-chip ${value.scope_items.includes(id) ? "on" : ""}`} onClick={() => toggleScope(id)}>
          {SCOPE_ICONS[id] || <Droplets />}{item.label}
        </button>)}
      </div>
    </section>

    {pro && <section className="brief-section">
      <h3>Details that change fees</h3>
      <label className="brief-number wide">Estimated construction value (optional)
        <span>$<input type="number" min="0" step="1000" inputMode="numeric" placeholder="Bid valuation" value={value.construction_value} onChange={event => set({ construction_value: event.target.value })} /></span>
      </label>
      <div className="chip-row">
        <Toggle label="Other federal permit, funding or action" checked={value.federal_nexus} onChange={federal_nexus => set({ federal_nexus })} />
        <Toggle label="Part of a larger common development plan" checked={value.common_plan} onChange={common_plan => set({ common_plan })} />
        <Toggle label="Altering a floodplain or watercourse" checked={value.floodplain_modification} onChange={floodplain_modification => set({ floodplain_modification })} />
      </div>
    </section>}
  </div>;
}
