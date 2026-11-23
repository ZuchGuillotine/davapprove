import type { Audience } from "./pricing";
import { betaApi } from "./betaApi";

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

export async function loadEstimator(): Promise<Estimator> {
  const meta = await betaApi<Pick<Estimator, "counties" | "scopeItems" | "projectTypes">>("meta");
  return {
    ...meta,
    search: query => betaApi<SearchResult>("search", { query }),
    estimate: ({ county, parcel_key }, project) => betaApi<EstimateSummary>("estimate", { county, parcel: parcel_key, project }),
  };
}

/** Whole dollars; the full report shows the same figures with cents where a schedule has them. */
export function money(value: number) {
  return "$" + Math.round(value).toLocaleString("en-US");
}

export function range(low: number, high: number) {
  return Math.round(low) === Math.round(high) ? money(low) : `${money(low)} – ${money(high)}`;
}
