import pc from 'polygon-clipping';
import type {OpenPassage} from './directory-openings.ts';
import {isHallway, isWalkable, containsRoomPoint, roomBuilding, roomArea, type DirectoryRoom, type RoomPoint, type RoomPortal} from './room-directory.ts';
export type AreaMetadata = {name?: string; notes?: string; elementIds?: number[]; circulationDoorUse?:'unknown'|'usually-open'|'usually-closed'};
export type AreaRelationship = {rooms:[string,string];kind:'access'|'open-space';evidence:'user-reported';notes?:string};
export function directoryAreaKind(room:DirectoryRoom):'atrium'|'hallway'|'room' {
  if(room.access?.kind==='staff')return 'room';
  if(room.spaceUse)return room.spaceUse.kind;
  if (/\batrium\b/i.test(room.name??'') || /\bAtrium\s+LVL\b/i.test(room.dwg?.sectionId??'') && (/^alcove$/i.test(room.name??'') || isHallway(room))) return 'atrium';
  return isHallway(room)?'hallway':'room';
}
export type DirectoryArea = {key:string; kind:'atrium'|'hallway'|'room'; title:string; building:string; levelId:number; elevation:number; roomKeys:string[]; polygons:RoomPoint[][][]; labelPointFeet:RoomPoint; areaFeet:number; geometryNeedsReview?:boolean; walkability?:"walkable"|"void"};
export type CirculationAreaLink = {areas:[string,string]; doorIds:number[]};
export type DirectoryAreaLink = CirculationAreaLink & {reported:AreaRelationship[]; openIds:string[]; riseFeet:number};
/** Model doorway evidence and human area relationships remain distinguishable. */
export function directoryAreaLinks(areas:readonly DirectoryArea[],portals:readonly RoomPortal[],reported:readonly AreaRelationship[]=[],openings:readonly OpenPassage[]=[]):DirectoryAreaLink[] {
  const owners=new Map(areas.flatMap(a=>a.roomKeys.map(k=>[k,a] as const))),links=new Map<string,DirectoryAreaLink>();
  function link(rooms:readonly string[],allowSplit=false):DirectoryAreaLink|null {
    const a=owners.get(rooms[0]!),b=owners.get(rooms[1]!);
    if(!a||!b||a.key===b.key||a.building!==b.building||a.levelId!==b.levelId||a.walkability==="void"||b.walkability==="void"||!allowSplit&&Math.abs(a.elevation-b.elevation)>.05)return null;
    const pair=[a.key,b.key].sort() as [string,string],key=JSON.stringify(pair);
    if(!links.has(key))links.set(key,{areas:pair,doorIds:[],reported:[],openIds:[],riseFeet:Math.abs(a.elevation-b.elevation)});return links.get(key)!;
  }
  for(const p of portals){const l=link(p.rooms);if(l&&!l.doorIds.includes(p.doorId))l.doorIds.push(p.doorId);}
  for(const o of openings){const l=link(o.rooms);if(l)l.openIds.push(o.openingId);}
  for(const r of reported){const l=link(r.rooms,true);if(l)l.reported.push(r);}
  return [...links.values()];
}
/** A doorway relationship is independent of the door's current open/closed state.
 * Keep semantic areas and fire-door boundaries while showing shared circulation. */
export function circulationAreaLinks(areas:readonly DirectoryArea[], portals:readonly RoomPortal[]):CirculationAreaLink[] {
  const owners=new Map(areas.filter(a=>a.kind!=='room').flatMap(a=>a.roomKeys.map(key=>[key,a] as const)));
  const links=new Map<string,CirculationAreaLink>();
  for(const p of portals){
    const a=owners.get(p.rooms[0]),b=owners.get(p.rooms[1]);
    if(!a||!b||a.key===b.key||a.building!==b.building||a.levelId!==b.levelId||Math.abs(a.elevation-b.elevation)>.05)continue;
    const pair=[a.key,b.key].sort() as [string,string],key=JSON.stringify(pair);
    const link=links.get(key)??{areas:pair,doorIds:[]};
    if(!link.doorIds.includes(p.doorId))link.doorIds.push(p.doorId);
    links.set(key,link);
  }
  return [...links.values()];
}
export function connectedCirculationAreas(areas:readonly DirectoryArea[], portals:readonly RoomPortal[], selectedKey:string|null,reported:readonly AreaRelationship[]=[],openings:readonly OpenPassage[]=[]):Set<string> {
  const selected=areas.find(a=>!!selectedKey&&a.roomKeys.includes(selectedKey));
  const keys=new Set<string>(selected?[selected.key]:[]);
  const links=directoryAreaLinks(areas,portals,reported,openings);
  for(const key of keys)for(const link of links)if(link.areas.includes(key)){
    for(const next of link.areas){const a=areas.find(a=>a.key===key)!,b=areas.find(a=>a.key===next)!;
      if(link.reported.length||a.kind!=='room'&&b.kind!=='room'||key===selected?.key&&b.kind!=='room')keys.add(next);
    }
  }
  return keys;
}
/** Show explicitly reported access in a circulation review without reclassifying
 * enclosed rooms or adding doorway, floor-support or routing evidence. */
