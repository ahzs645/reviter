import pc from 'polygon-clipping';
import {floorPlateRecords} from './export-svg.ts';
import {architecturalPlanGeometry} from './architectural-plan.ts';
import {directoryAreaKind} from './directory-areas.ts';
import {directoryDoors} from './directory-navigation.ts';
import {cleanRoomBoundary,containsDirectoryRoomPoint,nearestRoomBoundary,roomArea,roomBuilding,type DirectoryRoom,type RoomPoint} from './room-directory.ts';
import type {ConvertResult} from './types.ts';

/** Other storeys supply only an atrium search footprint. Candidate walk surfaces
 * always come from a slab attached to the requested native level, never copied up. */
export function modelWalkwayCandidates(model:ConvertResult,rooms:readonly DirectoryRoom[],building:string,levelId:number):number[] {
  const atrium=rooms.filter(r=>r.status!=="deleted"&&roomBuilding(r)===building&&r.walkability!=="void"&&directoryAreaKind(r)==="atrium");
  if(!atrium.length)return [];
  const scope=pc.union([atrium[0]!.polygonFeet,...atrium[0]!.holesFeet??[]],...atrium.slice(1).map(r=>[r.polygonFeet,...r.holesFeet??[]]));
  const area=(ps:ReturnType<typeof pc.intersection>)=>ps.reduce((s,p)=>s+roomArea(p[0]! as RoomPoint[])-p.slice(1).reduce((t,h)=>t+roomArea(h as RoomPoint[]),0),0);
  const level=model.levels.find(l=>l.levelId===levelId);if(!level)return [];
  return floorPlateRecords(model,levelId).filter(r=>{
    if(Math.abs(r.boundsFeet.max.z-level.elevation)>.1)return false;
    const loops=(r.loops??[]).map(l=>l.map(p=>[p[0],p[1]] as RoomPoint));if(!loops[0])return false;
    const native=area(pc.union(loops));return native>8&&area(pc.intersection(loops,scope))/native>.6;
  }).map(r=>r.elementId);
}

/** Recover explicitly selected floor elements, retaining holes and one native level.
 * Existing annotations win; a floor surface does not override a room or a void. */
export function recoverModelWalkways(model:ConvertResult,rooms:readonly DirectoryRoom[],selection:{building:string;levelId:number;elementIds:readonly number[]}):DirectoryRoom[] {
  const {building,levelId}=selection,level=model.levels.find(l=>l.levelId===levelId);
  if(!level)return [];
  const slabs=floorPlateRecords(model,levelId).filter(r=>selection.elementIds.includes(r.elementId)&&Math.abs(r.boundsFeet.max.z-level.elevation)<.1);
  const geometry=architecturalPlanGeometry(model,levelId),doors=directoryDoors(model,levelId).filter(d=>d.footprint);
  const existing=rooms.filter(r=>r.levelId===levelId&&roomBuilding(r)===building&&r.status!=='deleted');
  const shapes=existing.map(r=>[r.polygonFeet,...r.holesFeet??[]]);
  const walls=geometry.walls.flatMap(w=>pc.difference([w.polygon],...doors.map(d=>[d.footprint!])));
  const obstacles=[...shapes,...walls,...geometry.columns.map(c=>[c.polygon])];
  const added:DirectoryRoom[]=[];
  for(const slab of slabs){
    const loops=(slab.loops??[]).map(l=>l.map(p=>[p[0],p[1]] as RoomPoint));
    if(!loops[0])continue;
    const remaining=pc.difference(loops,...obstacles) as RoomPoint[][][];
    for(const [index,polygon] of remaining.entries()){
      const polygonFeet=cleanRoomBoundary(polygon[0]!),holesFeet=polygon.slice(1).map(cleanRoomBoundary);
      const area=roomArea(polygonFeet)-holesFeet.reduce((s,h)=>s+roomArea(h),0);if(area<8)continue;
      const region={polygonFeet,holesFeet} as DirectoryRoom;
      const xs=polygonFeet.map(p=>p[0]),ys=polygonFeet.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      let label:RoomPoint|null=null,clearance=0;
      for(let y=minY+.5;y<maxY;y+=1)for(let x=minX+.5;x<maxX;x+=1){const p:RoomPoint=[x,y];if(!containsDirectoryRoomPoint(p,region))continue;
        const distance=Math.min(...[polygonFeet,...holesFeet].map(l=>nearestRoomBoundary(p,l).distance));if(distance>clearance){clearance=distance;label=p;}}
      if(!label||clearance<.4)continue;
      const key=`walkway:${building}:${levelId}:${slab.elementId}:${index}`;
      if(rooms.some(r=>r.key===key))continue;
      added.push({key,building,levelId,name:'Atrium crosswalk',polygonFeet,holesFeet,labelPointFeet:label,confidence:.8,status:'active',
        modelSurface:{kind:'crosswalk',elementId:slab.elementId,levelId,elevationFeet:slab.boundsFeet.max.z},
        source:{polygon:'native-floor-crosswalk',name:'reviewed-model-surface'},
        boundaryReview:{evidence:'native-floor',notes:'Recovered from this level’s native slab, with its openings retained. Walls, columns, existing annotated areas and reported voids are excluded. Door and landing alignment remain subject to review.'}});
    }
  }
  return added;
}
