import {reviewedDoorOpening,reviewedDoorHostEvidence} from "./reviewed-door-apertures.ts";
import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import { architecturalPlanGeometry } from "./architectural-plan.ts";
import { containsDirectoryRoomPoint, isWalkable, findDirectoryRoute, nearestRoomBoundary, roomArea, roomBuilding, roomPortals, type DirectoryDoor, type DirectoryRoom, type DirectoryRoute, type DirectoryElevations, type DirectoryRouteBarriers, type RoomPoint, type RoomPortal, type RouteOpening } from "./room-directory.ts";

import { isStairArea } from "./directory-stair-geometry.ts";
import {nativeStairLandingContact} from './native-stair-landing-contact.ts';
export const isStaircase = (room: DirectoryRoom) => isStairArea(room) && room.stairAccess !== "local-only";
const allowsStairNeighbour = (room:DirectoryRoom, ownZ:number|undefined, otherZ:number|undefined) => room.stairAccess !== "up-flight-only" || (ownZ != null && otherZ != null && otherZ > ownZ + .05);
export type ReviewedDoorLink = { doorId: number; levelId: number; rooms: [string, string]; semanticEvidence?: import("./semantic-door-links.ts").SemanticDoorEvidence };
export type ReviewedStairLink = { rooms: [string,string] };
import type { ReviewedOpenLink } from "./directory-openings.ts";
export type DirectoryNavigation = { version: 1; doorLinks: ReviewedDoorLink[]; stairLinks?: ReviewedStairLink[]; openLinks?:ReviewedOpenLink[] };
export type StairConnection = { id: string; stairElementId?: number; evidence: "native-flight" | "reviewed"; rooms: [string,string]; levels: [number,number]; elevationsFeet: [number,number]; riseFeet: number; distanceFeet: number; treadCount: number };
export type DoorReview = { door: DirectoryDoor; candidates: string[]; state: "connected" | "unmatched" | "ambiguous"; portal?: RoomPortal; hasExplicitReview?:boolean };

