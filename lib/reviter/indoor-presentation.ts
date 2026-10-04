import { reviewedRoomInteriors } from "./reviewed-room-presentation.ts";
import type { ConvertResult } from './types.ts';
import { recoverNativeMeshRoomInteriors } from './native-mesh-room-presentation.ts';
import pc from "polygon-clipping";
import type { BoundaryReference } from "./room-boundaries.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import { roomArea, nearestRoomBoundary } from "./room-directory.ts";
import { recoverRegisteredRoomInteriors } from "./registered-room-presentation.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import { NATIVE_ROOM_JUNCTION_TOLERANCE_FEET, recoverNativeRoomInteriors, recoverRegisteredWallJunctionRepairs } from "./native-room-presentation.ts";
import { prepareRoomBlocks } from "./room-block-presentation.ts";
import { savedSemanticRoomBoundaryInput, validateSemanticRoomBoundaries } from "./semantic-room-boundaries.ts";

/** Compile visual room boundaries while preserving reviewed source and routing. */
export function prepareIndoorPresentation(
  dataset: IndoorDataset,
  annotations: RoomDirectoryData["annotations"],
  semanticBoundaries?: unknown,
  options?: {nativeModel?:ConvertResult;boundaryReference?:BoundaryReference;geometries?:ReadonlyMap<number,ArchitecturalPlanGeometry>;floorsByRecord?:ReadonlyMap<string,ArchitecturalPlanGeometry["floors"]>},
): NonNullable<IndoorDataset["presentation"]> {
  const recovered = recoverNativeRoomInteriors(
    dataset.records, dataset.walls, dataset.doors ?? [],
    new Map(annotations.map(r => [r.key, r.labelPointFeet])),
  );
  const geometries=options?.geometries;
  const sourceBacked: {room:typeof recovered.rooms[number];sourceProof:NonNullable<NonNullable<IndoorDataset["presentation"]>["rooms"][number]["sourceProof"]>}[]=[];
  const sourceArea=(parts:pc.MultiPolygon)=>parts.reduce((sum,rings)=>sum+roomArea(rings[0]! as [number,number][])-rings.slice(1).reduce((s,r)=>s+roomArea(r as [number,number][]),0),0);
  if(options?.boundaryReference&&geometries&&options?.floorsByRecord){
    const reference=options.boundaryReference,repairs=recoverRegisteredWallJunctionRepairs(dataset.walls,dataset.doors??[],reference);
    if(repairs.length){
      const nativeKeys=new Set(recovered.rooms.map(r=>r.roomKey));
      const patched=recoverNativeRoomInteriors(dataset.records,[...dataset.walls,...repairs.map(r=>({kind:"wall" as const,levelId:r.levelId,nativeElementId:r.nativeWallElementId,approximate:true,ringsFeet:r.ringsFeet}))],dataset.doors??[],new Map(annotations.map(r=>[r.key,r.labelPointFeet])));
      for(const room of patched.rooms.filter(r=>!nativeKeys.has(r.roomKey))){
        const annotation=annotations.find(a=>a.key===room.roomKey),section=reference.sections.find(s=>s.levelId===room.levelId&&s.sectionId===annotation?.dwg?.sectionId&&annotation?.dwg?.sha256===reference.sourceSha256&&s.registrationErrorFeet<=.05),geometry=geometries.get(room.levelId);
        if(!section||!geometry)continue;
        const relevant=repairs.filter(r=>r.levelId===room.levelId&&r.sourceSectionId===section.sectionId&&room.ringsFeet.some(ring=>ring.some(p=>nearestRoomBoundary(p,r.ringsFeet[0]!).distance<=.05)));
        if(!relevant.length)continue;
        try{let uncovered:pc.MultiPolygon=[room.ringsFeet];for(const floor of options.floorsByRecord.get(room.roomKey)??[]){uncovered=pc.difference(uncovered,floor);if(!uncovered.length)break;}if(sourceArea(uncovered)>.002)continue;}catch{continue;}
        const wallSegmentIndices=[...new Set(relevant.flatMap(r=>r.sourceWallSegmentIndices??[]))].sort((a,b)=>a-b);
        sourceBacked.push({room:{...room,boundaryEvidence:`Native wall enclosure with independently registered two-face source wall continuations; source ${reference.sourceSha256}; section ${section.sectionId}; native-only seam tolerance remains 0.08 ft; source-backed joins at most 0.5 ft; complete native floor support; visual evidence only.`},sourceProof:{sourceSha256:reference.sourceSha256,sectionId:section.sectionId,registrationErrorFeet:section.registrationErrorFeet,wallSegmentIndices,doorSegmentIndices:[],nativeFloorCoveredSquareFeet:sourceArea([room.ringsFeet]),jointRepairs:relevant.map(r=>({nativeWallElementId:r.nativeWallElementId,supportingElementId:r.supportingElementId,gapFeet:r.gapFeet,toleranceFeet:r.toleranceFeet,wallSegmentIndices:r.sourceWallSegmentIndices!}))}});
      }
    }
  }
  const sourceBackedKeys=new Set(sourceBacked.map(r=>r.room.roomKey));
  const registered=geometries?recoverRegisteredRoomInteriors(dataset,annotations,options?.boundaryReference,geometries,new Set(recovered.diagnostics.filter(d=>!sourceBackedKeys.has(d.roomKey)).map(d=>d.roomKey)),options?.floorsByRecord):{rooms:[],diagnostics:[]};
  const registeredKeys=new Set(registered.rooms.map(r=>r.roomKey));
  const sourceProofs=new Map([...sourceBacked.map(r=>[r.room.roomKey,r.sourceProof] as const),...registered.rooms.map(r=>[r.roomKey,r.sourceProof] as const)]);
  const saved = savedSemanticRoomBoundaryInput(dataset,annotations);
  const persisted = saved.input ? validateSemanticRoomBoundaries(dataset,annotations,saved.input) : {rooms:[],diagnostics:[]};
  const explicit = semanticBoundaries === undefined ? { rooms: [], diagnostics: [] } : validateSemanticRoomBoundaries(dataset, annotations, semanticBoundaries);
  const semantic = {rooms:[...new Map([...persisted.rooms,...explicit.rooms].map(r=>[r.roomKey,r])).values()],
    diagnostics:[...saved.diagnostics,...persisted.diagnostics,...explicit.diagnostics]};
  const semanticKeys = new Set(semantic.rooms.map(r => r.roomKey));
  const resolvedKeys = new Set([...recovered.rooms,...sourceBacked.map(r=>r.room),...registered.rooms,...semantic.rooms].map(r=>r.roomKey));
  const mesh = options?.nativeModel && options.floorsByRecord ? recoverNativeMeshRoomInteriors(dataset,annotations,options.nativeModel,new Set(recovered.diagnostics.filter(r=>!resolvedKeys.has(r.roomKey)).map(r=>r.roomKey)),options.floorsByRecord) : {rooms:[],walls:[]};
  const meshKeys = new Set(mesh.rooms.map(r=>r.roomKey));
  const meshProofs = new Map(mesh.rooms.map(r=>[r.roomKey,r.meshProof]));
  const interiors = [...recovered.rooms,...sourceBacked.map(r=>r.room),...registered.rooms,...mesh.rooms].filter(r=>!semanticKeys.has(r.roomKey)).concat(semantic.rooms);
  const protectedAreas = dataset.records.filter(r =>
    r.circulation || (!r.walkable && /open drop|open to (?:below|lower)/i.test(String(r.properties.notes ?? ""))),
  );
  const blocks = prepareRoomBlocks(interiors, dataset.walls, dataset.doors ?? [], protectedAreas);
  if (mesh.rooms.length) {
    const meshBlocks = prepareRoomBlocks(interiors,[...dataset.walls,...mesh.walls],dataset.doors??[],protectedAreas);
    for (const room of mesh.rooms) { const parts=meshBlocks.get(room.roomKey); if(parts?.length)blocks.set(room.roomKey,parts); }
  }
  const byRoom = new Map(dataset.records.map(r => [r.key, r]));
  const diagnostics = [...recovered.diagnostics.filter(r => !semanticKeys.has(r.roomKey)&&!sourceBackedKeys.has(r.roomKey)&&!registeredKeys.has(r.roomKey)&&!meshKeys.has(r.roomKey)), ...semantic.diagnostics];
  for (const room of interiors) if (!blocks.get(room.roomKey)?.length)
    diagnostics.push({roomKey: room.roomKey, levelId: room.levelId,
      code: "empty-display-block", message: "Protected floor or aperture subtraction left no room block."});
  const reviewed = options?.nativeModel && options.floorsByRecord
    ? reviewedRoomInteriors(dataset, annotations, options.nativeModel, options.floorsByRecord)
    : [];
  const reviewedKeys = new Set(reviewed.map(r => r.roomKey));
  return {
    version: 1,
    generator: "reviter/native-room-presentation-2",
    sourceModelSha256: dataset.source.modelSha256,
    junctionToleranceFeet: NATIVE_ROOM_JUNCTION_TOLERANCE_FEET,
    rooms: [...reviewed, ...interiors.filter(r => !reviewedKeys.has(r.roomKey)).flatMap(room => {
      const record = byRoom.get(room.roomKey)!;
      const blockPartsFeet = blocks.get(room.roomKey);
      return blockPartsFeet?.length ? [{
        roomKey: room.roomKey,
        levelId: room.levelId,
        sourceGeometryKey: JSON.stringify([record.levelId, record.ringsFeet]),
        interiorRingsFeet: room.ringsFeet,
        blockPartsFeet,
        boundarySource: semanticKeys.has(room.roomKey) ? "revit-finish-face" as const : meshKeys.has(room.roomKey)?"native-mesh-wall-enclosure" as const: registeredKeys.has(room.roomKey)?"registered-source-wall-enclosure" as const:sourceBackedKeys.has(room.roomKey)?"source-backed-native-wall-enclosure" as const:"native-wall-enclosure" as const,
        ...(meshProofs.has(room.roomKey)?{meshProof:meshProofs.get(room.roomKey)}:{}),
        ...(sourceProofs.has(room.roomKey)?{sourceProof:sourceProofs.get(room.roomKey)}:{}),
        ...("boundaryEvidence" in room && typeof room.boundaryEvidence === "string" ? { boundaryEvidence: room.boundaryEvidence } : {}),
        boundaryElementIds: room.boundaryElementIds,
        sourceCoverage: room.sourceCoverage,
        cellCoverage: room.cellCoverage,
      }] : [];
    })],
    diagnostics: diagnostics.filter(r => !reviewedKeys.has(r.roomKey)),
  };
}
