import {nativeSourceStairOwnedTerminal,nativeOwnedTerminalPartsForSegment,type NativeOwnedTerminalOptions} from './native-source-stair-owned-terminal.ts';
import {nativeStairRiserInventoryHash,nativeSourceStairRiserProjections,nativeSourceStairRiserPartsForSegment,type NativeStairRiserInventory,type NativeStairRiserContinuity} from './native-source-stair-riser-continuity.ts';
import {nativeRationalOverlay} from './native-rational-overlay.ts';
import {nativeRationalPointInParts} from './native-exact-planar-topology.ts';
import pc from 'polygon-clipping';
type P2=[number,number];type P3=[number,number,number];type Rings=P2[][];
export type NativeSourceStairReceipt={version:1;sourceModelSha256:string;nativeStairId:number;nativeRunIds:number[];levelIds:[number,number];nativeFloorElementIds:[number,number];widthFeet:2;pointsFeet:P3[];treads:{runElementId:number;elevationFeet:number;ringFeet:P2[];thicknessFeet?:number}[];landings:{nativeElementId:number;elevationFeet:number;ringsFeet:Rings;thicknessFeet?:number}[];terminalCaps:[{pointFeet:P3;capFeet:[P3,P3];levelId:number;nativeFloorElementId:number;originalRunElementId:number},{pointFeet:P3;capFeet:[P3,P3];levelId:number;nativeFloorElementId:number;originalRunElementId:number}]};
export type NativeSourceStairRiserOptions={inventory:NativeStairRiserInventory;carrier:NativeStairRiserContinuity;expectedOriginalSourceRiserInventorySha256:string;ownedTerminal?:NativeOwnedTerminalOptions};
export type NativeSourceStairFloor={nativeElementId:number;elevationFeet:number;ringsFeet:Rings;partsFeet?:Rings[]};
const areaRing=(r:P2[])=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length]!;return s+p[0]*q[1]-q[0]*p[1]},0)/2);
const area=(ps:pc.MultiPolygon)=>ps.reduce((s,p)=>s+areaRing(p[0]!as P2[])-p.slice(1).reduce((a,h)=>a+areaRing(h as P2[]),0),0);
const close=(r:Rings)=>r.map(h=>h.length&&h[0]![0]===h.at(-1)![0]&&h[0]![1]===h.at(-1)![1]?h:[...h,h[0]!]);
const near=(a:P3,b:P3)=>a.every((n,i)=>Math.abs(n-b[i]!)<1e-8);
const strip=(a:P3,b:P3,width:number):pc.Polygon=>{const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);if(d<1e-8)return[];const nx=-dy/d*width/2,ny=dx/d*width/2;return[[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny],[a[0]+nx,a[1]+ny]]];};
/** Mathematical replay only. Caller must independently bind original owners,
 * triangles/profile inventories and check current enclosure/foreign material.
 * Positive exact native tread/landing/floor surfaces support every 2-ft strip;
 * a bounding rectangle, missing stair tread, or slab hole cannot support it. */
