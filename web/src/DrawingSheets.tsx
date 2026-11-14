import { useEffect, useState } from 'react';
import { loadSheetImage } from './api';
import type { Json } from './types';

const colors:Record<string,string>={survey:'#566b5b',civil:'#a45b14',septic:'#8246a0',ecology:'#087b58',architecture:'#3d51ac',utilities:'#167aac'};
function outline(g:Json):string {
  if(g?.type==='Point'){const [x,y]=g.coordinates;return `M${x-.003},${y}h.006 M${x},${y-.003}v.006`;}
  if(g?.type==='MultiPoint')return g.coordinates.map((c:any)=>outline({type:'Point',coordinates:c})).join(' ');
  if(g?.type==='LineString')return g.coordinates.map((p:number[],i:number)=>(i?'L':'M')+p.join(',')).join(' ');
  if(g?.type==='Polygon')return g.coordinates.map((r:number[][])=>outline({type:'LineString',coordinates:r})+' Z').join(' ');
  if(g?.type==='MultiPolygon')return g.coordinates.map((c:any)=>outline({type:'Polygon',coordinates:c})).join(' ');
  if(g?.type==='MultiLineString')return g.coordinates.map((c:any)=>outline({type:'LineString',coordinates:c})).join(' ');
  return '';
}
export default function DrawingSheets({sheets,projectId,sample}:{sheets:Json[];projectId?:string;sample:boolean}) {
  const [choice,setChoice]=useState('');const [selected,setSelected]=useState('');
  const [image,setImage]=useState('');const [aspect,setAspect]=useState(1);const [error,setError]=useState('');
  const [source,setSource]=useState(true);const [zoom,setZoom]=useState(1);const [hidden,setHidden]=useState<string[]>([]);
  const sheet=sheets.find(s=>s.id===choice)||sheets[0];
  const identity=sheet ? `${sheet.document_id}:${sheet.page}:${sheet.document_sha256}` : '';
  useEffect(()=>{
    setImage('');setError('');setAspect(1);setZoom(1);setSelected('');setHidden([]);
    const abort=new AbortController();let url='';
    if(projectId && sheet?.document_id && !sample)void loadSheetImage(projectId,sheet.document_id,sheet.page,abort.signal).then(u=>{
      url=u;if(abort.signal.aborted)URL.revokeObjectURL(u);else setImage(u);
    }).catch(e=>{if(!abort.signal.aborted)setError((e as Error).message);});
    return ()=>{abort.abort();if(url)URL.revokeObjectURL(url);};
  },[identity,projectId,sample]);
  if(!sheet)return null;
  const features:Json[]=sheet.features||[];const active=features.find(f=>f.id===selected);
  const disciplines=[...new Set(features.map(f=>f.discipline||'unassigned'))];
  let ymax=1;for(const f of features){const walk=(a:any)=>{if(Array.isArray(a)&&typeof a[0]==='number')ymax=Math.max(ymax,a[1]+.02);else if(Array.isArray(a))a.forEach(walk);};walk(f.sheet_geometry?.coordinates);}
  const height=image?aspect:Math.max(aspect,ymax);
  return <section className="drawing-workspace" aria-label="Imported drawing workspace">
    <h3>Imported drawings · provisional overlays</h3>
    <p>{sheets.reduce((n,s)=>n+(s.features?.length||0),0)} extracted features across {sheets.length} source pages. Sheet coordinates render immediately; geographic placement is a separate step.</p>
    <div className="site-toolbar">
      <label>Source drawing<select aria-label="Source drawing" value={sheet.id} onChange={e=>setChoice(e.target.value)}>{sheets.map(s=><option key={s.id} value={s.id}>{s.title} · Page {s.page} · {s.features.length} features</option>)}</select></label>
      <label><input type="checkbox" checked={source} onChange={e=>setSource(e.target.checked)}/>Show original page</label>
      <button onClick={()=>setZoom(z=>Math.min(5,z*1.4))}>Enlarge drawing</button><button onClick={()=>setZoom(1)}>Fit drawing</button>
      {disciplines.map(d=><label key={d}><input type="checkbox" checked={!hidden.includes(d)} onChange={()=>setHidden(h=>h.includes(d)?h.filter(x=>x!==d):[...h,d])}/>{d} outlines</label>)}
    </div>
    {image && <img src={image} alt="" hidden onLoad={e=>{const i=e.currentTarget;if(i.naturalWidth)setAspect(i.naturalHeight/i.naturalWidth);}}/>}
    {error && <p role="status">Original page unavailable: {error}. Extracted outlines remain visible.</p>}
    <div className="drawing-scroll"><svg style={{width:`${zoom*100}%`,minWidth:'100%'}} viewBox={`0 0 1000 ${1000*height}`} role="img" aria-label="Extracted geometry on source sheet">
      <rect width="1000" height={1000*height} fill="#f5f4ef"/>
      {image&&source&&<image href={image} width="1000" height={1000*aspect} opacity=".75" preserveAspectRatio="none"/>}
      <g transform={`translate(0 ${1000*height}) scale(1000 -1000)`}>
        {features.filter(f=>!hidden.includes(f.discipline||'unassigned')).map(f=><path key={f.id} data-feature-id={f.id} d={outline(f.sheet_geometry)}
          fill={/Polygon/.test(f.sheet_geometry?.type||'')?(colors[f.discipline]||'#666'):'none'} fillOpacity={selected===f.id?'.3':'.12'}
          stroke={colors[f.discipline]||'#666'} strokeWidth={selected===f.id?4:2} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" fillRule="evenodd"
          onClick={()=>setSelected(f.id)}><title>{f.label} · needs review · {f.geometry?'provisional site placement available':'sheet coordinates'}</title></path>)}
      </g>
    </svg></div>
    <p className="site-note">Dashed outlines are extracted observations requiring review. Page {sheet.page} · {sheet.located_features||0} of {features.length} features have a site placement. Source-page positions are not surveyed coordinates.</p>
    <label>Inspect drawing feature<select aria-label="Inspect drawing feature" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select an outline</option>{features.map(f=><option key={f.id} value={f.id}>{f.label||'Extracted outline'}</option>)}</select></label>
    {active&&<div className="site-evidence"><strong>{active.label}</strong><p>{active.discipline} · {active.sheet||`Page ${sheet.page}`} · Revision {active.design_revision||'unknown'}</p>
      <p>{active.placement?.warning||'Sheet placement only; confirm orientation, scale and a site anchor before geographic use.'}</p>
      {(active.dimensions||[]).map((d:Json,i:number)=><p key={i}>Dimension: {d.notation}</p>)}
      {(active.issues||[]).map((issue:string,i:number)=><p key={i}>{issue}</p>)}
    </div>}
  </section>;
}
