/*
 * Feature flags. See docs/PRODUCT_STRATEGY.md.
 *
 * Project management (projects, document ingestion, evidence review, dependency graph) is
 * hidden for the bid-assessment beta. Turn it on for a build with VITE_FEATURE_PROJECTS=true,
 * or for one browser by opening /?features=projects (and /?features=none to turn it off).
 */
const STORAGE_KEY = "davapprove.features";

function storedFeatures(): string[] {
  try {
    const param = new URLSearchParams(window.location.search).get("features");
    if (param !== null) {
      if (param === "none") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, param);
    }
    return (window.localStorage.getItem(STORAGE_KEY) || "").split(",").map(item => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function projectsEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_PROJECTS === "true" || storedFeatures().includes("projects");
}
