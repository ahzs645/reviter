import pc from 'polygon-clipping';
import {cadPointInRings} from './dwg-stair-assumptions.ts';
import type {CadDrawingPaths} from './dwg-drawing-paths.ts';
type Point=[number,number];
export type CadSurfacePart={handle?:string;reverse:boolean;segmentIndex?:number;interval?:[number,number];doorId?:string;thresholdIndex?:number};
type Envelope=Record<'left'|'right'|'top'|'bottom',{handle:string;segmentIndex:number}[]>&{reason:string};
type Floor={wallCandidates?:{id:string;ringsMetres:Point[][]}[];id:string;buildingCode:string;doors?:{id:string;thresholdSegmentsMetres:Point[][]}[];primitives:{sourceHandle:string;pointsMetres:Point[]}[];regions:{roomKey:string;anchorMetres:Point}[]};
export type CadFloorSurfaces={format:'reviter-cad-floor-surfaces';version:1;sourceSha256:string;geometrySha256:string;appliedToNativeGeometry:false;routingEligible:false;graphEdges:never[];surfaces:{id:string;floorId:string;buildingCode:string;roomKey:string;title:string;sourceChains:CadSurfacePart[][];maximumJoinMetres:number;ringsMetres:Point[][];openToBelowConfirmed:true;physicalSlabVerified:false;reason:string;remainingReview:string[];transitConfirmed?:true;assumedFacadeEnvelope?:Envelope;excludedWallPairIds?:string[];boundaryCells?:{roomKey:string;sourceChains:CadSurfacePart[][];ringsMetres:Point[][]}[]}[]};
/** Source vertices/finite contacts only; trim bounded overlapping starts to avoid backtracking spikes. */
export function cadSourceSurfaceRings(floor:Floor,chains:CadFloorSurfaces['surfaces'][number]['sourceChains'],maximumJoinMetres:number,envelope?:Envelope):Point[][]{
 const fail=()=>{throw new Error('Reviewed floor surface has an unsupported source join.');};
 if(!Number.isFinite(maximumJoinMetres)||maximumJoinMetres<0||maximumJoinMetres>.002||!Array.isArray(chains)||chains.length<1||chains.length>200)fail();
 return chains.map((chain,ringIndex)=>{
  if(ringIndex===0&&envelope)return cadFacadeEnvelope(floor,envelope);
  if(!Array.isArray(chain)||chain.length<2||new Set(chain.map(c=>JSON.stringify(c))).size!==chain.length)fail();
  const parts=chain.map(c=>{
   if(typeof c.reverse!=='boolean')fail();
   let points:Point[];
   if(c.doorId!==undefined){const d=floor.doors?.find(d=>d.id===c.doorId);if(!d||c.handle!==undefined||!Number.isInteger(c.thresholdIndex)||!d.thresholdSegmentsMetres[c.thresholdIndex!])fail();points=d!.thresholdSegmentsMetres[c.thresholdIndex!]!;}
   else {const p=floor.primitives.find(p=>p.sourceHandle===c.handle);if(!p||p.pointsMetres.length<2)fail();points=p!.pointsMetres;if(c.segmentIndex!==undefined){if(!Number.isInteger(c.segmentIndex)||c.segmentIndex<0||c.segmentIndex>=points.length-1)fail();points=points.slice(c.segmentIndex,c.segmentIndex+2);}}
   if(c.interval!==undefined){if(points.length!==2||c.interval.length!==2||c.interval.some(t=>!Number.isFinite(t)||t<0||t>1)||c.interval[0]===c.interval[1])fail();const [a,b]=points as [Point,Point];points=c.interval.map(t=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])] as Point);}
   return (c.reverse?[...points].reverse():points).map(q=>[...q] as Point);
  });
  for(let i=0;i<parts.length;i++){const a=parts[i]!.at(-1)!,next=parts[(i+1)%parts.length]!,b=next[0]!,c=next[1]!,gap=Math.hypot(a[0]-b[0],a[1]-b[1]);if(gap>maximumJoinMetres+1e-12)fail();if(gap<=.00002){next[0]=[...a];continue;}const u:Point=[c[0]-b[0],c[1]-b[1]],den=u[0]*u[0]+u[1]*u[1];if(den){const t=((a[0]-b[0])*u[0]+(a[1]-b[1])*u[1])/den;if(t>=0&&t<=1&&Math.hypot(a[0]-b[0]-t*u[0],a[1]-b[1]-t*u[1])<=1e-12)next[0]=[...a];}}
  const ring=parts.flatMap(p=>p.map(q=>[...q] as Point));ring.push([...ring[0]!] as Point);return ring;
 });
}
const area=(polygons:pc.MultiPolygon)=>polygons.reduce((sum,p)=>sum+p.reduce((s,r,i)=>s+(i===0?1:-1)*Math.abs(r.reduce((a,v,j)=>{const q=r[(j+1)%r.length]!;return a+v[0]*q[1]-q[0]*v[1];},0))/2,0),0);
/** Source-bound review evidence; a drawn ring is not a native physical slab or public route. */
export function validateCadFloorSurfaces(v:CadFloorSurfaces,geometry:{sourceSha256:string;floors:Floor[]},geometrySha256:string){
 const fail=()=>{throw new Error('Reviewed floor surfaces do not match the source boundaries and protected openings.');};
 if(v.format!=='reviter-cad-floor-surfaces'||v.version!==1||v.sourceSha256!==geometry.sourceSha256||v.geometrySha256!==geometrySha256||v.appliedToNativeGeometry!==false||v.routingEligible!==false||!Array.isArray(v.graphEdges)||v.graphEdges.length||!Array.isArray(v.surfaces)||new Set(v.surfaces.map(s=>s.id)).size!==v.surfaces.length)fail();
 for(const s of v.surfaces){const f=geometry.floors.find(f=>f.id===s.floorId),room=f?.regions.find(r=>r.roomKey===s.roomKey);
  if(!f||f.buildingCode!==s.buildingCode||!room||s.openToBelowConfirmed!==true||s.physicalSlabVerified!==false||typeof s.reason!=='string'||!Array.isArray(s.remainingReview)||s.remainingReview.some(r=>typeof r!=='string'))fail();
  const rings=cadSourceSurfaceRings(f!,s.sourceChains,s.maximumJoinMetres,s.assumedFacadeEnvelope);
  cadSurfaceObstacles(f!,s);
  for(const c of s.boundaryCells??[]){const room=f!.regions.find(r=>r.roomKey===c.roomKey);const rings=cadSourceSurfaceRings(f!,c.sourceChains,s.maximumJoinMetres);if(!room||JSON.stringify(rings)!==JSON.stringify(c.ringsMetres)||!cadPointInRings(room.anchorMetres,rings)||area(pc.intersection(rings,[s.ringsMetres[1]!]))>1e-8)fail();}

  if(JSON.stringify(rings)!==JSON.stringify(s.ringsMetres)||!cadPointInRings(room!.anchorMetres,rings)||area(pc.union(rings))<=0)fail();
  for(let i=1;i<rings.length;i++){
   if(Math.abs(area(pc.difference([rings[i]!],[rings[0]!])) )>1e-8)fail();
   for(let j=1;j<i;j++)if(area(pc.intersection([rings[i]!],[rings[j]!]))>1e-8)fail();
  }
 }
 return v;
}
/** Reject stale path meshes or any floor cell/edge crossing a protected open-to-below hole. */
export function validateCadSurfacePaths(surfaces:CadFloorSurfaces,paths:CadDrawingPaths,surfaceSha256:string,geometry?:{floors:Floor[]}){
 if(paths.floorSurfacesSha256!==surfaceSha256)throw new Error('Drawing paths need regeneration for the reviewed floor surfaces.');
 for(const s of surfaces.surfaces){const f=paths.floors.find(f=>f.id===s.floorId);if(!f)throw new Error('Missing reviewed surface floor.');
  const delineations=f.sourceFloorDelineationHandles??[],allowedDelineations=s.transitConfirmed===true&&s.assumedFacadeEnvelope?s.sourceChains[0]!.flatMap(p=>'handle' in p?[p.handle]:[]):[];
  const protectedHandles=s.sourceChains.slice(1).flatMap(chain=>chain.flatMap(p=>'handle' in p?[p.handle]:[]));
  if(delineations.some(h=>!allowedDelineations.includes(h)||protectedHandles.includes(h))||new Set(delineations).size!==delineations.length)throw new Error('Unbound floor delineation interpretation.');
  if(s.excludedWallPairIds?.length){const original=geometry?.floors.find(f=>f.id===s.floorId);if(!original)throw new Error('Missing original floor obstacle evidence.');const cells=f.cells.filter(c=>c.roomKeys.includes(s.roomKey));if(cells.length!==1)throw new Error('Missing unique reviewed floor cell.');for(const obstacle of cadSurfaceObstacles(original,s))if(cadRingsOverlapInterior(cells[0]!.ringsMetres,obstacle))throw new Error('Reviewed floor cell crosses an original boundary strip.');}

  for(const hole of s.ringsMetres.slice(1)){
   if(f.cells.some(c=>area(pc.intersection(c.ringsMetres,[hole]))>1e-8))throw new Error('Drawing cell fills an open-to-below opening.');
   for(const e of f.previewEdges){const a=f.nodes[e.a]!.pointMetres,b=f.nodes[e.b]!.pointMetres,ts=[0,1];
    for(let i=1;i<hole.length;i++){const c=hole[i-1]!,d=hole[i]!,u:Point=[b[0]-a[0],b[1]-a[1]],v:Point=[d[0]-c[0],d[1]-c[1]],den=u[0]*v[1]-u[1]*v[0];if(Math.abs(den)<1e-14)continue;const w:Point=[c[0]-a[0],c[1]-a[1]],t=(w[0]*v[1]-w[1]*v[0])/den,q=(w[0]*u[1]-w[1]*u[0])/den;if(t>=0&&t<=1&&q>=0&&q<=1)ts.push(t);}
    ts.sort((a,b)=>a-b);const probes=[a,b,...ts.slice(1).map((t,i)=>{const mid=(t+ts[i]!)/2;return [a[0]+mid*(b[0]-a[0]),a[1]+mid*(b[1]-a[1])] as Point;})];
    if(probes.some(p=>cadPointInRings(p,[hole])))throw new Error('Drawing path crosses an open-to-below opening.');
   }
  }
 }
}

