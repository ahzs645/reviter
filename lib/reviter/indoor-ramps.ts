import pc from "polygon-clipping";
import {certifyNativeRampCrossfall,nativeRampTrackHeight,nativeRampTrackJoint,type NativeRampCrossfallCertificate} from "./native-ramp-crossfall.ts";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset, IndoorNode, IndoorRecord } from "./indoor-contract.ts";
import { containsRoomPoint, type RoomPoint } from "./room-directory.ts";
import { nativeWalkingRegion, supportedWalkingPath } from "./native-circulation-links.ts";
type Point3=[number,number,number];
type RampRecipe={id:string;nativeRampId:number;floorElementIds:[number,number];evidence:string;accessible:'yes'|'no'|'unknown';pointsFeet:Point3[];trianglesFeet:Point3[][];notes?:string;surfaceWidthCertificate?:NativeRampCrossfallCertificate};
export type IndoorRampRecipes={version:1;sourceModelSha256:string;ramps:RampRecipe[]};
const values=(a:unknown):number[]=>Array.isArray(a)?a:ArrayBuffer.isView(a)?Array.from(a as unknown as ArrayLike<number>):a&&typeof a==='object'?Object.values(a):[];
export function triangleSurfaceHeight(p:readonly number[],t:Point3[]):number|undefined {const [a,b,c]=t;if(!a||!b||!c)return;const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)return;const u=((b[1]-c[1])*(p[0]!-c[0])+(c[0]-b[0])*(p[1]!-c[1]))/den,v=((c[1]-a[1])*(p[0]!-c[0])+(a[0]-c[0])*(p[1]!-c[1]))/den;return Math.min(u,v,1-u-v)>=-1e-7?u*a[2]+v*b[2]+(1-u-v)*c[2]:undefined;}
/** Certified owner-tagged native BRep is required. The source-bound recipe does
 * not turn a ramp category's flat sketch or bounding box into a walking slope. */
export function nativeRampTriangles(model:ConvertResult,id:number):Point3[][] {
 const out:Point3[][]=[];
 for(const m of model.meshes??[]){if(m.source!=='native-brep'||!m.elementIds)continue;const ids=values(m.elementIds);if(!ids.includes(id))continue;const p=values(m.positions),ix=values(m.indices);for(let i=0;i<ids.length;i++){if(ids[i]!==id)continue;const t=ix.slice(i*3,i*3+3).map(j=>[p[j*3]!+model.origin.x,p[j*3+1]!+model.origin.y,p[j*3+2]!+model.origin.z] as Point3);if(t.length!==3||t.some(p=>!p.every(Number.isFinite)))continue;const [a,b,c]=t;const nz=(b![0]-a![0])*(c![1]-a![1])-(b![1]-a![1])*(c![0]-a![0]);if(nz>1e-8)out.push(t);}}
 return out;
}
/** Exact endpoint registration. Native floor/ramp geometry can differ by a
 * microscopic modelling joint; only an owner-tagged same-height face and its
 * specifically named slab may justify a seam up to 0.02 ft (6.1 mm). */
