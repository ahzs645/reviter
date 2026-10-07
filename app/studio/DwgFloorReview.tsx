"use client";
import type { ReviterGlobal } from './types.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DwgBuildingModel,type CadPathPreview } from './DwgBuildingModel.tsx';
import type { CadBuildingScene } from '../../lib/reviter/dwg-building-scene.ts';

export function DwgFloorReview({onClose,initialFile}:{onClose:()=>void;initialFile?:File|null}){
 const [document,setDocument]=useState<string|null>(null),[status,setStatus]=useState('Open the separate Reviter CAD analysis ZIP to compare buildings, floors, doors and stair evidence.');
 const [busy,setBusy]=useState(false),[coverage,setCoverage]=useState('');
 const [audit,setAudit]=useState<unknown>(null);
 const [buildings,setBuildings]=useState<CadBuildingScene[]>([]),[mode,setMode]=useState<'plans'|'3d'>('plans');
 const [pathPreview,setPathPreview]=useState<CadPathPreview|null>(null);
 const frame=useRef<HTMLIFrameElement>(null),[sceneCode,setSceneCode]=useState<string>();
 // The frame runs only bundled application code. Imported ZIP HTML is never
 // used, and all source JSON is escaped before inclusion. Same-origin enables
 // normal accessibility and focus handling for the trusted embedded workspace.
 const worker=useRef<Worker|null>(null),picker=useRef<HTMLInputElement>(null),sequence=useRef(0);
 useEffect(()=>{const receive=(event:MessageEvent)=>{
  if(event.source!==frame.current?.contentWindow||event.data?.type!=='reviter-cad-path-preview')return;const p=event.data.path;if(p===null){setPathPreview(null);return;}
  const building=buildings.find(b=>b.floors.some(f=>f.id===p?.floorId));
  const points=(ps:unknown)=>Array.isArray(ps)&&ps.length>0&&ps.length<=10000&&ps.every((q:unknown)=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite));
  if(!building||!points(p.points)||!Number.isFinite(p.lengthMetres)||p.lengthMetres<0)return;
  if(p.segments!==undefined&&(!Array.isArray(p.segments)||p.segments.length>100||p.segments.some((s:{floorId:string;points:unknown})=>!building.floors.some(f=>f.id===s.floorId)||!points(s.points))||p.segments.reduce((n:number,s:{points:unknown[]})=>n+s.points.length,0)>60000))return;
  if(p.connections!==undefined&&(!Array.isArray(p.connections)||p.connections.length>100||p.connections.some((id:string)=>!building.assumedLinks.some(l=>l.id===id))))return;
  setPathPreview(p);
 };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[buildings]);
 useEffect(()=>()=>{sequence.current++;worker.current?.terminate();},[]);
 const open=useCallback(async(file:File)=>{
  const token=++sequence.current;worker.current?.terminate();setBusy(true);setStatus('Reading and checking the CAD package locally…');
  setPathPreview(null);setDocument(null);setCoverage('');setAudit(null);setBuildings([]);setMode('plans');
  try{
   if(file.size>256*1024*1024)throw new Error('CAD ZIP exceeds 256 MB.');
   const w=new Worker((globalThis as ReviterGlobal).__REVITER_STATIC_WORKERS__?.cadReview ?? new URL('./cad-review.worker.ts',import.meta.url),{type:'module'});worker.current=w;
   w.onmessage=event=>{if(token!==sequence.current)return;w.terminate();worker.current=null;setBusy(false);
    if(!event.data.ok){setStatus(event.data.error);return;}
    try{setDocument(event.data.document);setBuildings(event.data.buildings);
     setStatus(file.name+' · local drawing review');
     const c=event.data.coverage;setAudit(c);if(c)setCoverage(c.sheets.length+' drawing sheets accounted for · '+c.pendingPanelCount+' composite panels still need attribution.');
    }catch(error){setStatus(error instanceof Error?error.message:'Unable to show CAD package.');}};
   w.onerror=()=>{if(token!==sequence.current)return;w.terminate();worker.current=null;setBusy(false);setStatus('CAD review worker could not read this package.');};
   const bytes=await file.arrayBuffer();if(token!==sequence.current)return;w.postMessage(bytes,[bytes]);
  }catch(error){if(token!==sequence.current)return;setBusy(false);setStatus(error instanceof Error?error.message:'Unable to read CAD ZIP.');}
 },[]);
 useEffect(()=>{if(initialFile)void open(initialFile);},[initialFile,open]);
 return <section className="cad-review-workspace" role="dialog" aria-modal="true" aria-label="DWG floor review" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();event.stopPropagation();const files=Array.from(event.dataTransfer.files);if(files.length===1)void open(files[0]!);else setStatus('Open one CAD analysis ZIP at a time.');}}>
  <header><strong>Reviter · DWG floor review</strong><button type="button" className="rv-button" autoFocus disabled={busy} onClick={()=>picker.current?.click()}>Open CAD analysis ZIP</button>{buildings.length>0&&<><button type="button" className="rv-button" aria-pressed={mode==='plans'} onClick={()=>setMode('plans')}>Floor plans</button><button type="button" className="rv-button" aria-pressed={mode==='3d'} onClick={()=>{setSceneCode((frame.current?.contentDocument?.getElementById('building') as HTMLSelectElement|null)?.value);setMode('3d');}}>3D building</button></>}{audit!==null&&<button type="button" className="rv-button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(audit,null,2)],{type:'application/json'}));const a=window.document.createElement('a');a.href=url;a.download='dwg-coverage-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download coverage audit</button>}<button type="button" className="rv-button" onClick={onClose}>Return to model</button></header>
  <input ref={picker} type="file" accept=".zip" hidden onChange={event=>{const f=event.target.files?.[0];if(f)void open(f);event.target.value='';}}/>
  <p role="status">{status} {coverage}</p>
  {document?<iframe ref={frame} hidden={mode==='3d'} title="CAD buildings and floor connections" srcDoc={document}/>:<div className="cad-review-empty"><h2>Review drawing geometry</h2><p>Use the ZIP generated by Reviter’s cad:analyze pipeline. Room labels, recovered outlines, door symbols and stair candidates are shown separately. Source geometry and routes stay unchanged.</p><p>Compare each floor’s layout and inspect both ends of proposed stair matches. Pending composite sheets are listed in the coverage audit.</p></div>}
  {mode==='3d'&&buildings.length>0&&<DwgBuildingModel buildings={buildings} initialBuildingCode={sceneCode} pathPreview={pathPreview}/>}
 </section>;
}
