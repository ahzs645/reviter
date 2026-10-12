import * as DMath from './deterministic-math.ts';
import {nativeAuthoredStairTreads} from './native-authored-stair-treads.ts';
import type{ConvertResult}from'./types.ts';
import type{IndoorDataset}from'./indoor-contract.ts';
import {nativeFloorPolygons,routingFloorPlateRecords}from'./routing-floor-support.ts';
import{validateNativeSourceStairWidth,type NativeSourceStairReceipt,type NativeSourceStairFloor}from'./native-source-stair-width.ts';
import pc from'polygon-clipping';
import{nativeStairRunTreads}from'./indoor-stair-run-surfaces.ts';
type P2=[number,number];type P3=[number,number,number];
const area=(r:P2[])=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length]!;return s+p[0]*q[1]-q[0]*p[1]},0)/2);
const center=(r:P2[]):P2=>r.reduce((s,p)=>[s[0]+p[0]/r.length,s[1]+p[1]/r.length]as P2,[0,0]as P2);
const same=(a:P3,b:P3)=>a.every((n,i)=>Math.abs(n-b[i]!)<1e-8);
/** Source proposal only: caller still checks original foreign material and
 * independently certified actual-height enclosures before creating an edge. */
export function prepareNativeSourceStairReceipts(model:ConvertResult,data:IndoorDataset){
 const floors:NativeSourceStairFloor[]=model.levels.flatMap(l=>routingFloorPlateRecords(model,l.elevation)).filter((f,i,all)=>all.findIndex(g=>g.elementId===f.elementId)===i).map(f=>({nativeElementId:f.elementId,elevationFeet:f.boundsFeet.max.z,ringsFeet:nativeFloorPolygons(f, !!data.nativeIndoorEnvelopes)[0]!,partsFeet:nativeFloorPolygons(f, !!data.nativeIndoorEnvelopes)}));
 const elements=new Map(model.elementBounds.map(r=>[r.elementId,r]));
 const receipts:NativeSourceStairReceipt[]=[],diagnostics:{nativeStairId:number;reason:string}[]=[];
 const authored=nativeAuthoredStairTreads(data.nativeSourceStairMaterials?.authoredTreadRoles,data.source.modelSha256);
 const brep=nativeStairRunTreads(model);
 for(const flight of data.stairDisplay?.sourceFlights??[]){
  if('context' in flight&&(flight.context==='outdoor'||flight.context==='tiered-seating'))continue;
  const assembly=model.nativeStairAssemblies?.find(a=>a.stairElementId===flight.stairElementId);
  const originalRuns=assembly?.runAndLandingIds.map(id=>elements.get(id)).filter(r=>r?.stairTreads?.length)??[];
  const cachedOriginalTreads=originalRuns.flatMap(r=>r!.stairTreads!.filter(t=>area(t.map(p=>[p[0],p[1]]as P2))>.01).map(t=>({runElementId:r!.elementId,elevationFeet:t.reduce((z,p)=>z+p[2]/t.length,0),ringFeet:t.map(p=>[p[0],p[1]]as P2)})));
  const authoredRuns=assembly?.runAndLandingIds.filter(id=>authored.has(id))??[];
  // Without typed authored roles, the runs' own owner-tagged native BRep tread
  // faces (accepted step for step by nativeStairRunTreads) are the independent
  // original inventory. Sketch-recovered cache profiles can sit one riser high
  // (nativeStairInventoryReconciliation explains that offset); they are then
  // not the authority.
  const brepRuns=authoredRuns.length?[]:(assembly?.runAndLandingIds.filter(id=>brep.has(id))??[]);
  const originalTreads=authoredRuns.length?authoredRuns.flatMap(id=>authored.get(id)!):brepRuns.length?brepRuns.flatMap(id=>brep.get(id)!):cachedOriginalTreads;
  const sameRing=(a:P2[],b:P2[])=>a.length===b.length&&a.some((_,offset)=>[1,-1].some(direction=>a.every((p,i)=>{const q=b[(offset+direction*i+b.length*2)%b.length]!;return DMath.hypot(p[0]-q[0],p[1]-q[1])<1e-8})));
  if(!assembly||!originalRuns.length||originalTreads.length!==flight.treads.length||flight.treads.some(t=>!originalTreads.some(o=>o.runElementId===t.runElementId&&Math.abs(o.elevationFeet-t.elevationFeet)<1e-8&&sameRing(o.ringFeet,t.ringFeet)))) {diagnostics.push({nativeStairId:flight.stairElementId,reason:'Prepared flight lacks exact independently replayed original typed owner/profile inventory'});continue;}
  const treads=flight.treads.toSorted((a,b)=>a.elevationFeet-b.elevationFeet||a.runElementId-b.runElementId);
  if(treads.length<2||treads.some(t=>area(t.ringFeet)<.01)){diagnostics.push({nativeStairId:flight.stairElementId,reason:'Incomplete positive original walking tread inventory'});continue;}
  const runIds=[...new Set(treads.map(t=>t.runElementId))];
  const supportFaces=(flight.supportFaces??[]).filter(f=>runIds.includes(f.runElementId));
  const low=Math.min(...originalRuns.map(r=>r!.boundsFeet.min.z)),high=Math.max(...originalRuns.map(r=>Math.max(r!.boundsFeet.max.z+(r!.stairTreadThicknessFeet??0),...r!.stairTreads!.flat().map(p=>p[2]))));
  const lev=[low,high].map(z=>model.levels.filter(l=>l.levelId!=null&&Math.abs(l.elevation-z)<.05).sort((a,b)=>Math.abs(a.elevation-z)-Math.abs(b.elevation-z))[0]);
  if(lev.some(l=>!l)||lev[0]!.levelId===lev[1]!.levelId){diagnostics.push({nativeStairId:flight.stairElementId,reason:'Original terminal heights do not match distinct original levels'});continue;}
  const caps=([0,1]as const).map(i=>{
   const terminal=i?treads.at(-1)!:treads[0]!,neighbour=i?treads.at(-2)!:treads[1]!;
   const c=center(terminal.ringFeet),n=center(neighbour.ringFeet),dx=c[0]-n[0],dy=c[1]-n[1],len=DMath.hypot(dx,dy);if(len<1e-8)return[];
   const ux=dx/len,uy=dy/len,edges=terminal.ringFeet.map((p,j)=>{const q=terminal.ringFeet[(j+1)%terminal.ringFeet.length]!,ex=q[0]-p[0],ey=q[1]-p[1],span=DMath.hypot(ex,ey);return{a:p,b:q,span,transverse:Math.abs(ex*ux+ey*uy)/(span||1),outward:((p[0]+q[0])/2-c[0])*ux+((p[1]+q[1])/2-c[1])*uy}}).filter(e=>e.transverse<.1&&e.outward>0&&e.span>=2-1e-8).sort((a,b)=>b.outward-a.outward);
   // A curved terminal edge is many short native segments: use an outward
   // chord between two of its own vertices, 2-3 ft apart, across the flight.
   if(!edges.length){
    const ring=terminal.ringFeet,chords:typeof edges=[];
    for(let j=0;j<ring.length;j++)for(let k=j+1;k<ring.length;k++){
     const p=ring[j]!,q=ring[k]!,ex=q[0]-p[0],ey=q[1]-p[1],span=DMath.hypot(ex,ey);
     if(span<2-1e-8||span>3)continue;
     const transverse=Math.abs(ex*ux+ey*uy)/span,outward=((p[0]+q[0])/2-c[0])*ux+((p[1]+q[1])/2-c[1])*uy;
     if(transverse<.1&&outward>0)chords.push({a:p,b:q,span,transverse,outward});
    }
    edges.push(...chords.sort((a,b)=>b.outward-a.outward||a.transverse-b.transverse).slice(0,12));
   }
   return edges.flatMap(e=>[.05,.1,.2,.4].flatMap(offset=>{
    const pointFeet:P3=[(e.a[0]+e.b[0])/2+ux*offset,(e.a[1]+e.b[1])/2+uy*offset,lev[i]!.elevation];
    return floors.filter(f=>Math.abs(f.elevationFeet-pointFeet[2])<.05&&f.partsFeet?.some(p=>pc.intersection([[[pointFeet[0]-.00001,pointFeet[1]-.00001],[pointFeet[0]+.00001,pointFeet[1]-.00001],[pointFeet[0]+.00001,pointFeet[1]+.00001],[pointFeet[0]-.00001,pointFeet[1]+.00001],[pointFeet[0]-.00001,pointFeet[1]-.00001]]],p).length)).map(f=>({pointFeet,capFeet:[[e.a[0],e.a[1],terminal.elevationFeet],[e.b[0],e.b[1],terminal.elevationFeet]]as[P3,P3],levelId:lev[i]!.levelId!,nativeFloorElementId:f.nativeElementId,originalRunElementId:terminal.runElementId}));
   }));
  });
  let accepted:NativeSourceStairReceipt|undefined;
  outer:for(const a of caps[0])for(const b of caps[1]){
   const pointsFeet:P3[]=[a.pointFeet,...treads.map(t=>[...center(t.ringFeet),t.elevationFeet]as P3),b.pointFeet].filter((p,i,all)=>!i||!same(p,all[i-1]!));
   const r:NativeSourceStairReceipt={version:1,sourceModelSha256:data.source.modelSha256,nativeStairId:flight.stairElementId,nativeRunIds:runIds,levelIds:[lev[0]!.levelId!,lev[1]!.levelId!],nativeFloorElementIds:[a.nativeFloorElementId,b.nativeFloorElementId],widthFeet:2,pointsFeet,treads:structuredClone(treads),landings:(flight.landings??[]).map(l=>({nativeElementId:l.nativeElementId,elevationFeet:l.elevationFeet,ringsFeet:l.ringsFeet,...(l.thicknessFeet?{thicknessFeet:l.thicknessFeet}:{})})),...(supportFaces.length?{supportFaces:structuredClone(supportFaces)}:{}),terminalCaps:[a,b]};
   if(validateNativeSourceStairWidth(r,floors,!!data.nativeIndoorEnvelopes)){accepted=r;break outer;}
  }
  if(accepted)receipts.push(accepted);else diagnostics.push({nativeStairId:flight.stairElementId,reason:'No complete two-foot positive original tread/landing path with both exact named native slab contacts'});
 }
 return{sourceModelSha256:data.source.modelSha256,receipts,diagnostics,foreignMaterialOrEnclosureApproved:false, walkingBodyApproved:false};
}