export function rampLandingPoint(model:ConvertResult,r: RampRecipe,i:number):Point3|undefined {
 const p=i?r.pointsFeet.at(-1)!:r.pointsFeet[0]!,f=model.elementBounds.find(x=>x.elementId===r.floorElementIds[i]);
 if(!f||f.categoryId!==-2000032||Math.abs(f.boundsFeet.max.z-p[2])>.002||!f.loops?.[0])return;
 const inside=(q:Point3)=>containsRoomPoint([q[0],q[1]],f.loops![0]!.map(v=>[v[0],v[1]]))&&!f.loops!.slice(1).some(h=>containsRoomPoint([q[0],q[1]],h.map(v=>[v[0],v[1]])));
 if(inside(p))return p;
 if(!nativeRampTriangles(model,r.nativeRampId).some(t=>{const z=triangleSurfaceHeight(p,t);return z!==undefined&&Math.abs(z-p[2])<.002;}))return;
 let nearest:{p:Point3;d:number}|undefined;
 const ring=f.loops[0];for(let j=0;j<ring.length;j++){const a=ring[j]!,b=ring[(j+1)%ring.length]!,dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;if(len2<1e-12)continue;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2)),q:Point3=[a[0]+t*dx,a[1]+t*dy,p[2]],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!nearest||d<nearest.d)nearest={p:q,d};}
 if(!nearest||nearest.d>.02||nearest.d<1e-10)return;
 const dx=(nearest.p[0]-p[0])/nearest.d,dy=(nearest.p[1]-p[1])/nearest.d;
 const q:Point3=[nearest.p[0]+dx*.01,nearest.p[1]+dy*.01,p[2]];
 return inside(q)?q:undefined;
}
type SupportInterval={start:number;end:number;kind:'floor'|'ramp'};
const clampInterval=(range:[number,number],a:number,b:number,tolerance=0):boolean=>{
 const slope=b-a;if(Math.abs(slope)<1e-12)return a>=-tolerance;
 const limit=(-tolerance-a)/slope;if(slope>0)range[0]=Math.max(range[0],limit);else range[1]=Math.min(range[1],limit);return range[0]<=range[1]+1e-10;
};
function triangleInterval(a:Point3,b:Point3,t:Point3[]):SupportInterval|undefined {
 const range:[number,number]=[0,1],sign=Math.sign((t[1]![0]-t[0]![0])*(t[2]![1]-t[0]![1])-(t[1]![1]-t[0]![1])*(t[2]![0]-t[0]![0]));if(!sign)return;
 for(let i=0;i<3;i++){const p=t[i]!,q=t[(i+1)%3]!,cross=(v:Point3)=>sign*((q[0]-p[0])*(v[1]-p[1])-(q[1]-p[1])*(v[0]-p[0]));if(!clampInterval(range,cross(a),cross(b),1e-8))return;}
 const [p,q,r]=t,den=(q![1]-r![1])*(p![0]-r![0])+(r![0]-q![0])*(p![1]-r![1]);
 const z=(v:Point3)=>{const u=((q![1]-r![1])*(v[0]-r![0])+(r![0]-q![0])*(v[1]-r![1]))/den,w=((r![1]-p![1])*(v[0]-r![0])+(p![0]-r![0])*(v[1]-r![1]))/den;return u*p![2]+w*q![2]+(1-u-w)*r![2];};
 const da=a[2]-z(a),db=b[2]-z(b);if(!clampInterval(range,.002-da,.002-db)||!clampInterval(range,.002+da,.002+db))return;
 return {start:Math.max(0,range[0]),end:Math.min(1,range[1]),kind:'ramp'};
}
function floorIntervals(a:Point3,b:Point3,f:ConvertResult['elementBounds'][number]):SupportInterval[] {
 if(!f.loops?.[0]||f.categoryId!==-2000032)return [];
 const range:[number,number]=[0,1],da=a[2]-f.boundsFeet.max.z,db=b[2]-f.boundsFeet.max.z;
 if(!clampInterval(range,.002-da,.002-db)||!clampInterval(range,.002+da,.002+db))return [];
 const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[Math.max(0,range[0]),Math.min(1,range[1])];
 for(const ring of f.loops)for(let i=0;i<ring.length;i++){const p=ring[i]!,q=ring[(i+1)%ring.length]!,sx=q[0]-p[0],sy=q[1]-p[1],den=dx*sy-dy*sx;if(Math.abs(den)<1e-12)continue;const t=((p[0]-a[0])*sy-(p[1]-a[1])*sx)/den,u=((p[0]-a[0])*dy-(p[1]-a[1])*dx)/den;if(t>cuts[0]!&&t<cuts[1]!&&u>=0&&u<=1)cuts.push(t);}
 cuts.sort((a,b)=>a-b);const out:SupportInterval[]=[];for(let i=1;i<cuts.length;i++){const start=cuts[i-1]!,end=cuts[i]!,t=(start+end)/2,p:RoomPoint=[a[0]+dx*t,a[1]+dy*t];if(containsRoomPoint(p,f.loops[0].map(v=>[v[0],v[1]]))&&!f.loops.slice(1).some(h=>containsRoomPoint(p,h.map(v=>[v[0],v[1]]))))out.push({start,end,kind:'floor'});}return out;
}
/** Analytic segment coverage catches sub-sample holes. Only a named slab-to-
 * owner-ramp modelling seam may bridge up to6.1mm; floor holes never qualify. */
