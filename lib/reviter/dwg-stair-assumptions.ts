export type CadStairAssumptions={format:'reviter-cad-stair-assumptions';version:1;sourceSha256:string;geometrySha256:string;userAssumed:true;routingEligible:false;graphEdges:never[];connections:{id:string;buildingCode:string;family:string;fromFloorId:string;toFloorId:string;fromAreaId:string;toAreaId:string;fromPointMetres:[number,number];toPointMetres:[number,number];missingIntermediateOrdinals:number[];assumedContinuous:true;servedStopsVerified:false;physicalElevations:null;reason:string}[];unresolved:{buildingCode:string;family:string;fromFloorId:string;toFloorId:string;reason:string}[]};
export function cadPointInRings(p:[number,number],rings:[number,number][][]):boolean{
 const inside=(ring:[number,number][])=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i]!,b=ring[j]!;const cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);if(Math.abs(cross)<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
 return !!rings[0]&&inside(rings[0])&&!rings.slice(1).some(inside);
}
export function validateCadStairAssumptions(v:CadStairAssumptions,geometry:{sourceSha256:string;floors:{id:string;buildingCode:string;stairAreas:{id:string;ringsMetres:[number,number][][]}[]}[]},analysis:{geometrySha256:string;floors:{id:string;additionalTransform:{a:number;b:number;c:number;d:number;e:number;f:number}}[];stairFamilies:{buildingCode:string;family:string;occurrences:{floorId:string;nearbyAreaIds:string[]}[]}[]}){
 const fail=()=>{throw new Error('Assumed stairs do not match the original source footprints.');};
 if(v.format!=='reviter-cad-stair-assumptions'||v.version!==1||v.sourceSha256!==geometry.sourceSha256||v.geometrySha256!==analysis.geometrySha256||v.userAssumed!==true||v.routingEligible!==false||!Array.isArray(v.graphEdges)||v.graphEdges.length||!Array.isArray(v.connections)||new Set(v.connections.map(c=>c.id)).size!==v.connections.length||!Array.isArray(v.unresolved))fail();
 for(const c of v.connections){const family=analysis.stairFamilies.find(f=>f.buildingCode===c.buildingCode&&f.family===c.family),positions=[];
  if(!family||c.fromFloorId===c.toFloorId||c.assumedContinuous!==true||c.servedStopsVerified!==false||c.physicalElevations!==null)fail();
  for(const [id,areaId,p]of [[c.fromFloorId,c.fromAreaId,c.fromPointMetres],[c.toFloorId,c.toAreaId,c.toPointMetres]] as const){const f=geometry.floors.find(f=>f.id===id),area=f?.stairAreas.find(a=>a.id===areaId),t=analysis.floors.find(f=>f.id===id)?.additionalTransform;
   if(f?.buildingCode!==c.buildingCode||!family!.occurrences.some(o=>o.floorId===id&&o.nearbyAreaIds.includes(areaId))||!area||!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||!cadPointInRings(p,area.ringsMetres)||!t)fail();
   positions.push([t!.a*p[0]+t!.c*p[1]+t!.e,t!.b*p[0]+t!.d*p[1]+t!.f]);
  }
  if(Math.hypot(positions[0]![0]!-positions[1]![0]!,positions[0]![1]!-positions[1]![1]!)>1e-7)fail();
 }
 return v;
}
