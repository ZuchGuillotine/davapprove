import { useRef, useEffect, type MouseEvent } from "react";

import { bidRequest } from "./bidStorage";

/** `report` opens a specific parcel and project brief (from the estimate pages) in a fresh frame. */
export default function BidWorkspace({ agencyName = "", accountKey = "", enabled = true, report = null }: { agencyName?: string; accountKey?: string; enabled?: boolean; report?: { hash: string; nonce: number } | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true;
    const versions = new Map<string, number>();
    let queue = Promise.resolve();
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== 'davapprove-bids' || typeof event.data.requestId !== 'string') return;
      const source = event.source as Window;
      const {requestId, operation, payload} = event.data;
      // Serialize writes and reject results crossing account or frame lifetimes.
      queue = queue.then(async () => {
        if (!active) return;
        try {
          if (!enabled) throw Error('Sign in to save and open private bids.');
          const result = await bidRequest(operation, payload || {}, versions, accountKey);
          if (active) source.postMessage({channel:'davapprove-bids-result',requestId,result},window.location.origin);
        } catch (error: any) {
          if (active) source.postMessage({channel:'davapprove-bids-result',requestId,error:error.message || 'Bid request failed'},window.location.origin);
        }
      });
    };
    window.addEventListener('message', handler);
    return () => { active = false; window.removeEventListener('message', handler); };
  }, [accountKey, enabled]);
  function prepareFullWorkspace(event: MouseEvent<HTMLAnchorElement>) {
    const target = new URL("/?workspace=bids", window.location.origin);
    let publisher = agencyName.trim().slice(0, 160);
    try {
      const params = new URLSearchParams(frame.current?.contentWindow?.location.hash.slice(1));
      const draft = params.get("draft");
      // Only the saved bid identifier crosses to the new workspace, never other fragment data.
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
  const initial = new URLSearchParams(window.location.hash.slice(1));
  const selected = initial.get("draft");
  const publisher = initial.has("agency") ? (initial.get("agency") || "") : agencyName;
  const parcel = initial.get("parcel");
  const directReport = parcel && /^[a-z0-9 .-]{3,50}$/i.test(parcel) && /^wa-(?:kitsap|king|skagit)$/.test(initial.get("county") || "")
    ? "#" + [...initial.entries()].filter(([name]) => ["parcel", "county", "project", "type"].includes(name))
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")
    : "";
  const agency = report ? report.hash : selected && /^[0-9a-f-]{36}$/i.test(selected) ? `#draft=${selected}` : directReport || (publisher ? `#agency=${encodeURIComponent(publisher.trim().slice(0, 160))}` : "");
  return <section className="bid-workspace" aria-label="Bids and assessments">
    <div className="bid-workspace-heading">
      <div><span className="eyebrow">BEFORE THE PROJECT BEGINS</span><h1>Bids &amp; assessments</h1>
        <p>Scope the agencies, studies and permitting allowance before committing to a design.</p></div>
      <a href={`/?workspace=bids${report ? "" : agency}`} target="_blank" rel="noopener" onClick={prepareFullWorkspace} onAuxClick={prepareFullWorkspace} onContextMenu={prepareFullWorkspace}>Open full workspace ↗</a>
    </div>
    <iframe key={accountKey + String(enabled) + (report ? report.nonce : "")} ref={frame} title="Early bid assessment workspace" src={`/bid-assistant/index.html?embedded=1${agency}`} allow="clipboard-write" />
  </section>;
}
