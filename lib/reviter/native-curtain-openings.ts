import type {ConvertResult,ElementBoundsRecord} from './types.ts';
import type {RoomPoint} from './room-directory.ts';
export type NativeCurtainOpening={hostId:number;doorId:number;memberIds:number[];cutElevationFeet:number;apertureFeet:RoomPoint[];barriers:{elementId:number;polygon:RoomPoint[];approximate:false}[];evidence:'persisted-curtain-frame-members'};
const sectionsCache=new WeakMap<ConvertResult,Map<number,NativeCurtainOpening>>();
const indexed=new WeakMap<ConvertResult,{records:Map<number,ElementBoundsRecord>;children:Map<number,number[]>;owners:Map<number,Set<number>>}>();
const min=(v:number[])=>Math.min(...v),max=(v:number[])=>Math.max(...v);
/** Replace a curtain container only when actual persisted members bound one
 * doorway on all four sides. Unknown placed geometry, opaque panels and cuts
 * outside that opening retain the container. The leaf fixes width/orientation;
 * exact frame members fix through-depth. No door bounding swing is an aperture. */
export function recoverNativeCurtainOpenings(model:ConvertResult,cutElevationFeet:number):NativeCurtainOpening[]{
 let index=indexed.get(model);if(!index){const children=new Map<number,number[]>(),owners=new Map<number,Set<number>>();for(const r of model.nativeHostRelations??[])if(r.evidence==='persisted'){const a=children.get(r.hostId)??[];a.push(r.elementId);children.set(r.hostId,a);const o=owners.get(r.elementId)??new Set<number>();o.add(r.hostId);owners.set(r.elementId,o);}index={records:new Map(model.elementBounds.map(r=>[r.elementId,r])),children,owners};indexed.set(model,index);}
 const output:NativeCurtainOpening[]=[];
 for(const [hostId,ids]of index.children){const host=index.records.get(hostId);if(host?.categoryId!==-2000011||host.wallKind!=='curtain'||host.arcs?.length)continue;
  const members=[...new Set(ids)].flatMap(id=>index!.records.get(id)?[index!.records.get(id)!]:[]);
  // Companions without placed bounds are not substituted as geometry. Every
  // actual member must have a precise box and a recognised assembly role.
  if(members.some(r=>index!.owners.get(r.elementId)?.size!==1||![-2000023,-2000170,-2000171].includes(r.categoryId??0)||r.orientedBox?.length!==8))continue;
  const doors=members.filter(r=>r.categoryId===-2000023);if(doors.length!==1)continue;const door=doors[0]!;
  const bottom=min(door.orientedBox!.map(p=>p[2])),top=max(door.orientedBox!.map(p=>p[2]));if(cutElevationFeet<=bottom+.01||cutElevationFeet>=top-.01)continue;
  const points=door.orientedBox!.slice(0,4).map(([x,y])=>[x,y]as RoomPoint),edges=points.map((p,i)=>{const q=points[(i+1)%4]!;return{p,q,len:Math.hypot(q[0]-p[0],q[1]-p[1])}}).sort((a,b)=>b.len-a.len),edge=edges[0]!;
  if(edge.len<2||edges[1]!.len<edge.len-.00001)continue;const u:RoomPoint=[(edge.q[0]-edge.p[0])/edge.len,(edge.q[1]-edge.p[1])/edge.len],n:RoomPoint=[-u[1],u[0]],project=(p:readonly number[],v:RoomPoint)=>p[0]!*v[0]+p[1]!*v[1];
  const bounds=(r:ElementBoundsRecord)=>{const ps=r.orientedBox!;const us=ps.map(p=>project(p,u)),ns=ps.map(p=>project(p,n));return{r,lo:min(us),hi:max(us),near:min(ns),far:max(ns),bottom:min(ps.map(p=>p[2])),top:max(ps.map(p=>p[2]))}};
  const leaf=bounds(door),parts=members.filter(r=>r!==door).map(bounds),mullions=parts.filter(p=>p.r.categoryId===-2000171),near=(a:number,b:number)=>Math.abs(a-b)<=.05;
  const left=mullions.filter(p=>near(p.hi,leaf.lo)&&p.hi-p.lo>.02&&p.hi-p.lo<.75&&p.bottom<=bottom+.05&&p.top>=top-.05);
  const right=mullions.filter(p=>near(p.lo,leaf.hi)&&p.hi-p.lo>.02&&p.hi-p.lo<.75&&p.bottom<=bottom+.05&&p.top>=top-.05);
  const sill=mullions.filter(p=>near(p.lo,leaf.lo)&&near(p.hi,leaf.hi)&&near(p.top,bottom)&&p.top-p.bottom>.02&&p.top-p.bottom<.75);
  const head=mullions.filter(p=>near(p.lo,leaf.lo)&&near(p.hi,leaf.hi)&&near(p.bottom,top)&&p.top-p.bottom>.02&&p.top-p.bottom<.75);
  if(left.length!==1||right.length!==1||sill.length!==1||head.length!==1)continue;
  const frame=[left[0]!,right[0]!,sill[0]!,head[0]!];const nearN=min(frame.map(p=>p.near)),farN=max(frame.map(p=>p.far));if(farN-nearN>1||frame.some(p=>!near(p.near,nearN)||!near(p.far,farN))||leaf.near<nearN-.05||leaf.far>farN+.05)continue;
  const clearLo=max([leaf.lo,left[0]!.hi]),clearHi=min([leaf.hi,right[0]!.lo]);if(clearHi-clearLo<2)continue;
  // All physical members must belong to this frame envelope; otherwise this
  // one door does not prove the larger curtain assembly is completely known.
  const outerLo=left[0]!.lo,outerHi=right[0]!.hi;
  if(parts.some(p=>p.lo<outerLo-.05||p.hi>outerHi+.05||p.near<nearN-.05||p.far>farN+.05))continue;
  const cut=parts.filter(p=>p.bottom<=cutElevationFeet&&p.top>=cutElevationFeet);
  if(cut.some(p=>p.lo<clearHi-1e-6&&p.hi>clearLo+1e-6))continue;
  const hb=host.boundsFeet,hostXY:[[number,number],[number,number],[number,number],[number,number]]=[[hb.min.x,hb.min.y],[hb.max.x,hb.min.y],[hb.max.x,hb.max.y],[hb.min.x,hb.max.y]],hUs=hostXY.map(p=>project(p,u));
  if(!near(min(hUs),outerLo)||!near(max(hUs),outerHi))continue;
  const at=(uu:number,nn:number):RoomPoint=>[u[0]*uu+n[0]*nn,u[1]*uu+n[1]*nn];
  output.push({hostId,doorId:door.elementId,memberIds:members.map(r=>r.elementId),cutElevationFeet,apertureFeet:[at(clearLo,nearN),at(clearHi,nearN),at(clearHi,farN),at(clearLo,farN)],barriers:cut.map(p=>({elementId:p.r.elementId,polygon:[at(p.lo,p.near),at(p.hi,p.near),at(p.hi,p.far),at(p.lo,p.far)],approximate:false})),evidence:'persisted-curtain-frame-members'});
 }
 return output;
}

