import type {CadStairAssumptions} from './dwg-stair-assumptions.ts';
export type CadPathPoint=[number,number];
export interface CadPathFloor {
 id:string; buildingCode:string; name:string;
 cells:{id:number;ringsMetres:CadPathPoint[][];roomKeys:string[];transit:boolean;status:string}[];
 nodes:{id:number;pointMetres:CadPathPoint;cellId:number;kind:string}[];
 previewEdges:{a:number;b:number;lengthMetres:number;kind:string;doorId:string|null}[];
 doors:{id:string;arcHandle:string;closedLeafMetres:CadPathPoint[];status:string;reason:string;cellIds:number[];nodeIds:number[];routingEligible:false;access:null}[];
 rooms:{roomKey:string;number:string;name:string;nodeId:number|null;cellId:number|null;status:string}[];
 selectionDoorClosures?:{doorId:string;originalThresholdSegmentsMetres:CadPathPoint[][];selectionThresholdSegmentsMetres:CadPathPoint[][];contacts:{handles:string[];pointsMetres:CadPathPoint[];hingeMarginMetres:number;latchMarginMetres:number}[];endpointFrameHandles:string[];selectionOnly:true;physicalDoorWidthMetres:number;maximumNormalCorrectionMetres:number;maximumEndMarginMetres:number}[];
 comparisonBarrierExclusionMetres?:number;sourceFloorDelineationHandles?:string[];graphEdges:never[];routingEligible:false;
}
export interface CadDrawingPaths {format:'reviter-cad-drawing-paths';version:1;sourceSha256:string;geometrySha256:string;floorSurfacesSha256?:string;circulationReviewSha256?:string;appliedToNativeGeometry:false;graphEdges:never[];routingEligible:false;floors:CadPathFloor[];limits:string[]}
/** Package parsing runs in the CAD worker. Preview data can never enter native graphEdges. */
export function validateCadDrawingPaths(value:CadDrawingPaths, geometry:{floors:{id:string;doors:{id:string;closedLeafMetres?:CadPathPoint[];widthMetres?:number;thresholdSegmentsMetres?:CadPathPoint[][];supportingWallHandles?:string[]}[];primitives?:{sourceHandle:string;pointsMetres:CadPathPoint[]}[];regions:{roomKey:string}[]}[]},sourceSha256:string,geometrySha256:string){
 const fail=()=>{throw new Error('Drawing path evidence does not match these floors and doors.');};
 if(value.format!=='reviter-cad-drawing-paths'||value.version!==1||value.sourceSha256!==sourceSha256||value.geometrySha256!==geometrySha256||value.appliedToNativeGeometry!==false||value.routingEligible!==false||!Array.isArray(value.graphEdges)||value.graphEdges.length||!Array.isArray(value.floors)||value.floors.length!==geometry.floors.length||new Set(value.floors.map(f=>f.id)).size!==value.floors.length)fail();
 for(const f of value.floors){
  const original=geometry.floors.find(x=>x.id===f.id);if(!original||f.routingEligible!==false||!Array.isArray(f.graphEdges)||f.graphEdges.length||![f.cells,f.nodes,f.previewEdges,f.doors,f.rooms].every(Array.isArray))fail();
  if(f.comparisonBarrierExclusionMetres!==undefined&&![0,.00002].includes(f.comparisonBarrierExclusionMetres)||f.comparisonBarrierExclusionMetres===.00002&&!value.circulationReviewSha256)fail();
  if(f.sourceFloorDelineationHandles?.length&&!value.floorSurfacesSha256)fail();
  const point=(p:CadPathPoint)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  if(f.cells.some((c,i)=>c.id!==i||typeof c.transit!=='boolean'||!Array.isArray(c.ringsMetres)||!c.ringsMetres.length||c.ringsMetres.some(r=>r.length<4||!r.every(point)))||f.nodes.some((n,i)=>n.id!==i||!point(n.pointMetres)||!f.cells[n.cellId]))fail();
  if(f.rooms.length!==original!.regions.length||f.rooms.some(r=>!original!.regions.some(s=>s.roomKey===r.roomKey)||(r.nodeId!==null&&(!f.nodes[r.nodeId]||f.nodes[r.nodeId]!.cellId!==r.cellId))))fail();
  if(f.doors.length!==original!.doors.length||new Set(f.doors.map(d=>d.id)).size!==f.doors.length||f.doors.some(d=>!original!.doors.some(s=>s.id===d.id)||d.routingEligible!==false||d.access!==null))fail();
  if(f.selectionDoorClosures!==undefined){
   if(!Array.isArray(f.selectionDoorClosures)||new Set(f.selectionDoorClosures.map(c=>c.doorId)).size!==f.selectionDoorClosures.length)fail();
   for(const c of f.selectionDoorClosures){const d=original!.doors.find(d=>d.id===c.doorId);
    if(!d||c.selectionOnly!==true||c.physicalDoorWidthMetres!==d.widthMetres||c.maximumNormalCorrectionMetres!==.0001||c.maximumEndMarginMetres!==.4||JSON.stringify(c.originalThresholdSegmentsMetres)!==JSON.stringify(d.thresholdSegmentsMetres)||!Array.isArray(c.contacts)||!c.contacts.length||c.contacts.length!==c.selectionThresholdSegmentsMetres.length||!Array.isArray(c.endpointFrameHandles)||c.endpointFrameHandles.some(h=>!original!.primitives?.some(p=>p.sourceHandle===h)))fail();
    for(let i=0;i<c.contacts.length;i++){const contact=c.contacts[i]!;
     if(contact.handles.length!==2||contact.pointsMetres.length!==2||!contact.pointsMetres.every(point)||JSON.stringify(contact.pointsMetres)!==JSON.stringify(c.selectionThresholdSegmentsMetres[i])||[contact.hingeMarginMetres,contact.latchMarginMetres].some(m=>!Number.isFinite(m)||m<-.05||m>.4))fail();
     const leaf=d!.closedLeafMetres;if(!leaf||leaf.length!==2||!leaf.every(point))fail();
     const a=leaf![0]!,b=leaf![1]!,width=Math.hypot(b[0]-a[0],b[1]-a[1]);if(width<.1)fail();
     const u:CadPathPoint=[(b[0]-a[0])/width,(b[1]-a[1])/width],normal=(p:CadPathPoint)=>(p[0]-a[0])*-u[1]+(p[1]-a[1])*u[0],along=(p:CadPathPoint)=>(p[0]-a[0])*u[0]+(p[1]-a[1])*u[1];
     if(Math.abs(-along(contact.pointsMetres[0]!)-contact.hingeMarginMetres)>1e-7||Math.abs(along(contact.pointsMetres[1]!)-width-contact.latchMarginMetres)>1e-7||!d!.thresholdSegmentsMetres?.some(s=>s.length===2&&contact.pointsMetres.every(p=>Math.abs(normal(p)-(normal(s[0]!)+normal(s[1]!))/2)<=.00010001)))fail();
     contact.handles.forEach((h,j)=>{if(!d!.supportingWallHandles?.includes(h)||!original!.primitives?.some(p=>p.sourceHandle===h&&p.pointsMetres.some(v=>v[0]===contact.pointsMetres[j]![0]&&v[1]===contact.pointsMetres[j]![1])))fail();});
    }
   }
  }
  for(const e of f.previewEdges){const a=f.nodes[e.a],b=f.nodes[e.b];if(!a||!b||!Number.isFinite(e.lengthMetres)||e.lengthMetres<0||Math.abs(e.lengthMetres-Math.hypot(a.pointMetres[0]-b.pointMetres[0],a.pointMetres[1]-b.pointMetres[1]))>1e-7)fail();
   if(e.kind==='interior'){if(a!.cellId!==b!.cellId||e.doorId!==null)fail();}
   else if(e.kind==='door'){const d=f.doors.find(d=>d.id===e.doorId);if(!d||d.status!=='two-sided-drawing-door'||d.nodeIds.length!==2||!d.nodeIds.includes(e.a)||!d.nodeIds.includes(e.b)||a!.cellId===b!.cellId)fail();}
   else fail();
  }
 }
 return value;
}
/** Default paths may pass through named circulation only. Unknown access remains unknown. */
export function findCadDrawingPath(f:CadPathFloor,startKey:string,endKey:string,allowUnreviewed=false){
 const start=f.rooms.find(r=>r.roomKey===startKey),end=f.rooms.find(r=>r.roomKey===endKey);
 if(start?.nodeId==null||end?.nodeId==null)return {status:'missing-boundary' as const,nodeIds:[],doorIds:[],lengthMetres:0};
 const allowed=(id:number)=>f.cells[id]?.transit||id===start.cellId||id===end.cellId||(allowUnreviewed&&f.cells[id]?.status==='unlabelled-needs-review');
 const adjacency=new Map<number,{to:number;edge:CadPathFloor['previewEdges'][number]}[]>();
 for(const edge of f.previewEdges){if(!allowed(f.nodes[edge.a]!.cellId)||!allowed(f.nodes[edge.b]!.cellId))continue;
  for(const [from,to]of [[edge.a,edge.b],[edge.b,edge.a]]){if(!adjacency.has(from!))adjacency.set(from!,[]);adjacency.get(from!)!.push({to:to!,edge});}}
 const distance=new Map([[start.nodeId,0]]),previous=new Map<number,{from:number;edge:CadPathFloor['previewEdges'][number]}>(),visited=new Set<number>();
 // Binary heap keeps large drawing graphs off quadratic scans.
 const heap:[number,number][]=[];
 const push=(v:[number,number])=>{heap.push(v);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]![0]<=v[0])break;heap[i]=heap[p]!;i=p;}heap[i]=v;};
 const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1]![0]<heap[c]![0])c++;if(heap[c]![0]>=last[0])break;heap[i]=heap[c]!;i=c;}heap[i]=last;}return first;};
 push([0,start.nodeId]);while(heap.length){const [cost,n]=pop();if(visited.has(n))continue;visited.add(n);if(n===end.nodeId)break;
  for(const item of adjacency.get(n)??[]){const next=cost+item.edge.lengthMetres;if(next<(distance.get(item.to)??Infinity)){distance.set(item.to,next);previous.set(item.to,{from:n,edge:item.edge});push([next,item.to]);}}}
 if(!distance.has(end.nodeId))return {status:'disconnected' as const,nodeIds:[],doorIds:[],lengthMetres:0};
 const ids=[end.nodeId],doors:string[]=[];let current=end.nodeId;
 while(current!==start.nodeId){const p=previous.get(current)!;if(p.edge.doorId)doors.push(p.edge.doorId);current=p.from;ids.push(current);}
 return {status:'drawing-preview' as const,sharedEndpoint:start.status==='shared-drawing-region'||end.status==='shared-drawing-region',nodeIds:ids.reverse(),doorIds:doors.reverse(),lengthMetres:distance.get(end.nodeId)!};
}