export function validateNativeSourceStairWidth(r:NativeSourceStairReceipt,floors:readonly NativeSourceStairFloor[],exactNative=false,riserOptions?:NativeSourceStairRiserOptions):boolean {
 try{
  if(riserOptions&&(!/^[a-f0-9]{64}$/.test(riserOptions.expectedOriginalSourceRiserInventorySha256)||nativeStairRiserInventoryHash(riserOptions.inventory)!==riserOptions.expectedOriginalSourceRiserInventorySha256))return false;
  const risers=riserOptions&&exactNative?nativeSourceStairRiserProjections(riserOptions.inventory,riserOptions.carrier,r):[];if(riserOptions&&(!exactNative||!risers))return false;
  const ownedTerminal=riserOptions?.ownedTerminal&&exactNative?nativeSourceStairOwnedTerminal(riserOptions.ownedTerminal,r,floors):undefined;if(riserOptions?.ownedTerminal&&!ownedTerminal)return false;
  if(r.version!==1||r.widthFeet!==2||!/^[a-f0-9]{64}$/.test(r.sourceModelSha256)||!Number.isSafeInteger(r.nativeStairId)||r.nativeRunIds.length<1||new Set(r.nativeRunIds).size!==r.nativeRunIds.length||r.pointsFeet.length<4||r.pointsFeet.length>10000||r.pointsFeet.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)))||r.treads.length<2||r.treads.length>10000||r.terminalCaps.length!==2||r.levelIds[0]===r.levelIds[1])return false;
  const ids=new Set(r.nativeRunIds);const ts=[...r.treads].sort((a,b)=>a.elevationFeet-b.elevationFeet||a.runElementId-b.runElementId);
  if(ts.some(t=>!ids.has(t.runElementId)||!Number.isFinite(t.elevationFeet)||t.ringFeet.length<3||areaRing(t.ringFeet)<.01||t.ringFeet.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)))))return false;
  if(r.landings.some(l=>!Number.isSafeInteger(l.nativeElementId)||!Number.isFinite(l.elevationFeet)||!l.ringsFeet[0]?.length||l.ringsFeet.some(h=>h.length<3||h.some(p=>p.some(n=>!Number.isFinite(n))))))return false;
  const sourceFloors=r.nativeFloorElementIds.map(id=>floors.find(f=>f.nativeElementId===id));if(sourceFloors.some(f=>!f))return false;
  for(const [i,cap]of r.terminalCaps.entries()){
   if(cap.levelId!==r.levelIds[i]||cap.nativeFloorElementId!==r.nativeFloorElementIds[i]||!ids.has(cap.originalRunElementId)||!(exactNative?JSON.stringify(cap.pointFeet)===JSON.stringify(r.pointsFeet[i? r.pointsFeet.length-1:0]!):near(cap.pointFeet,r.pointsFeet[i? r.pointsFeet.length-1:0]!))||cap.capFeet.length!==2||cap.capFeet.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)))||Math.hypot(cap.capFeet[1][0]-cap.capFeet[0][0],cap.capFeet[1][1]-cap.capFeet[0][1])<2-1e-8)return false;
   const f=sourceFloors[i]!;if(exactNative?f.elevationFeet!==cap.pointFeet[2]:Math.abs(f.elevationFeet-cap.pointFeet[2])>.05)return false;
   // Landing's full lateral width must be on the named original slab, rather
   // than borrowing a projected tread to hide an unsupported endpoint.
   const dx=cap.capFeet[1][0]-cap.capFeet[0][0],dy=cap.capFeet[1][1]-cap.capFeet[0][1],len=Math.hypot(dx,dy);const a:P3=[cap.pointFeet[0]-dy/len*.05,cap.pointFeet[1]+dx/len*.05,cap.pointFeet[2]],b:P3=[cap.pointFeet[0]+dy/len*.05,cap.pointFeet[1]-dx/len*.05,cap.pointFeet[2]];
   const parts=(f.partsFeet??[f.ringsFeet]).map(close);if(i===1&&ownedTerminal){if(nativeRationalOverlay('difference',ownedTerminal.capParts,nativeRationalOverlay('union',parts as [number,number][][][])).length)return false;continue;}if(exactNative){if(nativeRationalOverlay('difference',[strip(a,b,2)] as [number,number][][][],nativeRationalOverlay('union',parts as [number,number][][][])).length)return false;}else{const union=pc.union(parts[0]!,...parts.slice(1));if(area(pc.difference(strip(a,b,2),union))>1e-8)return false;}
  }
  const surfaces:{z:number;rings:Rings;parts?:Rings[]}[]=[...ts.map(t=>({z:t.elevationFeet,rings:[t.ringFeet]})),...r.landings.map(l=>({z:l.elevationFeet,rings:l.ringsFeet})),...sourceFloors.map(f=>({z:f!.elevationFeet,rings:f!.ringsFeet,parts:f!.partsFeet}))];
  const lo=r.pointsFeet[0]![2],hi=r.pointsFeet.at(-1)![2];if(hi-lo<1)return false;
  for(let i=1;i<r.pointsFeet.length;i++){
   const a=r.pointsFeet[i-1]!,b=r.pointsFeet[i]!;if(b[2]<a[2]-1e-8||b[2]-a[2]>1.2||Math.hypot(b[0]-a[0],b[1]-a[1])<1e-8)return false;
   const ps=surfaces.filter(s=>s.z>=a[2]-.05&&s.z<=b[2]+.05).flatMap(s=>(s.parts??[s.rings]).map(close));if(!ps.length)return false;
   if(exactNative){if(nativeRationalOverlay('difference',[strip(a,b,2)] as [number,number][][][],nativeRationalOverlay('union',ps as [number,number][][][],...[nativeSourceStairRiserPartsForSegment(risers??[],a,b),nativeOwnedTerminalPartsForSegment(ownedTerminal??undefined,a,b)].filter(p=>p.length))).length)return false;}else{const union=pc.union(ps[0]!,...ps.slice(1));if(area(pc.difference(strip(a,b,2),union))>1e-8)return false;}
  }
  // Each persisted walking tread must be visited at its original top height.
  // No straight bottom-to-top diagonal is a substitute for the flight chain.
  return ts.every(t=>r.pointsFeet.some(p=>(exactNative?p[2]===t.elevationFeet:Math.abs(p[2]-t.elevationFeet)<1e-8)&&(exactNative?nativeRationalPointInParts([p[0],p[1]],nativeRationalOverlay('union',[close([t.ringFeet])] as [number,number][][][])):pc.intersection([[[p[0]-.00001,p[1]-.00001],[p[0]+.00001,p[1]-.00001],[p[0]+.00001,p[1]+.00001],[p[0]-.00001,p[1]+.00001],[p[0]-.00001,p[1]-.00001]]],close([t.ringFeet])).length)));
 }catch{return false;}
}