/** A proven curtain frame remains an assembly at ankle/overhead cuts too.
 * Reconstruct every actual member at the requested height, including sills and
 * opaque panels. This does not declare a passable opening at that height. */
export function recoverNativeCurtainMemberSections(model:ConvertResult,cutElevationFeet:number):NativeCurtainOpening[]{
 let proven=sectionsCache.get(model);const records=indexed.get(model)?.records??new Map(model.elementBounds.map(r=>[r.elementId,r]));
 if(!proven){const curtainIds=new Set(model.elementBounds.filter(r=>r.wallKind==='curtain').map(r=>r.elementId)),doorIds=new Set((model.nativeHostRelations??[]).filter(r=>curtainIds.has(r.hostId)&&r.evidence==='persisted').map(r=>r.elementId));
 const heights=[...new Set(model.elementBounds.filter(r=>doorIds.has(r.elementId)&&r.categoryId===-2000023&&r.orientedBox?.length===8).map(r=>(min(r.orientedBox!.map(p=>p[2]))+max(r.orientedBox!.map(p=>p[2])))/2))];
 proven=new Map<number,NativeCurtainOpening>();for(const height of heights)for(const opening of recoverNativeCurtainOpenings(model,height))proven.set(opening.hostId,opening);sectionsCache.set(model,proven);}
 return [...proven.values()].flatMap(opening=>{
  const host=records.get(opening.hostId)!;if(cutElevationFeet<host.boundsFeet.min.z||cutElevationFeet>host.boundsFeet.max.z)return [];
  const barriers=opening.memberIds.flatMap(id=>{const r=records.get(id)!;if(r.categoryId===-2000023||cutElevationFeet<min(r.orientedBox!.map(p=>p[2]))||cutElevationFeet>max(r.orientedBox!.map(p=>p[2])))return [];
   return [{elementId:id,polygon:r.orientedBox!.slice(0,4).map(([x,y])=>[x,y]as RoomPoint),approximate:false as const}];});
  return [{...opening,cutElevationFeet,barriers}];
 });
}
