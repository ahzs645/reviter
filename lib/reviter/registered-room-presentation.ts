import{normalizeRoomTouchRings}from './room-touch-normalization.ts';
import pc from 'polygon-clipping';
import type {ArchitecturalPlanGeometry} from './architectural-plan.ts';
import type {IndoorDataset} from './indoor-contract.ts';
import {rebuildRoomBoundaries,type BoundaryReference} from './room-boundaries.ts';
import {cleanRoomBoundary,containsDirectoryRoomPoint,containsRoomPoint,isHallway,isWalkable,nearestRoomBoundary,roomArea,validRoomBoundary,type DirectoryRoom,type RoomPoint} from './room-directory.ts';
type Rings=RoomPoint[][];
// Coplanar registered/native faces can differ by sub-nanometre roundoff. Retry
// a failed boolean only on a 1e-7 ft coordinate grid; physical acceptance limits,
// originals and all native aperture/void checks remain unchanged.
const quantize=(geometry:pc.MultiPolygon|pc.Polygon):pc.MultiPolygon|pc.Polygon=>geometry.map(part=>part.map(ringOrPoint=>Array.isArray(ringOrPoint[0])?(ringOrPoint as pc.Ring).map(([x,y])=>[Math.round(x*1e7)/1e7,Math.round(y*1e7)/1e7] as pc.Pair):[(Math.round((ringOrPoint as pc.Pair)[0]*1e7)/1e7),(Math.round((ringOrPoint as pc.Pair)[1]*1e7)/1e7)] as pc.Pair)) as pc.MultiPolygon|pc.Polygon;
const difference=(first:pc.MultiPolygon|pc.Polygon,...rest:(pc.MultiPolygon|pc.Polygon)[]):pc.MultiPolygon=>{try{return pc.difference(first,...rest);}catch{return pc.difference(quantize(first),...rest.map(quantize));}};
const intersection=(first:pc.MultiPolygon|pc.Polygon,...rest:(pc.MultiPolygon|pc.Polygon)[]):pc.MultiPolygon=>{try{return pc.intersection(first,...rest);}catch{return pc.intersection(quantize(first),...rest.map(quantize));}};

const area=(parts:pc.MultiPolygon)=>parts.reduce((sum,rings)=>sum+roomArea(rings[0]! as RoomPoint[])-rings.slice(1).reduce((s,r)=>s+roomArea(r as RoomPoint[]),0),0);
const shape=(room:DirectoryRoom):Rings=>[room.polygonFeet,...room.holesFeet??[]];
const bounds=(rings:Rings)=>{const points=rings.flat();return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as const;};
const intersects=(a:ReturnType<typeof bounds>,b:ReturnType<typeof bounds>,pad=0)=>a[0]<=b[2]+pad&&a[2]+pad>=b[0]&&a[1]<=b[3]+pad&&a[3]+pad>=b[1];
export type RegisteredRoomInterior={roomKey:string;levelId:number;ringsFeet:Rings;boundaryElementIds:number[];sourceCoverage:number;cellCoverage:number;boundaryEvidence:string;sourceProof:{sourceSha256:string;sectionId:string;registrationErrorFeet:number;wallSegmentIndices:number[];doorSegmentIndices:number[];nativeFloorCoveredSquareFeet:number}};
/** Recover visual interiors from actual registered drawing wall faces, never
 * room contours or label interpolation. Native walls/columns and source/native
 * floor holes are subtracted; the complete cell must have native floor support,
 * one source label and an uncontested source identity. This is DISPLAY evidence:
 * a drawing partition absent from Revit cannot authorize a route through a wall.
 */
