/*
 * Loads the bid assistant's own scripts (synced to /bid-assistant/ by scripts/sync_bid_assets.mjs)
 * so the estimate pages use exactly the same search, screening, rules and fee data as the
 * full report. Nothing here computes a number itself.
 */
import type { Audience } from "./pricing";

const SCRIPTS = [
  "lib/geo.js", "lib/arcgis.js", "lib/screen.js", "lib/engine.js", "lib/quick.js",
  "data/data.js", "data/regions.js", "lib/regions.js",
  "packs/wa-kitsap.js", "packs/wa-regional.js",
  "rules/federal.js", "rules/wa-state.js", "rules/wa-kitsap.js", "rules/wa-regional.js",
];

export type Level = "required" | "likely" | "possible" | "unknown";
export type ParcelHit = { label: string; sublabel?: string; parcel_key: string; county: string; countyName: string };
export type SearchResult = { hits: ParcelHit[]; failed: string[]; truncated: boolean };
export type EstimateSummary = {
  parcel: { key: string; label: string; jurisdiction: string; zoning: string | null };
  project_label: string;
  estimate: { low: number; high: number };
  possible: { low: number; high: number } | null;
  quotes_needed: number;
  agencies: { firm: number; possible: number; professionals: number; list: { name: string; tier: string; level: Level; role: string }[] };
  professionals: { name: string; level: Level; role: string }[];
  issues: { title: string; level: Level }[];
  coverage: { complete: boolean; unread_layers: string[] };
  unassessed_scope: { id: string; label: string }[];
  checked: string | null;
  screened_at: string;
};
export type ProjectBrief = Record<string, string | number | boolean | string[]> & { type: string; scope_items?: string[] };
export type ReportRequest = { county: string; parcel: string; label: string; project: ProjectBrief; audience: Audience };
export type Estimator = {
  counties: { id: string; name: string }[];
  scopeItems: Record<string, { label: string; group: string }>;
  projectTypes: Record<string, { label: string; new_sqft: number; hard_surface_sqft: number; disturbance_sqft: number; grading_cy: number; bedrooms: number; lots?: number }>;
  search(query: string): Promise<SearchResult>;
  estimate(hit: ParcelHit, project: ProjectBrief, onProgress?: (done: number, total: number) => void): Promise<EstimateSummary>;
};

type BidWindow = Window & Record<string, any>;
let loading: Promise<Estimator> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-bid-src="${src}"]`);
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", () => reject(new Error("The estimate engine could not be loaded. Check your connection and retry.")), { once: true });
    if (!existing) {
      script.src = `/bid-assistant/${src}`;
      script.async = false;
      script.dataset.bidSrc = src;
      document.head.appendChild(script);
    }
  });
}

export function loadEstimator(): Promise<Estimator> {
  if (!loading) loading = (async () => {
    for (const src of SCRIPTS) await loadScript(src);
    return createEstimator(window as BidWindow);
  })().catch(error => { loading = null; throw error; });
  return loading;
}

/** Exposed for tests: builds the estimator from already-loaded bid assistant globals. */
export function createEstimator(w: BidWindow): Estimator {
  const base = w.BID_DATA, Engine = w.BidEngine, Quick = w.BidQuick;
  const loader = w.BidRegions.create(base, w.BID_REGIONS, w.fetch.bind(w));
  const counties: { id: string; name: string }[] = base.meta.jurisdictions.filter((j: any) => j.available).map((j: any) => ({ id: j.id, name: j.name }));
  const contexts = new Map<string, Promise<{ pack: any; data: any }>>();
  function context(id: string) {
    if (!contexts.has(id)) contexts.set(id, loader.load(id).then((data: any) => ({
      data,
      pack: id === "wa-kitsap" ? w.BidPacks["wa-kitsap"] : w.BidRegionalPack.create(data.region),
    })).catch((error: Error) => { contexts.delete(id); throw error; }));
    return contexts.get(id)!;
  }
  return {
    counties,
    scopeItems: Quick.SCOPE_ITEMS,
    projectTypes: Engine.PROJECT_TYPES,
    async search(query) {
      const settled = await Promise.allSettled(counties.map(async county => {
        const { pack } = await context(county.id);
        const hits = await pack.search(query);
        return { county, hits: hits as any[], truncated: !!(hits as any).truncated };
      }));
      const failed: string[] = [];
      const hits: ParcelHit[] = [];
      let truncated = false;
      settled.forEach((result, index) => {
        if (result.status === "rejected") { failed.push(counties[index].name); return; }
        truncated = truncated || result.value.truncated;
        result.value.hits.slice(0, 6).forEach(hit => hits.push({ label: hit.label, sublabel: hit.sublabel, parcel_key: String(hit.parcel_key), county: result.value.county.id, countyName: result.value.county.name }));
      });
      if (failed.length === counties.length) throw new Error("Parcel search is unavailable right now. Retry in a moment.");
      return { hits: hits.slice(0, 10), failed, truncated };
    },
    async estimate(hit, project, onProgress) {
      const { pack, data } = await context(hit.county);
      const parcel = await pack.parcelById(hit.parcel_key);
      if (!parcel) throw new Error("That parcel could not be found in county records. It may be right-of-way, water or an untaxed tract.");
      const result = await Quick.analyze({ pack, data, rulesets: w.BidRuleSets, Screen: w.BidScreen, Geo: w.BidGeo, Engine }, parcel, project, {
        onProgress: (done: number, total: number) => onProgress?.(done, total),
      });
      return Quick.summarize(result, project, data);
    },
  };
}

/** Whole dollars; the full report shows the same figures with cents where a schedule has them. */
export function money(value: number) {
  return "$" + Math.round(value).toLocaleString("en-US");
}

export function range(low: number, high: number) {
  return Math.round(low) === Math.round(high) ? money(low) : `${money(low)} – ${money(high)}`;
}
