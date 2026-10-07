import pc from 'polygon-clipping';
import type {ConvertResult} from './types.ts';
import type {RoomPoint} from './room-directory.ts';
export type ReviewedDoorApertures={version:1;sourceModelSha256:string;patches:{kind?:"basic-wall-overlap"|"basic-host-missing-opening";preparedDoorEvidence?:{pointFeet:RoomPoint;normalFeet:RoomPoint;footprintFeet:RoomPoint[];roomKeys:string[];evidenceSha256:string};doorEvidence?:{hostId:number;orientedBox:number[][]};id:string;levelId:number;nativeDoorId:number;apertureFeet:RoomPoint[];normalFeet:RoomPoint;wallEvidence:{nativeElementId:number;partsFeet:RoomPoint[][]}[];frameEvidence:{nativeElementId:number;orientedBox:number[][]}[];notes:string}[]};
const applied=new WeakMap<ConvertResult,ReviewedDoorApertures>();
type OriginalHostPart={elementId:number;polygon:RoomPoint[];approximate?:boolean};
const originalHosts=new WeakMap<ConvertResult,Map<string,OriginalHostPart[]>>();
const area=(ps:RoomPoint[][][])=>ps.reduce((s,rs)=>s+rs.reduce((a,r,i)=>a+(i?-1:1)*Math.abs(r.reduce((s,p,j)=>{const q=r[(j+1)%r.length]!;return s+p[0]*q[1]-q[0]*p[1]},0))/2,0),0);
export function validateReviewedDoorApertures(v:unknown,sha?:string):asserts v is ReviewedDoorApertures|undefined {
 if(v===undefined)return;const x=v as ReviewedDoorApertures;const pts=(p:unknown):p is RoomPoint[]=>Array.isArray(p)&&p.length>=3&&p.length<=100&&p.every(q=>Array.isArray(q)&&q.length===2&&q.every(n=>Number.isFinite(n)&&Math.abs(n)<1e7));
 if(!x||x.version!==1||!(/^[a-f0-9]{64}$/).test(x.sourceModelSha256)||(sha!==undefined&&sha!==x.sourceModelSha256)||!Array.isArray(x.patches)||x.patches.length>1000||x.patches.some(p=>!p||!p.id||!Number.isSafeInteger(p.levelId)||!Number.isSafeInteger(p.nativeDoorId)||p.nativeDoorId<=0||!pts(p.apertureFeet)||p.apertureFeet.length!==4||p.apertureFeet.some((q,i)=>Math.hypot(q[0]-p.apertureFeet[(i+1)%4]![0],q[1]-p.apertureFeet[(i+1)%4]![1])>(p.kind==="basic-host-missing-opening"?10:6))||!Array.isArray(p.normalFeet)||p.normalFeet.length!==2||p.normalFeet.some(n=>!Number.isFinite(n))||Math.abs(Math.hypot(...p.normalFeet)-1)>.000001||!Array.isArray(p.wallEvidence)||!p.wallEvidence.length||p.wallEvidence.length>20||p.wallEvidence.some(w=>!Number.isSafeInteger(w.nativeElementId)||!Array.isArray(w.partsFeet)||!w.partsFeet.length||!w.partsFeet.every(pts))||!Array.isArray(p.frameEvidence)||p.frameEvidence.length!==(p.kind==="basic-wall-overlap"||p.kind==="basic-host-missing-opening"?0:4)||p.frameEvidence.some(f=>!Number.isSafeInteger(f.nativeElementId)||!Array.isArray(f.orientedBox)||f.orientedBox.length!==8||f.orientedBox.some(q=>!Array.isArray(q)||q.length!==3||q.some(n=>!Number.isFinite(n))))||(p.kind!==undefined&&p.kind!=="basic-wall-overlap"&&p.kind!=="basic-host-missing-opening")||((p.kind==="basic-wall-overlap"||p.kind==="basic-host-missing-opening")&&(!p.doorEvidence||!Number.isSafeInteger(p.doorEvidence.hostId)||p.doorEvidence.hostId<=0||!Array.isArray(p.doorEvidence.orientedBox)||p.doorEvidence.orientedBox.length!==8||p.doorEvidence.orientedBox.some(q=>!Array.isArray(q)||q.length!==3||q.some(n=>!Number.isFinite(n)))))||(p.kind==="basic-host-missing-opening"&&(!p.preparedDoorEvidence||p.wallEvidence.length!==1||p.wallEvidence[0]!.nativeElementId!==p.doorEvidence?.hostId||!(/^[a-f0-9]{64}$/).test(p.preparedDoorEvidence.evidenceSha256)||![p.preparedDoorEvidence.pointFeet,p.preparedDoorEvidence.normalFeet].every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite))||JSON.stringify(p.preparedDoorEvidence.normalFeet)!==JSON.stringify(p.normalFeet)||!pts(p.preparedDoorEvidence.footprintFeet)||p.preparedDoorEvidence.footprintFeet.length!==4||!Array.isArray(p.preparedDoorEvidence.roomKeys)||p.preparedDoorEvidence.roomKeys.length!==2||new Set(p.preparedDoorEvidence.roomKeys).size!==2||p.preparedDoorEvidence.roomKeys.some(k=>typeof k!=='string'||!k)))||typeof p.notes!=='string'||!p.notes.trim()||p.notes.length>10000)||new Set(x.patches.map(p=>p.id)).size!==x.patches.length||new Set(x.patches.map(p=>`${p.levelId}:${p.nativeDoorId}`)).size!==x.patches.length)throw new Error('Invalid reviewed native door aperture patch.');
}
/** Explicit review of overlapping source containers, not automatic doorway recovery. */
export function withReviewedDoorApertures(model:ConvertResult,value:unknown,sha:string,plan:(m:ConvertResult,level:number)=>{walls:{elementId:number;polygon:RoomPoint[];approximate?:boolean}[];columns:{polygon:RoomPoint[]}[];floors:RoomPoint[][][];cutElevation:number}):ConvertResult {
 validateReviewedDoorApertures(value,sha);if(!value?.patches.length)return model;
 const originalParts=new Map<string,OriginalHostPart[]>();
 for(const p of value.patches){
  const g=plan(model,p.levelId),door=model.elementBounds.find(r=>r.elementId===p.nativeDoorId&&r.categoryId===-2000023),parents=new Map((model.nativeHostRelations??[]).filter(r=>r.evidence==='persisted').map(r=>[r.elementId,r.hostId]));
  if(!door?.orientedBox||door.orientedBox.length!==8||!p.frameEvidence.every(f=>{const r=model.elementBounds.find(r=>r.elementId===f.nativeElementId);return r?.categoryId===-2000171&&r.renderGeometryProvenance==='native'&&JSON.stringify(r.orientedBox)===JSON.stringify(f.orientedBox)&&parents.get(r.elementId)===parents.get(door.elementId)}))throw new Error('Reviewed doorway has stale/incomplete native frame evidence.');
  for(const w of p.wallEvidence){const parts=g.walls.filter(q=>q.elementId===w.nativeElementId);if(JSON.stringify(parts.map(q=>q.polygon))!==JSON.stringify(w.partsFeet))throw new Error('Reviewed doorway has stale original wall evidence.');originalParts.set(`${p.levelId}:${w.nativeElementId}`,parts);}
  const u:RoomPoint=[-p.normalFeet[1],p.normalFeet[0]],project=(q:readonly number[],v:RoomPoint)=>q[0]!*v[0]+q[1]!*v[1],lo=Math.min(...door.orientedBox.map(q=>project(q,u))),hi=Math.max(...door.orientedBox.map(q=>project(q,u))),as=p.apertureFeet.map(q=>project(q,u));
  const bottom=Math.min(...door.orientedBox.map(q=>q[2]!)),top=Math.max(...door.orientedBox.map(q=>q[2]!));
  const cutFrames=p.frameEvidence.map(f=>({lo:Math.min(...f.orientedBox.map(q=>project(q,u))),hi:Math.max(...f.orientedBox.map(q=>project(q,u))),near:Math.min(...f.orientedBox.map(q=>project(q,p.normalFeet))),far:Math.max(...f.orientedBox.map(q=>project(q,p.normalFeet))),bottom:Math.min(...f.orientedBox.map(q=>q[2]!)),top:Math.max(...f.orientedBox.map(q=>q[2]!))})).filter(f=>f.bottom<g.cutElevation&&f.top>g.cutElevation);
  const ns=p.apertureFeet.map(q=>project(q,p.normalFeet));
  const rectangular=p.apertureFeet.every((q,i)=>{const next=p.apertureFeet[(i+1)%4]!,a=(next[0]-q[0])*u[0]+(next[1]-q[1])*u[1],b=(next[0]-q[0])*p.normalFeet[0]+(next[1]-q[1])*p.normalFeet[1];return Math.abs(a)<=1e-6||Math.abs(b)<=1e-6;});
  if(p.kind==='basic-host-missing-opening'){
    // A single original basic host can retain an analytical wall mask across an
    // existing physical door. Only its source-bound finite aperture is cut.
    const proof=p.preparedDoorEvidence!,e=p.doorEvidence!,host=model.elementBounds.find(r=>r.elementId===e.hostId),solid=host?.solid,parts=g.walls.filter(w=>w.elementId===e.hostId);
    if(parents.get(door.elementId)!==e.hostId||JSON.stringify(door.orientedBox)!==JSON.stringify(e.orientedBox)||host?.categoryId!==-2000011||host.wallKind!=='basic'||host.renderGeometryProvenance!=='native'||!solid||parts.length!==1||parts.some(w=>w.approximate)||p.wallEvidence.length!==1||p.wallEvidence[0]!.nativeElementId!==e.hostId||g.cutElevation<=bottom||g.cutElevation>=top||!rectangular)throw new Error('Reviewed single basic host has stale physical door or native host evidence.');
    const direction:RoomPoint=[solid.end.x-solid.start.x,solid.end.y-solid.start.y],length=Math.hypot(...direction),depth=door.orientedBox.map(q=>project(q,p.normalFeet)),hostU=parts[0]!.polygon.map(q=>project(q,u)),hostN=parts[0]!.polygon.map(q=>project(q,p.normalFeet)),near=Math.min(...depth),far=Math.max(...depth),hn0=Math.min(...hostN),hn1=Math.max(...hostN);
    const expected:RoomPoint[]=[[lo,near],[hi,near],[hi,far],[lo,far]].map(([a,b])=>[a!*u[0]+b!*p.normalFeet[0],a!*u[1]+b!*p.normalFeet[1]]);
    const original=proof.footprintFeet,center:RoomPoint=[(lo+hi)/2*u[0]+(near+far)/2*p.normalFeet[0],(lo+hi)/2*u[1]+(near+far)/2*p.normalFeet[1]];
    const ring=parts[0]!.polygon,edges=ring.map((q,i)=>{const next=ring[(i+1)%ring.length]!;return[Math.abs(project(next,u)-project(q,u)),Math.abs(project(next,p.normalFeet)-project(q,p.normalFeet))];});
    if(length<hi-lo+.02||Math.abs(direction[0]*p.normalFeet[0]+direction[1]*p.normalFeet[1])>length*1e-6||ring.length!==4||edges.some(([a,b])=>a!>1e-6&&b!>1e-6)||hi-lo>10||far-near>2||solid.thickness<=0||Math.abs(hn1-hn0-solid.thickness)>1e-6||hn0<near-1e-6||hn1>far+1e-6||lo<Math.min(...hostU)+.01||hi>Math.max(...hostU)-.01||Math.abs(Math.min(...ns)-near)>1e-6||Math.abs(Math.max(...ns)-far)>1e-6||area(pc.xor([original],[expected]) as RoomPoint[][][])>1e-8||Math.hypot(proof.pointFeet[0]-center[0],proof.pointFeet[1]-center[1])>1e-8||Math.abs(area(pc.intersection([p.apertureFeet],[ring]) as RoomPoint[][][])-(hi-lo)*(hn1-hn0))>1e-6)throw new Error('Reviewed single host opening is not the exact finite physical door aperture.');
    if(g.walls.some(w=>w.elementId!==e.hostId&&area(pc.intersection([p.apertureFeet],[w.polygon]) as RoomPoint[][][])>.001))throw new Error('Reviewed single host opening intersects a foreign wall.');
  }else if(p.kind==='basic-wall-overlap'){
    // Explicit, model-bound correction for a second basic partition protruding
    // just beyond a physical door's host. Never infer a new opening from a gap.
    const e=p.doorEvidence!,host=g.walls.filter(w=>w.elementId===e.hostId),parts=p.wallEvidence.flatMap(w=>w.partsFeet),dn=door.orientedBox.map(q=>project(q,p.normalFeet)),near=Math.min(...dn),far=Math.max(...dn);
    if(parents.get(door.elementId)!==e.hostId||JSON.stringify(door.orientedBox)!==JSON.stringify(e.orientedBox)||p.wallEvidence.length<2||!p.wallEvidence.some(w=>w.nativeElementId===e.hostId)||!host.length||p.wallEvidence.some(w=>model.elementBounds.find(r=>r.elementId===w.nativeElementId)?.categoryId!==-2000011||g.walls.some(q=>q.elementId===w.nativeElementId&&q.approximate))||g.cutElevation<=bottom||g.cutElevation>=top||!rectangular)throw new Error('Reviewed basic doorway has stale native host or door evidence.');
    for(const ring of parts){
      const n=ring.map(q=>project(q,p.normalFeet)),edges=ring.map((q,i)=>{const next=ring[(i+1)%ring.length]!;return[Math.abs(project(next,u)-project(q,u)),Math.abs(project(next,p.normalFeet)-project(q,p.normalFeet))];});
      if(ring.length!==4||Math.max(...n)-Math.min(...n)>2||Math.min(...n)<near-.1-1e-6||Math.max(...n)>far+.1+1e-6||edges.some(([a,b])=>a!>1e-6&&b!>1e-6)||!host.some(h=>area(pc.intersection([h.polygon],[ring]) as RoomPoint[][][])>.000001))throw new Error('Reviewed basic doorway is not a small overlapping parallel host correction.');
    }
    const all=[...door.orientedBox,...parts.flat()],depth=all.map(q=>project(q,p.normalFeet));
    if(Math.abs(Math.min(...ns)-Math.min(...depth))>1e-6||Math.abs(Math.max(...ns)-Math.max(...depth))>1e-6)throw new Error('Reviewed basic doorway depth must follow exact door and overlapping wall faces.');
  }else if(g.cutElevation<=bottom||g.cutElevation>=top||cutFrames.length!==2||!cutFrames.some(f=>Math.abs(f.hi-lo)<1e-6&&f.lo<lo)||!cutFrames.some(f=>Math.abs(f.lo-hi)<1e-6&&f.hi>hi)||Math.min(...ns)>Math.min(...cutFrames.map(f=>f.near))+1e-6||Math.max(...ns)<Math.max(...cutFrames.map(f=>f.far))-1e-6||!rectangular)throw new Error('Reviewed aperture is outside a complete native jamb pair at this floor cut.');
  if(Math.abs(Math.min(...as)-lo)>1e-6||Math.abs(Math.max(...as)-hi)>1e-6||hi-lo<2||!g.floors.length||area(pc.difference([p.apertureFeet],...g.floors) as RoomPoint[][][])>.001||g.columns.some(c=>area(pc.intersection([p.apertureFeet],[c.polygon]) as RoomPoint[][][])>.001))throw new Error('Reviewed aperture crosses unsupported floor, column or measured door jamb.');
 }
 const reviewed={...model};applied.set(reviewed,value);originalHosts.set(reviewed,originalParts);return reviewed;
}
export function reviewedDoorOpening(model:ConvertResult,level:number,id:number){return applied.get(model)?.patches.find(p=>p.levelId===level&&p.nativeDoorId===id);}
/** Uncut, validated native host faces keep other door diagnostics independent
 * of a neighbouring aperture's prepared wall subtraction. */