/** Door bounds locate the opening; a recovered oriented footprint constrains its bridge. */
export function directoryDoors(model: ConvertResult, levelId: number): DirectoryDoor[] {
  const members = new Set(model.nativeAssociatedLevelRelations?.filter(r=>r.levelId===levelId).map(r=>r.elementId));
  const geometry=architecturalPlanGeometry(model,levelId);
  const hosts=new Map(model.nativeHostRelations?.map(h=>[h.elementId,h.hostId]));
  const footprints=new Map(geometry.doors.filter(d=>!d.approximate).map(d=>{
    const reviewed=reviewedDoorOpening(model,levelId,d.elementId);
    if(reviewed)return [d.elementId,reviewed.apertureFeet] as const;
    let polygon=d.polygon;
    const edges=polygon.map((p,i)=>({p,q:polygon[(i+1)%polygon.length]!,length:Math.hypot(p[0]-polygon[(i+1)%polygon.length]![0],p[1]-polygon[(i+1)%polygon.length]![1])})).sort((a,b)=>b.length-a.length);
    const edge=edges[0]!;
    if(edge.length>0){
      const ux=(edge.q[0]-edge.p[0])/edge.length,uy=(edge.q[1]-edge.p[1])/edge.length,nx=-uy,ny=ux;
      const u=(p:RoomPoint)=>p[0]*ux+p[1]*uy,n=(p:RoomPoint)=>p[0]*nx+p[1]*ny;
      const lo=Math.min(...polygon.map(u)),hi=Math.max(...polygon.map(u));let lower=Math.min(...polygon.map(n)),upper=Math.max(...polygon.map(n));
      const centre:RoomPoint=[polygon.reduce((s,p)=>s+p[0]/polygon.length,0),polygon.reduce((s,p)=>s+p[1]/polygon.length,0)];
      const hostId=hosts.get(d.elementId),hostParts=hostId===undefined?[]:reviewedDoorHostEvidence(model,levelId,hostId)??geometry.walls.filter(w=>w.elementId===hostId);
      for(const wall of hostParts){
        const ring=wall.polygon,last=ring[ring.length-1],first=ring[0];
        const face=last&&first&&last[0]===first[0]&&last[1]===first[1]?ring.slice(0,-1):ring;
        if(wall.approximate||face.length!==4)continue;
        const wallEdge=face.map((p,i)=>({p,q:face[(i+1)%4]!,length:Math.hypot(p[0]-face[(i+1)%4]![0],p[1]-face[(i+1)%4]![1])})).sort((a,b)=>b.length-a.length)[0]!;
        const parallel=Math.abs(((wallEdge.q[0]-wallEdge.p[0])*ux+(wallEdge.q[1]-wallEdge.p[1])*uy)/wallEdge.length);
        const min=Math.min(...face.map(n)),max=Math.max(...face.map(n));
        if(parallel<.99 || max-min>6 || (!containsDirectoryRoomPoint(centre,{polygonFeet:face} as DirectoryRoom) && nearestRoomBoundary(centre,face).distance>.75))continue;
        lower=Math.min(lower,min);upper=Math.max(upper,max);
      }
      const p=(uu:number,nn:number):RoomPoint=>[uu*ux+nn*nx,uu*uy+nn*ny];polygon=[p(lo,lower),p(hi,lower),p(hi,upper),p(lo,upper)];
    }
    return [d.elementId,polygon] as const;
  }));
  const normals=new Map(geometry.doors.filter(d=>!d.approximate).map(d=>{
    const edge=d.polygon.map((p,i)=>({p,q:d.polygon[(i+1)%d.polygon.length]!,length:Math.hypot(p[0]-d.polygon[(i+1)%d.polygon.length]![0],p[1]-d.polygon[(i+1)%d.polygon.length]![1])})).sort((a,b)=>b.length-a.length)[0]!;
    return [d.elementId,[-(edge.q[1]-edge.p[1])/edge.length,(edge.q[0]-edge.p[0])/edge.length] as RoomPoint] as const;
  }));
  return model.elementBounds.filter(r=>r.categoryId===-2000023 && members.has(r.elementId)).map(r=>{
    const footprint=footprints.get(r.elementId);
    const minX=footprint?Math.min(...footprint.map(p=>p[0])):r.boundsFeet.min.x,maxX=footprint?Math.max(...footprint.map(p=>p[0])):r.boundsFeet.max.x;
    const minY=footprint?Math.min(...footprint.map(p=>p[1])):r.boundsFeet.min.y,maxY=footprint?Math.max(...footprint.map(p=>p[1])):r.boundsFeet.max.y;
    return {id:r.elementId,point:[(minX+maxX)/2,(minY+maxY)/2] as RoomPoint,halfWidth:(maxX-minX)/2,halfHeight:(maxY-minY)/2,footprint,normal:reviewedDoorOpening(model,levelId,r.elementId)?.normalFeet??normals.get(r.elementId)};
  });
}
export function doorCandidates(rooms: readonly DirectoryRoom[], door: DirectoryDoor): DirectoryRoom[] {
  return rooms.filter(isWalkable).filter((r,i,active)=>!r.circulationGroup || active.findIndex(o=>o.circulationGroup===r.circulationGroup)===i).filter(r=>{
    const nearest=[r.polygonFeet,...r.holesFeet??[]].map(loop=>nearestRoomBoundary(door.point,loop)).sort((a,b)=>a.distance-b.distance)[0]!;
    return nearest.distance<=2 && Math.abs(nearest.point[0]-door.point[0])<=door.halfWidth+.6 && Math.abs(nearest.point[1]-door.point[1])<=door.halfHeight+.6;
  });
}
export function reviewedDoorPortal(rooms:readonly DirectoryRoom[], door:DirectoryDoor, link:ReviewedDoorLink):RoomPortal|null {
  if(link.doorId!==door.id || link.rooms[0]===link.rooms[1])return null;
  const candidates=doorCandidates(rooms,door),pair=link.rooms.map(key=>candidates.find(r=>r.key===key));
  if(pair.some(r=>!r || r.levelId!==link.levelId))return null;
  const points=pair.map(r=>[r!.polygonFeet,...r!.holesFeet??[]].map(loop=>nearestRoomBoundary(door.point,loop)).sort((a,b)=>a.distance-b.distance)[0]!.point);
  return {doorId:door.id,rooms:link.rooms,point:door.point,from:points[0]!,to:points[1]!,halfWidth:door.halfWidth,halfHeight:door.halfHeight,footprint:door.footprint,normal:door.normal,reviewed:true};
}
export function directoryDoorReviews(rooms:readonly DirectoryRoom[], doors:readonly DirectoryDoor[], reviewed:readonly ReviewedDoorLink[]=[], explicitReviews:readonly ReviewedDoorLink[]=reviewed):DoorReview[] {
  const auto=roomPortals(rooms,doors);
  return doors.map(door=>{
    const candidates=doorCandidates(rooms,door).map(r=>r.key),override=reviewed.find(l=>l.doorId===door.id && l.levelId===rooms[0]?.levelId);
    const portal=override ? reviewedDoorPortal(rooms,door,override) ?? undefined : auto.find(p=>p.doorId===door.id);
    // A semantic link rejected upstream still represents an explicit ownership
    // decision. Automatic recovery must not replace that decision silently.
    const explicit=explicitReviews.some(l=>l.doorId===door.id && l.levelId===rooms[0]?.levelId);
    return {door,candidates,portal,hasExplicitReview:explicit?true:undefined,state:portal?'connected':candidates.length>2?'ambiguous':'unmatched'};
  });
}

