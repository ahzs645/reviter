import pc from "polygon-clipping";
import { containsRoomPoint, type RoomPoint } from "./room-directory.ts";
import { routingFloorPlateRecords, nativeFloorPolygons, nativeLowSlabRecords } from "./routing-floor-support.ts";
import { architecturalPlanGeometry, nativeWallSolidPolygon, boundedNativeWallFootprints } from "./architectural-plan.ts";
import { recoverNativeCurtainMemberSections } from "./native-curtain-openings.ts";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset, IndoorNode, IndoorEdge } from "./indoor-contract.ts";
type Point3 = [number, number, number];
type Polygon = RoomPoint[][];
const area = (polys: RoomPoint[][][]) => polys.reduce((s,p)=>s+p.reduce((a,r,i)=>a+(i?-1:1)*Math.abs(r.reduce((s,q,j)=>s+q[0]*r[(j+1)%r.length]![1]-q[1]*r[(j+1)%r.length]![0],0)/2),0),0);
const inside = (p: RoomPoint, poly: Polygon) => !!poly[0] && containsRoomPoint(p, poly[0]) && !poly.slice(1).some(h=>containsRoomPoint(p,h));
const bounds = (p: Polygon) => {const ps=p.flat();return [Math.min(...ps.map(q=>q[0])),Math.min(...ps.map(q=>q[1])),Math.max(...ps.map(q=>q[0])),Math.max(...ps.map(q=>q[1]))] as const;};
/** A full two-foot swept strip; no distance-only or bounding-box connection. */
export const walkingStrip = (a: RoomPoint,b: RoomPoint,width=2):Polygon => {const dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy),x=-dy/n*width/2,y=dx/n*width/2;return [[[a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y]]];};

export type NativeWalkingRegion = {
  elevationFeet:number; floors:Polygon[]; barriers:Polygon[]; masks:Polygon[]; wallBarriers?:Polygon[];
  circulation?:Polygon[]; nativeFloorIds:number[];
};
/** Floors are exact profiles at the walking elevation, including all inner holes.
 * Solid obstacles are sliced at ankle height; every native doorway is a veto so
 * recovery cannot bypass a disabled door by cutting through a display opening. */
