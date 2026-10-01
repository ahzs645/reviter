import {findDirectoryRoute,isHallway,isWalkable,roomBuilding,type DirectoryRoom,type DirectoryRoute,type DirectoryRouteBarriers} from './room-directory.ts';
import type {DoorReview} from './directory-navigation.ts';

export type BuildingConnection = {door:DoorReview;rooms:[DirectoryRoom,DirectoryRoom];levelId:number;elevation:number;route:DirectoryRoute|null};
/** Building names do not interrupt a precise native doorway. Keep both source
 * spaces and verify a local crossing; this does not infer a campus-wide route. */
export function buildingConnections(rooms:readonly DirectoryRoom[],reviews:readonly DoorReview[],elevations:Readonly<Record<string,{elevation:number}>>,barriers?:DirectoryRouteBarriers):BuildingConnection[] {
  const byKey=new Map(rooms.map(r=>[r.key,r]));
  return reviews.flatMap(door=>{
    if(!door.portal||!door.door.footprint||!door.door.normal)return [];
    const a=byKey.get(door.portal.rooms[0]),b=byKey.get(door.portal.rooms[1]);
    if(!a||!b||!isWalkable(a)||!isWalkable(b)||a.levelId!==b.levelId||roomBuilding(a)===roomBuilding(b))return [];
    const za=elevations[a.key]?.elevation,zb=elevations[b.key]?.elevation;
    if(za==null||zb==null||!Number.isFinite(za)||!Number.isFinite(zb)||Math.abs(za-zb)>.05)return [];
    const points=[...a.polygonFeet,...b.polygonFeet],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const obstacles=rooms.filter(r=>r.key!==a.key&&r.key!==b.key&&r.levelId===a.levelId&&r.status!=="deleted"&&(!isWalkable(r)||!isHallway(r))&&Math.min(...r.polygonFeet.map(p=>p[0]))<=Math.max(...xs)&&Math.max(...r.polygonFeet.map(p=>p[0]))>=Math.min(...xs)&&Math.min(...r.polygonFeet.map(p=>p[1]))<=Math.max(...ys)&&Math.max(...r.polygonFeet.map(p=>p[1]))>=Math.min(...ys));
    return [{door,rooms:[a,b] as [DirectoryRoom,DirectoryRoom],levelId:a.levelId,elevation:za,route:findDirectoryRoute([a,b,...obstacles],[door.portal],a.key,b.key,elevations,barriers)}];
  });
}
