import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import type { Estimator, ParcelHit } from "../bidEngine";

/*
 * Address or parcel autocomplete over every supported county, using each county pack's own
 * fuzzy search (the same one the full report uses). Suggestions always require a choice.
 */
export default function AddressSearch({ estimator, onSelect, label = "Property address or parcel number", placeholder = "Start typing an address, e.g. 1234 Main St", autoFocus = false, value = "" }: {
  estimator: Estimator | null;
  onSelect: (hit: ParcelHit) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Text to show when a parcel was chosen elsewhere, for example from a shared link. */
  value?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState(value);
  useEffect(() => { if (value) setQuery(value); }, [value]);
  const [hits, setHits] = useState<ParcelHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(value: string) {
    const current = ++version.current;
    clearTimeout(timer.current);
    setActive(-1);
    if (value.trim().length < 3 || !estimator) {
      setHits([]); setOpen(false); setBusy(false);
      setMessage(value.trim().length && !estimator ? "Loading county records…" : "");
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        const result = await estimator.search(value.trim());
        if (current !== version.current) return;
        setHits(result.hits);
        setOpen(true);
        const notes = [];
        if (!result.hits.length) notes.push("No parcel matched. Try the house number and street name, or a full parcel number.");
        if (result.truncated) notes.push("Showing the closest matches; add more of the street name if yours is missing.");
        if (result.failed.length) notes.push(`${result.failed.join(" and ")} could not be searched right now.`);
        setMessage(notes.join(" "));
      } catch (error) {
        if (current !== version.current) return;
        setHits([]); setOpen(false);
        setMessage(error instanceof Error ? error.message : "Parcel search is unavailable right now.");
      } finally {
        if (current === version.current) setBusy(false);
      }
    }, 350);
  }

  function choose(hit: ParcelHit) {
    ++version.current;
    clearTimeout(timer.current);
    setQuery(hit.label);
    setOpen(false); setHits([]); setMessage(""); setBusy(false);
    onSelect(hit);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !hits.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(i => (i + 1) % hits.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(i => (i <= 0 ? hits.length - 1 : i - 1)); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(hits[active]); }
    else if (event.key === "Escape") setOpen(false);
  }

  const listId = `${id}-list`;
  return <div className="address-search">
    <label htmlFor={`${id}-input`} className="address-label">{label}</label>
    <div className="address-box">
      <Search size={20} aria-hidden="true" />
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={query}
        placeholder={placeholder}
        onChange={event => { setQuery(event.target.value); search(event.target.value); }}
        onKeyDown={onKeyDown}
      />
      {busy && <LoaderCircle className="spin" size={18} aria-label="Searching" />}
    </div>
    {open && hits.length > 0 && <ul id={listId} role="listbox" className="address-options" aria-label="Matching parcels">
      {hits.map((hit, index) => <li key={`${hit.county}:${hit.parcel_key}`} id={`${id}-option-${index}`} role="option" aria-selected={index === active}
        className={index === active ? "active" : ""} onMouseDown={event => { event.preventDefault(); choose(hit); }}>
        <MapPin size={16} aria-hidden="true" />
        <span><b>{hit.label}</b><small>{[hit.sublabel, hit.countyName].filter(Boolean).join(" · ")}</small></span>
      </li>)}
    </ul>}
    {message && <p className="address-message" role="status">{message}</p>}
  </div>;
}
