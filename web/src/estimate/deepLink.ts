import type { ProjectBrief } from "../bidEngine";

/* Shared estimate links: /?estimate=<base64url JSON {county, parcel, label, project}>. */
export type EstimateLink = { county: string; parcel: string; label: string; project: ProjectBrief };

export function parseEstimateLink(search: string): EstimateLink | null {
  const raw = new URLSearchParams(search).get("estimate");
  if (!raw || raw.length > 4000) return null;
  try {
    const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, c => c.charCodeAt(0))));
    if (!value || typeof value.county !== "string" || typeof value.parcel !== "string" || value.parcel.length > 40) return null;
    if (!value.project || typeof value.project !== "object" || typeof value.project.type !== "string") return null;
    return { county: value.county, parcel: value.parcel, label: typeof value.label === "string" ? value.label.slice(0, 200) : "", project: value.project };
  } catch {
    return null;
  }
}

/** Removes the link from the address bar after it has been read, so a refresh does not re-run it. */
export function stripEstimateLink() {
  if (!new URLSearchParams(window.location.search).has("estimate")) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("estimate");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
