import { useState } from "react";
import { betaApi } from "../betaApi";

type County = { code: string; state: string; name: string };

export default function CoverageRequest() {
  const [counties, setCounties] = useState<County[]>([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function show() {
    setOpen(true);
    if (counties.length || busy) return;
    setBusy(true);
    setStatus("");
    try {
      setCounties(await betaApi<County[]>("counties"));
    } catch {
      setStatus("The county list could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await betaApi<{ supported: boolean }>("coverage", { county_code: code });
      setStatus(result.supported
        ? "This county is in the beta. Try the street address or county parcel number above."
        : "Thanks. We’ve recorded the county for future coverage.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the coverage request.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="text-link" type="button" aria-expanded={open} onClick={() => open ? setOpen(false) : void show()}>
      Property in a different county?
    </button>
    {open && <form className="brief-grid" onSubmit={submit}>
      <label>State or territory
        <select value={state} disabled={!counties.length || busy} onChange={event => { setState(event.target.value); setCode(""); setStatus(""); }} required>
          <option value="">Select a state</option>
          {[...new Set(counties.map(item => item.state))].sort().map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label>County or county equivalent
        <select value={code} disabled={!state || busy} onChange={event => { setCode(event.target.value); setStatus(""); }} required>
          <option value="">Select a county</option>
          {counties.filter(item => item.state === state).sort((a, b) => a.name.localeCompare(b.name))
            .map(item => <option value={item.code} key={item.code}>{item.name}</option>)}
        </select>
      </label>
      <button className="secondary" disabled={!code || busy}>Check coverage</button>
      <p role="status">{status}</p>
    </form>}
  </>;
}