export function nativeWalkingRegion(model:ConvertResult,dataset:IndoorDataset,elevationFeet:number,allowUnlabelled=false,portalNode?:IndoorNode):NativeWalkingRegion {
 const nativeFloors=routingFloorPlateRecords(model,elevationFeet);
 const floors=nativeFloors.flatMap(nativeFloorPolygons);
 const levels=dataset.nativeLevels.filter(l=>Math.abs(l.elevationFeet-elevationFeet)<.05).map(l=>l.id);
 const portal=portalNode&&dataset.doors?.find(d=>portalNode.id===`${d.id}:0`||portalNode.id===`${d.id}:1`);
 const aperture=portal?.state==='connected'&&portal.footprintFeet&&dataset.edges.some(e=>e.id===portal.id&&e.enabled)?[portal.footprintFeet]:undefined;
 const barriers:Polygon[]=[],wallBarriers:Polygon[]=[];
 const addWalls=(parts:Polygon[])=>{barriers.push(...parts);wallBarriers.push(...parts);};
 const curtainSections=recoverNativeCurtainMemberSections(model,elevationFeet+.1);
 const curtainHosts=new Set(curtainSections.map(section=>section.hostId));
 // A proven curtain host is a container, not its gross solid rectangle.
 // The actual member section at ankle height retains sills/opaque panels and
 // jambs. Door leaves remain separately blocked unless their explicit portal
 // is being continued on its existing side.
 barriers.push(...curtainSections.flatMap(section=>section.barriers.map(member=>[member.polygon])));
 const wallParts=(polygon:RoomPoint[]):Polygon[]=>aperture?pc.difference([polygon],aperture) as Polygon[]:[[polygon]];
 addWalls((dataset.walls??[]).filter(w=>w.reviewPatchId&&levels.includes(w.levelId)).flatMap(w=>w.ringsFeet.flatMap(ring=>wallParts(ring))));
 for(const level of levels){if(!model.nativeAssociatedLevelRelations?.length)continue;const g=architecturalPlanGeometry(model,level);addWalls(g.walls.filter(w=>!curtainHosts.has(w.elementId)).flatMap(w=>wallParts(w.polygon)));barriers.push(...g.columns.map(w=>[w.polygon]),...g.doors.filter(d=>!aperture||d.elementId!==portal?.nativeElementId).map(w=>[w.polygon]));}
 // Physical solids cover associated-level omissions without projecting another storey down.
 for(const r of model.elementBounds.filter(r=>[-2000011,-2000100,-2001330].includes(r.categoryId??0)&&!curtainHosts.has(r.elementId))) for(const s of r.solids??(r.solid?[r.solid]:[])) {
  if(s.baseElevation>elevationFeet+.1||s.topElevation<elevationFeet+.1)continue;
  const dx=s.end.x-s.start.x,dy=s.end.y-s.start.y,n=Math.hypot(dx,dy);if(n<1e-8)continue;
  const polygon:RoomPoint[]=nativeWallSolidPolygon(s);
  // Share the plan's native curtain-host envelope constraint. Reintroducing
  // the raw analytical axis here otherwise blocks floor outside the element,
  // even after the level-aware plan correctly clipped that extension.
  const footprints=r.categoryId===-2000011?boundedNativeWallFootprints(r,polygon).map(f=>f.polygon):[polygon];
  if(r.categoryId===-2000011)addWalls(footprints.flatMap(p=>wallParts(p)));else barriers.push(...footprints.map(p=>[p]));
 }
 for(const tread of model.elementBounds.flatMap(record=>record.stairTreads??[])){const z=Math.min(...tread.map(p=>p[2]));if(z>elevationFeet+.05&&z<elevationFeet+6)barriers.push([tread.map(p=>[p[0],p[1]] as RoomPoint)]);}
 // A low native slab/tabletop is an obstruction, not another walking floor.
 // Use its exact separate shells and holes, never its bounds rectangle.
 barriers.push(...nativeLowSlabRecords(model,elevationFeet).flatMap(nativeFloorPolygons));
 const same=dataset.records.filter(r=>Math.abs(r.elevationFeet-elevationFeet)<.05);
 const masks=same.filter(r=>(!allowUnlabelled&&!r.circulation)||!r.walkable||r.access==='staff').map(r=>r.ringsFeet);
 // Circulation trace holes can be empty bands beside a wall, not physical
 // openings. Native-floor recovery uses actual slab voids and solid obstacles;
 // explicit reviewed floor openings remain a veto on every path.
 masks.push(...same.flatMap(r=>[...(!allowUnlabelled||!r.circulation?r.ringsFeet.slice(1):[]),...((r.properties.floorOpeningsFeet as RoomPoint[][]|undefined)??[])].map(h=>[h])));
 // A matched exit may move away from its already compiled threshold, but the
 // threshold centre itself remains blocked: this continuation cannot bypass a
 // disabled entrance or replace the explicit door edge. Columns are never cut.
 if(aperture&&portal?.normalFeet){const n=portal.normalFeet,t:[number,number]=[-n[1],n[0]],c=portal.pointFeet,w=Math.max(...portal.footprintFeet!.map(p=>Math.abs((p[0]-c[0])*t[0]+(p[1]-c[1])*t[1])))+.1;barriers.push([[[c[0]+t[0]*w+n[0]*.01,c[1]+t[1]*w+n[1]*.01],[c[0]-t[0]*w+n[0]*.01,c[1]-t[1]*w+n[1]*.01],[c[0]-t[0]*w-n[0]*.01,c[1]-t[1]*w-n[1]*.01],[c[0]+t[0]*w-n[0]*.01,c[1]+t[1]*w-n[1]*.01]]]);}
 return {elevationFeet,floors,barriers,masks,wallBarriers,nativeFloorIds:nativeFloors.map(r=>r.elementId),...(!allowUnlabelled?{circulation:same.filter(r=>r.circulation&&r.walkable&&r.access!=='staff').map(r=>r.ringsFeet)}:{})};
}
/** Continuous polygon proof of native support, obstacle clearance and source
 * circulation ownership. Raster searches propose candidates; this authorizes them. */
