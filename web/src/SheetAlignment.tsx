import { useEffect, useState } from "react";
import type { Json, Project, DocumentRecord } from "./types";
import { loadSheetImage, request } from "./api";
import ParcelMap from "./ParcelMap";

const disciplines = ["survey", "septic", "ecology", "civil", "utilities", "architecture"];
const control = (i: number) => ({id:`P${i+1}`,label:`Control ${i+1}`,coordinates:["",""]});
export default function SheetAlignment({project, documents, onSaved}: {project:Project;documents:DocumentRecord[];onSaved:(p:Project)=>Promise<void>}) {
  const existing = (project as any).alignment;
  const [reference,setReference]=useState<Json>(existing?.reference || {id:crypto.randomUUID(),label:"Project survey reference",kind:"survey",crs:"EPSG:2285",accuracy_ft:null,document_id:"",page:1,source_revision:"",points:[0,1,2,3].map(control)});
  const [savedState,setSavedState]=useState<Json>(existing || {});
  const [sheet,setSheet]=useState<Json>({id:crypto.randomUUID(),document_id:"",page:1,discipline:"civil",design_revision:"",tolerance_ft:1,review_status:"proposed",pairs:[]});
  const [image,setImage]=useState(""); const [aspect,setAspect]=useState(1);
  const [imageZoom,setImageZoom]=useState(1);
  const [active,setActive]=useState(0); const [error,setError]=useState("");
  const [busy,setBusy]=useState(false); const [preview,setPreview]=useState<Json>();
  useEffect(()=>{
    if (!sheet.document_id) {setImage("");return;}
    const abort=new AbortController(); let url="";setImage("");setPreview(undefined);
    loadSheetImage(project.id,sheet.document_id,Number(sheet.page),abort.signal).then(value=>{url=value;if(!abort.signal.aborted)setImage(value);else URL.revokeObjectURL(value);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return ()=>{abort.abort();if(url)URL.revokeObjectURL(url);};
  },[project.id,sheet.document_id,sheet.page]);
  const body=(alignment:Json)=>({expected_revision:project.current_revision,alignment});
  const mutate=(change:Json)=>{setSheet(s=>({...s,...change,review_status:"proposed"}));setPreview(undefined);};
  async function saveReference() {
    setBusy(true);setError("");
    try {
      const doc=documents.find(d=>d.id===reference.document_id);
      const ref={...reference,document_sha256:doc?.sha256,accuracy_ft:reference.accuracy_ft === "" || reference.accuracy_ft == null ? null : Number(reference.accuracy_ft),points:reference.points.map((p:Json)=>{if(p.coordinates.some((v:any)=>v===""))throw Error("Enter coordinates for every control point.");return {...p,coordinates:p.coordinates.map(Number)};})};
      const state=await request(`/projects/${project.id}/alignment/preview`,"POST",body({reference:ref,registrations:savedState.registrations || []}));
      const p=await request(`/projects/${project.id}/alignment`,"POST",body(state));
      setSavedState(p.alignment);setReference(p.alignment.reference);setPreview(undefined);await onSaved(p);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  function alignmentInput(accepted=false) {
    if (!savedState.reference) throw Error("Save the shared reference first.");
    if (!sheet.document_id || !sheet.design_revision || !image) throw Error("Select a rendered source page and enter its revision.");
    const doc=documents.find(d=>d.id===sheet.document_id);
    const pairs=(sheet.pairs || []).filter((p:Json)=>p.use!=="ignore").map((p:Json)=>{if(p.sheet.some((v:any)=>v===""))throw Error("Match every control point.");return {...p,sheet:p.sheet.map(Number)};});
    const reg:Json={...sheet,pairs,document_sha256:doc?.sha256,reference_id:savedState.reference.id,reference_fingerprint:savedState.reference_fingerprint,sheet_height:aspect,review_status:accepted?"accepted":"proposed"};
    return {reference:savedState.reference,registrations:[...(savedState.registrations || []).filter((r:Json)=>!(r.document_id===reg.document_id && r.page===reg.page)),reg]};
  }
  async function fit(save=false,accepted=false) {
    setBusy(true);setError("");
    try {
      const input=alignmentInput(accepted);
      if (save) {const p=await request(`/projects/${project.id}/alignment`,"POST",body(input));setSavedState(p.alignment);setPreview(p.alignment);await onSaved(p);}
      else setPreview(await request(`/projects/${project.id}/alignment/preview`,"POST",body(input)));
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  function chooseSheet(id:string,page=1) {
    const old=savedState.registrations?.find((r:Json)=>r.document_id===id && r.page===page);
    setSheet(old || {id:crypto.randomUUID(),document_id:id,page,discipline:"civil",design_revision:"",tolerance_ft:1,review_status:"proposed",pairs:(savedState.reference?.points || []).map((p:Json,i:number)=>({point_id:p.id,sheet:["",""],use:i===3?"check":i<3?"fit":"ignore"}))});
    setActive(0);setImageZoom(1);setPreview(undefined);setError("");
  }
  const result=preview?.registrations?.find((r:Json)=>r.document_id===sheet.document_id && r.page===sheet.page);
  return <section className="panel alignment-panel"><h2>Align source sheets</h2><p>Set shared control points once, then match each drawing to them. Original pages and prior project revisions are retained.</p>
    <details open={!savedState.reference}><summary>1. Shared reference{savedState.reference ? ` · ${savedState.reference.label}` : " · not established"}</summary>
      <div className="alignment-fields"><label>Reference name<input value={reference.label} onChange={e=>setReference({...reference,label:e.target.value})}/></label>
      <label>Reference type<select value={reference.kind} onChange={e=>setReference({...reference,kind:e.target.value})}><option value="survey">Survey control</option><option value="screening">Approximate GIS / screening</option></select></label>
      <label>Coordinate system<select value={reference.crs} onChange={e=>setReference({...reference,crs:e.target.value})}><option value="EPSG:2285">WA North State Plane · US survey feet (EPSG:2285)</option><option value="EPSG:4326">WGS84 · longitude, latitude (EPSG:4326)</option></select></label>
      <label>Source document<select value={reference.document_id} onChange={e=>setReference({...reference,document_id:e.target.value})}><option value="">Choose imported survey</option>{documents.map(d=><option value={d.id} key={d.id}>{d.title || d.filename}</option>)}</select></label>
      <label>Source page<input type="number" min="1" value={reference.page} onChange={e=>setReference({...reference,page:Number(e.target.value)})}/></label>
      <label>Source revision<input value={reference.source_revision} onChange={e=>setReference({...reference,source_revision:e.target.value})}/></label>
      <label>Stated reference accuracy (ft; blank = unknown)<input type="number" min="0" step="any" value={reference.accuracy_ft ?? ""} onChange={e=>setReference({...reference,accuracy_ft:e.target.value})}/></label></div>
      <p>Enter coordinates for identifiable monuments, corners or other fixed controls. Use their actual datum and units. Do not label assessor GIS as a survey. Changing this reference invalidates earlier sheet registrations.</p>
      <table><thead><tr><th>Point</th><th>Description</th><th>{reference.crs==="EPSG:4326"?"Longitude":"Easting (ft)"}</th><th>{reference.crs==="EPSG:4326"?"Latitude":"Northing (ft)"}</th></tr></thead><tbody>{reference.points.map((p:Json,i:number)=><tr key={p.id}><td>{p.id}</td><td><input aria-label={`${p.id} description`} value={p.label} onChange={e=>setReference({...reference,points:reference.points.map((v:Json,j:number)=>j===i?{...v,label:e.target.value}:v)})}/></td>{[0,1].map(axis=><td key={axis}><input aria-label={`${p.id} coordinate ${axis+1}`} type="number" step="any" value={p.coordinates[axis]} onChange={e=>setReference({...reference,points:reference.points.map((v:Json,j:number)=>j===i?{...v,coordinates:v.coordinates.map((n:any,k:number)=>k===axis?e.target.value:n)}:v)})}/></td>)}</tr>)}</tbody></table>
      <button onClick={()=>setReference({...reference,points:[...reference.points,control(reference.points.length)]})} disabled={reference.points.length>=40}>Add control point</button> <button className="primary" disabled={busy} onClick={saveReference}>Save shared reference</button>
    </details>
    {savedState.reference && <><h3>2. Match a sheet to the reference</h3><div className="alignment-fields">
      <label>Source document<select value={sheet.document_id} onChange={e=>chooseSheet(e.target.value)}><option value="">Choose a drawing</option>{documents.map(d=><option key={d.id} value={d.id}>{d.title || d.filename}</option>)}</select></label>
      <label>Page<input type="number" min="1" max={documents.find(d=>d.id===sheet.document_id)?.page_count || 500} value={sheet.page} onChange={e=>chooseSheet(sheet.document_id,Number(e.target.value))}/></label>
      <label>Discipline<select value={sheet.discipline} onChange={e=>mutate({discipline:e.target.value})}>{disciplines.map(d=><option key={d}>{d}</option>)}</select></label>
      <label>Drawing revision<input value={sheet.design_revision} onChange={e=>mutate({design_revision:e.target.value})}/></label>
      <label>Control error tolerance (ft)<input type="number" step="any" min="0.01" max="100" value={sheet.tolerance_ft} onChange={e=>mutate({tolerance_ft:Number(e.target.value)})}/></label>
    </div>
    <p>Select a control row, then click the matching point on the original page. Keep at least one point as an independent check. Coordinates can also be entered precisely: x right, y up, origin bottom-left, both axes measured in page-width units.</p>
    <div className="alignment-workspace"><div>
      {image && <><label>Source zoom<input aria-label="Source zoom" type="range" min="1" max="6" step="0.5" value={imageZoom} onChange={e=>setImageZoom(Number(e.target.value))}/></label><div className="alignment-image-scroll"><div className="alignment-image" style={{width:`${imageZoom*100}%`}}><img src={image} alt="Original sheet — click to match the selected control" onLoad={e=>setAspect(e.currentTarget.naturalHeight/e.currentTarget.naturalWidth)} onClick={e=>{const b=e.currentTarget.getBoundingClientRect();const xy=[(e.clientX-b.left)/b.width,(b.bottom-e.clientY)/b.width];mutate({pairs:sheet.pairs.map((p:Json,i:number)=>i===active?{...p,sheet:xy}:p)});}}/>{sheet.pairs.map((p:Json,i:number)=>p.use!=="ignore" && p.sheet.every((x:any)=>x!=="") && <span key={p.point_id} style={{left:`${Number(p.sheet[0])*100}%`,bottom:`${Number(p.sheet[1])/aspect*100}%`}}>{i+1}</span>)}</div></div></>}
    </div><div><table><thead><tr><th>Match</th><th>Sheet X</th><th>Sheet Y</th><th>Use</th></tr></thead><tbody>{sheet.pairs.map((p:Json,i:number)=><tr key={p.point_id}><td><button aria-pressed={active===i} onClick={()=>setActive(i)}>{i+1}. {savedState.reference.points.find((r:Json)=>r.id===p.point_id)?.label || p.point_id}</button></td>{[0,1].map(axis=><td key={axis}><input aria-label={`${p.point_id} sheet ${axis===0?"X":"Y"}`} type="number" step="any" value={p.sheet[axis]} onChange={e=>mutate({pairs:sheet.pairs.map((v:Json,j:number)=>j===i?{...v,sheet:v.sheet.map((n:any,k:number)=>k===axis?e.target.value:n)}:v)})}/></td>)}<td><select aria-label={`${p.point_id} control use`} value={p.use} onChange={e=>mutate({pairs:sheet.pairs.map((v:Json,j:number)=>j===i?{...v,use:e.target.value}:v)})}><option value="fit">Fit</option><option value="check">Check</option><option value="ignore">Not on this sheet</option></select></td></tr>)}</tbody></table>
    <button disabled={busy || !image} onClick={()=>fit()}>Preview alignment</button>
    {result && <div className="site-evidence"><strong>{result.status.replaceAll("_"," ")}</strong><p>Fit RMS: {result.fit_rms_ft?.toFixed(2) ?? "—"} ft · Independent check: {result.check_max_ft?.toFixed(2) ?? "—"} ft · Reference accuracy: {result.accuracy_ft == null?"unknown":`${result.accuracy_ft} ft`}</p>{result.issues.map((issue:string)=><p key={issue}>{issue}</p>)}{result.residuals?.map((r:Json)=><p key={r.point_id}>{r.point_id} · {r.use}: {r.error_ft.toFixed(2)} ft</p>)}</div>}
    <button disabled={busy || !result?.transform} onClick={()=>fit(true)}>Save needs-review alignment</button> <button disabled={busy || result?.status!=="proposed"} onClick={()=>fit(true,true)}>Accept alignment after source review</button>
    <p>Accepting alignment positions this sheet. Feature acceptance, source approvals and construction status remain separate.</p></div></div>
    {result?.transform && <ParcelMap projectId={project.id} parcel={project.parcel} sample={false} envelope={{alignment:{...preview,registrations:[result]}}}/>}
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