export function recoverRegisteredRoomInteriors(dataset:IndoorDataset,annotations:readonly DirectoryRoom[],reference:BoundaryReference|undefined,geometries:ReadonlyMap<number,ArchitecturalPlanGeometry>,candidateKeys:ReadonlySet<string>,floorsByRecord?:ReadonlyMap<string,ArchitecturalPlanGeometry["floors"]>){
 const result:{rooms:RegisteredRoomInterior[];diagnostics:{roomKey:string;levelId:number;code:string;message:string}[]}={rooms:[],diagnostics:[]};
 if(!reference||!floorsByRecord)return result;
 const records=new Map(dataset.records.map(r=>[r.key,r]));
 for(const levelId of new Set(annotations.filter(r=>candidateKeys.has(r.key)).map(r=>r.levelId))){
  const g=geometries.get(levelId),rooms=annotations.filter(r=>r.levelId===levelId&&r.status!=='deleted');
  if(!g)continue;
  const sections=reference.sections.filter(s=>s.levelId===levelId&&Number.isFinite(s.registrationErrorFeet)&&s.registrationErrorFeet<=.05);
  if(!sections.length)continue;
  const rebuilt=rebuildRoomBoundaries(rooms,{...reference,sections},g);
  for(const room of rebuilt.rooms.filter(r=>candidateKeys.has(r.key)&&isWalkable(r)&&!isHallway(r))){
   const fail=(code:string,message:string)=>result.diagnostics.push({roomKey:room.key,levelId,code,message});
   const original=annotations.find(r=>r.key===room.key)!,record=records.get(room.key);
   const section=sections.find(s=>s.sectionId===original.dwg?.sectionId&&original.dwg?.sha256===reference.sourceSha256);
   if(!record||!section||(room.boundaryReview as {method?:string}|undefined)?.method!=='registered-survey-walls-and-model-doors'){fail('unclosed-source-wall-cell','No uniquely labelled enclosure of registered source walls and source/native door thresholds was found.');continue;}
   try {
    const originalCell=shape(room),box=bounds(originalCell),localWalls=dataset.walls.filter(w=>w.levelId===levelId&&intersects(box,bounds(w.ringsFeet)));
    let parts:pc.MultiPolygon=[originalCell];
    for(const wall of localWalls){parts=difference(parts,wall.ringsFeet);if(!parts.length)break;}
    const holes=[...original.holesFeet??[],...rooms.flatMap(r=>r.floorOpeningsFeet??[])].map(h=>[h] as Rings);
    if(holes.length&&parts.length)parts=difference(parts,...holes);
    if(parts.length!==1){fail('native-barrier-splits-source-cell','Native material or protected floor openings split the registered cell; it remains unresolved.');continue;}
    let rings=parts[0]!.map(r=>cleanRoomBoundary(r as RoomPoint[]));
    const normalization=!rings.every(validRoomBoundary)?normalizeRoomTouchRings(rings):undefined;
    if(normalization)rings=normalization.ringsFeet;
    if(!rings.every(validRoomBoundary)||!containsDirectoryRoomPoint(original.labelPointFeet,{...original,polygonFeet:rings[0]!,holesFeet:rings.slice(1)})){fail('source-label-outside-interior','The registered/native intersection excludes the source label.');continue;}
    let cellArea=area([rings]);const sourceArea=area([shape(original)]),overlap=area(intersection(rings,shape(original)));
    let sourceCoverage=overlap/sourceArea,cellCoverage=overlap/cellArea;
    if(sourceCoverage<.65||cellCoverage<.65){fail('source-identity-mismatch','Registered cell and original source claim lack bilateral identity overlap.');continue;}
    const otherRooms=rooms.filter(r=>r.key!==original.key&&intersects(box,bounds(shape(r))));
    if(otherRooms.some(r=>containsDirectoryRoomPoint(r.labelPointFeet,{...r,polygonFeet:rings[0]!,holesFeet:rings.slice(1)}))){fail('multiple-source-room-labels','Another authored room label lies in the registered/native cell.');continue;}
    const protectedRecords=dataset.records.filter(r=>r.key!==record.key&&r.levelId===levelId&&(r.circulation||(!r.walkable&&/open drop|open to (?:below|lower)/i.test(String(r.properties.notes??'')))));
    if(protectedRecords.some(r=>intersects(box,bounds(r.ringsFeet))&&area(intersection(rings,r.ringsFeet))>.002)){fail('protected-source-floor-overlap','The cell intersects authored circulation or an open-to-below mask.');continue;}
    if(otherRooms.some(r=>!isHallway(r)&&area(intersection(rings,shape(r)))>Math.min(cellArea,area([shape(r)]))*.05)){fail('competing-source-room-claim','A distinct authored room claim overlaps the registered/native cell.');continue;}
    let uncovered:pc.MultiPolygon=[rings];
    for(const floor of floorsByRecord.get(room.key)??[]){uncovered=difference(uncovered,floor);if(!uncovered.length)break;}
    if(area(uncovered)>.002){
     // Genuine interior holes remain holes. An unsupported outer edge is not
     // silently cropped into a smaller room, and an aperture containing the
     // label invalidates room identity.
     const enclosed=uncovered.every(part=>part[0]!.every(p=>containsRoomPoint(p as RoomPoint,rings[0]!)&&nearestRoomBoundary(p as RoomPoint,rings[0]!).distance>1e-5));
     if(!enclosed){fail('unsupported-native-floor','The complete registered interior has an unsupported outer edge on precise native floor polygons.');continue;}
     const cut=difference(rings,uncovered);
     if(cut.length!==1){fail('floor-opening-splits-source-cell','Native floor apertures split the registered enclosure.');continue;}
     rings=cut[0]!.map(r=>cleanRoomBoundary(r as RoomPoint[]));cellArea=area([rings]);
     const finalOverlap=area(intersection(rings,shape(original)));sourceCoverage=finalOverlap/sourceArea;cellCoverage=finalOverlap/cellArea;
     if(sourceCoverage<.65||cellCoverage<.65){fail('floor-aperture-identity-mismatch','Preserving native floor apertures removes too much of the source room claim.');continue;}
     if(!containsDirectoryRoomPoint(original.labelPointFeet,{...original,polygonFeet:rings[0]!,holesFeet:rings.slice(1)})){fail('label-in-native-floor-opening','Native floor aperture excludes the source room label.');continue;}
    }
    const touch=(ps:Rings)=>rings.some(r=>r.some(p=>ps.some(s=>nearestRoomBoundary(p,s).distance<=.05)));
    const supports=localWalls.filter(w=>!w.approximate&&touch(w.ringsFeet)).map(w=>w.nativeElementId);
    if(new Set(supports).size<2){fail('unanchored-source-enclosure','Fewer than two precise native barrier elements anchor the registered enclosure.');continue;}
    const segmentIndices=(segments:typeof section.wallSegments)=>segments.flatMap((line,i)=>originalCell.some(r=>r.some(p=>nearestRoomBoundary(p,line).distance<=.05))?[i]:[]);
    const wallSegmentIndices=segmentIndices(section.wallSegments),doorSegmentIndices=segmentIndices(section.doorSegments);
    if(wallSegmentIndices.length<3){fail('insufficient-source-wall-support','Registered wall support does not establish the enclosure.');continue;}
    result.rooms.push({roomKey:room.key,levelId,ringsFeet:rings,boundaryElementIds:[...new Set(supports)].sort((a,b)=>a-b),sourceCoverage,cellCoverage,
     boundaryEvidence:`Registered source wall enclosure; source ${reference.sourceSha256}; section ${section.sectionId}; registration ${section.registrationErrorFeet.toFixed(6)} ft; native walls/columns and all floor holes retained; complete native floor support; visual evidence only.${normalization?` Contact-only ring normalization (${normalization.contactCount} contacts); unchanged region and void area; actual crossings rejected.`:""}`,
     sourceProof:{sourceSha256:reference.sourceSha256,sectionId:section.sectionId,registrationErrorFeet:section.registrationErrorFeet,wallSegmentIndices,doorSegmentIndices,nativeFloorCoveredSquareFeet:cellArea}});
   }catch(error){fail('source-wall-topology-error',error instanceof Error?error.message:String(error));}
  }
 }
 return result;
}
