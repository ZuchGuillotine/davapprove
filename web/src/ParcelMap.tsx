import { useEffect, useState } from "react";
import DrawingSheets from "./DrawingSheets";
import { loadSheetImage } from "./api";
import type { Json } from "./types";

const colors: Record<string, string> = { septic: "#985eaa", ecology: "#27836b", civil: "#b16e25", utilities: "#347fc0", architecture: "#4859a5", survey: "#65706c", unassigned: "#747474" };
export default function ParcelMap({ parcel, envelope, sample, projectId }: { parcel: Json; envelope?: Json; sample: boolean; projectId?: string }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [revision, setRevision] = useState("all");
  const [hiddenSheets, setHiddenSheets] = useState<string[]>([]);
  const [images, setImages] = useState<Record<string,string>>({});
  const [imageError, setImageError] = useState("");
  const [opacity, setOpacity] = useState(0.35);
  const [selected, setSelected] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState([0, 0]);
  const drawingSheets: Json[] = envelope?.drawing_sheets || [];
  const layers: Json[] = envelope?.layers || envelope?.constraints || [];
  const sheets: Json[] = envelope?.alignment?.registrations || [];
  const disciplines = [...new Set([...layers,...sheets].map(l => l.discipline || "unassigned"))];
  const revisions = [...new Set([...layers,...sheets].map(l => l.design_revision || "Unspecified"))];
  const visible = (l:Json) => !hidden.includes(l.discipline || "unassigned") && (revision === "all" || (l.design_revision || "Unspecified") === revision);
  const visibleSheets = sheets.filter(r=>visible(r) && !hiddenSheets.includes(r.id) && r.transform);
  const imageKey=JSON.stringify(visibleSheets.map(r=>[r.id,r.document_id,r.page,r.document_sha256]));
  useEffect(()=>{
    const abort=new AbortController(); const urls:string[]=[];setImages({});setImageError("");
    if (!projectId || sample) return;
    const entries: any[]=JSON.parse(imageKey);
    // Load serially; previews are cached and never trigger document extraction.
    void (async()=>{for (const [id,doc,page] of entries) {
      if(abort.signal.aborted)break;
      try {const url=await loadSheetImage(projectId,doc,page,abort.signal);urls.push(url);if(abort.signal.aborted)URL.revokeObjectURL(url);else setImages(old=>({...old,[id]:url}));}
      catch(e){if(!abort.signal.aborted)setImageError((e as Error).message);}
    }})();
    return ()=>{abort.abort();urls.forEach(URL.revokeObjectURL);};
  },[imageKey,projectId,sample]);
  const geometry = parcel.geometry?.type === "Feature" ? parcel.geometry.geometry : parcel.geometry;
  const coordinates: number[][] = [];
  function walk(a: any) { if (Array.isArray(a) && typeof a[0] === "number" && a.every(Number.isFinite)) coordinates.push(a); else if (Array.isArray(a)) a.forEach(walk); }
  walk(geometry?.coordinates);
  const xs = coordinates.map(c => c[0]), ys = coordinates.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const factor = Math.cos((minY + maxY) / 2 * Math.PI / 180);
  const width = (maxX - minX) * factor || 1, height = maxY - minY || 1;
  const scale = Math.min(480 / width, 280 / height);
  const project = (p: number[]) => [300 + ((p[0] - minX) * factor - width / 2) * scale, 180 - (p[1] - minY - height / 2) * scale];
  function path(g: any): string {
    if (g?.type === "LineString") return g.coordinates.map((c: number[], i: number) => (i ? "L" : "M") + project(c).join(",")).join(" ");
    if (g?.type === "MultiLineString") return g.coordinates.map((c: number[][]) => path({type:"LineString",coordinates:c})).join(" ");
    if (g?.type === "Point") { const [x,y]=project(g.coordinates); return `M${x-3},${y}h6 M${x},${y-3}v6`; }
    if (g?.type === "MultiPoint") return g.coordinates.map((c:number[]) => path({type:"Point",coordinates:c})).join(" ");
    const polygons = g?.type === "MultiPolygon" ? g.coordinates : g?.type === "Polygon" ? [g.coordinates] : [];
    return polygons.flatMap((poly: number[][][]) => poly.map(ring => ring.map((c, i) => (i ? "L" : "M") + project(c).join(",")).join(" ") + " Z")).join(" ");
  }
  const active = [...layers,...sheets].find(l => l.id === selected);
  function imageMatrix(r:Json) {
    const [tl,tr,bl]=r.image_corners.map(project);
    return `matrix(${tr[0]-tl[0]} ${tr[1]-tl[1]} ${(bl[0]-tl[0])/r.sheet_height} ${(bl[1]-tl[1])/r.sheet_height} ${tl[0]} ${tl[1]})`;
  }
  const conflicts: Json[] = envelope?.spatial_conflicts || [];
  return <div className="site-viewer">
    {envelope?.rendering_summary && <p className="site-note">{envelope.rendering_summary.sheet_features} drawing features rendered on {envelope.rendering_summary.sheets} source pages · {envelope.rendering_summary.provisional_site_features} automatically placed on GIS for review. Provisional placements do not change envelope calculations.</p>}
    {!layers.length && <DrawingSheets sheets={drawingSheets} projectId={projectId} sample={sample}/>}

    <div className="site-toolbar" aria-label="Discipline layers">
      {disciplines.map(d => <label key={d}><input type="checkbox" checked={!hidden.includes(d)} onChange={() => setHidden(h => h.includes(d) ? h.filter(x => x !== d) : [...h, d])} />{d}</label>)}
      {!!revisions.length && <label>Drawing revision<select aria-label="Drawing revision" value={revision} onChange={e=>setRevision(e.target.value)}><option value="all">All revisions — compare</option>{revisions.map(r=><option key={r} value={r}>{r}</option>)}</select></label>}
      {!!sheets.length && <label>Sheet opacity<input aria-label="Sheet opacity" type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label>}
      <button onClick={() => setZoom(z => Math.min(8, z * 1.4))} aria-label="Zoom in">+</button>
      <button onClick={() => setZoom(z => Math.max(1, z / 1.4))} aria-label="Zoom out">−</button>
      <button onClick={() => { setZoom(1); setOffset([0, 0]); }}>Fit parcel</button>
      {[["←", -40, 0], ["→", 40, 0], ["↑", 0, -40], ["↓", 0, 40]].map(([label, x, y]) => <button key={label} aria-label={`Pan ${label}`} onClick={() => setOffset(o => [o[0] + Number(x), o[1] + Number(y)])}>{label}</button>)}
    </div>
    {coordinates.length ? <svg className="site-canvas" viewBox="0 0 600 360" aria-label="Interactive site envelope" role="img">
      <rect width="600" height="360" fill="#eef1e9" />
      <g transform={`translate(${300 + offset[0]} ${180 + offset[1]}) scale(${zoom}) translate(-300 -180)`}>
        <path d={path(geometry)} fill="#dfe7d8" stroke="#526953" strokeWidth="2" fillRule="evenodd" />
        {visibleSheets.map(r=><g key={r.id}><title>{r.discipline} · {r.design_revision} · {r.status} · Check error {r.check_max_ft?.toFixed(2)} ft</title>{images[r.id] && <image href={images[r.id]} width="1" height={r.sheet_height} transform={imageMatrix(r)} opacity={opacity} preserveAspectRatio="none"/>}<path d={r.image_corners ? path({type:"Polygon",coordinates:[[r.image_corners[0],r.image_corners[1],[r.image_corners[1][0]+r.image_corners[2][0]-r.image_corners[0][0],r.image_corners[1][1]+r.image_corners[2][1]-r.image_corners[0][1]],r.image_corners[2],r.image_corners[0]]]}) : ""} fill="none" stroke={colors[r.discipline] || colors.unassigned} strokeDasharray={r.status==="reviewed"?undefined:"5 4"} onClick={()=>setSelected(r.id)}/></g>)}
        {(envelope?.alignment?.reference_points || []).map((p:Json)=><g key={p.id}><circle cx={project(p.lonlat)[0]} cy={project(p.lonlat)[1]} r="3" fill="#243c55"/><text x={project(p.lonlat)[0]+5} y={project(p.lonlat)[1]} fontSize="9">{p.id}</text></g>)}
        {envelope?.geometry && <path d={path(envelope.geometry)} fill="#dcba6566" stroke="#ad924e" fillRule="evenodd" />}
        {envelope?.proposed_geometry && <path d={path(envelope.proposed_geometry)} fill="none" stroke="#4859a5" strokeDasharray="6 4" />}
        {layers.filter(visible).map((l, i) => <path key={l.id || i} d={path(l.geometry)} fill={/Polygon/.test(l.geometry?.type || "") ? colors[l.discipline] || colors.unassigned : "none"} fillOpacity={l.review_status === "accepted" ? 0.23 : 0.10} stroke={colors[l.discipline] || colors.unassigned} strokeWidth={selected === l.id ? 4 : 2} strokeDasharray={l.review_status === "accepted" ? undefined : "6 4"} fillRule="evenodd" onClick={() => setSelected(l.id)}><title>{l.label} · {l.review_status}</title></path>)}
        {conflicts.map(c => <path key={c.id} d={path(c.geometry)} fill="#d4323266" stroke="#b82323" strokeDasharray="2 2" fillRule="evenodd"><title>{c.message}</title></path>)}
      </g><text x="560" y="25" fontSize="13">N ↑</text>
    </svg> : <p>No parcel geometry available.</p>}
    <p className="site-note">{sample ? "Illustrative geometry" : "GIS boundary · approximate"} · Solid: accepted · Dashed / pale shading: needs review · Red: coordination conflict. Layer visibility does not change calculations.</p>
    {imageError && <p role="status" className="site-note">{imageError}</p>}
    {!!sheets.length && <div className="site-layer-list">{sheets.map(r=><label key={r.id}><input type="checkbox" checked={!hiddenSheets.includes(r.id)} onChange={()=>setHiddenSheets(h=>h.includes(r.id)?h.filter(id=>id!==r.id):[...h,r.id])}/><button onClick={()=>setSelected(r.id)}>{r.discipline} · {r.design_revision} · Page {r.page} · {r.status}</button></label>)}</div>}
    <div className="site-layer-list">{layers.map((l, i) => <button key={l.id || i} aria-pressed={selected === l.id} onClick={() => setSelected(l.id)}>{l.label || "Site feature"} · {l.review_status || "proposed"}</button>)}</div>
    {active && <div className="site-evidence"><strong>{active.label || `${active.discipline} sheet ${active.page}`}</strong>{active.placement && <p>{active.placement.warning} Shape overlap: {(active.placement.fit.overlap_ratio*100).toFixed(1)}% · perimeter mismatch: {active.placement.fit.perimeter_error_ft.toFixed(1)} ft. These are fit diagnostics, not positional accuracy.</p>}{active.transform && <p>Alignment: {active.status} · Fit RMS {active.fit_rms_ft?.toFixed(2)} ft · Independent check {active.check_max_ft?.toFixed(2)} ft · Reference accuracy {active.accuracy_ft == null ? "unknown" : `${active.accuracy_ft} ft`}</p>}{(active.issues || active.alignment_issues || []).map((issue:string)=><p key={issue}>{issue}</p>)}<p>{active.discipline || "Unassigned"} · {active.role} · {active.review_status} · {active.work_stage || "Stage unspecified"}</p><p>Source revision: {active.design_revision || "unknown"} · Sheet/page: {active.sheet || active.page || "unknown"} · Accuracy: {active.accuracy || "unspecified"}</p><p>Source decision: {active.source_decision || "unknown"} · Installation: {active.installation_status || "unknown"}</p>{/^https?:\/\//i.test(active.source_url || "") && <a href={active.source_url} target="_blank" rel="noreferrer">Open source</a>}{active.document_id && <p>Document: {active.document_id}</p>}</div>}
    {!!envelope?.conflicts?.length && <div className="site-conflicts" role="status"><strong>Coordination conflicts — all layers</strong>{envelope.conflicts.map((c: string, i: number) => <p key={i}>{c}</p>)}</div>}
    {!!layers.length && <DrawingSheets sheets={drawingSheets} projectId={projectId} sample={sample}/> }
    {!drawingSheets.length && (envelope?.drawing_previews || []).map((d: Json) => <DrawingPreview key={d.id} drawing={d} />)}
    {!!envelope?.document_geometry?.length && <details className="site-evidence"><summary>Why documents may not appear on the map</summary>{envelope.document_geometry.map((d: Json) => <div key={d.document_id}><strong>{d.title}</strong><p>{d.geometry_facts} extracted geometry features. {d.geometry_facts === 0 && d.reason}</p>{d.processing_warning && <p>{d.processing_warning}</p>}</div>)}</details>}
    {!layers.length && <p className="site-note">Features without a site anchor are visible in the imported drawing workspace. Review or supply sheet alignment to place them geographically. No setback or buffer distance is assumed.</p>}
  </div>;
}

function DrawingPreview({ drawing: d }: { drawing: Json }) {
  const ring: number[][] = d.sheet_geometry?.type === "Point" ? [d.sheet_geometry.coordinates] : d.sheet_geometry?.type === "LineString" ? d.sheet_geometry.coordinates : d.sheet_geometry?.coordinates?.[0] || [];
  if (!ring.length) return null;
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  const w = Math.max(...xs) - x || 1, h = Math.max(...ys) - y || 1;
  const scale = Math.min(280 / w, 140 / h);
  return <details className="site-evidence"><summary>{d.label} · Drawing calibration: {d.calibration?.replaceAll("_", " ")}</summary>
    <p>Document {d.document_id} · Page {d.page} · Sheet {d.sheet || "unknown"} · Revision {d.design_revision || "unknown"}</p>
    <svg viewBox="0 0 320 180" role="img" aria-label={`${d.label} sheet preview — not geographic placement`}><path d={d.sheet_geometry?.type === "Point" ? "M17,160h6 M20,157v6" : ring.map((p, i) => `${i ? "L" : "M"}${20+(p[0]-x)*scale},${160-(p[1]-y)*scale}`).join(" ")+(d.sheet_geometry?.type === "Polygon" ? " Z" : "")} fill={d.sheet_geometry?.type === "Polygon" ? "#dce3ef" : "none"} stroke="#4859a5" strokeDasharray="5 3" /></svg>
    <p>Sheet outline only · {d.feet_per_sheet_unit ? `${Number(d.feet_per_sheet_unit).toFixed(2)} ft per sheet unit` : "Scale unresolved"} · Control residual: {d.control_residual_ft == null ? "unknown" : `${Number(d.control_residual_ft).toFixed(2)} ft`}</p>
    {(d.dimensions || []).map((v: Json, i: number) => <p key={i}>Dimension evidence: {v.notation}</p>)}
    {(d.issues || []).map((v: string, i: number) => <p key={i}>{v}</p>)}
    <p>Review source controls and dimensions before accepting site placement.</p>
  </details>;
}