export function rampWalkingSupport(model:ConvertResult,r:RampRecipe,points:readonly Point3[]=r.pointsFeet):{supported:boolean;maximumNativeJointFeet:number} {
 const triangles=nativeRampTriangles(model,r.nativeRampId),floors=r.floorElementIds.map(id=>model.elementBounds.find(f=>f.elementId===id)).filter((f):f is ConvertResult['elementBounds'][number]=>!!f);let maximumNativeJointFeet=0;
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,length=Math.hypot(...b.map((v,k)=>v-a[k]!));if(length<1e-10)continue;const xy=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=xy?-(b[1]-a[1])/xy:0,ny=xy?(b[0]-a[0])/xy:0;
 for(const offset of[-.5,0,.5]){const p:Point3=[a[0]+nx*offset,a[1]+ny*offset,a[2]],q:Point3=[b[0]+nx*offset,b[1]+ny*offset,b[2]],intervals=[...triangles.flatMap(t=>{const x=triangleInterval(p,q,t);return x?[x]:[];}),...floors.flatMap(f=>floorIntervals(p,q,f))].sort((a,b)=>a.start-b.start||b.end-a.end);let end=0,last:'floor'|'ramp'|undefined;
 for(const interval of intervals){if(interval.end<end)continue;const gap=Math.max(0,interval.start-end)*length;if(gap>1e-7){if(last==null||last===interval.kind||gap>.02||Math.abs(q[2]-p[2])*(interval.start-end)>.002)return {supported:false,maximumNativeJointFeet};maximumNativeJointFeet=Math.max(maximumNativeJointFeet,gap);}if(interval.end>end){end=interval.end;last=interval.kind;}}
 if((1-end)*length>1e-7)return {supported:false,maximumNativeJointFeet};
 }}return {supported:true,maximumNativeJointFeet};
}
export function validateRampRecipe(model:ConvertResult,dataset:IndoorDataset,r: RampRecipe):string|undefined {
 if(!r||typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.nativeRampId)||!Array.isArray(r.floorElementIds)||r.floorElementIds.length!==2||!Array.isArray(r.pointsFeet)||r.pointsFeet.length<2||r.pointsFeet.length>1000||r.pointsFeet.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))||!['yes','no','unknown'].includes(r.accessible))return 'Malformed ramp recipe.';
 const native=model.elementBounds.find(x=>x.elementId===r.nativeRampId);if(native?.categoryId!==-2000180)return 'Source element is not a native ramp.';
 const actual=nativeRampTriangles(model,r.nativeRampId);if(!actual.length||!Array.isArray(r.trianglesFeet)||!r.trianglesFeet.length)return 'Ramp has no certified native walking faces.';
 const same=(a:Point3[],b:Point3[])=>a.length===3&&a.every(p=>b.some(q=>p.every((v,k)=>Math.abs(v-q[k]!)<.002)));
 if(r.trianglesFeet.some(t=>!Array.isArray(t)||t.length!==3||t.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))||r.trianglesFeet.some(t=>!actual.some(a=>same(t,a)))||actual.some(t=>!r.trianglesFeet.some(a=>same(t,a))))return 'Saved ramp faces do not match owner-tagged native geometry.';
 const floors=r.floorElementIds.map(id=>model.elementBounds.find(x=>x.elementId===id));
 const contained=(p:Point3,f:NonNullable<typeof floors[number]>)=>f.categoryId===-2000032&&Math.abs(p[2]-f.boundsFeet.max.z)<.05&&!!f.loops?.[0]&&containsRoomPoint([p[0],p[1]],f.loops[0].map(q=>[q[0],q[1]]))&&!f.loops.slice(1).some(h=>containsRoomPoint([p[0],p[1]],h.map(q=>[q[0],q[1]])));
 if(floors.some((f,i)=>!f||!rampLandingPoint(model,r,i)))return 'Ramp endpoint lacks its exact native landing floor.';
 const registered=[rampLandingPoint(model,r,0)!,...r.pointsFeet,rampLandingPoint(model,r,1)!];
 if(!r.surfaceWidthCertificate&&!rampWalkingSupport(model,r,registered).supported)return 'Ramp path leaves its continuously proved native surfaces or exceeds the bounded native endpoint seam.';
 const certificate=r.surfaceWidthCertificate;
 if(certificate){if(JSON.stringify(registered[0])!==JSON.stringify(r.pointsFeet[0])||JSON.stringify(registered.at(-1))!==JSON.stringify(r.pointsFeet.at(-1)))return 'Curved ramp caps must already lie inside their exact original landing slabs.';const actualCertificate=certifyNativeRampCrossfall(actual,floors.filter((f):f is NonNullable<typeof f>=>!!f),r.pointsFeet);if(!actualCertificate||JSON.stringify(certificate)!==JSON.stringify(actualCertificate))return 'Curved ramp width certificate does not match original continuous native surface profiles.';}
 const treads=model.elementBounds.flatMap(r=>r.stairTreads??[]);
 for(let i=1;i<r.pointsFeet.length;i++){const a=r.pointsFeet[i-1]!,b=r.pointsFeet[i]!,n=Math.max(1,Math.ceil(Math.hypot(...b.map((v,k)=>v-a[k]!))/.1));if(n>20000)return 'Ramp segment is too long.';
 for(let j=0;j<=n;j++){const p=a.map((v,k)=>v+(b[k]!-v)*j/n) as Point3;const centerRegion=certificate?undefined:nativeWalkingRegion(model,dataset,p[2],true);
 // Native triangles are checked across both sides as well as the centre. A
 // surviving centre line does not justify cutting a corner outside the ramp.
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=length?-dy/length:0,ny=length?dx/length:0;
 for(const offset of[-.5,0,.5]){const measuredHeight=certificate?nativeRampTrackHeight(certificate,i-1,offset,j/n):p[2];if(measuredHeight===undefined)return 'Curved ramp track lacks exact native height support.';const q:Point3=[p[0]+nx*offset,p[1]+ny*offset,measuredHeight],region=centerRegion??nativeWalkingRegion(model,dataset,q[2],true);if(!(certificate&&nativeRampTrackJoint(certificate,i-1,offset,j/n))&&!floors.some(f=>f&&contained(q,f))&&!actual.some(t=>{const z=triangleSurfaceHeight(q,t);return z!==undefined&&Math.abs(z-q[2])<.002;}))return 'Ramp path leaves its continuous native walking surfaces.';
 if(region.barriers.some(poly=>containsRoomPoint([q[0],q[1]],poly[0]!))||region.masks.some(poly=>containsRoomPoint([q[0],q[1]],poly[0]!)&&!poly.slice(1).some(h=>containsRoomPoint([q[0],q[1]],h))))return 'Ramp path intersects native barriers, stair treads or protected source areas.';
 if(treads.some(t=>containsRoomPoint([q[0],q[1]],t.map(v=>[v[0],v[1]]))&&t.some(v=>v[2]>q[2]+.05&&v[2]<q[2]+6)))return 'Ramp path crosses native stair treads.';
 }}}
}
/** Rebuild ramps from immutable model/recipe evidence, before generic native
 * landing attachment. Accessibility comes from the existing specific review;
 * native ramp geometry alone cannot certify a wheelchair route. */
