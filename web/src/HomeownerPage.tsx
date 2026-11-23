import { useEffect, useState } from "react";
import { configure } from "./api";
import Landing from "./estimate/Landing";
import { parseEstimateLink, stripEstimateLink } from "./estimate/deepLink";

/*
 * Homeowner view at /homeowner: separate page, plain-language output, its own pricing.
 * Unlisted and not indexed until the professional directory side exists
 * (docs/PRODUCT_STRATEGY.md, decision 4).
 */
export default function HomeownerPage() {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof configure>> | null>(null);
  const [link] = useState(() => parseEstimateLink(window.location.search));
  useEffect(stripEstimateLink, []);
  useEffect(() => {
    let active = true;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
    const title = document.title;
    document.title = "Davapprove · What will my project's permits cost?";
    configure().then(value => { if (active) setConfig(value); });
    return () => { active = false; robots.remove(); document.title = title; };
  }, []);
  return <Landing audience="homeowner" config={config} initial={link} />;
}