export function reportedCirculationRoomKeys(areas:readonly DirectoryArea[],reported:readonly AreaRelationship[]=[]):Set<string> {
  const connected=new Set(areas.filter(a=>a.kind!=="room"&&a.walkability!=="void").map(a=>a.key));
  const links=directoryAreaLinks(areas,[],reported);
  for(const key of connected)for(const link of links)if(link.areas.includes(key))for(const next of link.areas)connected.add(next);
  return new Set(areas.filter(a=>connected.has(a.key)).flatMap(a=>a.roomKeys));
}
/** Display regions retain their source records. Union removes label seams without
 * buffering gaps, filling voids, joining floors, or changing navigation data. */
export function directoryAreas(rooms:readonly DirectoryRoom[], elevations:Readonly<Record<string,{elevation:number}>> = {}):DirectoryArea[] {
  const active=rooms.filter(r=>r.status!=='deleted');
  const groups=new Map<string,DirectoryRoom[]>();
  for(const r of active){
    const kind=isWalkable(r)?directoryAreaKind(r):"room";
    const z=elevations[r.key]?.elevation ?? 0;
    const key=kind==='room'?`room:${r.key}`:`area:${roomBuilding(r)}:${r.levelId}:${kind}:${z.toFixed(2)}`;
    groups.set(key,[...groups.get(key)??[],r]);
  }
  return [...groups].map(([key,members])=>{
    const first=members[0]!,kind=isWalkable(first)?directoryAreaKind(first):"room";
    const elevation=elevations[first.key]?.elevation ?? 0;
    const shape=(r:DirectoryRoom):RoomPoint[][]=>[r.polygonFeet,...r.holesFeet??[]];
    let polygons:RoomPoint[][][]=members.map(shape),geometryNeedsReview=false;
    try {
    polygons=pc.union(shape(first),...members.slice(1).map(shape)) as RoomPoint[][][];
    if(kind!=='room'){
      const privateRooms=active.filter(r=>(!isWalkable(r)||directoryAreaKind(r)==='room')&&r.levelId===first.levelId&&roomBuilding(r)===roomBuilding(first)&&Math.abs((elevations[r.key]?.elevation??0)-elevation)<.05);
      if(privateRooms.length)polygons=pc.difference(polygons,...privateRooms.map(shape)) as RoomPoint[][][];
    }
    if (isWalkable(first)) {
      const openings=active.filter(r=>r.levelId===first.levelId&&roomBuilding(r)===roomBuilding(first)&&Math.abs((elevations[r.key]?.elevation??0)-elevation)<.05).flatMap(r=>r.floorOpeningsFeet??[]);
      if(openings.length)polygons=pc.difference(polygons,...openings.map(h=>[h])) as RoomPoint[][][];
      const voids=active.filter(r=>!isWalkable(r)&&r.levelId===first.levelId&&roomBuilding(r)===roomBuilding(first));
      if(voids.length)polygons=pc.difference(polygons,...voids.map(shape)) as RoomPoint[][][];
    }
    } catch { geometryNeedsReview=true; }
    const points=polygons.flatMap(p=>p[0]!),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const center:RoomPoint=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];
    const inside=(point:RoomPoint)=>polygons.some(p=>containsRoomPoint(point,p[0]!)&&!p.slice(1).some(h=>containsRoomPoint(point,h)));
    const labelPointFeet=inside(center)?center:members.map(r=>r.labelPointFeet).find(inside)??first.labelPointFeet;
    return {key,kind,walkability:members.every(r=>r.walkability==="void")?"void":"walkable",title:kind==='atrium'?(members.every(r=>r.modelSurface?.kind==='crosswalk')?'Atrium crosswalks':'Atrium'):kind==='hallway'?'Hallways':`${first.number??'Room'} · ${first.name??'Unnamed room'}`,building:roomBuilding(first),levelId:first.levelId,elevation,roomKeys:members.map(r=>r.key),polygons,labelPointFeet,geometryNeedsReview,areaFeet:polygons.reduce((sum,p)=>sum+roomArea(p[0]!)-p.slice(1).reduce((s,h)=>s+roomArea(h),0),0)};
  });
}
