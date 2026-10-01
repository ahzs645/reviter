import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import { containsRoomPoint, isWalkable, nearestRoomBoundary, roomArea, type DirectoryRoom, type RoomPoint } from "./room-directory.ts";

export const isStairArea = (room: DirectoryRoom) => /\bstair(?:s|case|well)?\b/i.test(room.name ?? "") || !!room.stairFlightIds?.length;
/** A stair landing can belong to a shared hallway; review only its selected record. */
export const stairRoomsForSelection = (rooms: readonly DirectoryRoom[], selectedKey: string|null) => rooms.filter(r=>isStairArea(r)&&(selectedKey==null||r.key===selectedKey));
export type DirectoryStairFootprint = {
  roomKey: string;
  stairElementIds: number[];
  polygons: RoomPoint[][][];
  treads: {polygons: RoomPoint[][][]; elevation: number; elementId: number; localToStorey: boolean}[];
  areaFeet: number;
  marker: RoomPoint;
  markersByStair: Record<number,RoomPoint>;
  /** Nearby reviewed flight context does not establish a supported source landing. */
  sourceOverlap?: boolean;
};
const area = (polygons: RoomPoint[][][]) => polygons.reduce((sum,p)=>sum+roomArea(p[0]!)-p.slice(1).reduce((s,h)=>s+roomArea(h),0),0);
const close = (loops: RoomPoint[][]) => loops.map(l=>[...l,l[0]!]);

/** Actual tread projections, never the room envelope or a stair's bounding box.
 * Kept independent of routing eligibility so local steps remain visible after review. */
