import { useRef, type MouseEvent } from "react";

export default function BidWorkspace({ agencyName = "" }: { agencyName?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  function prepareFullWorkspace(event: MouseEvent<HTMLAnchorElement>) {
    const target = new URL("/bid-assistant/index.html", window.location.origin);
    let publisher = agencyName.trim().slice(0, 160);
    try {
      const params = new URLSearchParams(frame.current?.contentWindow?.location.hash.slice(1));
      const draft = params.get("draft");
      // Only the local draft identifier crosses to the standalone route, never other fragment data.
      if (draft && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft)) {
        target.hash = new URLSearchParams({ draft }).toString();
        event.currentTarget.href = target.href;
        return;
      }
      if (params.has("agency")) publisher = (params.get("agency") || "").trim().slice(0, 160);
    } catch {
      // A not-yet-ready or inaccessible iframe falls back to the account's company default.
    }
    if (publisher) target.hash = `agency=${encodeURIComponent(publisher)}`;
    event.currentTarget.href = target.href;
  }
  const agency = agencyName ? `#agency=${encodeURIComponent(agencyName.trim().slice(0, 160))}` : "";
  return <section className="bid-workspace" aria-label="Bids and assessments">
    <div className="bid-workspace-heading">
      <div><span className="eyebrow">BEFORE THE PROJECT BEGINS</span><h1>Bids &amp; assessments</h1>
        <p>Scope the agencies, studies and permitting allowance before committing to a design.</p></div>
      <a href={`/bid-assistant/index.html${agency}`} target="_blank" rel="noopener" onClick={prepareFullWorkspace} onAuxClick={prepareFullWorkspace} onContextMenu={prepareFullWorkspace}>Open full workspace ↗</a>
    </div>
    <iframe ref={frame} title="Early bid assessment workspace" src={`/bid-assistant/index.html?embedded=1${agency}`} allow="clipboard-write" />
  </section>;
}
