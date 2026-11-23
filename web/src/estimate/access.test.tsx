import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { projectsEnabled } from "../features";
import { reportHash, savePendingReport, takePendingReport } from "../reportAccess";
import { createEstimator } from "../bidEngine";
import type { ReportRequest } from "../bidEngine";

vi.mock("../api", () => ({ configure: async () => ({ authAvailable: false }), getAuth: () => null }));

beforeEach(() => { cleanup(); window.localStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => vi.unstubAllEnvs());

it("hides project management unless the build or this browser turns it on", () => {
  vi.stubEnv("VITE_FEATURE_PROJECTS", "false");
  expect(projectsEnabled()).toBe(false);
  window.history.replaceState(null, "", "/?features=projects");
  expect(projectsEnabled()).toBe(true);
  window.history.replaceState(null, "", "/");
  expect(projectsEnabled()).toBe(true);
  window.history.replaceState(null, "", "/?features=none");
  expect(projectsEnabled()).toBe(false);
  vi.stubEnv("VITE_FEATURE_PROJECTS", "true");
  expect(projectsEnabled()).toBe(true);
});

const request: ReportRequest = { county: "wa-king", parcel: "0123456789", label: "1 TEST AVE", audience: "pro", project: { type: "addition", new_sqft: 0, scope_items: ["solar", "heat_pump"] } };

it("builds a report fragment the assessment frame decodes exactly", () => {
  const hash = reportHash(request, "Smith & Sons + Co");
  const params: Record<string, string> = {};
  // Same parsing as bid-assistant/app.js.
  hash.slice(1).split("&").forEach(kv => { const i = kv.indexOf("="); params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  expect(params.county).toBe("wa-king");
  expect(params.parcel).toBe("0123456789");
  expect(params.agency).toBe("Smith & Sons + Co");
  expect(JSON.parse(params.project)).toEqual(request.project);
});

it("hands a pending report across the email link once, and drops stale or malformed ones", () => {
  savePendingReport(request);
  expect(takePendingReport()).toEqual(request);
  expect(takePendingReport()).toBeNull();
  window.localStorage.setItem("davapprove.pending-report", JSON.stringify({ ...request, at: Date.now() - 8 * 24 * 3600 * 1000 }));
  expect(takePendingReport()).toBeNull();
  window.localStorage.setItem("davapprove.pending-report", JSON.stringify({ county: "wa-king", at: Date.now() }));
  expect(takePendingReport()).toBeNull();
  window.localStorage.setItem("davapprove.pending-report", "{not json");
  expect(takePendingReport()).toBeNull();
});

function bidGlobals(searches: Record<string, () => Promise<any[]>>) {
  const pack = (id: string) => ({ id, search: vi.fn(searches[id]), parcelById: vi.fn() });
  const kitsap = pack("wa-kitsap");
  return {
    BID_DATA: { meta: { jurisdictions: [{ id: "wa-kitsap", name: "Kitsap", available: true }, { id: "wa-king", name: "King", available: true }, { id: "wa-pierce", name: "Pierce", available: false }] } },
    BID_REGIONS: {},
    BidRegions: { create: () => ({ load: async (id: string) => ({ region: { id } }) }) },
    BidPacks: { "wa-kitsap": kitsap },
    BidRegionalPack: { create: (region: { id: string }) => pack(region.id) },
    BidEngine: { PROJECT_TYPES: {} },
    BidQuick: { SCOPE_ITEMS: {} },
    fetch: vi.fn(),
  };
}

it("searches every available county, labels results and reports a county that failed", async () => {
  const estimator = createEstimator(bidGlobals({
    "wa-kitsap": async () => [{ label: "1 A ST", sublabel: "Parcel 1", parcel_key: 1 }],
    "wa-king": async () => { throw new Error("offline"); },
  }) as any);
  expect(estimator.counties.map(c => c.id)).toEqual(["wa-kitsap", "wa-king"]);
  const result = await estimator.search("1 a st");
  expect(result.hits).toEqual([{ label: "1 A ST", sublabel: "Parcel 1", parcel_key: "1", county: "wa-kitsap", countyName: "Kitsap" }]);
  expect(result.failed).toEqual(["King"]);
});

it("never turns a failed search everywhere into 'no match'", async () => {
  const estimator = createEstimator(bidGlobals({
    "wa-kitsap": async () => { throw new Error("offline"); },
    "wa-king": async () => { throw new Error("offline"); },
  }) as any);
  await expect(estimator.search("1 a st")).rejects.toThrow(/unavailable/);
});

it("serves the homeowner page unindexed with plain-language copy", async () => {
  const { default: HomeownerPage } = await import("../HomeownerPage");
  const { unmount } = render(<HomeownerPage />);
  expect(screen.getByRole("heading", { name: /See what permits your project needs/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "For builders and architects" })).toHaveAttribute("href", "/");
  await waitFor(() => expect(document.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull());
  unmount();
  expect(document.querySelector('meta[name="robots"]')).toBeNull();
});