export function supportedWalkingPath(region:NativeWalkingRegion,points:readonly Point3[],width=2):boolean {
 if(points.length<2||points.some(p=>!p.every(Number.isFinite)||Math.abs(p[2]-region.elevationFeet)>.05)||!region.floors.length)return false;
 try {
  const floor=pc.union(region.floors[0]!,...region.floors.slice(1)),owned=region.circulation?.length?pc.union(region.circulation[0]!,...region.circulation.slice(1)):undefined;
  if(region.circulation&&!owned)return false;
  for(let i=1;i<points.length;i++){
   const a=points[i-1]!,b=points[i]!;if(Math.hypot(b[0]-a[0],b[1]-a[1])<1e-8)continue;
   const strip=walkingStrip([a[0],a[1]],[b[0],b[1]],width);
   if(area(pc.difference(strip,floor) as RoomPoint[][][])>1e-7)return false;
   if(owned&&area(pc.difference(strip,owned) as RoomPoint[][][])>1e-7)return false;
   if([...region.barriers,...region.masks].some(p=>area(pc.intersection(strip,p) as RoomPoint[][][])>1e-7))return false;
  }
  return true;
 }catch{return false;}
}

/** Bounded native-floor search for an unlabelled landing approach. It explores
 * physical geometry, never campus floor names or nearest-room assignment. */
export function findNativeWalkingPath(region:NativeWalkingRegion,from:Point3,to:Point3,maxDistanceFeet=90):Point3[]|undefined {
 if(Math.abs(from[2]-to[2])>.05||Math.hypot(from[0]-to[0],from[1]-to[1])>maxDistanceFeet)return;
 if(supportedWalkingPath(region,[from,to]))return [from,to];
 const margin=8,cell=.6,minX=Math.min(from[0],to[0])-margin,minY=Math.min(from[1],to[1])-margin,maxX=Math.max(from[0],to[0])+margin,maxY=Math.max(from[1],to[1])+margin;
 const nx=Math.ceil((maxX-minX)/cell)+1,ny=Math.ceil((maxY-minY)/cell)+1;if(nx*ny>50000)return;
 const near=(p:Point3)=>[Math.round((p[0]-minX)/cell),Math.round((p[1]-minY)/cell)] as const;
 const id=(x:number,y:number)=>y*nx+x,xy=(i:number):RoomPoint=>[minX+(i%nx)*cell,minY+Math.floor(i/nx)*cell];
 const obstacles=[...region.barriers,...region.masks].map(p=>({p,b:bounds(p)}));
 const available=new Map<number,boolean>();
 const clear=(i:number)=>{if(available.has(i))return available.get(i)!;const p=xy(i);const probes=[p,[p[0]-1,p[1]],[p[0]+1,p[1]],[p[0],p[1]-1],[p[0],p[1]+1]] as RoomPoint[];
 const ok=probes.every(q=>region.floors.some(f=>inside(q,f))&&(!region.circulation||region.circulation.some(f=>inside(q,f)))&&!obstacles.some(({p:f,b})=>q[0]>=b[0]&&q[0]<=b[2]&&q[1]>=b[1]&&q[1]<=b[3]&&inside(q,f)));available.set(i,ok);return ok;};
 const snap=(p:Point3)=>{const [x,y]=near(p);for(let r=0;r<=2;r++)for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){const k=id(x+dx,y+dy);if(x+dx<0||x+dx>=nx||y+dy<0||y+dy>=ny||!clear(k))continue;const q=xy(k);if(supportedWalkingPath(region,[p,[...q,region.elevationFeet]]))return k;}return;};
 const start=snap(from),end=snap(to);if(start==null||end==null)return;
 const heap:{id:number;score:number}[]=[];const push=(v:{id:number;score:number})=>{heap.push(v);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]!.score<=v.score)break;heap[i]=heap[p]!;i=p;}heap[i]=v;};
 const pop=()=>{const out=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1]!.score<heap[j]!.score)j++;if(last.score<=heap[j]!.score)break;heap[i]=heap[j]!;i=j;}heap[i]=last;}return out;};
 const costs=new Map([[start,0]]),parents=new Map<number,number>(),closed=new Set<number>();push({id:start,score:0});
 while(heap.length){const k=pop().id;if(closed.has(k))continue;closed.add(k);if(k===end)break;
 const x=k%nx,y=Math.floor(k/nx);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx<0||xx>=nx||yy<0||yy>=ny)continue;const n=id(xx,yy);if(!clear(n)||closed.has(n))continue;const c=costs.get(k)!+cell;if(c>maxDistanceFeet*2||c>=(costs.get(n)??Infinity))continue;costs.set(n,c);parents.set(n,k);push({id:n,score:c+Math.hypot(xx-end%nx,yy-Math.floor(end/nx))*cell});}}
 if(!closed.has(end))return;
 const chain=[end];while(chain.at(-1)!==start)chain.push(parents.get(chain.at(-1)!)!);chain.reverse();
 const dense=[from,...chain.map(i=>[...xy(i),region.elevationFeet] as Point3),to];
 // Greedy visibility reduction retains continuous full-width proof at every turn.
 const result=[dense[0]!];for(let i=0;i<dense.length-1;){let j=dense.length-1;while(j>i+1&&!supportedWalkingPath(region,[dense[i]!,dense[j]!]))j--;if(!supportedWalkingPath(region,[dense[i]!,dense[j]!]))return;result.push(dense[j]!);i=j;}
 return supportedWalkingPath(region,result)?result:undefined;
}

