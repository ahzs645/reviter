import polygonClipping from "polygon-clipping";
import type { BoundaryReference } from "./room-boundaries.ts";
import { containsDirectoryRoomPoint, directoryRoomArea, findDirectoryRoute, hallwayRouteComponents, isHallway, isWalkable, nearestRoomBoundary, roomArea, roomBuilding, validRoomBoundary, type DirectoryRoom, type DirectoryElevations, type DirectoryRouteBarriers, type RoomPoint, type RouteOpening } from "./room-directory.ts";
import type { DoorReview, StairConnection } from "./directory-navigation.ts";

export type DirectoryIssue = {roomKey:string;kind:"boundary"|"anchor"|"alignment"|"overlap"|"access"|"stair";message:string};
export type DirectoryFloorAudit = {building:string;levelId:number;roomCount:number;destinations:number;routesPassed:number;networks:number;connectedDoors:number;unresolvedDoors:number;stairLinks:number;issues:DirectoryIssue[];wallContext?:{drawingSegments:number;missingDrawingSections:string[];nativeWalls:number;slabMatches:number}};
export type DirectoryAudit = {version:1;checkedAt:string;floors:DirectoryFloorAudit[]};
const loops=(r:DirectoryRoom)=>[r.polygonFeet,...r.holesFeet??[]].map(l=>[...l,l[0]!]);
const bounds=(r:DirectoryRoom)=>[Math.min(...r.polygonFeet.map(p=>p[0])),Math.min(...r.polygonFeet.map(p=>p[1])),Math.max(...r.polygonFeet.map(p=>p[0])),Math.max(...r.polygonFeet.map(p=>p[1]))];

/** Shared by the live interface; checks are recomputed from the current annotations. */
export function auditDirectoryFloor(rooms:readonly DirectoryRoom[], portals:readonly RouteOpening[], doors:readonly DoorReview[], stairs:readonly StairConnection[], reference?:BoundaryReference,elevations:DirectoryElevations = {},barriers?:DirectoryRouteBarriers):DirectoryFloorAudit {
  const issues:DirectoryIssue[]=[],levelId=rooms[0]!.levelId,building=roomBuilding(rooms[0]!);
  const add=(r:DirectoryRoom,kind:DirectoryIssue['kind'],message:string)=>issues.push({roomKey:r.key,kind,message});
  const components=hallwayRouteComponents(rooms,portals,elevations,barriers).sort((a,b)=>b.length-a.length);
  const seeds=components.map(c=>rooms.filter(r=>c.includes(r.key) && containsDirectoryRoomPoint(r.labelPointFeet,r)).sort((a,b)=>directoryRoomArea(b)-directoryRoomArea(a))[0]).filter((r):r is DirectoryRoom=>!!r);
  const unique=rooms.filter((r,i)=>!r.circulationGroup || rooms.findIndex(o=>o.circulationGroup===r.circulationGroup)===i);
  const sections=reference?.sections.filter(s=>s.levelId===levelId && rooms.some(r=>r.dwg?.sectionId===s.sectionId))??[];
  const bins=new Map<string,[RoomPoint,RoomPoint][]>(),size=8;
  for(const segment of sections.flatMap(s=>[...s.wallSegments,...s.doorSegments])){
    const [a,b]=segment;for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++){const key=`${x}:${y}`;bins.set(key,[...bins.get(key)??[],segment]);}
  }
  const evidenceDistance=(p:RoomPoint)=>{let best=Infinity;const x=Math.floor(p[0]/size),y=Math.floor(p[1]/size);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const segment of bins.get(`${x+dx}:${y+dy}`)??[])best=Math.min(best,nearestRoomBoundary(p,segment).distance);return best;};
  let routesPassed=0,destinations=0;
  for(const r of rooms){
    if(!validRoomBoundary(r.polygonFeet) || directoryRoomArea(r)<=0)add(r,'boundary','Room outline crosses itself or has no usable area.');
    if(!containsDirectoryRoomPoint(r.labelPointFeet,r))add(r,'anchor','Room label is outside its usable boundary.');
    if(sections.some(s=>s.sectionId===r.dwg?.sectionId)){
      let perimeter=0,unsupported=0;
      for(const loop of [r.polygonFeet,...r.holesFeet??[]])for(let i=0;i<loop.length;i++){const a=loop[i]!,b=loop[(i+1)%loop.length]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(length/2));for(let j=0;j<n;j++){const t=(j+.5)/n;perimeter+=length/n;if(evidenceDistance([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])>.3)unsupported+=length/n;}}
      if(unsupported>5 && unsupported/perimeter>.1)add(r,'alignment',`${Math.round(100*unsupported/perimeter)}% of the outline needs wall or opening review.`);
    }
    if(isWalkable(r)&&!isHallway(r)){
      destinations++;
      if(seeds.some(s=>findDirectoryRoute(rooms,portals,s.key,r.key,elevations,barriers)))routesPassed++;
      else add(r,'access','No route to a hallway through the current room outlines and door openings.');
    }
    if(/\bstair(?:s|case|well)?\b/i.test(r.name??'') && !stairs.some(s=>s.rooms.includes(r.key)))add(r,'stair','No unambiguous native stair flight connects this entrance to another annotated floor.');
  }
  const area=(polys:ReturnType<typeof polygonClipping.intersection>)=>polys.reduce((sum,p)=>sum+roomArea(p[0]! as RoomPoint[])-p.slice(1).reduce((s,h)=>s+roomArea(h as RoomPoint[]),0),0);
  const boxes=unique.map(bounds);
  for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
    const a=unique[i]!,b=unique[j]!,u=boxes[i]!,v=boxes[j]!;
    if(isHallway(a)&&isHallway(b) || u[0]!>v[2]! || u[2]!<v[0]! || u[1]!>v[3]! || u[3]!<v[1]!)continue;
    try{const overlap=area(polygonClipping.intersection(loops(a),loops(b)));if(overlap>1 && overlap/Math.min(directoryRoomArea(a),directoryRoomArea(b))>.02){add(a,'overlap',`Boundary overlaps ${b.number??b.key} by ${(overlap*.092903).toFixed(1)} m².`);add(b,'overlap',`Boundary overlaps ${a.number??a.key} by ${(overlap*.092903).toFixed(1)} m².`);}}catch{add(a,'boundary','Unable to compare this outline with a neighbouring room.');}
  }
  const nearby=doors.filter(d=>d.candidates.length || rooms.some(r=>containsDirectoryRoomPoint(d.door.point,r) || nearestRoomBoundary(d.door.point,r.polygonFeet).distance<4));
  return {building,levelId,roomCount:rooms.length,destinations,routesPassed,networks:components.length,connectedDoors:nearby.filter(d=>d.portal).length,unresolvedDoors:nearby.filter(d=>!d.portal).length,stairLinks:stairs.filter(s=>s.levels.includes(levelId)&&s.rooms.some(k=>rooms.some(r=>r.key===k))).length,issues};
}