export function directoryStairFootprints(model: Pick<ConvertResult,"levels"> & Partial<ConvertResult>, rooms: readonly DirectoryRoom[]): DirectoryStairFootprint[] {
  const records = new Map(model.elementBounds?.map(r=>[r.elementId,r]));
  const footprints: DirectoryStairFootprint[]=[];
  for(const room of rooms.filter(r=>isWalkable(r)&&isStairArea(r))){
    const elevation=model.levels.find(l=>l.levelId===room.levelId)?.elevation;
    if(elevation==null)continue;
    const runs=new Set(model.nativeAssociatedLevelRelations?.filter(r=>r.levelId===room.levelId).map(r=>r.elementId));
    const assemblies=(model.nativeStairAssemblies??[]).filter(a=>{
      const rs=a.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length);
      return rs.length && (Math.abs(Math.min(...rs.map(r=>r!.boundsFeet.min.z))-elevation)<=1 || Math.abs(Math.max(...rs.map(r=>r!.boundsFeet.max.z))-elevation)<=1);
    });
    for(const a of assemblies)for(const id of a.runAndLandingIds)runs.add(id);
    // The review distinguishes a local downward height change from the
    // upward storey flight. Keep the native shape and elevation for both.
    const localRuns=new Set(room.stairAccess==="up-flight-only"?assemblies.filter(a=>{
      const rs=a.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length);
      return Math.max(...rs.map(r=>r!.boundsFeet.max.z))<=elevation+1;
    }).flatMap(a=>a.runAndLandingIds):[]);
    // A reviewed native flight may extend beyond an approximate source label face.
    // Require native floor endpoints and actual tread overlap, or a reviewed
    // outline within 3 ft of those treads. Nearby context does not create a route
    // or fill an unsupported source landing; never use a bounding rectangle.
    const overlaps=(projection:RoomPoint[])=>roomArea(projection)>.01&&area(polygonClipping.intersection(close([projection]),close([room.polygonFeet,...room.holesFeet??[]])) as RoomPoint[][][])>.5;
    const expandedRuns=new Set(assemblies.filter(a=>room.stairFlightIds?.includes(a.stairElementId)&&a.runAndLandingIds.some(id=>(records.get(id)?.stairTreads??[]).some(t=>{
      const projection=t.map(p=>[p[0],p[1]] as RoomPoint);
      if(overlaps(projection))return true;
      return roomArea(projection)>.01&&!room.holesFeet?.some(h=>projection.every(p=>containsRoomPoint(p,h)))&&Math.min(...projection.map(p=>nearestRoomBoundary(p,room.polygonFeet).distance),...room.polygonFeet.map(p=>nearestRoomBoundary(p,projection).distance))<=3;
    }))).flatMap(a=>a.runAndLandingIds));
    const treads:DirectoryStairFootprint["treads"]=[];
    for(const id of runs)for(const tread of records.get(id)?.stairTreads??[]){
      const projection=tread.map(p=>[p[0],p[1]] as RoomPoint);
      if(roomArea(projection)<.01)continue;
      const polygons=(expandedRuns.has(id)?(room.holesFeet?.length?polygonClipping.difference(close([projection]),...room.holesFeet.map(h=>close([h]))):[close([projection])]):polygonClipping.intersection(close([projection]),close([room.polygonFeet,...room.holesFeet??[]]))) as RoomPoint[][][];
      if(area(polygons)<.01)continue;
      treads.push({polygons,elevation:tread.reduce((s,p)=>s+p[2]/tread.length,0),elementId:id,localToStorey:room.stairAccess==="local-only"||localRuns.has(id)});
    }
    if(!treads.length)continue;
    const polygons=polygonClipping.union(...treads.map(t=>t.polygons) as [polygonClipping.MultiPolygon,...polygonClipping.MultiPolygon[]]) as RoomPoint[][][];
    const markerFor=(steps:DirectoryStairFootprint["treads"])=>{
      const first=steps.toSorted((a,b)=>Math.abs(a.elevation-elevation)-Math.abs(b.elevation-elevation))[0]!.polygons[0]![0]!;
      const centre=first.reduce((s,p)=>[s[0]+p[0]/first.length,s[1]+p[1]/first.length] as RoomPoint,[0,0] as RoomPoint);
      return containsRoomPoint(centre,first)?centre:first[0]!;
    };
    const runIds=new Set(treads.map(t=>t.elementId));
    const matches=assemblies.filter(a=>a.runAndLandingIds.some(id=>runIds.has(id)));
    const markersByStair=Object.fromEntries(matches.map(a=>[a.stairElementId,markerFor(treads.filter(t=>a.runAndLandingIds.includes(t.elementId)))]));
    footprints.push({roomKey:room.key,stairElementIds:matches.map(a=>a.stairElementId),polygons,treads,areaFeet:area(polygons),marker:markerFor(treads),markersByStair,sourceOverlap:treads.some(t=>t.polygons.some(p=>overlaps(p[0]!)))});
  }
  return footprints;
}

/** Plan cut matches the architectural map; overhead flights do not paint the landing below. */
export function stairTreadVisibleInPlan(tread:DirectoryStairFootprint["treads"][number],floorElevation:number):boolean {
  return tread.localToStorey || tread.elevation<=floorElevation+4+.1;
}

export type UpperStairContext = {stairElementId:number;roomKeys:string[];floorElevation:number;treads:{runId:number;elevation:number;polygon:RoomPoint[]}[]};
/** Complete native upper-flight projections for atrium/under-stair review.
 * Match a physical endpoint to the recovered floor height, then require actual
 * overlap with a source area. Context is never floor fill or routing evidence. */
