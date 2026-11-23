import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, HardHat, Info, LoaderCircle, MapPin, Pencil, Tag, TriangleAlert, Users } from "lucide-react";
import { loadEstimator, range, money, type EstimateSummary, type Estimator, type ParcelHit, type ReportRequest } from "../bidEngine";
import type { Audience } from "../pricing";
import { PLANS } from "../pricing";
import AddressSearch from "./AddressSearch";
import CoverageRequest from "./CoverageRequest";
import ProjectBrief, { defaultBrief, toProject, type BriefState } from "./ProjectBrief";
import "./estimate.css";

const PLAIN_LEVEL: Record<string, string> = { required: "Will be involved", likely: "Probably involved", possible: "May be involved", unknown: "Couldn't check" };

/*
 * Address -> project description -> basic estimate -> full report request.
 * The parent decides what "full report" means for the current visitor (email capture,
 * pricing prompt or straight to the report).
 */
export default function EstimateFlow({ audience, onFullReport, onPricing, loader = loadEstimator }: {
  audience: Audience;
  onFullReport: (request: ReportRequest) => void;
  onPricing: () => void;
  loader?: () => Promise<Estimator>;
}) {
  const [estimator, setEstimator] = useState<Estimator | null>(null);
  const [loadError, setLoadError] = useState("");
  const [hit, setHit] = useState<ParcelHit | null>(null);
  const [brief, setBrief] = useState<BriefState | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<EstimateSummary | null>(null);
  const [ranFor, setRanFor] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(true);
  const runVersion = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const plain = audience === "homeowner";

  useEffect(() => {
    let active = true;
    loader().then(value => { if (active) { setEstimator(value); setBrief(defaultBrief(value)); } })
      .catch(err => { if (active) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, [loader]);

  const briefKey = brief ? JSON.stringify(toProject(brief)) : "";
  const stale = !!summary && ranFor !== `${hit?.county}:${hit?.parcel_key}:${briefKey}`;

  async function run() {
    if (!estimator || !hit || !brief) return;
    const version = ++runVersion.current;
    const project = toProject(brief);
    setError(""); setRunning({ done: 0, total: 1 });
    try {
      const result = await estimator.estimate(hit, project, (done, total) => { if (version === runVersion.current) setRunning({ done, total }); });
      if (version !== runVersion.current) return;
      setSummary(result);
      setRanFor(`${hit.county}:${hit.parcel_key}:${JSON.stringify(project)}`);
      setEditing(false);
      setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
    } catch (err) {
      if (version === runVersion.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (version === runVersion.current) setRunning(null);
    }
  }

  function requestReport() {
    if (!hit || !brief || !summary) return;
    onFullReport({ county: hit.county, parcel: hit.parcel_key, label: summary.parcel.label, project: toProject(brief), audience });
  }

  if (loadError) return <div className="estimate-card error-card" role="alert"><TriangleAlert size={18} /> {loadError} <button className="secondary" onClick={() => window.location.reload()}>Retry</button></div>;

  return <div className={`estimate-flow ${plain ? "plain" : "pro"}`}>
    <div className="estimate-card search-card">
      <AddressSearch estimator={estimator} autoFocus onSelect={value => { setHit(value); setSummary(null); setEditing(true); setError(""); }}
        label={plain ? "Where is the property?" : "Property address or parcel number"} />
      <p className="estimate-coverage"><MapPin size={14} /> Kitsap, King, Skagit and Pierce counties, Washington. More counties are on the way.</p>
      <CoverageRequest />
    </div>

    {hit && estimator && brief && <>
      {summary && !editing ? <div className="estimate-card brief-summary">
        <div><span className="eyebrow">PROJECT</span><b>{summary.project_label}</b>
          <small>{[brief.new_sqft ? `${brief.new_sqft.toLocaleString()} sq ft` : "", brief.scope_items.length ? `${brief.scope_items.length} upgrade${brief.scope_items.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</small></div>
        <button className="secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Change project details</button>
      </div> : <div className="estimate-card">
        <div className="selected-parcel"><MapPin size={16} /><span><b>{hit.label}</b><small>{[hit.sublabel, hit.countyName].filter(Boolean).join(" · ")}</small></span></div>
        <ProjectBrief estimator={estimator} variant={plain ? "plain" : "pro"} value={brief} onChange={setBrief} />
        <div className="run-row">
          <button className="primary run-button" disabled={!!running} onClick={run}>
            {running ? <><LoaderCircle className="spin" size={17} /> Checking agencies and maps…</> : <>{summary ? "Update estimate" : plain ? "See what it might cost" : "Get estimate"} <ArrowRight size={17} /></>}
          </button>
          {running && <div className="run-progress" role="status" aria-live="polite">
            <div className="bar"><span style={{ width: `${Math.round(100 * running.done / Math.max(1, running.total))}%` }} /></div>
            Reading public map layers {running.total > 1 ? `${running.done} of ${running.total}` : ""}
          </div>}
        </div>
      </div>}
      {error && <div className="estimate-card error-card" role="alert"><TriangleAlert size={18} /> Could not complete the estimate: {error}</div>}
    </>}

    {summary && <div ref={resultRef}>
      {plain ? <PlainResult summary={summary} stale={stale} onFullReport={requestReport} onPricing={onPricing} />
        : <ProResult summary={summary} stale={stale} onFullReport={requestReport} onPricing={onPricing} />}
    </div>}
  </div>;
}

function Coverage({ summary, plain }: { summary: EstimateSummary; plain: boolean }) {
  if (summary.coverage.complete) return <span className="stat ok"><Info size={15} /> {plain ? "All the maps we use were read" : "All map layers read"}</span>;
  const unread = summary.coverage.unread_layers.length;
  return <span className="stat warn"><TriangleAlert size={15} /> {unread
    ? (plain ? `${unread} map${unread === 1 ? "" : "s"} couldn't be read, so the range may be low` : `${unread} map layer${unread === 1 ? "" : "s"} could not be read · range may be low`)
    : (plain ? "Some local rules here still need a person to check" : "Coverage incomplete · local buffers or jurisdiction unresolved")}</span>;
}

function StaleNote({ stale }: { stale: boolean }) {
  return stale ? <p className="stale-note" role="status">Project details changed. Update the estimate to refresh this range.</p> : null;
}

function ProResult({ summary, stale, onFullReport, onPricing }: { summary: EstimateSummary; stale: boolean; onFullReport: () => void; onPricing: () => void }) {
  const price = PLANS.pro[0];
  return <section className="estimate-card result-card" aria-labelledby="estimate-range-title">
    <div className="result-parcel"><b>{summary.parcel.label}</b><span>{[summary.parcel.jurisdiction, summary.parcel.zoning, summary.project_label].filter(Boolean).join(" · ")}</span></div>
    <span className="eyebrow" id="estimate-range-title">PERMITTING AND PRE-CONSTRUCTION ALLOWANCE</span>
    <p className="result-range">{range(summary.estimate.low, summary.estimate.high)}</p>
    {summary.possible && <p className="result-possible">Plus up to {money(summary.possible.high)} in possible allowances if site conditions trigger them.</p>}
    <div className="stat-row">
      <span className="stat"><Users size={15} /> {summary.agencies.firm} agencies and districts{summary.agencies.possible ? ` · ${summary.agencies.possible} possible` : ""}</span>
      {summary.quotes_needed > 0 && <span className="stat warn"><Tag size={15} /> {summary.quotes_needed} item{summary.quotes_needed === 1 ? "" : "s"} need quotes · not included</span>}
      <Coverage summary={summary} plain={false} />
    </div>
    {summary.unassessed_scope.length > 0 && <p className="unpriced-note">Not separately estimated yet: {summary.unassessed_scope.map(item => item.label).join(", ")}.</p>}
    <StaleNote stale={stale} />
    <div className="result-actions">
      <button className="primary" onClick={onFullReport} disabled={stale}><FileText size={17} /> Open the full report</button>
      <button className="text-link" onClick={onPricing}>Pricing: {price.price} {price.cadence} · free during beta</button>
    </div>
    <p className="fine-print">The full report lists every agency, study and fee behind this range, with the code sections and fee schedules they come from. Screening estimate from public maps and published fee schedules{summary.checked ? ` (sources checked ${summary.checked})` : ""}. Not an approval, a determination or a quote.</p>
  </section>;
}

function PlainResult({ summary, stale, onFullReport, onPricing }: { summary: EstimateSummary; stale: boolean; onFullReport: () => void; onPricing: () => void }) {
  const price = PLANS.homeowner[0];
  const shown = summary.agencies.list.slice(0, 6);
  return <section className="estimate-card result-card" aria-labelledby="estimate-range-title">
    <div className="result-parcel"><b>{summary.parcel.label}</b><span>{summary.parcel.jurisdiction}</span></div>
    <span className="eyebrow" id="estimate-range-title">PERMITS, FEES AND REQUIRED STUDIES</span>
    <p className="result-range">{range(summary.estimate.low, summary.estimate.high)}</p>
    <p className="result-possible">A typical range for a {summary.project_label.toLowerCase()} on this property{summary.possible ? `, and it could run up to ${money(summary.possible.high)} more if the site needs extra review` : ""}. This is not construction cost.</p>
    <div className="stat-row"><Coverage summary={summary} plain />
      {summary.quotes_needed > 0 && <span className="stat warn"><Tag size={15} /> {summary.quotes_needed} cost{summary.quotes_needed === 1 ? "" : "s"} need a quote and aren't included</span>}</div>
    <StaleNote stale={stale} />

    {summary.issues.length > 0 && <div className="plain-block">
      <h3>What this project will likely need</h3>
      <ul className="plain-list">{summary.issues.slice(0, 6).map(issue => <li key={issue.title}>{issue.title}</li>)}</ul>
    </div>}

    <div className="plain-block">
      <h3>Who's involved</h3>
      <ul className="party-list">{shown.map(party => <li key={party.name}><span className={`level ${party.level}`}>{PLAIN_LEVEL[party.level]}</span><b>{party.name}</b>{party.role && <small>{party.role}</small>}</li>)}</ul>
      {summary.agencies.list.length > shown.length && <p className="hint">+ {summary.agencies.list.length - shown.length} more in the full report.</p>}
    </div>

    {summary.professionals.length > 0 && <div className="plain-block">
      <h3>Professionals you may need</h3>
      <ul className="plain-list">{summary.professionals.slice(0, 6).map(pro => <li key={pro.name}>{pro.name}</li>)}</ul>
    </div>}

    {summary.unassessed_scope.length > 0 && <p className="unpriced-note">We don't price these yet, so they aren't in the range: {summary.unassessed_scope.map(item => item.label.toLowerCase()).join(", ")}.</p>}

    <div className="result-actions">
      <button className="primary" onClick={onFullReport} disabled={stale}><FileText size={17} /> Get the full report · {price.price}</button>
      <button className="text-link" onClick={onPricing}>Free during the beta</button>
    </div>

    <div className="directory-teaser">
      <HardHat size={20} />
      <div><b>Local builders and architects who work in {summary.parcel.jurisdiction.replace(/^Unincorporated /, "")}</b>
        <p>Coming soon: matched pros who can firm up these numbers. <a href="/?listing=1">Are you a pro? Join the founding directory.</a></p></div>
    </div>
    <p className="fine-print">Based on public maps and published fee schedules{summary.checked ? ` checked ${summary.checked}` : ""}. Agencies make the final decisions; this is a planning estimate, not an approval or a quote.</p>
  </section>;
}
