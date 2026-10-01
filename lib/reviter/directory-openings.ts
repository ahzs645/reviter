import pc from 'polygon-clipping';
import { containsDirectoryRoomPoint, containsRoomPoint, nearestRoomBoundary, roomArea, roomBuilding, isWalkable, type DirectoryRoom, type RoomPoint, type RouteOpening } from './room-directory.ts';
import type { BoundaryReference } from './room-boundaries.ts';
import type { ArchitecturalPlanGeometry } from './architectural-plan.ts';

/** Explicit drawing openings have their own identity; they never impersonate Revit doors. */
export type ReviewedOpenLink = {id:string; levelId:number; rooms:[string,string]; from:RoomPoint; to:RoomPoint; widthFeet:number; evidence:'registered-opening'; sourceSha256:string};
export type OpenPassage = RouteOpening & {openingId:string; evidence:'registered-opening'};
export function directoryOpenPassages(rooms:readonly DirectoryRoom[], links:readonly ReviewedOpenLink[], reference?:BoundaryReference, geometry?:ArchitecturalPlanGeometry):OpenPassage[] {
  if (!reference || !geometry) return [];
  const result:OpenPassage[]=[];
  for (const link of links) {
    if (link.sourceSha256 !== reference.sourceSha256) continue;
    const a=rooms.find(r=>r.key===link.rooms[0]), b=rooms.find(r=>r.key===link.rooms[1]);
    if (!a||!b||!isWalkable(a)||!isWalkable(b)||a.levelId!==link.levelId||b.levelId!==link.levelId||roomBuilding(a)!==roomBuilding(b)) continue;
    const endpoints=[link.from,link.to];
    if ([a,b].some((r,i)=>!containsDirectoryRoomPoint(endpoints[i]!,r)&&nearestRoomBoundary(endpoints[i]!,r.polygonFeet).distance>.15)) continue;
    const dx=link.to[0]-link.from[0],dy=link.to[1]-link.from[1],length=Math.hypot(dx,dy);
    if (length<.1||length>6||link.widthFeet<.6||link.widthFeet>8) continue;
    const ux=dx/length,uy=dy/length,nx=-uy*link.widthFeet/2,ny=ux*link.widthFeet/2;
    // Short overlap into both rooms avoids a raster seam at the boundary itself.
    const from:RoomPoint=[link.from[0]-.2*ux,link.from[1]-.2*uy],to:RoomPoint=[link.to[0]+.2*ux,link.to[1]+.2*uy];
    const footprint:RoomPoint[]=[[from[0]+nx,from[1]+ny],[to[0]+nx,to[1]+ny],[to[0]-nx,to[1]-ny],[from[0]-nx,from[1]-ny]];
    const area=(p:ReturnType<typeof pc.intersection>)=>p.reduce((s,v)=>s+roomArea(v[0]! as RoomPoint[])-v.slice(1).reduce((t,h)=>t+roomArea(h as RoomPoint[]),0),0);
    // Native walls, columns, private footprints and voids veto an inferred opening.
    const obstacles=[...geometry.walls,...geometry.columns].map(v=>[v.polygon]);
    obstacles.push(...rooms.filter(r=>r.levelId===link.levelId&&!link.rooms.includes(r.key)).map(r=>[r.polygonFeet,...r.holesFeet??[]]));
    try {if(obstacles.some(p=>area(pc.intersection([footprint],p))>.005))continue;} catch {continue;}
    const sections=reference.sections.filter(s=>s.levelId===link.levelId&&[a,b].some(r=>r.dwg?.sectionId===s.sectionId));
    if (!sections.length) continue;
    const crosses=(p:RoomPoint,q:RoomPoint)=>{
      if(containsRoomPoint(p,footprint)||containsRoomPoint(q,footprint))return true;
      return footprint.some((u,i)=>{
        const v=footprint[(i+1)%footprint.length]!,dx=v[0]-u[0],dy=v[1]-u[1],vx=q[0]-p[0],vy=q[1]-p[1],den=dx*vy-dy*vx;
        if(Math.abs(den)<1e-9)return false;
        const px=p[0]-u[0],py=p[1]-u[1],t=(px*vy-py*vx)/den,w=(px*dy-py*dx)/den;
        return t>=0&&t<=1&&w>=0&&w<=1;
      });
    };
    if(sections.some(s=>s.wallSegments.some(([p,q])=>crosses(p,q))))continue;
    const xs=footprint.map(p=>p[0]),ys=footprint.map(p=>p[1]),point:RoomPoint=[(link.from[0]+link.to[0])/2,(link.from[1]+link.to[1])/2];
    result.push({openingId:link.id,evidence:link.evidence,rooms:link.rooms,point,from,to,footprint,halfWidth:Math.max(...xs)-point[0],halfHeight:Math.max(...ys)-point[1]});
  }
  return result;
}