export function directoryUpperStairContext(model:Pick<ConvertResult,"levels"> & Partial<ConvertResult>,rooms:readonly DirectoryRoom[],placements:Readonly<Record<string,{elevation:number}>>={}):UpperStairContext[] {
  const records=new Map(model.elementBounds?.map(r=>[r.elementId,r]));
  const context:UpperStairContext[]=[];
  for(const assembly of model.nativeStairAssemblies??[]){
    const runs=assembly.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length);
    if(!runs.length)continue;
    const low=Math.min(...runs.map(r=>r!.boundsFeet.min.z)),high=Math.max(...runs.map(r=>r!.boundsFeet.max.z));
    const treads=runs.flatMap(r=>r!.stairTreads!.map(t=>({runId:r!.elementId,elevation:t.reduce((s,p)=>s+p[2]/t.length,0),polygon:t.map(p=>[p[0],p[1]] as RoomPoint)}))).filter(t=>roomArea(t.polygon)>.01);
    const matches=rooms.filter(r=>r.status!=="deleted").flatMap(room=>{
      const elevation=placements[room.key]?.elevation??model.levels.find(l=>l.levelId===room.levelId)?.elevation;
      if(elevation==null||Math.abs(low-elevation)>1&&Math.abs(high-elevation)>1)return[];
      const xs=room.polygonFeet.map(p=>p[0]),ys=room.polygonFeet.map(p=>p[1]);
      const overlap=treads.some(t=>t.elevation>elevation+4.1&&Math.min(...t.polygon.map(p=>p[0]))<=Math.max(...xs)&&Math.max(...t.polygon.map(p=>p[0]))>=Math.min(...xs)&&Math.min(...t.polygon.map(p=>p[1]))<=Math.max(...ys)&&Math.max(...t.polygon.map(p=>p[1]))>=Math.min(...ys)&&area(polygonClipping.intersection(close([t.polygon]),close([room.polygonFeet,...room.holesFeet??[]])) as RoomPoint[][][])>.01);
      return overlap?[{key:room.key,elevation}]:[];
    });
    if(!matches.length)continue;
    const floorElevation=Math.min(...matches.map(r=>r.elevation));
    context.push({stairElementId:assembly.stairElementId,roomKeys:matches.map(r=>r.key),floorElevation,treads:treads.filter(t=>t.elevation>floorElevation+4.1)});
  }
  return context;
}


/** Identify physical steps at a pin even outside an imported source outline.
 * An overhead projection is not a walkable surface on the selected floor. */
export function nativeStairAtPoint(model:Pick<ConvertResult,"levels"> & Partial<ConvertResult>,levelId:number,point:RoomPoint,maxDistanceFeet=0) {
  const floor=model.levels.find(l=>l.levelId===levelId)?.elevation;if(floor==null)return null;
  const records=new Map(model.elementBounds?.map(r=>[r.elementId,r]));
  const hits=[];
  for(const a of model.nativeStairAssemblies??[]){
    const runs=a.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length);if(!runs.length)continue;
    const low=Math.min(...runs.map(r=>r!.boundsFeet.min.z)),high=Math.max(...runs.map(r=>r!.boundsFeet.max.z));
    if(Math.abs(low-floor)>1&&Math.abs(high-floor)>1)continue;
    const levelAt=(z:number)=>model.levels.filter(l=>Math.abs(l.elevation-z)<=1).sort((a,b)=>Math.abs(a.elevation-z)-Math.abs(b.elevation-z))[0]?.levelId;
    for(const r of runs)for(const t of r!.stairTreads!){
      const polygon=t.map(p=>[p[0],p[1]] as RoomPoint);if(roomArea(polygon)<.01)continue;
      const distanceFeet=containsRoomPoint(point,polygon)?0:nearestRoomBoundary(point,polygon).distance;
      if(distanceFeet>Math.max(0,Math.min(maxDistanceFeet,1)))continue;
      const elevation=t.reduce((sum,p)=>sum+p[2]/t.length,0);
      hits.push({stairElementId:a.stairElementId,runId:r!.elementId,elevation,lowLevelId:levelAt(low),highLevelId:levelAt(high),overhead:elevation>floor+4+.1,polygon,distanceFeet});
    }
  }
  return hits.sort((a,b)=>a.distanceFeet-b.distanceFeet||Math.abs(a.elevation-floor)-Math.abs(b.elevation-floor))[0]??null;
}