/** Explain how sketch-recovered cache profiles relate to a run's native BRep
 * treads: the same steps ("equal"), the same plan footprints one riser higher
 * ("one-riser-offset"), or neither ("disagree"). Diagnostic evidence only: the
 * BRep faces stay the authority whenever nativeStairRunTreads accepted them. */
export function nativeStairInventoryReconciliation(
 brep:{runElementId:number;elevationFeet:number;ringFeet:P2[]}[],
 cache:{runElementId:number;elevationFeet:number;ringFeet:P2[]}[],
):{relation:'equal'|'one-riser-offset'|'disagree';offsetFeet:number;minimumOverlap:number}{
 const close=(r:P2[])=>[[...r,r[0]!]] as pc.Polygon;
 const groups=(ts:typeof brep)=>[...new Set(ts.map(t=>Math.round(t.elevationFeet*1e4)/1e4))].sort((x,y)=>x-y).map(z=>({z,parts:ts.filter(t=>Math.round(t.elevationFeet*1e4)/1e4===z).map(t=>close(t.ringFeet))}));
 const b=groups(brep),c=groups(cache);
 if(!b.length||b.length!==c.length)return{relation:'disagree',offsetFeet:NaN,minimumOverlap:0};
 const pa=(ps:pc.MultiPolygon)=>ps.reduce((s2,p)=>s2+area(p[0]!as P2[])-p.slice(1).reduce((h,r)=>h+area(r as P2[]),0),0);
 let minimum=1;const offsets:number[]=[];
 for(const [i,g] of b.entries()){
  const u=pc.union(g.parts[0]!,...g.parts.slice(1)),v=pc.union(c[i]!.parts[0]!,...c[i]!.parts.slice(1));
  const iou=pa(pc.intersection(u,v))/Math.max(1e-12,pa(pc.union(u,v)));minimum=Math.min(minimum,iou);offsets.push(c[i]!.z-g.z);
 }
 const offset=offsets[0]!,risers=b.slice(1).map((g,i)=>g.z-b[i]!.z),riser=risers.length?risers.reduce((x,y)=>x+y,0)/risers.length:0;
 if(minimum<.8||offsets.some(o=>Math.abs(o-offset)>1e-3))return{relation:'disagree',offsetFeet:offset,minimumOverlap:minimum};
 if(Math.abs(offset)<=1e-3)return{relation:'equal',offsetFeet:offset,minimumOverlap:minimum};
 return risers.length&&Math.abs(Math.abs(offset)-riser)<=1e-3?{relation:'one-riser-offset',offsetFeet:offset,minimumOverlap:minimum}:{relation:'disagree',offsetFeet:offset,minimumOverlap:minimum};
}
