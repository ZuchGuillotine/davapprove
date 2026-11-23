import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { projectsEnabled } from "../features";
import { reportHash, savePendingReport, takePendingReport } from "../reportAccess";
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