export function reviewedDoorHostEvidence(model:ConvertResult,level:number,hostId:number){return originalHosts.get(model)?.get(`${level}:${hostId}`);}
export function applyReviewedDoorWallCuts<T extends {elementId:number;polygon:RoomPoint[];approximate:boolean}>(model:ConvertResult,level:number,walls:T[]):T[]{
 return walls.flatMap(w=>{const ps=applied.get(model)?.patches.filter(p=>p.levelId===level&&p.wallEvidence.some(e=>e.nativeElementId===w.elementId))??[];if(!ps.length)return[w];const parts=pc.difference([w.polygon],...ps.map(p=>[p.apertureFeet])) as RoomPoint[][][];if(parts.some(rs=>rs.length!==1))throw new Error('Reviewed door cut creates unsupported hole topology.');return parts.map(rs=>({...w,polygon:rs[0]!}));});
}

/** Recover source evidence for composition only. Every current host must equal
 * either the exact original parts or their exact declared aperture subtraction.
 * This never restores material to prepared walls or admits stale source faces. */
export function reviewedDoorWallSourceEvidence<T extends {levelId:number;nativeElementId:number;ringsFeet:RoomPoint[][];kind?:"wall"|"column";approximate?:boolean;reviewPatchId?:string}>(walls:T[],value:unknown,sha:string,boundaries?:{patches:{id:string;levelId:number;status:string;ringsFeet:RoomPoint[][];wallEvidence:{nativeElementId:number;ringsFeet:RoomPoint[][]}[]}[]}):T[]{
 validateReviewedDoorApertures(value,sha);if(!value?.patches.length)return walls;
 const groups=new Map<string,{levelId:number;id:number;parts:RoomPoint[][];apertures:RoomPoint[][]}>();
 for(const p of value.patches)for(const w of p.wallEvidence){const key=p.levelId+':'+w.nativeElementId,old=groups.get(key);if(old){if(JSON.stringify(old.parts)!==JSON.stringify(w.partsFeet))throw new Error('Conflicting original doorway host evidence.');old.apertures.push(p.apertureFeet);}else groups.set(key,{levelId:p.levelId,id:w.nativeElementId,parts:w.partsFeet,apertures:[p.apertureFeet]});}
 let result=[...walls];
 for(const g of groups.values()){
  // A saved continuation can already bind retained post-cut pieces. Restore
  // only referenced full original faces; current-piece evidence stays checked
  // against current geometry and never becomes an archived-source exception.
  const key=(rs:RoomPoint[][])=>JSON.stringify(rs.map(r=>r.map(p=>p.map(n=>Math.round(n*1e6)/1e6))));
  const usesOriginal=(p:NonNullable<typeof boundaries>['patches'][number])=>p.status==='applied'&&p.levelId===g.levelId&&p.wallEvidence.some(w=>w.nativeElementId===g.id&&g.parts.some(r=>key([r])===key(w.ringsFeet)));
  if(!boundaries?.patches.some(usesOriginal))continue;
  if(!walls.some(w=>w.levelId===g.levelId))continue; // Compiler levels are populated incrementally.
  const current=walls.filter(w=>w.levelId===g.levelId&&w.nativeElementId===g.id&&!w.reviewPatchId);
  if(!current.length||current.some(w=>w.approximate||w.kind!=='wall'))throw new Error('Reviewed doorway host source evidence has no precise prepared wall.');
  const actual=current.map(w=>w.ringsFeet),original=g.parts.map(r=>[r]),cut=pc.difference(original,...g.apertures.map(r=>[r]));
  const equal=(a:RoomPoint[][][],b:RoomPoint[][][])=>area(pc.xor(a,b) as RoomPoint[][][])<=1e-6;
  if(!equal(actual,original)&&!equal(actual,cut as RoomPoint[][][]))throw new Error('Prepared doorway host differs from exact original/aperture composition.');
  for(const p of boundaries?.patches??[])if(usesOriginal(p)){
   if(g.apertures.some(aperture=>area(pc.intersection(p.ringsFeet,[aperture]) as RoomPoint[][][])>1e-8)||(area(pc.intersection(p.ringsFeet,original) as RoomPoint[][][])>1e-10&&area(pc.intersection(p.ringsFeet,cut) as RoomPoint[][][])<=1e-10))throw new Error('Boundary continuation loses retained host contact or fills a reviewed doorway: '+p.id);
  }
  for(const r of g.parts)if(!current.some(w=>key(w.ringsFeet)===key([r])))result.push({...current[0]!,ringsFeet:[r]});
 }
 return result;
}
