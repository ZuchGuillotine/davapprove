import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoRequest } from "./demo";
import type { Json } from "./types";
export const apiBase =
  (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api/v1";
let sample = false;
let client: SupabaseClient | null = null;
let requestGeneration = 0;
export function invalidateRequests() {
  requestGeneration++;
}
export function setSampleMode(value: boolean) {
  if (sample !== value) invalidateRequests();
  sample = value;
}
export function getAuth() {
  return client;
}
export async function configure() {
  let config: Json = {};
  try {
    const r = await fetch(apiBase + "/config", {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) config = await r.json();
  } catch {
    /* Explicit sample mode remains available; never silently treat failure as live. */
  }
  const url = import.meta.env.VITE_SUPABASE_URL || config.supabase_url;
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || config.publishable_key;
  client = url && key ? createClient(url, key) : null;
  return {
    ...config,
    connected: !!config.mode,
    authAvailable: !!client,
    email_delivery_enabled:
      config.email_delivery_enabled === undefined
        ? import.meta.env.VITE_EMAIL_DELIVERY_ENABLED === "true"
        : config.email_delivery_enabled === true,
  };
}
export async function request<T = any>(
  path: string,
  method = "GET",
  body?: any,
): Promise<T> {
  const generation = requestGeneration;
  if (sample) return demoRequest(path, method, body);
  const session = client ? await client.auth.getSession() : null;
  const token = session?.data.session?.access_token;
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch(apiBase + path, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  if (!r.ok) {
    let error: Json = {};
    try {
      error = await r.json();
    } catch {
      /* Response may be a proxy error. */
    }
    throw Error(
      typeof error.detail === "string"
        ? error.detail
        : `Request failed (${r.status}). Please try again.`,
    );
  }
  const result = r.status === 204 ? undefined : await r.json();
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  return result as T;
}
export function safeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export async function documentUrl(projectId: string, documentId: string) {
  const generation = requestGeneration;
  const { data } = getAuth()
    ? await getAuth()!.auth.getSession()
    : { data: { session: null } };
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  const r = await fetch(
    `${apiBase}/projects/${projectId}/documents/${documentId}/file`,
    {
      headers: data.session
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {},
    },
  );
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  if (!r.ok) throw Error("The document could not be opened.");
  if (r.headers.get("content-type")?.includes("application/json")) {
    const value = await r.json();
    if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
    const url = safeUrl(value.url);
    if (!url) throw Error("Invalid document URL.");
    return url;
  }
  const blob = await r.blob();
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  return URL.createObjectURL(blob);
}

export async function loadSheetImage(projectId: string, documentId: string, page: number, signal?: AbortSignal): Promise<string> {
  const generation = requestGeneration;
  const session = client ? await client.auth.getSession() : null;
  const token = session?.data.session?.access_token;
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  const r = await fetch(`${apiBase}/projects/${projectId}/documents/${documentId}/pages/${page}/image`, {
    headers: token ? {Authorization: `Bearer ${token}`} : {}, signal,
  });
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  if (!r.ok) throw Error("Unable to render this source page. Check that document processing has finished.");
  const blob = await r.blob();
  if (generation !== requestGeneration) throw Error("Workspace changed. Please try again.");
  return URL.createObjectURL(blob);
}