/** Both endpoints must identify ONE persisted assembly by native tread overlap,
 * or an explicitly bound source-floor landing contacting its terminal cap.
 * Matching room numbers or overlapping stair envelopes alone never create links. */
export function directoryStairs(model:ConvertResult, rooms:readonly DirectoryRoom[], reviewed:readonly ReviewedStairLink[]=[]):StairConnection[] {
  const elevations=new Map(model.levels.map(l=>[l.levelId,l.elevation]));
  const records=new Map(model.elementBounds.map(r=>[r.elementId,r]));
  const stairRooms=rooms.filter(r=>isWalkable(r)&&isStaircase(r)), links:StairConnection[]=[];
  for(const assembly of model.nativeStairAssemblies??[]){
    const runs=assembly.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length);
    if(!runs.length)continue;
    const low=Math.min(...runs.map(r=>r!.boundsFeet.min.z)),high=Math.max(...runs.map(r=>r!.boundsFeet.max.z));
    if(high-low<1)continue;
    const treads=runs.flatMap(r=>r!.stairTreads!);
    const overlaps=(room:DirectoryRoom)=>treads.some(t=>{
      const polygon=t.map(p=>[p[0],p[1]] as RoomPoint);
      if(roomArea(polygon)<.01)return false;
      const intersection=polygonClipping.intersection([[...polygon,polygon[0]!]], [room.polygonFeet,...room.holesFeet??[]].map(l=>[...l,l[0]!]));
      return intersection.reduce((sum,p)=>sum+roomArea(p[0]! as RoomPoint[])-p.slice(1).reduce((s,h)=>s+roomArea(h as RoomPoint[]),0),0)>.5;
    });
    const bottom=stairRooms.filter(r=>Math.abs((elevations.get(r.levelId)??Infinity)-low)<=1 && (overlaps(r)||nativeStairLandingContact(model,r,assembly.stairElementId,runs as NonNullable<typeof runs[number]>[],'bottom')));
    const top=stairRooms.filter(r=>Math.abs((elevations.get(r.levelId)??Infinity)-high)<=1 && (overlaps(r)||nativeStairLandingContact(model,r,assembly.stairElementId,runs as NonNullable<typeof runs[number]>[],'top')));
    const buildings=new Set(bottom.map(roomBuilding));
    for(const building of buildings){
      const a=bottom.filter(r=>roomBuilding(r)===building),b=top.filter(r=>roomBuilding(r)===building);
      if(a.length!==1 || b.length!==1 || a[0]!.levelId===b[0]!.levelId)continue;
      const az=elevations.get(a[0]!.levelId)!,bz=elevations.get(b[0]!.levelId)!;
      if(!allowsStairNeighbour(a[0]!,az,bz)||!allowsStairNeighbour(b[0]!,bz,az))continue;
      const rise=Math.abs(az-bz);
      // Distance is an estimate from rise and native tread centres, including turns.
      const centres=treads.map(t=>t.reduce((s,p)=>[s[0]+p[0]/t.length,s[1]+p[1]/t.length,s[2]+p[2]/t.length],[0,0,0])).sort((a,b)=>a[2]!-b[2]!);
      const distance=centres.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]!-centres[i]![0]!,p[1]!-centres[i]![1]!,p[2]!-centres[i]![2]!),0);
      links.push({id:`stair:${assembly.stairElementId}:${a[0]!.key}:${b[0]!.key}`,stairElementId:assembly.stairElementId,evidence:"native-flight",rooms:[a[0]!.key,b[0]!.key],levels:[a[0]!.levelId,b[0]!.levelId],elevationsFeet:[az,bz],riseFeet:rise,distanceFeet:Math.max(rise,distance),treadCount:treads.length});
    }
  }
  for(const review of reviewed){const link=reviewedStairConnection(model,rooms,review);if(link && !links.some(s=>s.rooms.every(k=>link.rooms.includes(k))))links.push(link);}
  return links;
}
export function reviewedStairConnection(model:ConvertResult,rooms:readonly DirectoryRoom[],review:ReviewedStairLink):StairConnection|null {
  const a=rooms.find(r=>r.key===review.rooms[0]),b=rooms.find(r=>r.key===review.rooms[1]);
  if(!a || !b || !isWalkable(a) || !isWalkable(b) || !isStaircase(a) || !isStaircase(b) || a.levelId===b.levelId || roomBuilding(a)!==roomBuilding(b))return null;
  const intersection=polygonClipping.intersection([a.polygonFeet,...a.holesFeet??[]].map(l=>[...l,l[0]!]),[b.polygonFeet,...b.holesFeet??[]].map(l=>[...l,l[0]!]));
  if(intersection.reduce((sum,p)=>sum+roomArea(p[0]! as RoomPoint[])-p.slice(1).reduce((s,h)=>s+roomArea(h as RoomPoint[]),0),0)<1)return null;
  const az=model.levels.find(l=>l.levelId===a.levelId)?.elevation,bz=model.levels.find(l=>l.levelId===b.levelId)?.elevation;
  if(az==null || bz==null || Math.abs(az-bz)<1 || !allowsStairNeighbour(a,az,bz) || !allowsStairNeighbour(b,bz,az))return null;
  const rise=Math.abs(az-bz);
  return {id:`reviewed-stair:${[a.key,b.key].sort().join(":")}`,evidence:"reviewed",rooms:[a.key,b.key],levels:[a.levelId,b.levelId],elevationsFeet:[az,bz],riseFeet:rise,distanceFeet:rise*2,treadCount:0};
}
export type BuildingRouteStep = {kind:"floor";levelId:number;route:DirectoryRoute} | {kind:"stairs";connection:StairConnection;fromKey:string;toKey:string};
export type BuildingRoute = {distanceFeet:number;steps:BuildingRouteStep[]; legs:{levelId:number;route:DirectoryRoute}[]; transitions:StairConnection[]};
export function findBuildingRoute(rooms:readonly DirectoryRoom[], portalsByLevel:ReadonlyMap<number,readonly RouteOpening[]>, stairs:readonly StairConnection[], startKey:string,endKey:string, useStairs=true,elevations:DirectoryElevations = {},barriersByLevel:ReadonlyMap<number,DirectoryRouteBarriers> = new Map()):BuildingRoute|null {
  const start=rooms.find(r=>r.key===startKey),end=rooms.find(r=>r.key===endKey);
  if(!start || !end || !isWalkable(start) || !isWalkable(end) || roomBuilding(start)!==roomBuilding(end))return null;
  const local=(a:DirectoryRoom,b:DirectoryRoom)=>findDirectoryRoute(rooms.filter(r=>r.levelId===a.levelId),portalsByLevel.get(a.levelId)??[],a.key,b.key,elevations,barriersByLevel.get(a.levelId));
  if(start.levelId===end.levelId){const route=local(start,end);if(route)return {distanceFeet:route.distanceFeet,steps:[{kind:"floor",levelId:start.levelId,route}],legs:[{levelId:start.levelId,route}],transitions:[]};}
  if(!useStairs)return null;
  const relevant=stairs.filter(s=>s.rooms.every((k,i)=>rooms.some(r=>r.key===k && isWalkable(r) && isStaircase(r) && roomBuilding(r)===roomBuilding(start) && allowsStairNeighbour(r,s.elevationsFeet?.[i],s.elevationsFeet?.[1-i]))));
  const keys=new Set([startKey,endKey,...relevant.flatMap(s=>s.rooms)]),nodes=rooms.filter(r=>keys.has(r.key) && containsDirectoryRoomPoint(r.routePointFeet??r.labelPointFeet,r));
  if(!nodes.some(r=>r.key===startKey) || !nodes.some(r=>r.key===endKey))return null;
  const distance=new Map<string,number>([[startKey,0]]),previous=new Map<string,{from:string;leg?:DirectoryRoute;stair?:StairConnection}>(),seen=new Set<string>(),cache=new Map<string,DirectoryRoute|null>();
  while(true){
    const current=nodes.filter(r=>!seen.has(r.key) && distance.has(r.key)).sort((a,b)=>distance.get(a.key)!-distance.get(b.key)!)[0];
    if(!current)return null;if(current.key===endKey)break;seen.add(current.key);
    for(const next of nodes){
      if(seen.has(next.key) || next.key===current.key)continue;
      const stair=relevant.find(s=>s.rooms.includes(current.key)&&s.rooms.includes(next.key));
      let leg:DirectoryRoute|null=null;
      if(!stair && current.levelId===next.levelId){const key=`${current.key}:${next.key}`;if(!cache.has(key))cache.set(key,local(current,next));leg=cache.get(key)!;}
      if(!stair && !leg)continue;
      const cost=distance.get(current.key)!+(stair?.distanceFeet??leg!.distanceFeet);
      if(cost<(distance.get(next.key)??Infinity)){distance.set(next.key,cost);previous.set(next.key,{from:current.key,leg:leg??undefined,stair});}
    }
  }
  const steps:NonNullable<ReturnType<typeof previous.get>>[]=[];
  for(let key=endKey;key!==startKey;){const step=previous.get(key);if(!step)return null;steps.push(step);key=step.from;}steps.reverse();
  return {distanceFeet:distance.get(endKey)!,steps:steps.map((s,i)=>s.stair ? {kind:"stairs",connection:s.stair,fromKey:s.from,toKey:steps[i+1]?.from??endKey} : {kind:"floor",levelId:rooms.find(r=>r.key===s.from)!.levelId,route:s.leg!}),legs:steps.filter(s=>s.leg).map(s=>({levelId:rooms.find(r=>r.key===s.from)!.levelId,route:s.leg!})),transitions:steps.filter(s=>s.stair).map(s=>s.stair!)};
}
