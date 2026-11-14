import { beforeEach, expect, it, vi } from "vitest";
import { configure, documentUrl, loadSheetImage, invalidateRequests, request, setSampleMode } from "./api";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getSession } }) }));

beforeEach(async () => {
  vi.resetAllMocks(); setSampleMode(false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    mode: "supabase", supabase_url: "https://example.supabase.co", publishable_key: "public-test-key",
  }) }));
  getSession.mockResolvedValue({ data: { session: { access_token: "test-user-token" } } });
  await configure();
});

it("sends only the signed-in user's token to the workspace API", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ projects: [] }) });
  vi.stubGlobal("fetch", fetcher);
  await expect(request("/projects")).resolves.toEqual({ projects: [] });
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/projects"), expect.objectContaining({ headers: { Authorization: "Bearer test-user-token" } }));
});

it("rejects responses that arrive after the workspace identity changes", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
  const result = request("/projects");
  const rejected = expect(result).rejects.toThrow("Workspace changed");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  invalidateRequests();
  resolve({ ok: true, status: 200, json: async () => ({ projects: [{ id: "previous-user" }] }) });
  await rejected;
});

it("does not send a pending request using the previous session after sign-out", async () => {
  let resolve!: (value: unknown) => void;
  getSession.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const result = request("/projects");
  const rejected = expect(result).rejects.toThrow("Workspace changed");
  invalidateRequests(); resolve({ data: { session: { access_token: "old-token" } } });
  await rejected; expect(fetcher).not.toHaveBeenCalled();
});

it("discards a private document link whose body finishes after sign-out", async () => {
  let resolve!: (value: unknown) => void;
  const json = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/json" }, json }));
  const result = documentUrl("project", "document");
  const rejected = expect(result).rejects.toThrow("Workspace changed");
  await vi.waitFor(() => expect(json).toHaveBeenCalled());
  invalidateRequests(); resolve({ url: "https://example.com/private-signed-document" });
  await rejected;
});

it("discards private sheet image bytes after a session change", async () => {
  let resolve!: (value: unknown) => void;
  const blob = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob }));
  const result = loadSheetImage("project", "document", 1);
  const rejected = expect(result).rejects.toThrow("Workspace changed");
  await vi.waitFor(() => expect(blob).toHaveBeenCalled());
  invalidateRequests(); resolve(new Blob(["private image"]));
  await rejected;
});
