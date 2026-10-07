import pc from 'polygon-clipping';
import type {ConvertResult,ElementBoundsRecord} from './types.ts';
import type {IndoorDataset} from './indoor-contract.ts';
type P=[number,number];
const hull=(points:P[]):P[]=>{
 const pts=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a:P,b:P,c:P)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=(ps:P[])=>{const h:P[]=[];for(const p of ps){while(h.length>1&&cross(h.at(-2)!,h.at(-1)!,p)<=0)h.pop();h.push(p)}return h};
 return [...half(pts).slice(0,-1),...half([...pts].reverse()).slice(0,-1)];
};
const area=(parts:pc.MultiPolygon)=>parts.reduce((s,p)=>s+p.reduce((sum,r,i)=>sum+(i?-1:1)*Math.abs(r.reduce((a,q,j)=>{const t=r[(j+1)%r.length]!;return a+q[0]*t[1]-t[0]*q[1]},0))/2,0),0);
const footprint=(r:ElementBoundsRecord)=>r.orientedBox?.length?hull(r.orientedBox.map(p=>[p[0],p[1]])):undefined;
/** Optional visual evidence only. Original routing barriers/rooms/portals stay exact. */
export function prepareNativeWindowDisplay(model:ConvertResult,data:IndoorDataset,mode:'native'|'simplified'='simplified'){
 const records=new Map(model.elementBounds.map(r=>[r.elementId,r]));
 const children=new Map<number,Set<number>>();const hostFor=new Map<number,number>();
 for(const relation of model.nativeHostRelations??[]){if(relation.kind!=='host')continue;hostFor.set(relation.elementId,relation.hostId);if(!children.has(relation.hostId))children.set(relation.hostId,new Set());children.get(relation.hostId)!.add(relation.elementId)}
 const materials=new Map(model.nativeMaterialDefinitions?.map(m=>[m.elementId,m]));
 const assignments=new Map<number,Set<number>>();
 for(const m of model.nativeElementMaterialAssignments??[]){if(!assignments.has(m.elementId))assignments.set(m.elementId,new Set());assignments.get(m.elementId)!.add(m.materialId)}
 const display:NonNullable<IndoorDataset['windowDisplay']>={version:1,sourceModelSha256:data.source.modelSha256,mode,routing:'original-barriers',elements:[],wallCuts:[],unresolvedNativeElementIds:[]};
 const bounds=new WeakMap<object,number[]>();
 const box=(rings:P[][])=>{let b=bounds.get(rings);if(!b){const q=rings.flat();b=[Math.min(...q.map(p=>p[0])),Math.min(...q.map(p=>p[1])),Math.max(...q.map(p=>p[0])),Math.max(...q.map(p=>p[1]))];bounds.set(rings,b)}return b};
 const overlaps=(a:number[],b:number[])=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
 for(const level of data.nativeLevels){
  const cut=level.elevationFeet+4;
  const hosts=[...records.values()].filter(r=>r.wallKind==='curtain'&&r.boundsFeet.min.z-.1<=cut&&r.boundsFeet.max.z+.1>=cut);
  const ids=new Set(hosts.flatMap(h=>[...(children.get(h.elementId)??[])]));
  for(const r of records.values())if(r.categoryId===-2000014&&r.boundsFeet.min.z-.1<=cut&&r.boundsFeet.max.z+.1>=cut)ids.add(r.elementId);

  for(const id of ids){const r=records.get(id);if(!r||![-2000014,-2000170,-2000171].includes(r.categoryId??0))continue;
   const ring=footprint(r);if(!ring||ring.length<3){display.unresolvedNativeElementIds.push(id);continue;}
   if(r.boundsFeet.max.z<level.elevationFeet-.1)continue;
   const host=records.get(hostFor.get(id)??id)??r;
   const materialIds=[...(assignments.get(id)??[])];const material=materialIds.length===1?materials.get(materialIds[0]!):undefined;
   const transparency=material?.appearance?.transparency;
   const role=r.categoryId===-2000171?'frame':transparency!==undefined?(transparency>0?'glazing':'opaque-panel'):/glaz|glass|стекл/i.test(r.typeName??'')?'glazing':'unknown-panel';
   display.elements.push({nativeElementId:id,hostId:host.elementId,levelId:level.id,role,footprintFeet:ring,baseElevationFeet:r.boundsFeet.min.z,topElevationFeet:r.boundsFeet.max.z,assemblyTopElevationFeet:host.boundsFeet.max.z,materialId:material?.elementId,transparency,materialColorSrgb:material?.appearance?.baseColorSrgb,materialEvidence:transparency!==undefined?'native-material':'category-or-type'});

  }

  // Complete straight assemblies only. Never substitute an axis-aligned envelope.
  for(const host of hosts){
   const members=[...(children.get(host.elementId)??[])].map(id=>records.get(id));
   if(!members.length||members.some(r=>!r||![-2000170,-2000171].includes(r.categoryId??0)||!footprint(r)?.length)){display.unresolvedNativeElementIds.push(host.elementId);continue;}
   const precise=members as ElementBoundsRecord[];
   const points=precise.flatMap(r=>footprint(r)!);
   const panels=precise.filter(r=>r.categoryId===-2000170);
   if(!panels.length)continue;
   for(const w of data.walls.filter(w=>w.levelId===level.id&&w.kind!=='column'&&!w.approximate&&!w.reviewPatchId)){
    const native=records.get(w.nativeElementId);if(!native||native.wallKind==='curtain')continue;
    const solid=native.solids?.length===1?native.solids[0]:native.solid;
    if(!solid||solid.thickness<=0)continue;
    const dx=solid.end.x-solid.start.x,dy=solid.end.y-solid.start.y,len=Math.hypot(dx,dy);if(len<.1)continue;
    const u:P=[dx/len,dy/len],normal:P=[-u[1],u[0]];
    const along=(p:P)=>(p[0]-solid.start.x)*u[0]+(p[1]-solid.start.y)*u[1];
    const across=(p:P)=>(p[0]-solid.start.x)*normal[0]+(p[1]-solid.start.y)*normal[1];
    if(points.some(p=>Math.abs(across(p))>solid.thickness/2+.03))continue;
    // Panel long edges must run along the parent wall; avoid perpendicular joins.
    if(panels.some(p=>{const q=footprint(p)!;const edges=q.map((v,i)=>{const t=q[(i+1)%q.length]!;return [t[0]-v[0],t[1]-v[1]]as P}).sort((a,b)=>Math.hypot(...b)-Math.hypot(...a));return Math.abs(edges[0]![0]*normal[0]+edges[0]![1]*normal[1])>.02}))continue;
    const low=Math.min(...points.map(along)),high=Math.max(...points.map(along));if(low<.02||high>len-.02||high-low<.3)continue;
    const at=(a:number,b:number):P=>[solid.start.x+a*u[0]+b*normal[0],solid.start.y+a*u[1]+b*normal[1]];
    const aperture=[at(low,-solid.thickness/2),at(high,-solid.thickness/2),at(high,solid.thickness/2),at(low,solid.thickness/2)];
    try{if(area(pc.difference([aperture],w.ringsFeet))>.005)continue;}catch{continue}
    const memberIds=new Set(precise.map(r=>r.elementId));
    const crossesOther=data.walls.some(other=>other.levelId===level.id&&other.nativeElementId!==w.nativeElementId&&other.nativeElementId!==host.elementId&&!memberIds.has(other.nativeElementId)&&overlaps(box([aperture]),box(other.ringsFeet))&&(()=>{try{return area(pc.intersection([aperture],other.ringsFeet))>.015}catch{return true}})());
    if(crossesOther)continue;
    display.wallCuts.push({hostId:host.elementId,nativeWallId:w.nativeElementId,levelId:level.id,wallGeometryKey:JSON.stringify(w.ringsFeet),ringsFeet:[aperture],baseElevationFeet:Math.min(...precise.map(r=>r.boundsFeet.min.z)),topElevationFeet:Math.max(...precise.map(r=>r.boundsFeet.max.z)),assemblyTopElevationFeet:host.boundsFeet.max.z});
    break;
   }
  }
 }
 display.unresolvedNativeElementIds=[...new Set(display.unresolvedNativeElementIds)].sort((a,b)=>a-b);
 data.windowDisplay=display;return display;
}
