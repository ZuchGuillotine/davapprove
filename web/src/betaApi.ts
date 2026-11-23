import { getAuth } from "./api";

export async function betaApi<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const credential = token ?? (await getAuth()?.auth.getSession())?.data.session?.access_token;
  const headers: Record<string, string> = {};
  if (credential) headers.Authorization = `Bearer ${credential}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/beta-api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Beta access is temporarily unavailable.");
  return data;
}
