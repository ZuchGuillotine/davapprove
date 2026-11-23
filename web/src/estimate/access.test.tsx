import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { projectsEnabled } from "../features";
import { reportHash, savePendingReport, takePendingReport } from "../reportAccess";
import { createEstimator } from "../bidEngine";
import type { ReportRequest } from "../bidEngine";

vi.mock("../api", () => ({ configure: async () => ({ authAvailable: false }), getAuth: () => null, apiBase: "/api/v1" }));

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

it("parses MCP estimate links, including non-ASCII labels, and rejects tampered ones", async () => {
  const { parseEstimateLink, stripEstimateLink } = await import("./deepLink");
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const link = { county: "wa-king", parcel: "0123456789", label: "1 CAFÉ WAY", project: { type: "adu", scope_items: ["solar"] } };
  expect(parseEstimateLink("?estimate=" + encode(link))).toEqual(link);
  expect(parseEstimateLink("?estimate=" + encode({ ...link, project: { new_sqft: 1 } }))).toBeNull();
  expect(parseEstimateLink("?estimate=" + encode({ ...link, parcel: "x".repeat(41) }))).toBeNull();
  expect(parseEstimateLink("?estimate=not-base64!")).toBeNull();
  window.history.replaceState(null, "", "/?estimate=abc&listing=1");
  stripEstimateLink();
  expect(window.location.search).toBe("?listing=1");
});

it("talks to the engine service with the same estimator interface", async () => {
  const { createRemoteEstimator } = await import("../bidEngine");
  const calls: [string, RequestInit | undefined][] = [];
  const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(url), init]);
    if (String(url).endsWith("/engine/coverage")) return respond(200, { counties: [{ id: "wa-kitsap", name: "Kitsap County, WA" }, { id: "wa-king", name: "King County, Washington" }], scope_items: { solar: "Solar panels" }, project_type_defaults: { adu: { label: "ADU", new_sqft: 800 } } });
    if (String(url).includes("/engine/search")) return respond(200, { hits: [{ label: "1 A ST", sublabel: null, parcel_key: "7", county: "wa-kitsap", county_name: "Kitsap County, WA" }], failed_counties: ["wa-king"], truncated: false });
    if (String(url).endsWith("/estimate")) return respond(422, { detail: "Unsupported county", code: "unsupported_county" });
    return respond(404, {});
  });
  const estimator = await createRemoteEstimator("/api/v1", fetcher as typeof fetch);
  expect(estimator.scopeItems.solar.label).toBe("Solar panels");
  expect(estimator.projectTypes.adu.new_sqft).toBe(800);
  const result = await estimator.search("1 a st");
  expect(calls[1][0]).toBe("/api/v1/engine/search?q=1%20a%20st");
  expect(result).toEqual({ hits: [{ label: "1 A ST", sublabel: undefined, parcel_key: "7", county: "wa-kitsap", countyName: "Kitsap County, WA" }], failed: ["King County, Washington"], truncated: false });
  await expect(estimator.estimate(result.hits[0], { type: "adu" }, undefined, "homeowner")).rejects.toThrow("Unsupported county");
  expect(JSON.parse(String(calls[2][1]!.body))).toEqual({ county: "wa-kitsap", parcel: "7", project: { type: "adu" }, audience: "homeowner" });
});