export function prepareReviewedIndoorRamps(model:ConvertResult,dataset:IndoorDataset,metadata:unknown,geo:(p:RoomPoint)=>[number,number],savedReviews?:unknown):Set<string> {
 const restoredReviews=new Set<string>();
 if(metadata==null)return restoredReviews;
 const data=metadata as IndoorRampRecipes;
 const reject=(id:string,message:string)=>dataset.issues.push({id:`ramp-review:${id}`,code:'ramp-review',severity:'review',message:`${id}: ${message}`});
 if(data.version!==1||data.sourceModelSha256!==dataset.source.modelSha256||!Array.isArray(data.ramps)||data.ramps.length>1000){reject('source','Saved ramp source identity or version does not match.');return restoredReviews;}
 dataset.rampDisplay={version:1,sourceModelSha256:dataset.source.modelSha256,ramps:[]};
 const identifiers=new Set<string>();
 for(const r of data.ramps){if(identifiers.has(r?.id)){reject(r.id,'Duplicate ramp identifier.');continue;}if(r?.id)identifiers.add(r.id);const problem=validateRampRecipe(model,dataset,r);if(problem){reject(r?.id??'unknown',problem);continue;}
 const ends=[rampLandingPoint(model,r,0)!,rampLandingPoint(model,r,1)!];
 const compiledPath=[ends[0]!,...r.pointsFeet,ends[1]!].filter((p,i,all)=>!i||Math.hypot(...p.map((v,k)=>v-all[i-1]![k]!))>1e-8);
 const widthCertificate=certifyNativeRampCrossfall(nativeRampTriangles(model,r.nativeRampId),r.floorElementIds.map(id=>model.elementBounds.find(f=>f.elementId===id)!),compiledPath);
 if(dataset.nativeIndoorEnvelopes&&!widthCertificate){reject(r.id,'Strict native ramp lacks continuously certified original lateral surface profiles.');continue;}
 const seamFeet=Math.hypot(...ends[0]!.map((v,k)=>v-r.pointsFeet[0]![k]!));
 if(seamFeet>1e-8)dataset.issues.push({id:`ramp-native-seam:${r.id}`,code:"ramp-native-seam",severity:"info",nativeElementId:r.nativeRampId,message:`Native ramp/floor endpoint registered across a ${Math.max(0,seamFeet-.01).toFixed(6)} ft source joint, bounded to 0.02 ft and paired same-height owner-tagged faces. The walking approach node is on the exact slab; the source recipe remains unchanged.`});
 const endpointNodes=ends.map((p,i)=>{
  const slab=model.elementBounds.find(x=>x.elementId===r.floorElementIds[i])!;
  const previous=dataset.nodes.filter(n=>n.roomKey.startsWith('landing:')&&Math.abs(n.pointFeet[2]-p[2])<.05&&dataset.records.find(x=>x.key===n.roomKey)?.properties.nativeFloorId===slab.elementId).sort((a,b)=>Math.hypot(a.pointFeet[0]-p[0],a.pointFeet[1]-p[1])-Math.hypot(b.pointFeet[0]-p[0],b.pointFeet[1]-p[1]))[0];
  let record=previous&&Math.hypot(previous.pointFeet[0]-p[0],previous.pointFeet[1]-p[1])<20?dataset.records.find(x=>x.key===previous.roomKey):undefined;
  if(!record){const key=`landing:${r.id}:${i?'upper':'lower'}`,level=dataset.nativeLevels.find(l=>Math.abs(l.elevationFeet-p[2])<.05);if(!level)return undefined;
   const patch=pc.intersection(slab.loops!.map(l=>l.map(q=>[q[0],q[1]] as RoomPoint)),[[[p[0]-2,p[1]-2],[p[0]+2,p[1]-2],[p[0]+2,p[1]+2],[p[0]-2,p[1]+2]]]) as RoomPoint[][][];
   const poly=patch.find(x=>containsRoomPoint([p[0],p[1]],x[0]!));if(!poly)return undefined;
   const nearest=dataset.records.filter(x=>x.circulation&&Math.abs(x.elevationFeet-p[2])<.05).sort((a,b)=>Math.hypot(a.ringsFeet[0]![0]![0]-p[0],a.ringsFeet[0]![0]![1]-p[1])-Math.hypot(b.ringsFeet[0]![0]![0]-p[0],b.ringsFeet[0]![0]![1]-p[1]))[0];
   record={key,number:'',name:i?'Native ramp upper landing':'Native ramp lower approach',building:nearest?.building??'',levelId:level.id,elevationFeet:p[2],elevationEvidence:`Native floor #${slab.elementId}`,surfaceId:`native-ramp:${r.nativeRampId}:${i}`,circulation:true,stair:false,access:'unknown',walkable:true,confidence:1,ringsFeet:poly,properties:{nativeFloorId:slab.elementId,nativeRampId:r.nativeRampId,generatedLanding:true}};dataset.records.push(record);
  }
  const node:IndoorNode={id:`${r.id}:${i?'upper':'lower'}`,roomKey:record.key,levelId:record.levelId,building:record.building,surfaceId:record.surfaceId,pointFeet:p,geographic:geo([p[0],p[1]]),kind:'connector'};
  dataset.nodes.push(node);return node;
 });
 if(endpointNodes.some(n=>!n)){reject(r.id,'Ramp has no native floor-level endpoint identity.');continue;}
 const [lower,upper]=endpointNodes as [IndoorNode,IndoorNode];
 dataset.edges.push({id:r.id,from:lower.id,to:upper.id,kind:'ramp',pointsFeet:compiledPath,lengthMetres:compiledPath.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((v,k)=>v-compiledPath[i]![k]!))*.3048,0),roomKeys:[lower.roomKey,upper.roomKey],nativeElementId:r.nativeRampId,evidence:'source-bound reviewed ramp + owner-tagged native BRep and continuously checked walking surfaces',accessible:r.accessible,enabled:true,notes:r.notes,...(widthCertificate?{nativeRampSurface:{version:1 as const,sourceModelSha256:dataset.source.modelSha256,nativeRampId:r.nativeRampId,nativeFloorElementIds:r.floorElementIds,pointsFeet:compiledPath,widthCertificate}}:{})});
 dataset.rampDisplay.ramps.push({edgeId:r.id,nativeElementId:r.nativeRampId,levelIds:[lower.levelId,upper.levelId],anchorPointFeet:r.pointsFeet[Math.floor(r.pointsFeet.length/2)]!,trianglesFeet:nativeRampTriangles(model,r.nativeRampId)});
 // Earlier versions stored reviewed ramp approaches in geometry-bound edge
 // reviews. Those exact source recipes are authoritative, not a fresh generic
 // accessibility inference. Recompute the complete native walking proof.
 const reviews=(savedReviews as {edges?:Record<string,{accessible?:'yes'|'no'|'unknown';enabled?:boolean;notes?:string;geometryKey?:string}>}|undefined)?.edges;
 if(reviews?.[r.id]?.geometryKey===JSON.stringify([dataset.source.modelSha256,lower.id,upper.id,[lower.roomKey,upper.roomKey],r.pointsFeet]))restoredReviews.add(r.id);
 for(const side of['lower','upper']){const id=`walk:${r.id}:${side}`,review=reviews?.[id];if(!review?.geometryKey||!review.notes?.trim())continue;
  try{const [sha,fromId,toId,roomKeys,savedPath]=JSON.parse(review.geometryKey) as [string,string,string,string[],Point3[]];const from=dataset.nodes.find(n=>n.id===fromId),to=dataset.nodes.find(n=>n.id===toId);
   if(sha!==dataset.source.modelSha256||!from||!to||from.levelId!==to.levelId||Math.abs(from.pointFeet[2]-to.pointFeet[2])>.05||!Array.isArray(roomKeys)||roomKeys.some(key=>!dataset.records.some(record=>record.key===key&&record.walkable&&record.access!=='staff'))||!Array.isArray(savedPath)||savedPath.length<2||savedPath.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))){reject(id,'Saved approach identities or source geometry are stale.');continue;}
   if(Math.hypot(...from.pointFeet.map((v,k)=>v-savedPath[0]![k]!))>.6||Math.hypot(...to.pointFeet.map((v,k)=>v-savedPath.at(-1)![k]!))>.6){reject(id,'Saved approach endpoint moved beyond one compiler cell; accessibility review is retained in source but not applied.');continue;}
   const path=[from.pointFeet,...savedPath.slice(1,-1),to.pointFeet],region=nativeWalkingRegion(model,dataset,from.pointFeet[2],true);
   if(!supportedWalkingPath(region,path)){reject(id,'Saved approach lacks complete two-foot exact native floor and obstacle clearance.');continue;}
   dataset.edges.push({id,from:from.id,to:to.id,kind:from.surfaceId===to.surfaceId?'walk':'opening',pointsFeet:path,lengthMetres:path.slice(1).reduce((s,p,i)=>s+Math.hypot(...p.map((v,k)=>v-path[i]![k]!))*.3048,0),roomKeys,evidence:'same-model geometry-bound reviewed native ramp approach; complete2ft exact slab, wall, column, door, stair and sourcevoid proof; endpoint registration at most one gridcell',nativeElementId:r.nativeRampId,accessible:review.accessible??'unknown',enabled:review.enabled??true,notes:review.notes});restoredReviews.add(id);
  }catch{reject(id,'Malformed source-bound ramp approach review.');}
 }

 }
 return restoredReviews;
}