/** Source-bound, switchable drawing comparisons. Never emits native route edges.
 * A stair attaches only where its recorded point belongs to exactly one meshed
 * cell and a visible segment stays inside that cell, including every hole. */
export function findCadMultiFloorPath(paths:CadDrawingPaths,assumptions:CadStairAssumptions|null,startFloorId:string,startKey:string,endFloorId:string,endKey:string,enableAssumedStairs=false,allowUnreviewed=false){
 const empty=(status:string,unresolved:string[]=[])=>({status,segments:[] as {floorId:string;points:CadPathPoint[]}[],connections:[] as string[],doorIds:[] as string[],lengthMetres:0,unresolved,routingEligible:false as const});
 const sf=paths.floors.find(f=>f.id===startFloorId),ef=paths.floors.find(f=>f.id===endFloorId);
 if(!sf||!ef||sf.buildingCode!==ef.buildingCode)return empty('different-building');
 if(sf.id!==ef.id&&!enableAssumedStairs)return empty('stairs-disabled');
 const sr=sf.rooms.find(r=>r.roomKey===startKey),er=ef.rooms.find(r=>r.roomKey===endKey);
 if(sr?.nodeId==null||er?.nodeId==null)return empty('missing-boundary');
 if(assumptions&&(assumptions.sourceSha256!==paths.sourceSha256||assumptions.geometrySha256!==paths.geometrySha256||assumptions.routingEligible!==false||assumptions.graphEdges.length))return empty('stale-stair-evidence');
 const fs=paths.floors.filter(f=>f.buildingCode===sf.buildingCode),offsets=new Map<string,number>();
 const ns:{floorId:string;point:CadPathPoint;cellId:number}[]=[],edges:{a:number;b:number;length:number;doorId:string|null;connectionId:string|null}[]=[],stairCells=new Map<string,Set<number>>();
 for(const f of fs){offsets.set(f.id,ns.length);for(const n of f.nodes)ns.push({floorId:f.id,point:n.pointMetres,cellId:n.cellId});}
 const unresolved:string[]=[];
 // Strict interiors: a point on a shared boundary cannot acquire two owners.
 const inRing=(p:CadPathPoint,r:CadPathPoint[])=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i]!,b=r[j]!;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 const inside=(p:CadPathPoint,rings:CadPathPoint[][])=>!!rings[0]&&inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));
 const visible=(a:CadPathPoint,b:CadPathPoint,rings:CadPathPoint[][])=>{
  const u=[b[0]-a[0],b[1]-a[1]],ts=[0,1];
  for(const ring of rings)for(let i=0;i<ring.length;i++){const c=ring[i]!,d=ring[(i+1)%ring.length]!,v=[d[0]-c[0],d[1]-c[1]],den=u[0]!*v[1]!-u[1]!*v[0]!;
   if(Math.abs(den)<1e-12)continue;const w=[c[0]-a[0],c[1]-a[1]],t=(w[0]!*v[1]!-w[1]!*v[0]!)/den,q=(w[0]!*u[1]!-w[1]!*u[0]!)/den;if(t>0&&t<1&&q>=0&&q<=1)ts.push(t);
  }
  ts.sort((a,b)=>a-b);return ts.slice(1).every((t,i)=>{const m=(t+ts[i]!)/2;return inside([a[0]+m*u[0]!,a[1]+m*u[1]!],rings);});
 };
 const attach=(id:string,p:CadPathPoint)=>{const f=fs.find(f=>f.id===id);if(!f)return null;const owners=f.cells.filter(c=>inside(p,c.ringsMetres));if(owners.length!==1)return null;const c=owners[0]!,off=offsets.get(id)!;if(!c.roomKeys.length||c.roomKeys.some(key=>{const r=f.rooms.find(r=>r.roomKey===key);return !r||!/^stair(?:case)?$/i.test(r.name.trim());}))return null;
  const candidates=f.nodes.filter(n=>n.cellId===c.id).map(n=>({n,d:Math.hypot(n.pointMetres[0]-p[0],n.pointMetres[1]-p[1])})).sort((a,b)=>a.d-b.d);
  const target=candidates.find(({n})=>visible(p,n.pointMetres,c.ringsMetres));if(!target)return null;return {floorId:id,point:p,cellId:c.id,target:off+target.n.id,length:target.d};
 };
 if(enableAssumedStairs&&assumptions)for(const c of assumptions.connections.filter(c=>c.buildingCode===sf.buildingCode)){
  if(c.assumedContinuous!==true||c.servedStopsVerified!==false||c.physicalElevations!==null){unresolved.push(c.id+': unsupported assumption');continue;}
  const a=attach(c.fromFloorId,c.fromPointMetres),b=attach(c.toFloorId,c.toPointMetres);
  if(!a||!b){unresolved.push(c.id+': missing meshed landing on '+(!a?c.fromFloorId:c.toFloorId));continue;}
  const ai=ns.length;ns.push(a);const bi=ns.length;ns.push(b);
  edges.push({a:ai,b:a.target,length:a.length,doorId:null,connectionId:null},{a:bi,b:b.target,length:b.length,doorId:null,connectionId:null},{a:ai,b:bi,length:0,doorId:null,connectionId:c.id});
  for(const n of [a,b]){if(!stairCells.has(n.floorId))stairCells.set(n.floorId,new Set());stairCells.get(n.floorId)!.add(n.cellId);}
 }
 const allowed=(f:CadPathFloor,id:number)=>f.cells[id]?.transit||(f.id===sf.id&&id===sr.cellId)||(f.id===ef.id&&id===er.cellId)||stairCells.get(f.id)?.has(id)||(allowUnreviewed&&f.cells[id]?.status==='unlabelled-needs-review');
 for(const f of fs){const off=offsets.get(f.id)!;for(const e of f.previewEdges)if(allowed(f,f.nodes[e.a]!.cellId)&&allowed(f,f.nodes[e.b]!.cellId))edges.push({a:off+e.a,b:off+e.b,length:e.lengthMetres,doorId:e.doorId,connectionId:null});}
 const adjacent=new Map<number,{to:number;edge:typeof edges[number]}[]>();for(const e of edges)for(const [a,b]of [[e.a,e.b],[e.b,e.a]]){if(!adjacent.has(a!))adjacent.set(a!,[]);adjacent.get(a!)!.push({to:b!,edge:e});}
 const start=offsets.get(sf.id)!+sr.nodeId,end=offsets.get(ef.id)!+er.nodeId,dist=new Map([[start,0]]),previous=new Map<number,{from:number;edge:typeof edges[number]}>(),visited=new Set<number>();
 const heap:[number,number][]=[];
 const push=(v:[number,number])=>{heap.push(v);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]![0]<=v[0])break;heap[i]=heap[p]!;i=p;}heap[i]=v;};
 const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1]![0]<heap[c]![0])c++;if(heap[c]![0]>=last[0])break;heap[i]=heap[c]!;i=c;}heap[i]=last;}return first;};
 push([0,start]);while(heap.length){const [cost,n]=pop();if(visited.has(n))continue;visited.add(n);if(n===end)break;for(const x of adjacent.get(n)??[]){const d=cost+x.edge.length;if(d<(dist.get(x.to)??Infinity)){dist.set(x.to,d);previous.set(x.to,{from:n,edge:x.edge});push([d,x.to]);}}}
 if(!dist.has(end))return empty('disconnected',unresolved);
 const ids=[end],used:typeof edges=[],doorIds:string[]=[];let current=end;while(current!==start){const p=previous.get(current)!;used.push(p.edge);current=p.from;ids.push(current);}ids.reverse();used.reverse();
 const segments:{floorId:string;points:CadPathPoint[]}[]=[];for(const id of ids){const n=ns[id]!;if(segments.at(-1)?.floorId!==n.floorId)segments.push({floorId:n.floorId,points:[]});segments.at(-1)!.points.push(n.point);}
 for(const e of used)if(e.doorId)doorIds.push(e.doorId);
 return {status:'drawing-preview',segments,connections:used.flatMap(e=>e.connectionId?[e.connectionId]:[]),doorIds,lengthMetres:dist.get(end)!,unresolved,routingEligible:false as const};
}
