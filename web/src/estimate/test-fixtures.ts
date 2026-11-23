import { vi } from "vitest";
import type { EstimateSummary, Estimator } from "../bidEngine";

/* A synthetic estimator for UI tests. Shapes match bid-assistant/lib/quick.js; values are made up. */
export const PROJECT_TYPES = {
  new_sfr: { label: "New single-family home", new_sqft: 2400, hard_surface_sqft: 4500, disturbance_sqft: 14000, grading_cy: 120, bedrooms: 3 },
  adu: { label: "Accessory dwelling unit (detached)", new_sqft: 800, hard_surface_sqft: 1400, disturbance_sqft: 5000, grading_cy: 40, bedrooms: 1 },
  addition: { label: "Addition or major remodel", new_sqft: 600, hard_surface_sqft: 700, disturbance_sqft: 2500, grading_cy: 20, bedrooms: 1 },
  short_plat: { label: "Short plat (divide into lots)", new_sqft: 0, hard_surface_sqft: 6000, disturbance_sqft: 30000, grading_cy: 300, bedrooms: 0, lots: 2 },
};

export function summary(over: Partial<EstimateSummary> = {}): EstimateSummary {
  return {
    parcel: { key: "123", label: "1 SYNTHETIC RD", jurisdiction: "Unincorporated Kitsap County", zoning: "RR · Rural Residential" },
    project_label: "Accessory dwelling unit (detached)",
    estimate: { low: 12345.4, high: 23456.6 },
    possible: { low: 1000, high: 4000 },
    quotes_needed: 2,
    agencies: { firm: 4, possible: 2, professionals: 1, list: [
      { name: "Synthetic County Permit Center", tier: "local", level: "required", role: "Building and land use permits" },
      { name: "Synthetic Health District", tier: "local", level: "likely", role: "Septic and well review" },
      { name: "Synthetic State Agency", tier: "state", level: "possible", role: "Water work" },
    ] },
    professionals: [{ name: "Wetland biologist", level: "likely", role: "Delineation" }],
    issues: [{ title: "Mapped wetland within the review distance", level: "likely" }],
    coverage: { complete: false, unread_layers: ["Flood hazard"] },
    unassessed_scope: [{ id: "solar", label: "Solar panels" }],
    checked: "2026-11-15",
    screened_at: "2026-11-23T00:00:00Z",
    ...over,
  };
}

export function fakeEstimator(result: EstimateSummary = summary()) {
  const estimator = {
    counties: [{ id: "wa-kitsap", name: "Kitsap County, Washington" }, { id: "wa-king", name: "King County, Washington" }],
    scopeItems: { solar: { label: "Solar panels", group: "electrical" }, heat_pump: { label: "Heat pump, furnace or HVAC", group: "mechanical" } },
    projectTypes: PROJECT_TYPES as any,
    search: vi.fn(async () => ({
      hits: [{ label: "1 SYNTHETIC RD", sublabel: "Parcel 123", parcel_key: "123", county: "wa-kitsap", countyName: "Kitsap County, Washington" }],
      failed: ["King County, Washington"],
      truncated: false,
    })),
    estimate: vi.fn(async (_hit, _project, onProgress?: (done: number, total: number) => void) => { onProgress?.(3, 6); return result; }),
  };
  return estimator as typeof estimator & Estimator;
}
