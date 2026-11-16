import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "./api";
import type { Json } from "./types";

type Hit = { parcel_number: string; label: string; city?: string };
/** Search identity first. Only fetch geometry after the user chooses the intended parcel. */
export default function ParcelSearch({ onSelected, onChange, sample = false }: {
  onSelected: (parcel: Json) => void; onChange: () => void; sample?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { version.current++; active.current?.abort(); }, []);
  function cancel() { version.current++; active.current?.abort(); }
  async function select(number: string) {
    cancel();
    const current = version.current;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setMessage("Loading parcel boundary and jurisdiction…");
    try {
      const parcel = await request("/parcels/lookup", "POST", { parcel_number: number }, controller.signal);
      if (current !== version.current) return;
      setHits([]); setMessage(""); onSelected(parcel);
    } catch (e) { if (current === version.current) { setError((e as Error).message); setMessage(""); } }
    finally { if (current === version.current) setBusy(false); }
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    const value = query.trim();
    if (value.length < 3) return;
    cancel(); onChange(); setHits([]); setError("");
    // Complete IDs skip suggestions and work for parcels with no assigned street address.
    if (/^(?:\d{7}|\d{14})$/.test(value.replace(/[\s-]/g, "")) || sample) { await select(value); return; }
    const current = version.current;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage("Searching county address records…");
    try {
      const result = await request<{ results: Hit[]; truncated: boolean }>("/parcels/search", "POST", { query: value }, controller.signal);
      if (current !== version.current) return;
      setHits(result.results);
      setMessage(result.results.length ? (result.truncated ? "Showing closest matches from a limited result. Refine the street or use the parcel number if yours is missing." : "Select the intended parcel to confirm its boundary.") : "No matching address. Try the house number and street name, or a complete parcel number. Vacant parcels may not have an address.");
    } catch (e) { if (current === version.current) { setError((e as Error).message); setMessage(""); } }
    finally { if (current === version.current) setBusy(false); }
  }
  return <form onSubmit={search} aria-label="Find property">
    <label>Address or parcel number<input autoFocus value={query} maxLength={160} required minLength={3}
      placeholder="602 Alder Ave NE or tax parcel number" onChange={e => {
        cancel(); setQuery(e.target.value); setHits([]); setMessage(""); setError(""); setBusy(false); onChange();
      }} /></label>
    <small>Kitsap County · street address, 14-digit tax parcel number, or 7-digit assessor account ID.</small>
    <button className="secondary full" disabled={busy || query.trim().length < 3}>{busy ? "Searching…" : "Look up property"}</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!!hits.length && <ul className="parcel-search-results" aria-label="Matching parcels">{hits.map(hit => <li key={hit.parcel_number}>
      <button type="button" className="secondary full" disabled={busy} onClick={() => select(hit.parcel_number)}>
        {hit.label}{hit.city ? `, ${hit.city}` : ""} · {hit.parcel_number}
      </button>
    </li>)}</ul>}
  </form>;
}
