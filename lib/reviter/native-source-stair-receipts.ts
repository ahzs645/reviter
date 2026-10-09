import {nativeAuthoredStairTreads} from './native-authored-stair-treads.ts';
import type{ConvertResult}from'./types.ts';
import type{IndoorDataset}from'./indoor-contract.ts';
import {nativeFloorPolygons,routingFloorPlateRecords}from'./routing-floor-support.ts';
import{validateNativeSourceStairWidth,type NativeSourceStairReceipt,type NativeSourceStairFloor}from'./native-source-stair-width.ts';
import pc from'polygon-clipping';
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
 for(const flight of data.stairDisplay?.sourceFlights??[]){
  if('context' in flight&&(flight.context==='outdoor'||flight.context==='tiered-seating'))continue;
  const assembly=model.nativeStairAssemblies?.find(a=>a.stairElementId===flight.stairElementId);
  const originalRuns=assembly?.runAndLandingIds.map(id=>elements.get(id)).filter(r=>r?.stairTreads?.length)??[];
  const cachedOriginalTreads=originalRuns.flatMap(r=>r!.stairTreads!.filter(t=>area(t.map(p=>[p[0],p[1]]as P2))>.01).map(t=>({runElementId:r!.elementId,elevationFeet:t.reduce((z,p)=>z+p[2]/t.length,0),ringFeet:t.map(p=>[p[0],p[1]]as P2)})));
  const authoredRuns=assembly?.runAndLandingIds.filter(id=>authored.has(id))??[];
  const originalTreads=authoredRuns.length?authoredRuns.flatMap(id=>authored.get(id)!):cachedOriginalTreads;
  const sameRing=(a:P2[],b:P2[])=>a.length===b.length&&a.some((_,offset)=>[1,-1].some(direction=>a.every((p,i)=>{const q=b[(offset+direction*i+b.length*2)%b.length]!;return Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8})));
  if(!assembly||!originalRuns.length||originalTreads.length!==flight.treads.length||flight.treads.some(t=>!originalTreads.some(o=>o.runElementId===t.runElementId&&Math.abs(o.elevationFeet-t.elevationFeet)<1e-8&&sameRing(o.ringFeet,t.ringFeet)))) {diagnostics.push({nativeStairId:flight.stairElementId,reason:'Prepared flight lacks exact independently replayed original typed owner/profile inventory'});continue;}
  const treads=flight.treads.toSorted((a,b)=>a.elevationFeet-b.elevationFeet||a.runElementId-b.runElementId);
  if(treads.length<2||treads.some(t=>area(t.ringFeet)<.01)){diagnostics.push({nativeStairId:flight.stairElementId,reason:'Incomplete positive original walking tread inventory'});continue;}
  const runIds=[...new Set(treads.map(t=>t.runElementId))];
  const low=Math.min(...originalRuns.map(r=>r!.boundsFeet.min.z)),high=Math.max(...originalRuns.map(r=>Math.max(r!.boundsFeet.max.z+(r!.stairTreadThicknessFeet??0),...r!.stairTreads!.flat().map(p=>p[2]))));
  const lev=[low,high].map(z=>model.levels.filter(l=>l.levelId!=null&&Math.abs(l.elevation-z)<.05).sort((a,b)=>Math.abs(a.elevation-z)-Math.abs(b.elevation-z))[0]);
  if(lev.some(l=>!l)||lev[0]!.levelId===lev[1]!.levelId){diagnostics.push({nativeStairId:flight.stairElementId,reason:'Original terminal heights do not match distinct original levels'});continue;}
  const caps=([0,1]as const).map(i=>{
   const terminal=i?treads.at(-1)!:treads[0]!,neighbour=i?treads.at(-2)!:treads[1]!;
   const c=center(terminal.ringFeet),n=center(neighbour.ringFeet),dx=c[0]-n[0],dy=c[1]-n[1],len=Math.hypot(dx,dy);if(len<1e-8)return[];
   const ux=dx/len,uy=dy/len,edges=terminal.ringFeet.map((p,j)=>{const q=terminal.ringFeet[(j+1)%terminal.ringFeet.length]!,ex=q[0]-p[0],ey=q[1]-p[1],span=Math.hypot(ex,ey);return{a:p,b:q,span,transverse:Math.abs(ex*ux+ey*uy)/(span||1),outward:((p[0]+q[0])/2-c[0])*ux+((p[1]+q[1])/2-c[1])*uy}}).filter(e=>e.transverse<.1&&e.outward>0&&e.span>=2-1e-8).sort((a,b)=>b.outward-a.outward);
   return edges.flatMap(e=>[.05,.1,.2,.4].flatMap(offset=>{
    const pointFeet:P3=[(e.a[0]+e.b[0])/2+ux*offset,(e.a[1]+e.b[1])/2+uy*offset,lev[i]!.elevation];
    return floors.filter(f=>Math.abs(f.elevationFeet-pointFeet[2])<.05&&f.partsFeet?.some(p=>pc.intersection([[[pointFeet[0]-.00001,pointFeet[1]-.00001],[pointFeet[0]+.00001,pointFeet[1]-.00001],[pointFeet[0]+.00001,pointFeet[1]+.00001],[pointFeet[0]-.00001,pointFeet[1]+.00001],[pointFeet[0]-.00001,pointFeet[1]-.00001]]],p).length)).map(f=>({pointFeet,capFeet:[[e.a[0],e.a[1],terminal.elevationFeet],[e.b[0],e.b[1],terminal.elevationFeet]]as[P3,P3],levelId:lev[i]!.levelId!,nativeFloorElementId:f.nativeElementId,originalRunElementId:terminal.runElementId}));
   }));
  });
  let accepted:NativeSourceStairReceipt|undefined;
  outer:for(const a of caps[0])for(const b of caps[1]){
   const pointsFeet:P3[]=[a.pointFeet,...treads.map(t=>[...center(t.ringFeet),t.elevationFeet]as P3),b.pointFeet].filter((p,i,all)=>!i||!same(p,all[i-1]!));
   const r:NativeSourceStairReceipt={version:1,sourceModelSha256:data.source.modelSha256,nativeStairId:flight.stairElementId,nativeRunIds:runIds,levelIds:[lev[0]!.levelId!,lev[1]!.levelId!],nativeFloorElementIds:[a.nativeFloorElementId,b.nativeFloorElementId],widthFeet:2,pointsFeet,treads:structuredClone(treads),landings:(flight.landings??[]).map(l=>({nativeElementId:l.nativeElementId,elevationFeet:l.elevationFeet,ringsFeet:l.ringsFeet,...(l.thicknessFeet?{thicknessFeet:l.thicknessFeet}:{})})),terminalCaps:[a,b]};
   if(validateNativeSourceStairWidth(r,floors,!!data.nativeIndoorEnvelopes)){accepted=r;break outer;}
  }
  if(accepted)receipts.push(accepted);else diagnostics.push({nativeStairId:flight.stairElementId,reason:'No complete two-foot positive original tread/landing path with both exact named native slab contacts'});
 }
 return{sourceModelSha256:data.source.modelSha256,receipts,diagnostics,foreignMaterialOrEnclosureApproved:false, walkingBodyApproved:false};
}
