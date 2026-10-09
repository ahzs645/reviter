import {nativeMaterialPlanWalls} from './native-material-plan.ts';
import pc from 'polygon-clipping';
import {nativeWallPositionRepairedWalls} from './native-wall-position-repairs.ts';
import {reviewedBoundaryWalls} from './native-boundary-patches.ts';
import {prepareIndoorPresentation} from './indoor-presentation.ts';
import {promoteNativeRoomInteriors} from './native-room-promotion.ts';
import {routingFloorPlateRecords} from './routing-floor-support.ts';
import {architecturalPlanGeometry} from './architectural-plan.ts';
import {directoryDoorReviews,directoryDoors,type ReviewedDoorLink} from './directory-navigation.ts';
import {containsDirectoryRoomPoint,splitGeneratedLandingDoorLinks,type DirectoryRoom,type RoomDirectoryData,type RoomPoint} from './room-directory.ts';
import type{IndoorDataset}from'./indoor-contract.ts';import type{ConvertResult}from'./types.ts';
const area=(ps:RoomPoint[][][])=>ps.reduce((s,p)=>s+p.reduce((a,r,i)=>a+(i?-1:1)*Math.abs(r.reduce((s,q,j)=>s+q[0]*r[(j+1)%r.length]![1]-q[1]*r[(j+1)%r.length]![0],0)/2),0),0);
/** Derive routing boundaries in memory from uniquely owned native wall cells.
 * Original annotation JSON/hash remains authoritative and byte-preserved; every
 * promoted ring has exact same-height floor support and preserved native holes. */
export function prepareNativeRoutingBoundaries(model:ConvertResult,source:RoomDirectoryData,dataset:IndoorDataset,links:readonly ReviewedDoorLink[]):{rooms:Map<string,DirectoryRoom>;report:ReturnType<typeof promoteNativeRoomInteriors>['report']} {
 const walls:IndoorDataset['walls']=[],doors:NonNullable<IndoorDataset['doors']>=[];
 for(const levelId of [...new Set(source.annotations.map(r=>r.levelId))]){const g=architecturalPlanGeometry(model,levelId);walls.push(...[...g.walls.map(w=>({...w,kind:'wall' as const})),...g.columns.map(w=>({...w,kind:'column' as const}))].filter(w=>w.polygon.length>=3).map(w=>({levelId,nativeElementId:w.elementId,kind:w.kind,approximate:w.approximate,ringsFeet:[w.polygon]})));
 doors.push(...directoryDoorReviews(source.annotations.filter(r=>r.levelId===levelId),directoryDoors(model,levelId),links,splitGeneratedLandingDoorLinks(source.navigation?.doorLinks??[]).immediate).map(({door,candidates,state,portal})=>({id:`door:${levelId}:${door.id}`,levelId,nativeElementId:door.id,pointFeet:door.point,footprintFeet:door.footprint,normalFeet:door.normal,roomKeys:portal?.rooms??candidates,state})));}
 // Bind every correction to the complete original native wall before adding
 // reviewed continuations. Floor/door/fixture checks are mandatory on the fully
 // compiled dataset in indoor-pipeline; those physical proofs do not exist yet.
 const correctedWalls=nativeWallPositionRepairedWalls({...dataset,walls,doors},{deferPhysicalChecks:true});
 const contactStage={...dataset,walls:correctedWalls,doors};
 correctedWalls.push(...reviewedBoundaryWalls(correctedWalls,source.nativeBoundaryPatches,dataset.source.modelSha256,undefined,source.reviewedDoorApertures,source.nativeMaterialSections,source.nativeMaterialSections ? levelId=>nativeMaterialPlanWalls(contactStage,levelId,source.reviewedDoorApertures) : undefined));
 const stage={...dataset,walls:correctedWalls,doors};stage.presentation=prepareIndoorPresentation(stage,source.annotations,undefined,{purpose:"routing-prepass",materialDoorApertures:source.reviewedDoorApertures});
 const promoted=promoteNativeRoomInteriors(stage,source),records=new Map(dataset.records.map(r=>[r.key,r])),rooms=new Map<string,DirectoryRoom>();
 for(const item of promoted.report.rooms){const room=promoted.data.annotations.find(r=>r.key===item.roomKey)!,record=records.get(room.key)!;
 const floors=routingFloorPlateRecords(model,record.elevationFeet).map(f=>f.loops!.map(l=>l.map(p=>[p[0],p[1]] as RoomPoint)));
 const reject=(message:string)=>promoted.report.rejected.push({roomKey:room.key,code:'native-floor-support',message});
 if(!floors.length){reject('No exact same-height native floor profile exists for the corrected room.');continue;}
 try{const rings=[room.polygonFeet,...room.holesFeet??[]],union=pc.union(floors[0]!,...floors.slice(1));const supported=pc.intersection(rings,union) as RoomPoint[][][];
 // Native openings may add inner holes, but may not shrink/replace the exterior
 // enclosure or split its unique source-labelled walking region.
 if(supported.length!==1||!containsDirectoryRoomPoint(room.labelPointFeet,{...room,polygonFeet:supported[0]![0]!,holesFeet:supported[0]!.slice(1)})||room.routePointFeet&&!containsDirectoryRoomPoint(room.routePointFeet,{...room,polygonFeet:supported[0]![0]!,holesFeet:supported[0]!.slice(1)})){reject('Native floor gaps split the interior or remove its unique source/reviewed anchor.');continue;}
 if(area(pc.xor([room.polygonFeet],[supported[0]![0]!]) as RoomPoint[][][])>.002){reject('Exact native floor support changes the enclosure exterior; boundary-touching openings cannot authorize a smaller replacement room.');continue;}
 const outerDifference=area(pc.difference([room.polygonFeet],union) as RoomPoint[][][]);
 // Difference includes genuine inner floor holes, which are retained rather
 // than filled. Reject any unsupported exterior sliver beyond rounding.
 const floorHoles=floors.flatMap(f=>f.slice(1).map(h=>[h] as RoomPoint[][]));const unproved=floorHoles.length?pc.difference(pc.difference([room.polygonFeet],union),...floorHoles):pc.difference([room.polygonFeet],union);
 if(area(unproved as RoomPoint[][][])>.002){reject(`Native enclosure has ${outerDifference.toFixed(4)}sqft unsupported exterior beyond native profile holes.`);continue;}
 room.polygonFeet=supported[0]![0]!;room.holesFeet=supported[0]!.slice(1);rooms.set(room.key,room);
 }catch(error){reject(error instanceof Error?error.message:String(error));}}
 promoted.report.rooms=promoted.report.rooms.filter(r=>rooms.has(r.roomKey));promoted.report.promoted=rooms.size;
 return {rooms,report:promoted.report};
}