/** Provisional full floor extent; each plane has substantial finite inside-face evidence. */
export function cadFacadeEnvelope(floor:Floor,e:Envelope):Point[]{
 const fail=()=>{throw new Error('Unsupported assumed facade floor envelope.');};
 if(!e.reason?.trim())fail();
 const values:Record<string,number>={},spans:Record<string,[number,number][]>={};
 for(const side of ['left','right','bottom','top'] as const){const axis=side==='left'||side==='right'?0:1,other=1-axis,parts=e[side];if(!Array.isArray(parts)||!parts.length)fail();spans[side]=[];
  for(const c of parts){const pts=floor.primitives.find(p=>p.sourceHandle===c.handle)?.pointsMetres;if(!pts||!Number.isInteger(c.segmentIndex)||c.segmentIndex<0||c.segmentIndex>=pts.length-1)fail();const a=pts![c.segmentIndex]!,b=pts![c.segmentIndex+1]!;if(Math.abs(a[axis]!-b[axis]!)>.00002||Math.abs(a[other]!-b[other]!)<.001)fail();values[side]??=a[axis]!;if(Math.abs(a[axis]!-values[side]!)>.00002)fail();spans[side]!.push([Math.min(a[other]!,b[other]!),Math.max(a[other]!,b[other]!)]);}
 }
 const l=values.left!,r=values.right!,b=values.bottom!,t=values.top!;if(!(l<r&&b<t))fail();
 for(const side of ['left','right','bottom','top']){const vertical=side==='left'||side==='right',lo=vertical?b:l,hi=vertical?t:r;const intervals=spans[side]!.map(([a,b])=>[Math.max(a,lo),Math.min(b,hi)] as [number,number]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let end=lo,length=0;for(const [a,b] of intervals){length+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}if(length/(hi-lo)<.35)fail();}
 return [[l,b],[r,b],[r,t],[l,t],[l,b]];
}
export function cadSurfaceObstacles(floor:Pick<Floor,'wallCandidates'>,s:CadFloorSurfaces['surfaces'][number]):Point[][][]{
 const ids=s.excludedWallPairIds??[];if(new Set(ids).size!==ids.length)throw new Error('Duplicate surface obstacle.');return ids.map(id=>{const w=floor.wallCandidates?.find(w=>w.id===id);if(!w)throw new Error('Stale surface wall evidence.');return w.ringsMetres;});
}
/** Strict interior collision independent of repeated clipping of near-collinear source strips. */
export function cadRingsOverlapInterior(a:Point[][],b:Point[][]):boolean{
 const segments=(rings:Point[][])=>rings.flatMap(r=>r.map((p,i)=>[p,r[(i+1)%r.length]!] as [Point,Point])).filter(([p,q])=>Math.hypot(p[0]-q[0],p[1]-q[1])>1e-12);const aa=segments(a),bb=segments(b),eps=1e-8;
 const distance=(p:Point,[x,y]:[Point,Point])=>{const u=[y[0]-x[0],y[1]-x[1]],den=u[0]!*u[0]!+u[1]!*u[1]!,t=den?Math.max(0,Math.min(1,((p[0]-x[0])*u[0]!+(p[1]-x[1])*u[1]!)/den)):0;return Math.hypot(p[0]-x[0]-t*u[0]!,p[1]-x[1]-t*u[1]!);};
 const inRing=(p:Point,ring:Point[])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i]!,b=ring[j]!;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};const inside=(p:Point,rings:Point[][],edges:[Point,Point][])=>inRing(p,rings[0]!)&&!rings.slice(1).some(r=>inRing(p,r))&&edges.every(e=>distance(p,e)>eps);
 if(a[0]!.some(p=>inside(p,b,bb))||b[0]!.some(p=>inside(p,a,aa)))return true;
 const orientation=(p:Point,a:Point,b:Point)=>((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/Math.max(eps,Math.hypot(b[0]-a[0],b[1]-a[1]));
 const opposite=(a:number,b:number)=>(a>eps&&b< -eps)||(a< -eps&&b>eps);
 for(const [p,q] of aa)for(const [r,s] of bb)if(opposite(orientation(p,r,s),orientation(q,r,s))&&opposite(orientation(r,p,q),orientation(s,p,q)))return true;
 // Coincident rings can overlap with all vertices on the boundary. Probe each
 // edge midpoint and a short normal offset, retaining the polygon's real holes.
 for(const [p,q] of aa){const dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);if(len<eps)continue;for(const sign of [-1,1]){const m:Point=[(p[0]+q[0])/2+sign*dy/len*eps*10,(p[1]+q[1])/2-sign*dx/len*eps*10];if(inside(m,a,aa)&&inside(m,b,bb))return true;}}
 return false;
}
