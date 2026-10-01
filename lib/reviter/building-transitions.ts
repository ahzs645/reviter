import pc from "polygon-clipping";
import {architecturalPlanGeometry} from "./architectural-plan.ts";
import {containsDirectoryRoomPoint,containsRoomPoint,isWalkable,isHallway,roomBuilding,type DirectoryRoom,type RoomPoint} from "./room-directory.ts";
import type {ConvertResult} from "./types.ts";

export type BuildingLocation={building:string;levelId:number;point:RoomPoint;roomKey?:string;elevationFeet?:number};
/** A reported local connection may end on a native landing with no room label.
 * Distinct Revit levels can describe a small height change within one storey. */
export type ReportedBuildingTransition={id:string;kind:"local-steps";evidence:"user-reported";endpoints:[BuildingLocation,BuildingLocation];nativeStairId:number;floorElementIds:[number,number];notes?:string};
export type LocalBuildingConnection={report:ReportedBuildingTransition;endpoints:[BuildingLocation&{elevation:number;room?:DirectoryRoom},BuildingLocation&{elevation:number;room?:DirectoryRoom}];surfaces:{elementId:number;elevation:number;polygons:RoomPoint[][][]}[];treads:{elementId:number;elevation:number;polygon:RoomPoint[]}[];samples:{point:RoomPoint;elevation:number}[];surfaceSupported:boolean;warnings:string[];bounds:[number,number,number,number];stepBands:number};
const inside=(p:RoomPoint,loops:RoomPoint[][])=>!!loops[0]&&containsRoomPoint(p,loops[0])&&!loops.slice(1).some(h=>containsRoomPoint(p,h));

/** Verify the picked crossing against slabs, tread surfaces, walls and room masks.
 * This preview is not an inferred campus route or a replacement room boundary. */
export function localBuildingConnections(model:ConvertResult,rooms:readonly DirectoryRoom[],reports:readonly ReportedBuildingTransition[]):LocalBuildingConnection[]{
  const records=new Map(model.elementBounds.map(r=>[r.elementId,r]));
  return reports.flatMap(report=>{
    const endpoints=report.endpoints.map(e=>({...e,elevation:e.elevationFeet??model.levels.find(l=>l.levelId===e.levelId)?.elevation,room:rooms.find(r=>r.key===e.roomKey)}));
    if(endpoints.some(e=>e.elevation==null||e.room&&(!isWalkable(e.room)||roomBuilding(e.room)!==e.building||e.room.levelId!==e.levelId)))return[];
    const ends=endpoints as LocalBuildingConnection["endpoints"],assembly=model.nativeStairAssemblies?.find(a=>a.stairElementId===report.nativeStairId);
    const runs=assembly?.runAndLandingIds.map(id=>records.get(id)).filter(r=>r?.stairTreads?.length)??[];
    const treads=runs.flatMap(r=>r!.stairTreads!.map(t=>({elementId:r!.elementId,elevation:t.reduce((s,p)=>s+p[2]/t.length,0),polygon:t.map(p=>[p[0],p[1]] as RoomPoint)})));
    const points=[...ends.map(e=>e.point),...treads.flatMap(t=>t.polygon)],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const bounds:[number,number,number,number]=[Math.min(...xs)-5,Math.min(...ys)-5,Math.max(...xs)+5,Math.max(...ys)+5];
    const scope:RoomPoint[][]=[[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]]];
    const slabs=report.floorElementIds.map(id=>records.get(id)),warnings:string[]=[];
    const originalSurfaces=slabs.map((r,i)=>({elementId:r?.elementId??report.floorElementIds[i]!,elevation:r?.boundsFeet.max.z??Infinity,loops:(r?.loops??[]).map(l=>l.map(p=>[p[0],p[1]] as RoomPoint))}));
    if(!treads.length||Math.abs(Math.min(...runs.map(r=>r!.boundsFeet.min.z))-Math.min(...ends.map(e=>e.elevation)))>.5||Math.abs(Math.max(...runs.map(r=>r!.boundsFeet.max.z))-Math.max(...ends.map(e=>e.elevation)))>.5)warnings.push("Native steps do not match both landing elevations.");
    for(const [i,s] of originalSurfaces.entries())if(slabs[i]?.categoryId!==-2000032||Math.abs(s.elevation-ends[i]!.elevation)>.1||!inside(ends[i]!.point,s.loops))warnings.push(`Landing ${i+1} has no matching native floor at the picked location.`);
    const obstacles=rooms.filter(r=>r.status!=="deleted"&&ends.some(e=>r.levelId===e.levelId&&roomBuilding(r)===e.building)&&!ends.some(e=>e.roomKey===r.key)&&(!isWalkable(r)||!isHallway(r)&&!/\bstair(?:s|case|well)?\b/i.test(r.name??"")));
    const geometry=ends.flatMap(e=>{try{return[architecturalPlanGeometry(model,e.levelId)];}catch{warnings.push(`Native barriers could not be checked for level #${e.levelId}.`);return[];}});
    const masks=obstacles.map(r=>[r.polygonFeet,...r.holesFeet??[]]).filter(p=>p[0]!.length>=3);
    const surfaces=originalSurfaces.map(s=>({elementId:s.elementId,elevation:s.elevation,polygons:s.loops[0]?(masks.length?pc.difference(pc.intersection(s.loops,scope),...masks):pc.intersection(s.loops,scope)) as RoomPoint[][][]:[]}));
    if(ends.some(e=>e.room&&!containsDirectoryRoomPoint(e.point,e.room)))warnings.push("Picked endpoint is outside its associated source room boundary.");
    const length=Math.hypot(ends[1].point[0]-ends[0].point[0],ends[1].point[1]-ends[0].point[1]),count=Math.max(1,Math.ceil(length/.1)),samples:LocalBuildingConnection["samples"]=[];
    if(length>30)warnings.push("Picked locations are too far apart for this local preview.");
    let hasSteps=false,missing=false,blocked=false,previous=ends[0].elevation;
    for(let i=0;i<=Math.min(count,1000);i++){
      const f=i/count,p:RoomPoint=[ends[0].point[0]+(ends[1].point[0]-ends[0].point[0])*f,ends[0].point[1]+(ends[1].point[1]-ends[0].point[1])*f];
      const steps=treads.filter(t=>containsRoomPoint(p,t.polygon));hasSteps ||= !!steps.length;
      const heights=[...steps.map(t=>t.elevation),...originalSurfaces.filter(s=>inside(p,s.loops)).map(s=>s.elevation)].filter(z=>Math.abs(z-previous)<1.2);
      const expected=ends[0].elevation+(ends[1].elevation-ends[0].elevation)*f;
      const z=heights.toSorted((a,b)=>Math.abs(a-expected)-Math.abs(b-expected))[0];
      if(z==null){missing=true;continue;}previous=z;samples.push({point:p,elevation:z});
      if(obstacles.some(r=>containsDirectoryRoomPoint(p,r)))blocked=true;
      for(const g of geometry)if([...g.walls,...g.columns].some(w=>containsRoomPoint(p,w.polygon))&&!g.doors.some(d=>!d.approximate&&containsRoomPoint(p,d.polygon)))blocked=true;
    }
    if(missing||!hasSteps)warnings.push("Picked crossing is not continuously supported by native steps and floor surfaces.");
    if(blocked)warnings.push("A wall, column, private room or reported void intersects the crossing.");
    return[{report,endpoints:ends,surfaces,treads,samples,surfaceSupported:!warnings.length,warnings,bounds,stepBands:new Set(treads.map(t=>t.elevation.toFixed(3))).size}];
  });
}