/** Join only disconnected source circulation surfaces which overlap at a
 * physically supported height, plus native generated landings. Explicit doors,
 * walls, voids, private rooms and another storey's floors remain hard vetoes. */
export function attachNativeCirculation(model:ConvertResult,dataset:IndoorDataset):{edges:IndoorEdge[];diagnostics:string[]} {
 const records=new Map(dataset.records.map(r=>[r.key,r])),nodes=dataset.nodes.filter(n=>{const r=records.get(n.roomKey);return r?.circulation&&r.walkable&&r.access!=='staff';});
 const parent=new Map(dataset.nodes.map(n=>[n.id,n.id]));const root=(id:string):string=>{const p=parent.get(id)!;if(p===id)return id;const r=root(p);parent.set(id,r);return r;};const join=(a:string,b:string)=>parent.set(root(a),root(b));for(const e of dataset.edges.filter(e=>e.enabled&&['walk','door','opening'].includes(e.kind)))join(e.from,e.to);
 const edges:IndoorEdge[]=[],diagnostics:string[]=[],regions=new Map<string,NativeWalkingRegion>();
 const region=(z:number,landing:boolean)=>{const key=`${z.toFixed(6)}:${landing}`;if(!regions.has(key))regions.set(key,nativeWalkingRegion(model,dataset,z,landing));return regions.get(key)!;};
 // Existing native-generated landings are the only starts allowed to cross an
 // unlabelled floor patch. All other links must remain source-circulation-owned.
 const starts=nodes.filter(n=>n.roomKey.startsWith('landing:')||records.get(n.roomKey)?.stair&&n.kind==='portal');
 const pairs:{a:IndoorNode;b:IndoorNode;landing:boolean;distance:number}[]=[];
 for(const a of nodes){const landing=starts.includes(a);for(const b of nodes){if(a.id>=b.id&&!landing||a.id===b.id||a.roomKey===b.roomKey&&!landing||root(a.id)===root(b.id)||a.levelId!==b.levelId||Math.abs(a.pointFeet[2]-b.pointFeet[2])>.05)continue;const distance=Math.hypot(a.pointFeet[0]-b.pointFeet[0],a.pointFeet[1]-b.pointFeet[1]);if(distance>(landing?90:12))continue;const ar=records.get(a.roomKey)!,br=records.get(b.roomKey)!;if(!landing&&ar.surfaceId===br.surfaceId)continue;pairs.push({a,b,landing,distance});}}
 pairs.sort((a,b)=>a.distance-b.distance);
 for(const p of pairs){if(root(p.a.id)===root(p.b.id))continue;const r=p.landing&&p.a.kind==='portal'?nativeWalkingRegion(model,dataset,p.a.pointFeet[2],true,p.a):region(p.a.pointFeet[2],p.landing);let path:Point3[]|undefined;
 if(p.landing&&p.a.kind==='portal'){const door=dataset.doors?.find(d=>p.a.id===`${d.id}:0`||p.a.id===`${d.id}:1`),n=door?.normalFeet;if(!door||!n)continue;const side=(p.a.pointFeet[0]-door.pointFeet[0])*n[0]+(p.a.pointFeet[1]-door.pointFeet[1])*n[1],sign=side>=0?1:-1,out:Point3=[p.a.pointFeet[0]+n[0]*sign*2,p.a.pointFeet[1]+n[1]*sign*2,p.a.pointFeet[2]];if(!supportedWalkingPath(r,[p.a.pointFeet,out]))continue;const rest=findNativeWalkingPath(r,out,p.b.pointFeet);if(rest)path=[p.a.pointFeet,...rest];}
 else if(p.landing){const record=records.get(p.a.roomKey)!,floor=model.elementBounds.find(f=>f.elementId===record.properties.nativeFloorId);let nearest:{point:RoomPoint;distance:number}|undefined;
  for(const [i,a]of(floor?.loops?.[0]??[]).entries()){const b=floor!.loops![0]![(i+1)%floor!.loops![0]!.length]!,dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;if(len2<1e-12)continue;const t=Math.max(0,Math.min(1,((p.a.pointFeet[0]-a[0])*dx+(p.a.pointFeet[1]-a[1])*dy)/len2)),point:RoomPoint=[a[0]+t*dx,a[1]+t*dy],distance=Math.hypot(point[0]-p.a.pointFeet[0],point[1]-p.a.pointFeet[1]);if(!nearest||distance<nearest.distance)nearest={point,distance};}
  if(nearest&&nearest.distance>.00001&&nearest.distance<1.05){const out:Point3=[p.a.pointFeet[0]+(p.a.pointFeet[0]-nearest.point[0])/nearest.distance*2,p.a.pointFeet[1]+(p.a.pointFeet[1]-nearest.point[1])/nearest.distance*2,p.a.pointFeet[2]];if(supportedWalkingPath(r,[p.a.pointFeet,out])){const rest=findNativeWalkingPath(r,out,p.b.pointFeet);if(rest)path=[p.a.pointFeet,...rest];}}
  if(!path)path=findNativeWalkingPath(r,p.a.pointFeet,p.b.pointFeet);
 }else path=supportedWalkingPath(r,[p.a.pointFeet,p.b.pointFeet])?[p.a.pointFeet,p.b.pointFeet]:undefined;if(!path)continue;
 edges.push({id:`native-circulation:${[p.a.id,p.b.id].sort().join('|')}`,from:p.a.id,to:p.b.id,kind:p.a.surfaceId===p.b.surfaceId?'walk':'opening',pointsFeet:path,lengthMetres:path.slice(1).reduce((s,q,i)=>s+Math.hypot(...q.map((v,k)=>v-path[i]![k]!))*dataset.alignment.horizontalMetresPerFoot,0),roomKeys:[...new Set([p.a.roomKey,p.b.roomKey,...dataset.records.filter(record=>Math.abs(record.elevationFeet-r.elevationFeet)<.05&&path.slice(1).some((point,i)=>{try{return area(pc.intersection(walkingStrip([path[i]![0],path[i]![1]],[point[0],point[1]]),record.ringsFeet) as RoomPoint[][][])>1e-7;}catch{return false;}})).map(record=>record.key)])],evidence:`continuously supported full 2 ft native floor approach; exact slabs ${r.nativeFloorIds.join(',')}; walls, columns, doors, voids and staff/nonwalkable masks vetoed; all traversed source room identities retained; ${p.landing?'generated native landing':'source circulation overlap'}; access/accessibility remain unverified`,accessible:'unknown',enabled:true});join(p.a.id,p.b.id);
 }
 for(const n of starts)if(!edges.some(e=>e.from===n.id||e.to===n.id))diagnostics.push(`Native landing ${n.id} has no new continuously supported attachment; retained existing graph connections.`);
 return {edges,diagnostics};
}
