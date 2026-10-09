import {initializeNativeExactGeosOverlay} from "./native-exact-geos-overlay.ts";
import {verifyNativeProvisionalCornerSeals} from "./native-provisional-corner-seals.ts";
import {createNativePortalFloorVoidQuery} from "./native-portal-floor-voids.ts";
import {verifyNativeDerivedFrameReturns} from "./native-derived-frame-returns.ts";
import {validateNativeSourceStairMaterials} from "./native-source-stair-material.ts";
import {nativeStairRouteQualified} from "./native-source-stair.ts";
import {prepareNativePhysicalLevels,nativePhysicalWorkingLevelIds} from "./native-physical-levels.ts";
import {nativeMaterialPlanWalls} from "./native-material-plan.ts";
import {preservedNativeDoorPortals} from "./preserved-native-door-portals.ts";
import {validateNativeFloorOpeningOwnershipBinding} from "./native-floor-opening-ownership.ts";
import {verifyNativeMaterialSections} from "./native-material-sections.ts";
import {verifyNativeIndoorEnvelopes} from "./native-indoor-envelopes.ts";
import {validateNativeDisplayScopes} from "./native-display-scopes.ts";
import {validateReviewedAreaPartitionBinding} from "./reviewed-area-partitions.ts";
import {nativeDoorBoundaryClosureFootprints} from "./native-door-boundary-closures.ts";
import {deriveNativeSelectionContactRepairs} from "./native-selection-contact-repairs.ts";
import {assertNativeSelectionContactRepairsPhysicalGuards} from "./native-selection-contact-guards.ts";
import {nativeWallPositionRepairedWalls,nativeWallPositionRepairedPlanWalls} from "./native-wall-position-repairs.ts";
import {withReviewedDoorApertures} from "./reviewed-door-apertures.ts";
import {validateSelectionDoorBinding} from "./selection-door-thresholds.ts";
import {prepareNativeWindowDisplay} from './native-window-display.ts';
import { validateIndoorExclusions } from "./indoor-exclusions.ts";
import {bindConnectorAreaArrivals} from "./connector-area-arrivals.ts";
import {reviewedBoundaryWalls} from "./native-boundary-patches.ts";
import pc from "polygon-clipping";
import { containsDirectoryRoomPoint } from "./room-directory.ts";
import { routingFloorPlateRecords, nativeFloorPolygons } from "./routing-floor-support.ts";
import { attachNativeCirculation,createNativeWalkingRegionQuery,supportedWalkingPath } from "./native-circulation-links.ts";
import { prepareReviewedIndoorRamps } from "./indoor-ramps.ts";
import { prepareNativeRampDisplay } from "./native-ramp-display.ts";
import { recoverIndoorOpeningSpan } from "./indoor-opening-spans.ts";
import { prepareNativeRoutingBoundaries } from "./indoor-native-prepass.ts";
import { prepareNativeCirculationGeometry, attachNativeCirculationCellRoutes } from "./native-circulation-geometry.ts";
import { recoverNativeWallJunctionRepairs } from "./native-room-presentation.ts";
import {supportedSemanticDoorLinks} from "./semantic-door-links.ts";
import {supportedIndoorConnectors} from "./indoor-connectors.ts";
import type { ConvertResult } from "./types.ts";
import {
  parseRoomDirectory,
  isHallway,
  isWalkable,
  roomBuilding,
  nativeRouteBlocker,
  type DirectoryRoom,
  type RoomDirectoryData,
  type RoomPoint,
  type RouteOpening,
} from "./room-directory.ts";
import {
  directoryDoors,
  directoryDoorReviews,
  preserveOriginalNativeDoorPortals,
  directoryStairs,
} from "./directory-navigation.ts";
import { recoverRegisteredOpenFronts, recoverRegisteredCirculationSeams } from "./registered-open-fronts.ts";
import { recoverRegisteredSourceDoors } from "./registered-source-doors.ts";
import { recoverNativeDoorOwnership, recoverRegisteredStairDoorOwnership } from "./native-door-ownership.ts";
import { nativeArrivalFloorSupport } from "./indoor-arrival-recovery.ts";
import { directoryOpenPassages } from "./directory-openings.ts";
import { localBuildingConnections } from "./building-transitions.ts";
import { architecturalPlanGeometry } from "./architectural-plan.ts";
import { campusFloors } from "./campus-floors.ts";
import { directoryModelFloor } from "../../app/studio/directory-model.ts";
import { fitGeoreference, modelPointToGeographic } from "./georeference.ts";
import { buildIndoorGrid, type GridTerminal } from "./indoor-grid.ts";
import { prepareIndoorPresentation } from "./indoor-presentation.ts";
import { prepareIndoorStairDisplay } from "./indoor-stair-display.ts";
import type {
  IndoorDataset,
  IndoorEdge,
  IndoorNode,
  IndoorRecord,
} from "./indoor-contract.ts";

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
/** Compile evidence-backed geometry. Display grouping never creates graph adjacency. */
export async function prepareIndoorDataset(
  model: ConvertResult,
  input: RoomDirectoryData,
  modelSha256: string,
  progress: (message: string) => void = () => {},
  options: {
    physicalDoorSource?: IndoorDataset;
    /** CLI may offload independent physical planes; route decisions below
     * remain in the original order. Browser/default compilation is unchanged. */
    nativeCirculationCompiler?: (model: ConvertResult, dataset: IndoorDataset) => Promise<ReturnType<typeof prepareNativeCirculationGeometry>>;
  } = {},
): Promise<IndoorDataset> {
  const data = parseRoomDirectory(JSON.stringify(input));
  model=withReviewedDoorApertures(model,data.reviewedDoorApertures,modelSha256,architecturalPlanGeometry);
  if (!data.georeference)
    throw new Error(
      "Save at least two GIS reference points before preparing an indoor project.",
    );
  if (
    data.georeference.modelFileName !== model.fileName ||
    !/^[a-f0-9]{64}$/.test(modelSha256)
  )
    throw new Error(
      "Model identity or source digest does not match this project.",
    );
  validateNativeDisplayScopes(data.nativeDisplayScopes, modelSha256);
  await verifyNativeIndoorEnvelopes(data.nativeIndoorEnvelopes, modelSha256);
  await verifyNativeMaterialSections(data.nativeMaterialSections,modelSha256);
  if(data.nativeIndoorEnvelopes)await initializeNativeExactGeosOverlay();
  validateNativeSourceStairMaterials(data.nativeSourceStairMaterials,modelSha256);
  validateIndoorExclusions(data.indoorExclusions, modelSha256, model.levels.filter(l => l.levelId != null).map(l => ({ id: l.levelId!, elevationFeet: l.elevation })));
  const fit = fitGeoreference(data.georeference),
    cell = 0.6;
  const sourceRooms = data.annotations
    .filter((r) => r.status !== "deleted")
    .sort((a, b) => a.key.localeCompare(b.key));
  const elevations = Object.assign(
    {},
    ...[...new Set(sourceRooms.map((r) => r.levelId))].map(
      (id) =>
        directoryModelFloor(model, sourceRooms, id, null)?.roomElevations ?? {},
    ),
  ) as Record<string, { elevation: number; evidence: string }>;
  const geo = (p: RoomPoint): [number, number] => {
    const q = modelPointToGeographic(p, fit);
    return [q.longitude, q.latitude];
  };
  const surface = (r: DirectoryRoom) =>
    `${roomBuilding(r)}:${r.levelId}:${(elevations[r.key]?.elevation ?? model.levels.find((l) => l.levelId === r.levelId)?.elevation ?? 0).toFixed(3)}`;
  const records: IndoorRecord[] = sourceRooms.map((r) => ({
    key: r.key,
    number: r.number ?? "",
    name: r.name ?? "Unnamed area",
    building: roomBuilding(r),
    levelId: r.levelId,
    elevationFeet: elevations[r.key]?.elevation ?? 0,
    elevationEvidence: elevations[r.key]?.evidence ?? "Unknown surface",
    surfaceId: surface(r),
    circulation: isHallway(r),
    stair:
      /\bstair(?:s|case|well)?\b/i.test(r.name ?? "") ||
      !!r.stairFlightIds?.length,
    access: r.access?.kind ?? "unknown",
    walkable: isWalkable(r),
    confidence: r.confidence,
    ringsFeet: [r.polygonFeet, ...(r.holesFeet ?? [])],
    properties: {
      dwg: r.dwg,
      spaceUse: r.spaceUse,
      access: r.access,
      stairAccess: r.stairAccess,
      modelSurface: r.modelSurface,
      notes: r.walkabilityNotes,
      floorOpeningsFeet: r.floorOpeningsFeet,
      nativeFloorOpeningOwnership: r.nativeFloorOpeningOwnership,
    },
  }));
  const byRoom = new Map(sourceRooms.map((r) => [r.key, r])),
    byRecord = new Map(records.map((r) => [r.key, r]));
  const dataset: IndoorDataset = {
    format: "reviter-indoor",
    version: 1,
    generator: "reviter/indoor-pipeline-1",
    source: {
      modelFileName: model.fileName,
      modelSha256,
      roomsSha256: await sha256Bytes(
        new TextEncoder().encode(JSON.stringify(data)),
      ),
    },
    alignment: {
      originFeet: [model.origin.x, model.origin.y, model.origin.z],
      originGeographic: geo([model.origin.x, model.origin.y]),
      projectionLatitude: fit.origin.latitude,
      rotationRadians: (fit.rotationDegrees * Math.PI) / 180,
      horizontalMetresPerFoot: fit.scaleMetresPerFoot,
      verticalMetresPerFoot: 0.3048,
      rmsMetres: fit.rmsMetres,
      referenceCount: data.georeference.points.length,
    },
    floors: campusFloors(sourceRooms, model.levels, data.campusStoreys).map(
      (f) => ({
        id: `storey:${f.levelIds.join("+")}`,
        name: f.name,
        levelIds: f.levelIds,
        elevationFeet: f.elevation,
      }),
    ),
    nativeLevels: model.levels
      .filter((l) => l.levelId != null)
      .map((l) => ({
        id: l.levelId!,
        name: l.name ?? `Level ${l.levelId}`,
        elevationFeet: l.elevation,
      })),
    records,
    ...(data.nativeDoorBoundaryClosures ? {nativeDoorBoundaryClosures: structuredClone(data.nativeDoorBoundaryClosures)} : {}),
    ...(data.nativeSelectionContactRepairs ? {nativeSelectionContactRepairs: structuredClone(data.nativeSelectionContactRepairs)} : {}),
    ...(data.nativeWallPositionRepairs ? {nativeWallPositionRepairs: structuredClone(data.nativeWallPositionRepairs)} : {}),
    ...(data.selectionDoorThresholds ? { selectionDoorThresholds: structuredClone(data.selectionDoorThresholds) } : {}),
    ...(data.reviewedAreaPartitions ? { reviewedAreaPartitions: structuredClone(data.reviewedAreaPartitions) } : {}),
    ...(data.nativeDisplayScopes ? { nativeDisplayScopes: structuredClone(data.nativeDisplayScopes) } : {}),
    ...(data.nativeIndoorEnvelopes ? { nativeIndoorEnvelopes: structuredClone(data.nativeIndoorEnvelopes) } : {}),
    ...(data.nativeProvisionalCornerSeals?{nativeProvisionalCornerSeals:structuredClone(data.nativeProvisionalCornerSeals)}:{}),
    ...(data.nativeDerivedFrameReturns?{nativeDerivedFrameReturns:structuredClone(data.nativeDerivedFrameReturns)}:{}),
    ...(data.nativeMaterialSections?{nativeMaterialSections:structuredClone(data.nativeMaterialSections)}:{}),
    ...(data.nativeSourceStairMaterials?{nativeSourceStairMaterials:structuredClone(data.nativeSourceStairMaterials)}:{}),
    ...(data.indoorExclusions ? { indoorExclusions: structuredClone(data.indoorExclusions) } : {}),
    ...(data.visitorMetadata ? { visitor: structuredClone(data.visitorMetadata) } : {}),
    nodes: [],
    edges: [],
    walls: [],
    doors: [],
    issues: [],
    report: {
      recordCount: data.annotations.length,
      routableArrivals: 0,
      components: 0,
      largestComponentArrivals: 0,
      unmatchedDoors: 0,
      cellSizeFeet: cell,
      omittedSourceLabels:
        data.sourceCoverage?.omittedSheets.reduce(
          (s, p) => s + p.labelCount,
          0,
        ) ?? 0,
    },
  };
  if (dataset.nativeIndoorEnvelopes) {
    dataset.nativePhysicalLevels = prepareNativePhysicalLevels(model,dataset);
    for(const alias of dataset.nativePhysicalLevels.displayAliases) {
      const floor=dataset.floors.find(f=>f.id===alias.displayFloorId)!;
      if(!floor.levelIds.includes(alias.nativeLevelId))floor.levelIds.push(alias.nativeLevelId);
    }
  }
  const issue = (
    code: string,
    message: string,
    roomKey?: string,
    nativeElementId?: number,
    levelId?: number,
  ) => {
    const baseId = `${code}:${roomKey ?? nativeElementId ?? dataset.issues.length}:${levelId ?? ""}`;
    let id = baseId, occurrence = 2;
    // A room may own several independently recovered seams or diagnostics.
    // Preserve the original first ID, then deterministic occurrence IDs so no
    // review entries share a React key or overwrite each other in a queue.
    while (dataset.issues.some(item => item.id === id)) id = `${baseId}:${occurrence++}`;
    return dataset.issues.push({
      id,
      code,
      severity: "review",
      message,
      roomKey,
      nativeElementId,
      levelId,
    });
  };
  if (data.georeference.points.length < 3)
    issue(
      "alignment-check",
      "Two-point alignment needs an independent, well-spread survey check.",
    );
  if (dataset.report.omittedSourceLabels)
    issue(
      "source-coverage",
      `${dataset.report.omittedSourceLabels} drawing labels were not imported; see the preserved source coverage.`,
    );
  for (const pin of data.accessReviewLocations ?? [])
    issue(
      "staff-pin",
      "A staff restriction pin has no assigned boundary; review nearby circulation.",
      undefined,
      undefined,
      pin.levelId,
    );
  // Supported unlabelled landings participate in native doorway ownership.
  // Creating them after door review leaves real exterior thresholds unmatched.
  const strictNativeRouting = !!(dataset.nativeIndoorEnvelopes && dataset.nativeMaterialSections);
  // The legacy local preview subtracts room contours from its landing slabs.
  // Retain the saved recipes for review, but it cannot certify strict native
  // walking geometry. Qualified original flights use nativeSourceStair receipts.
  const localConnections = strictNativeRouting ? [] : localBuildingConnections(model, sourceRooms, data.buildingTransitions ?? []);
  if (strictNativeRouting)
    for (const transition of data.buildingTransitions ?? [])
      issue("native-local-transition-review", `Local transition ${transition.id} remains a source recipe. Its owned native flight, full-width terminal contacts and exact native approaches require qualification before routing; no contour-derived landing or crossing emitted.`, undefined, transition.nativeStairId);
  const localEndpointKeys = new Map<string, (string | undefined)[]>();
  for (const c of localConnections.filter(c => c.surfaceSupported)) {
    const keys = c.endpoints.map((e, i) => {
      let key = e.roomKey;
      if (!key) {
        key = `landing:${c.report.id}:${i}`;
        const candidate = c.surfaces[i]?.polygons.find(p => p[0]?.length && containsDirectoryRoomPoint(e.point, { polygonFeet: p[0]!, holesFeet: p.slice(1) } as DirectoryRoom));
        if (!candidate) return undefined;
        // Existing source areas retain their own graph ownership. The native
        // generated landing is precisely the otherwise unlabelled floor patch.
        const claimed = sourceRooms.filter(r => r.levelId === e.levelId && Math.abs((elevations[r.key]?.elevation ?? 0) - e.elevation) < .05).map(r => [r.polygonFeet, ...(r.holesFeet ?? [])]);
        const unclaimed = claimed.length ? pc.difference(candidate, ...claimed) as RoomPoint[][][] : [candidate];
        const loops = unclaimed.find(p => p[0]?.length && containsDirectoryRoomPoint(e.point, { polygonFeet: p[0]!, holesFeet: p.slice(1) } as DirectoryRoom));
        if (!loops) return undefined;
        const room: DirectoryRoom = { key, building: e.building, levelId: e.levelId, name: "Native connection landing", polygonFeet: loops[0]!, holesFeet: loops.slice(1), labelPointFeet: e.point, confidence: 1, spaceUse: { kind: "hallway", evidence: "user-reported" } };
        sourceRooms.push(room); byRoom.set(key, room);
        elevations[key] = { elevation: e.elevation, evidence: `Native floor #${c.surfaces[i]!.elementId}` };
        const record: IndoorRecord = { key, number: "", name: room.name!, building: e.building, levelId: e.levelId, elevationFeet: e.elevation, elevationEvidence: elevations[key]!.evidence, surfaceId: surface(room), circulation: true, stair: false, access: "unknown", walkable: true, confidence: 1, ringsFeet: loops, properties: { nativeFloorId: c.surfaces[i]!.elementId, generatedLanding: true } };
        records.push(record); byRecord.set(key, record);
      }
      return key;
    });
    localEndpointKeys.set(c.report.id, keys);
  }
  const exactFloors = new Map([...new Set([...records.map(r => r.elevationFeet),
    ...nativePhysicalWorkingLevelIds(dataset).map(id=>dataset.nativeLevels.find(l=>l.id===id)!.elevationFeet)])]
    .flatMap(elevation => routingFloorPlateRecords(model, elevation))
    .map(floor => [floor.elementId, floor]));
  dataset.walkingSupport = {
    version: 1,
    sourceModelSha256: modelSha256,
    floors: [...exactFloors.values()].sort((a,b) => a.elementId-b.elementId).map(floor => ({
      nativeElementId: floor.elementId,
      elevationFeet: floor.boundsFeet.max.z,
      ringsFeet: nativeFloorPolygons(floor, !!dataset.nativeIndoorEnvelopes)[0]!,
      partsFeet: nativeFloorPolygons(floor, !!dataset.nativeIndoorEnvelopes),
    })),
  };
  await verifyNativeProvisionalCornerSeals(dataset);
  verifyNativeDerivedFrameReturns(dataset);
  const semanticDoors = supportedSemanticDoorLinks(model, data, modelSha256, data.navigation?.doorLinks ?? []);
  for (const diagnostic of semanticDoors.diagnostics) issue(diagnostic.code, diagnostic.message, undefined, diagnostic.doorId, diagnostic.levelId);
  progress("Deriving independently enclosed, floor-supported native routing interiors…");
  const sourcePortalRooms = [...sourceRooms];
  const nativePrepass = prepareNativeRoutingBoundaries(model, data, dataset, semanticDoors.links);
  for (let i = 0; i < sourceRooms.length; i++) {
    const derived = nativePrepass.rooms.get(sourceRooms[i]!.key);
    if (!derived) continue;
    const record = byRecord.get(derived.key)!;
    record.properties.originalSourceRingsFeet = structuredClone(record.ringsFeet);
    record.properties.nativeRoutingBoundary = derived.nativeInteriorProvenance;
    record.ringsFeet = [derived.polygonFeet, ...(derived.holesFeet ?? [])];
    sourceRooms[i] = derived;
    byRoom.set(derived.key, derived);
  }
  dataset.issues.push({ id: "native-routing-boundaries", code: "native-routing-boundaries", severity: "info",
    message: `${nativePrepass.report.promoted} native wall-defined routing interiors recovered with complete same-height floor support. Original source rings and saved annotation JSON remain preserved.` });
  const terminals = new Map<string, GridTerminal[]>(),
    nodes = new Map<string, IndoorNode>();
  const addTerminal = (
    id: string,
    roomKey: string,
    point: RoomPoint,
    kind: IndoorNode["kind"],
    snap: number,
    nativeClearWidthFootprint?: RoomPoint[],
    nativeDoorNormal?: RoomPoint,
  ) => {
    const r = byRecord.get(roomKey);
    if (!r || !r.walkable || r.access === "staff") return;
    terminals.set(roomKey, [
      ...(terminals.get(roomKey) ?? []),
      { id, roomKey, point, maxSnapFeet: snap, nativeClearWidthFootprint, nativeDoorNormal },
    ]);
    nodes.set(id, {
      id,
      roomKey,
      kind,
      levelId: r.levelId,
      building: r.building,
      surfaceId: r.surfaceId,
      pointFeet: [...point, r.elevationFeet],
      geographic: geo(point),
    });
  };
  for (const r of sourceRooms)
    addTerminal(
      `arrival:${r.key}`,
      r.key,
      r.routePointFeet ?? r.labelPointFeet,
      "arrival",
      cell * 2,
    );
  const geometries = new Map<
      number,
      ReturnType<typeof architecturalPlanGeometry>
    >(),
    openings = new Map<number, RouteOpening[]>(),
    pending: IndoorEdge[] = [];
  for (const levelId of nativePhysicalWorkingLevelIds(dataset)) {
    progress(`Checking native walls and doors · level #${levelId}`);
    const rooms = sourceRooms.filter((r) => r.levelId === levelId),
      geometry = architecturalPlanGeometry(model, levelId);
    dataset.walls.push(
      ...[
        ...geometry.walls.map((w) => ({ ...w, kind: "wall" as const })),
        ...geometry.columns.map((w) => ({ ...w, kind: "column" as const })),
      ]
        .filter((w) => w.polygon.length >= 3)
        .map((w) => ({
          levelId,
          nativeElementId: w.elementId,
          kind: w.kind,
          approximate: w.approximate,
          ringsFeet: [w.polygon],
        })),
    );
    const positioned=nativeWallPositionRepairedWalls(dataset,{deferPhysicalChecks:true});
    dataset.walls=positioned;
    const positionedGeometry={...geometry,walls:nativeWallPositionRepairedPlanWalls(geometry.walls,dataset,levelId)};
    const correctedWalls=reviewedBoundaryWalls(dataset.walls,data.nativeBoundaryPatches,modelSha256,levelId,data.reviewedDoorApertures,data.nativeMaterialSections,data.nativeMaterialSections ? contactLevel=>nativeMaterialPlanWalls(dataset,contactLevel,data.reviewedDoorApertures) : undefined);
    dataset.walls.push(...correctedWalls);
    const correctedGeometry={...positionedGeometry,walls:[...positionedGeometry.walls,...correctedWalls.map(w=>({elementId:w.nativeElementId,approximate:false,polygon:w.ringsFeet[0]!}))]};
    geometries.set(levelId,correctedGeometry);
    const nativeDoors = directoryDoors(model, levelId);
    const promotedDoorReviews = directoryDoorReviews(
        rooms,
        nativeDoors,
        semanticDoors.links,
        data.navigation?.doorLinks ?? [],
      );
    const reviews = dataset.nativeIndoorEnvelopes ? preserveOriginalNativeDoorPortals(
      directoryDoorReviews(sourcePortalRooms.filter(r=>r.levelId===levelId), nativeDoors, semanticDoors.links, data.navigation?.doorLinks ?? []),
      promotedDoorReviews,
    ) : promotedDoorReviews;
    for(const review of reviews) if(review.portal && !promotedDoorReviews.find(r=>r.door.id===review.door.id)?.portal)
      issue("native-promotion-preserved-physical-door", "The native main-room label no longer includes this entry recess. Its unchanged original physical doorway, ownership and portal points are retained; exact current native cells/own-host approaches must independently support any walking attachment.", undefined, review.door.id, levelId);
    const
      passages = directoryOpenPassages(
        rooms,
        data.navigation?.openLinks ?? [],
        data.boundaryReference,
        correctedGeometry,
        {nativeOnly:!!dataset.nativeIndoorEnvelopes},
      );
    dataset.doors!.push(
      ...reviews.map(({ door, candidates, state, portal }) => ({
        id: `door:${levelId}:${door.id}`,
        levelId,
        nativeElementId: door.id,
        hostWallNativeElementId: model.nativeHostRelations?.find(relation => relation.elementId === door.id)?.hostId,
        pointFeet: door.point,
        footprintFeet: door.footprint,
        normalFeet: door.normal,
        roomKeys: portal?.rooms ?? candidates,
        state,
      })),
    );
    // Repair only independently supported microscopic native joints for barrier
    // checks. Raw exported native walls and all source model bytes stay intact.
    const jointRepairs = dataset.nativeIndoorEnvelopes ? [] : recoverNativeWallJunctionRepairs(
      dataset.walls.filter(w => w.levelId === levelId),
      dataset.doors!.filter(d => d.levelId === levelId),
    );
    geometries.set(levelId, {
      ...correctedGeometry,
      walls: [...correctedGeometry.walls, ...jointRepairs.map(repair => ({
        elementId: repair.nativeWallElementId,
        approximate: true,
        polygon: repair.ringsFeet[0]!,
      }))],
    });
    const recoveredDoorOwnership = recoverNativeDoorOwnership(
      rooms, reviews, geometries.get(levelId)!,
    );
    // The ordinary native doorway recovery retains its existing search bound.
    // A separate source-registered stair threshold proof may explain a larger
    // unlabelled approach only with its real frame and exact-height floor.
    for (const recovered of recoveredDoorOwnership) {
      const review = reviews.find(r => r.door.id === recovered.portal.doorId);
      if (review) { review.portal = recovered.portal; review.state = "connected"; }
    }
    const exactFloorSupport = new Map(rooms.map(room => {
      const elevationFeet = byRecord.get(room.key)!.elevationFeet;
      const floors = routingFloorPlateRecords(model, elevationFeet);
      return [room.key, { elevationFeet, nativeFloorElementIds: floors.map(floor => floor.elementId), floors: floors.flatMap(floor => nativeFloorPolygons(floor, !!dataset.nativeIndoorEnvelopes)) }];
    }));
    recoveredDoorOwnership.push(...recoverRegisteredStairDoorOwnership(
      rooms, reviews, geometries.get(levelId)!, data.boundaryReference, exactFloorSupport,
    ));
    for (const recovered of recoveredDoorOwnership) {
      const review = reviews.find(r => r.door.id === recovered.portal.doorId);
      if (!review) continue;
      review.portal = recovered.portal;
      review.state = "connected";
      const exported = dataset.doors!.find(d => d.levelId === levelId && d.nativeElementId === review.door.id);
      if (exported) {
        exported.roomKeys = [...recovered.portal.rooms];
        exported.state = "connected";
      }
      issue(
        "recovered-native-door-ownership",
        `Native door-side ownership recovered with continuous floor, jamb, wall/column and third-room checks: ${JSON.stringify(recovered.proof)}. Access and accessibility remain unverified.`,
        undefined, review.door.id, levelId,
      );
    }
    const matchedKeys = new Set([...reviews.flatMap(d => d.portal?.rooms ?? []), ...passages.flatMap(p => p.rooms)]);
    const recoveredFronts = recoverRegisteredOpenFronts(
      rooms, new Set(rooms.filter(r => !matchedKeys.has(r.key)).map(r => r.key)),
      data.boundaryReference, geometries.get(levelId)!,
    );
    recoveredFronts.push(...recoverRegisteredCirculationSeams(
      rooms, data.boundaryReference, geometries.get(levelId)!,
      exactFloorSupport,
    ).filter(front => !passages.some(p => p.rooms.every(key => front.rooms.includes(key)))));
    passages.push(...recoveredFronts);
    for (const front of recoveredFronts) issue(
      "recovered-open-front",
      `Doorless registered opening recovered at full ${front.proof.widthFeet} ft width across a ${front.proof.boundaryGapFeet.toFixed(4)} ft drawing seam; ${front.proof.floorCoveredSquareFeet.toFixed(4)} square feet continuously covered by native floors. Native/repaired walls, columns, source walls, other rooms and holes were checked. Public access and accessibility remain unverified.`,
      front.rooms[0], undefined, levelId,
    );
    const sourceDoors = recoverRegisteredSourceDoors(
      rooms, data.boundaryReference, geometries.get(levelId)!, exactFloorSupport,
      dataset.source.modelSha256,
    );
    for (const door of sourceDoors) issue(
      "recovered-source-door",
      `Fixed registered drawing doorway ${door.sourceDoorId} recovered from independently proved paired swing/leaf symbols and both jamb wall faces; both exact-height native floors, full 2 ft crossing, native/source walls, columns, existing native doors, third rooms and holes checked. Source model bytes stay intact. Access and accessibility remain unverified.`,
      door.rooms[0], undefined, levelId,
    );
    const ports = [
      ...reviews.flatMap((d) =>
        d.portal
          ? [
              {
                ...d.portal,
                id: `door:${levelId}:${d.door.id}`,
                kind: "door" as const,
                evidence: d.portal.reviewed
                  ? "reviewed-native-door"
                  : "native-door",
                nativeElementId: d.door.id,
                sourceDoorProof: undefined,
              },
            ]
          : [],
      ),
      ...passages.map((p) => ({
        ...p,
        id: `opening:${p.openingId}`,
        kind: "opening" as const,
        evidence: (() => {
          const recovered = recoveredFronts.find(front => front.openingId === p.openingId);
          if (!recovered) return p.evidence;
          const proof = recovered.proof;
          return `recovered registered source open front; widthFeet=${proof.widthFeet}; boundaryGapFeet=${proof.boundaryGapFeet}; registrationErrorFeet=${proof.registrationErrorFeet}; continuously native-floor-covered squareFeet=${proof.floorCoveredSquareFeet}; native/repaired-wall, column, source-wall, other-room and hole vetoes passed; access/accessibility unverified`;
        })(),
        nativeElementId: undefined,
        sourceDoorProof: undefined,
      })),
      ...sourceDoors.map(door => ({
        ...door,
        id: door.sourceDoorId,
        kind: "door" as const,
        evidence: "registered source doorway; paired source leaf/swing symbols and actual jamb wall faces; fixed threshold, exact native floors and full-width obstacle proof; no native door identity inferred; access/accessibility unverified",
        nativeElementId: undefined,
        sourceDoorProof: door.proof,
      })),
    ];
    openings.set(levelId, ports);
    for (const d of reviews)
      if (!d.portal) {
        dataset.report.unmatchedDoors++;
        issue(
          "door-unmatched",
          `${d.state} native door: ${d.candidates.length} candidate areas${d.candidates.length ? ` (${d.candidates.join(", ")})` : ""}. Review the native threshold, floor, room boundaries and explicit door link; proximity alone does not authorize a connection.`,
          undefined,
          d.door.id,
          levelId,
        );
      }
    const nativeWalkingQuery=createNativeWalkingRegionQuery(model,dataset);
    for (const p of ports) {
      const a = byRecord.get(p.rooms[0])!,
        b = byRecord.get(p.rooms[1])!;
      if (!p.footprint) {
        issue(
          "door-footprint",
          "Opening has no precise footprint.",
          undefined,
          p.nativeElementId,
          levelId,
        );
        continue;
      }
      if (Math.abs(a.elevationFeet - b.elevationFeet) > 0.05) {
        issue(
          "door-height",
          "Door joins different surface heights; a supported transition is needed.",
          undefined,
          p.nativeElementId,
          levelId,
        );
        continue;
      }
      if(p.kind === "opening" && dataset.nativeIndoorEnvelopes && !supportedWalkingPath(nativeWalkingQuery(a.elevationFeet,true),[[p.from[0],p.from[1],a.elevationFeet],[p.to[0],p.to[1],b.elevationFeet]])) {
        issue("native-opening-support","An opening seed lacks continuous two-foot support inside the checked native indoor floor and physical barriers; no outline-based route retained.",undefined,p.nativeElementId,levelId);
        continue;
      }
      const ids = [`${p.id}:0`, `${p.id}:1`];
      addTerminal(ids[0]!, a.key, p.from, "portal", 2, p.footprint, p.normal);
      addTerminal(ids[1]!, b.key, p.to, "portal", 2, p.footprint, p.normal);
      pending.push({
        id: p.id,
        from: ids[0]!,
        to: ids[1]!,
        kind: p.kind,
        lengthMetres: 0,
        pointsFeet: [],
        roomKeys: p.rooms,
        evidence: p.evidence,
        nativeElementId: p.nativeElementId,
        accessible: "unknown",
        enabled: true,
        ...(p.sourceDoorProof ? { sourceDoorProof: p.sourceDoorProof } : {}),
        ...(p.kind === "opening" ? (() => {
          const front = recoveredFronts.find(front => front.openingId === p.openingId);
          const span = front && recoverIndoorOpeningSpan(model, dataset, rooms, front, data.boundaryReference, geometries.get(levelId)!,nativeWalkingQuery);
          return span ? { openingSpan: span } : {};
        })() : {}),
      });
    }
    for(const message of nativeWalkingQuery.diagnostics())issue("native-geometry-unclassified",message,undefined,undefined,levelId);
  }
  for (const s of directoryStairs(
    model,
    sourceRooms,
    data.navigation?.stairLinks,
  )) {
    const ids = s.rooms.map((key, i) => `${s.id}:${i}`);
    s.rooms.forEach((key, i) => {
      const room = byRoom.get(key)!;
      addTerminal(
        ids[i]!,
        key,
        room.routePointFeet ?? room.labelPointFeet,
        "stair",
        cell * 2,
      );
    });
    pending.push({
      id: s.id,
      from: ids[0]!,
      to: ids[1]!,
      kind: "stairs",
      lengthMetres: s.distanceFeet * 0.3048,
      pointsFeet: [],
      roomKeys: s.rooms,
      evidence: s.evidence,
      nativeElementId: s.stairElementId,
      accessible: "no",
      enabled: true,
    });
  }
  if (data.indoorConnectors) {
    const review=supportedIndoorConnectors(model,sourceRooms,modelSha256,data.indoorConnectors);
    dataset.connectors=[];
    for(const rejected of review.rejected) issue("connector-review", `${rejected.id}: ${rejected.message}`);
    for(const connector of review.accepted) {
      const entrances=connector.entrances.map((e,i)=>({nodeId:`connector:${connector.id}:${i}`,roomKey:e.roomKey,levelId:e.levelId,...(e.areaKey ? {areaKey:e.areaKey} : {})}));
      connector.entrances.forEach((e,i)=>addTerminal(entrances[i]!.nodeId,e.roomKey,e.pointFeet,"connector",cell*2));
      dataset.connectors.push({id:connector.id,kind:connector.kind,nativeElementId:connector.nativeElementId,...(connector.reviewedShaft ? {reviewedShaft:connector.reviewedShaft} : {}),sourceModelSha256:modelSha256,evidence:connector.evidence,accessible:connector.accessible,direction:connector.direction,entrances});
      // Elevator entrance pairs use explicit served floor identities; an escalator is one directed pair.
      for(let i=0;i<entrances.length-1;i++) for(let j=i+1;j<entrances.length;j++) {
        const from=entrances[i]!,to=entrances[j]!;
        pending.push({id:`connector:${connector.id}:${i}:${j}`,from:from.nodeId,to:to.nodeId,kind:connector.kind,connectorId:connector.id,direction:connector.direction,lengthMetres:Math.abs(byRecord.get(from.roomKey)!.elevationFeet-byRecord.get(to.roomKey)!.elevationFeet)*0.3048,pointsFeet:[],roomKeys:[from.roomKey,to.roomKey],evidence:connector.evidence,nativeElementId:connector.nativeElementId,accessible:connector.accessible,enabled:true});
      }
    }
  }
  // Local steps can land on a supported slab without a room label. Such landings
  // get their own explicit surface identity; proximity alone never attaches them.
  for (const c of localConnections) {
    if (!c.surfaceSupported) {
      issue("local-transition", `${c.report.id}: ${c.warnings.join(" ")}`);
      continue;
    }
    const ids = c.endpoints.map((e, i) => {
      const key = localEndpointKeys.get(c.report.id)?.[i];
      if (!key) return undefined;
      const id = `local:${c.report.id}:${i}`;
      addTerminal(id, key, e.point, "stair", 1.2);
      return id;
    });
    if (ids.some((x) => !x)) continue;
    pending.push({
      id: `local:${c.report.id}`,
      from: ids[0]!,
      to: ids[1]!,
      kind: "local-steps",
      lengthMetres: c.samples
        .slice(1)
        .reduce(
          (s, p, i) =>
            s +
            Math.hypot(
              p.point[0] - c.samples[i]!.point[0],
              p.point[1] - c.samples[i]!.point[1],
              p.elevation - c.samples[i]!.elevation,
            ) *
              0.3048,
          0,
        ),
      pointsFeet: c.samples.map((p) => [...p.point, p.elevation]),
      roomKeys: c.endpoints.map((_, i) => nodes.get(ids[i]!)!.roomKey),
      evidence: "user-reported + native-supported",
      nativeElementId: c.report.nativeStairId,
      accessible: "no",
      enabled: true,
    });
  }
  const scopes = new Map<string, DirectoryRoom[]>();
  // Strict native cells rebuild every walking branch below. The legacy raster
  // must not first snap or delete physical stair/lift/opening terminals using
  // room identity contours: their original coordinates remain the source of
  // truth, and unsupported native approaches simply receive no walking link.
  const legacyRaster = !strictNativeRouting;
  for (const r of legacyRaster ? sourceRooms : []) {
    const record = byRecord.get(r.key)!;
    if (!record.walkable || record.access === "staff") continue;
    const id = record.circulation
      ? `circulation:${record.surfaceId}`
      : `room:${r.key}`;
    scopes.set(id, [...(scopes.get(id) ?? []), r]);
  }
  const connectedTerminals = new Set<string>();
  const arrivalFloorSupport = new Map<string, ReturnType<typeof nativeArrivalFloorSupport>>();
  let index = 0;
  for (const [scopeId, rooms] of scopes) {
    progress(`Building walkable graph · region ${++index}/${scopes.size}`);
    const reference = byRecord.get(rooms[0]!.key)!,
      geometry = geometries.get(reference.levelId)!;
    const bounds = rooms.flatMap((r) => r.polygonFeet),
      minX = Math.min(...bounds.map((p) => p[0])),
      maxX = Math.max(...bounds.map((p) => p[0])),
      minY = Math.min(...bounds.map((p) => p[1])),
      maxY = Math.max(...bounds.map((p) => p[1]));
    const keys = new Set(rooms.map((r) => r.key));
    const masks = sourceRooms.filter(
      (r) =>
        !keys.has(r.key) &&
        r.levelId === reference.levelId &&
        roomBuilding(r) === reference.building &&
        (!isWalkable(r) || !isHallway(r)) &&
        Math.min(...r.polygonFeet.map((p) => p[0])) <= maxX &&
        Math.max(...r.polygonFeet.map((p) => p[0])) >= minX &&
        Math.min(...r.polygonFeet.map((p) => p[1])) <= maxY &&
        Math.max(...r.polygonFeet.map((p) => p[1])) >= minY,
    );
    const supportKey = `${reference.levelId}:${reference.elevationFeet}`;
    if (!arrivalFloorSupport.has(supportKey))
      arrivalFloorSupport.set(supportKey, nativeArrivalFloorSupport({floors: [
        ...routingFloorPlateRecords(model, reference.elevationFeet).map(record =>
          (record.loops ?? []).map(loop => loop.map(p => [p[0], p[1]] as RoomPoint))),
      ]}));
    const ts = rooms.flatMap((r) => terminals.get(r.key) ?? []),
      floorSupported = arrivalFloorSupport.get(supportKey),
      grid = buildIndoorGrid(
        rooms,
        masks,
        ts,
        geometry,
        openings.get(reference.levelId) ?? [],
        cell,
        floorSupported ? {
          arrivalTerminalIds: new Set(ts.filter(t =>
            nodes.get(t.id)?.kind === "arrival" &&
            !rooms.find(r => r.key === t.roomKey)?.routePointFeet,
          ).map(t => t.id)),
          nativeFloorSupported: floorSupported,
        } : undefined,
      );
    for (const recovery of grid.arrivalRecoveries) {
      const record = byRecord.get(recovery.roomKey);
      if (record) record.properties.arrivalRecovery = recovery;
      dataset.issues.push({
        id: `arrival-label-recovery:${recovery.roomKey}`,
        code: "arrival-label-recovery",
        severity: "info",
        roomKey: recovery.roomKey,
        levelId: reference.levelId,
        message: `Obstructed drawing-label arrival replaced by a room-contained, native-floor-supported destination connected to ${recovery.entranceId}; displacement ${recovery.displacementFeet.toFixed(4)} feet. Original source label is preserved.`,
      });
    }
    for (const id of grid.missing) {
      nodes.delete(id);
      issue(
        "arrival-or-portal",
        `No safe walkable anchor within the snap limit: ${id}.`,
        ts.find((t) => t.id === id)?.roomKey,
        undefined,
        reference.levelId,
      );
    }
    for (const [id, p] of grid.positions) {
      let node = nodes.get(id);
      if (!node) {
        node = {
          id,
          roomKey: rooms[0]!.key,
          kind: "junction",
          levelId: reference.levelId,
          building: reference.building,
          surfaceId: reference.surfaceId,
          pointFeet: [...p, reference.elevationFeet],
          geographic: geo(p),
        };
        nodes.set(id, node);
      }
      node.pointFeet = [...p, reference.elevationFeet];
      node.geographic = geo(p);
    }
    for (const b of grid.branches) {
      connectedTerminals.add(b.from);
      connectedTerminals.add(b.to);
      // An arrival and an existing connector can be the identical graph point.
      // Changing node identity at that point introduces no physical travel or
      // clearance claim; otherwise an already reviewed ramp ends at an
      // inaccessible zero-length bookkeeping edge.
      const stationaryTransfer = b.points.length >= 2 && b.points.every(p =>
        p[0] === b.points[0]![0] && p[1] === b.points[0]![1]);
      dataset.edges.push({
        id: `walk:${scopeId}:${[b.from, b.to].sort().join("|")}`,
        from: b.from,
        to: b.to,
        kind: "walk",
        lengthMetres: b.points
          .slice(1)
          .reduce(
            (s, p, k) =>
              s +
              Math.hypot(p[0] - b.points[k]![0], p[1] - b.points[k]![1]) *
                fit.scaleMetresPerFoot,
            0,
          ),
        pointsFeet: b.points.map((p) => [...p, reference.elevationFeet]),
        roomKeys: b.roomKeys,
        evidence: stationaryTransfer
          ? "identical same-surface same-height graph point; stationary node identity transfer with no physical travel"
          : "boundary + continuously checked native barriers + turn/clearance-preferred raster",
        routingQuality: b.routingQuality,
        accessible: stationaryTransfer ? "yes" : "unknown",
        enabled: true,
      });
    }
  }
  const portalFloorVoids = createNativePortalFloorVoidQuery(dataset);
  for (const e of pending) {
    const a = nodes.get(e.from),
      b = nodes.get(e.to);
    if (!a || !b) {
      issue(
        "connection-anchor",
        `Connection ${e.id} has an unsupported entrance.`,
        undefined,
        e.nativeElementId,
      );
      continue;
    }
    if (e.kind === "door" || e.kind === "opening") {
      const involved = e.roomKeys.map(key => sourceRooms.find(r => r.key === key)).filter((r): r is DirectoryRoom => !!r);
      let holes: RoomPoint[][];
      try { holes = portalFloorVoids(a.pointFeet[2], involved); }
      catch(error) {
        issue("connection-floor-void-review", `Connection ${e.id} cannot classify current native slab holes: ${String(error)}`, undefined, e.nativeElementId, a.levelId);
        continue;
      }
      const voidBlocked = nativeRouteBlocker({ walls: [], columns: holes.map(polygon => ({polygon})) }, []);
      if (voidBlocked([a.pointFeet[0], a.pointFeet[1]], [b.pointFeet[0], b.pointFeet[1]])) {
        issue("connection-void", `Connection ${e.id} crosses a source floor opening or room hole; its approach needs review.`, undefined, e.nativeElementId, a.levelId);
        continue;
      }
      const geometry = geometries.get(a.levelId)!;
      const blocked = nativeRouteBlocker(
        geometry,
        openings.get(a.levelId) ?? [],
      );
      if (
        blocked(
          [a.pointFeet[0], a.pointFeet[1]],
          [b.pointFeet[0], b.pointFeet[1]],
        )
      ) {
        issue(
          "connection-barrier",
          `Connection ${e.id} crosses a native barrier.`,
          undefined,
          e.nativeElementId,
        );
        continue;
      }
    }
    if (!e.pointsFeet.length) e.pointsFeet = [a.pointFeet, b.pointFeet];
    else e.pointsFeet = [a.pointFeet, ...e.pointsFeet, b.pointFeet];
    if (e.kind === "door" || e.kind === "opening")
      e.lengthMetres =
        Math.hypot(
          a.pointFeet[0] - b.pointFeet[0],
          a.pointFeet[1] - b.pointFeet[1],
        ) * fit.scaleMetresPerFoot;
    dataset.edges.push(e);
    connectedTerminals.add(e.from);
    connectedTerminals.add(e.to);
  }
  dataset.nodes = [...nodes.values()];
  for(const preserved of preservedNativeDoorPortals(dataset,options.physicalDoorSource)) {
    const door=dataset.doors!.find(d=>d.id===preserved.doorId)!;
    door.roomKeys=preserved.roomKeys;door.state="connected";
    for(const node of preserved.nodes) nodes.set(node.id,node);
    dataset.edges=dataset.edges.filter(e=>e.id!==preserved.edge.id);
    dataset.edges.push(preserved.edge);
    if(!preserved.nodes.every(n=>connectedTerminals.has(n.id))) issue("physical-door-approach-review","Original enabled physical doorway metadata is preserved. An approach lacks current native support; exact own-cell, floor/enclosure and own-host material checks must support it before attachment.",undefined,door.nativeElementId,door.levelId);
  }
  dataset.nodes = [...nodes.values()];
  if(data.reviewedDoorApertures)dataset.doorAperturePatchState={regenerated:true,sourceGeometryKey:JSON.stringify(data.reviewedDoorApertures.patches.map(({notes,...p})=>p))};
  progress("Rebuilding source-bound native ramps and supported landing approaches…");
  const restoredRampReviews = prepareReviewedIndoorRamps(model, dataset, data.indoorRamps, geo, data.indoorReviews);
  const attachments = attachNativeCirculation(model, dataset, (checked, total, edges) =>
    progress(`Checking native landing approaches · ${checked}/${total} candidate pairs · ${edges} supported connections`));
  dataset.edges.push(...attachments.edges);
  for (const message of attachments.diagnostics) issue("native-landing-attachment", message);
  for (const edge of attachments.edges) {
    connectedTerminals.add(edge.from);
    connectedTerminals.add(edge.to);
  }
  // Ramps may create a named native landing; generated arrivals must remain
  // regenerable rather than existing only in an OpenIndoorMaps ZIP mutation.
  const finalNodes = new Map(dataset.nodes.map(n => [n.id, n]));
  for (const r of records) {
    const id = `arrival:${r.key}`;
    if (finalNodes.has(id) && connectedTerminals.has(id)) r.arrivalNodeId = id;
    else if (r.key.startsWith("landing:")) {
      const landing = dataset.nodes.find(n => n.roomKey === r.key && dataset.edges.some(e => e.from === n.id || e.to === n.id));
      if (landing) r.arrivalNodeId = landing.id;
    }
    else if (r.walkable && r.access !== "staff")
      issue(
        "isolated-arrival",
        "Area has no matched access to the routing graph.",
        r.key,
        undefined,
        r.levelId,
      );
    if (r.access === "unknown")
      issue(
        "access-review",
        "Public access has not been confirmed.",
        r.key,
        undefined,
        r.levelId,
      );
  }
  dataset.connectors = dataset.connectors?.filter(c => c.entrances.every(e => nodes.has(e.nodeId)) && dataset.edges.some(e=>e.connectorId===c.id));
  const savedReviews = data.indoorReviews as
    | {
        records?: Record<string, {
          name?: string; notes?: string; throughNavigation?: boolean;
          throughNavigationGeometryKey?: string;
        }>;
        edges?: Record<
          string,
          {
            enabled?: boolean;
            accessible?: "yes" | "no" | "unknown";
            notes?: string;
            geometryKey?: string;
          }
        >;
      }
    | undefined;
  for (const record of records) {
    const review = savedReviews?.records?.[record.key];
    if (review?.name) record.name = review.name;
    if (review?.notes) record.properties.reviewNotes = review.notes;
    if (review?.throughNavigation === true) {
      const geometryKey = JSON.stringify([dataset.source.modelSha256, record.key, record.levelId, record.ringsFeet]);
      if (review.throughNavigationGeometryKey === geometryKey && review.notes?.trim() && record.walkable && record.access !== "staff")
        record.properties.throughNavigationReview = { geometryKey, notes: review.notes.trim() };
      else
        issue("through-navigation-review-stale", `Recheck the confirmed passage after regeneration: ${record.number || record.key}`, record.key, undefined, record.levelId);
    }
  }
  for (const edge of dataset.edges) {
    const review = savedReviews?.edges?.[edge.id];
    if (!review) continue;
    if (review.enabled != null) edge.enabled = review.enabled;
    if (review.notes) edge.notes = review.notes;
    if (review.accessible) {
      const key = JSON.stringify([
        dataset.source.modelSha256,
        edge.from,
        edge.to,
        edge.roomKeys,
        edge.pointsFeet,
      ]);
      if (
        (review.geometryKey === key || restoredRampReviews.has(edge.id)) &&
        (["stairs", "local-steps", "escalator"].includes(edge.kind)
          ? review.accessible !== "yes"
          : true)
      )
        edge.accessible = review.accessible;
      else
        issue(
          "connection-review-stale",
          `Recheck accessibility after regeneration: ${edge.id}`,
          undefined,
          edge.nativeElementId,
        );
    }
  }
  bindConnectorAreaArrivals(dataset, sourceRooms);
  const adjacency = new Map<string, string[]>();
  for (const e of dataset.edges) {
    adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
  }
  const arrivals = new Set(
      records.flatMap((r) => (r.arrivalNodeId ? [r.arrivalNodeId] : [])),
    ),
    seen = new Set<string>(),
    components: number[] = [];
  for (const id of adjacency.keys()) {
    if (seen.has(id)) continue;
    const q = [id];
    seen.add(id);
    let count = 0;
    for (let k = 0; k < q.length; k++) {
      if (arrivals.has(q[k]!)) count++;
      for (const next of adjacency.get(q[k]!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          q.push(next);
        }
    }
    components.push(count);
  }
  dataset.report.routableArrivals = arrivals.size;
  dataset.report.components = components.length;
  dataset.report.largestComponentArrivals = Math.max(0, ...components);
  await verifyNativeProvisionalCornerSeals(dataset);
  verifyNativeDerivedFrameReturns(dataset);
  validateNativeFloorOpeningOwnershipBinding(dataset,data.annotations);
  validateIndoorExclusions(dataset.indoorExclusions, modelSha256, dataset.nativeLevels);
  validateSelectionDoorBinding(data,dataset);
  validateReviewedAreaPartitionBinding(data,dataset);
  nativeWallPositionRepairedWalls(dataset);
  for(const level of new Set(dataset.nativeDoorBoundaryClosures?.doors.map(d=>d.levelId)??[]))nativeDoorBoundaryClosureFootprints(dataset,level);
  progress("Preparing native wall-defined room presentation…");
  const presentationGeometries = new Map([...geometries].map(([levelId, geometry]) => {
    const physicalElevation = model.levels.find(l => l.levelId === levelId)?.elevation;
    return [levelId, { ...geometry, floors: physicalElevation == null ? [] :
      routingFloorPlateRecords(model, physicalElevation).flatMap(floor => nativeFloorPolygons(floor, !!dataset.nativeIndoorEnvelopes)) }];
  }));
  dataset.presentation = prepareIndoorPresentation(dataset, data.annotations, undefined, {
    materialDoorApertures: data.reviewedDoorApertures,
    nativeModel: model,
    boundaryReference: data.boundaryReference,
    geometries: presentationGeometries,
    floorsByRecord: new Map(records.map(record => [record.key,
      routingFloorPlateRecords(model, record.elevationFeet).flatMap(floor => nativeFloorPolygons(floor, !!dataset.nativeIndoorEnvelopes))
    ])),
  });
  dataset.stairDisplay = prepareIndoorStairDisplay(model, dataset, data.annotations);
  if (strictNativeRouting)
    for (const edge of dataset.edges.filter(e => e.kind === "stairs" || e.kind === "local-steps"))
      if (!nativeStairRouteQualified(dataset, edge)) {
        edge.enabled = false;
        issue("native-stair-route-review", `Native ${edge.kind} connection ${edge.id} retains its original identity and terminal coordinates for review, but lacks the complete original owned flight, foreign-material and terminal-cap routing proof. No room-contour jump is enabled.`, undefined, edge.nativeElementId);
      }
  prepareNativeRampDisplay(model, dataset);
  progress("Deriving native floor-bound circulation cells and rebuilding their walking branches…");
  const nativeCirculation = options.nativeCirculationCompiler
    ? await options.nativeCirculationCompiler(model, dataset)
    : prepareNativeCirculationGeometry(model, dataset);
  dataset.circulationGeometry = nativeCirculation.geometry;
  const nativeBranches = attachNativeCirculationCellRoutes(dataset);
  if (strictNativeRouting) {
    // The final native cells, not an obsolete raster or vertical edge alone,
    // decide whether an unchanged destination has a real lateral approach.
    const approached = new Set(dataset.edges.filter(e => e.enabled && e.kind === "walk" && e.nativeCellId).flatMap(e => [e.from, e.to]));
    const finalNodeIds = new Set(dataset.nodes.map(n => n.id));
    const connectedKeys = new Set<string>();
    for (const record of records) {
      const id = `arrival:${record.key}`;
      if (record.walkable && record.access !== "staff" && finalNodeIds.has(id) && approached.has(id)) {
        record.arrivalNodeId = id;
        connectedKeys.add(record.key);
      } else if (record.arrivalNodeId === id) {
        delete record.arrivalNodeId;
      }
      // A reviewed shaft area may name its physical lobby stop as its arrival.
      // Keep that identity while requiring the same real lateral approach for
      // routability; the elevator edge itself cannot supply walking support.
      if (record.arrivalNodeId && approached.has(record.arrivalNodeId)) connectedKeys.add(record.key);
    }
    dataset.issues = dataset.issues.filter(i => i.code !== "isolated-arrival" || !connectedKeys.has(i.roomKey ?? ""));
    for (const record of records)
      if (record.walkable && record.access !== "staff" && !connectedKeys.has(record.key) && !dataset.issues.some(i => i.code === "isolated-arrival" && i.roomKey === record.key))
        issue("isolated-arrival", "Area has no supported lateral approach in the final native routing graph.", record.key, undefined, record.levelId);
    const arrivals = new Set(records.filter(r => connectedKeys.has(r.key)).flatMap(r => r.arrivalNodeId ? [r.arrivalNodeId] : []));
    const adjacency = new Map<string, string[]>();
    for (const edge of dataset.edges.filter(e => e.enabled)) {
      adjacency.set(edge.from, [...adjacency.get(edge.from) ?? [], edge.to]);
      adjacency.set(edge.to, [...adjacency.get(edge.to) ?? [], edge.from]);
    }
    const seen = new Set<string>(), components: number[] = [];
    for (const start of adjacency.keys()) {
      if (seen.has(start)) continue;
      const queue = [start]; seen.add(start); let count = 0;
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]!; if (arrivals.has(id)) count++;
        for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      components.push(count);
    }
    dataset.report.routableArrivals = arrivals.size;
    dataset.report.components = components.length;
    dataset.report.largestComponentArrivals = Math.max(0, ...components);
  }
  dataset.issues.push({id:"native-circulation-geometry",code:"native-circulation-geometry",severity:"info",message:`${nativeCirculation.report.accepted} native circulation cells; ${nativeBranches} native walking branches. ${nativeCirculation.report.rejected} unclassified cells retained for review. Source identities, door thresholds and vertical connectors preserved.`});
  for(const [i,message] of nativeCirculation.report.diagnostics.entries())
    dataset.issues.push({id:`native-circulation-topology:${i}`,code:"native-circulation-topology",severity:"review",message});
  const applied=(data.nativeBoundaryPatches?.patches??[]).filter(p=>p.status==='applied');
  if(applied.some(p=>!dataset.walls.some(w=>w.reviewPatchId===p.id)))throw new Error('An applied boundary patch has no compiled native floor. Review its level.');
  if(applied.length)dataset.boundaryPatchState={patchIds:applied.map(p=>p.id),regenerated:true};
  // Replay provisional selection contacts against the completed original
  // floors/doors/fixtures after verified native material recovery. They never
  // join physical walls or participate in circulation/route preparation.
  const selectionContacts=(dataset.nativeSelectionContactRepairs?.repairs??[]).filter(p=>p.status==='applied');
  if(selectionContacts.length)assertNativeSelectionContactRepairsPhysicalGuards(dataset,selectionContacts,deriveNativeSelectionContactRepairs(dataset,selectionContacts));
  prepareNativeWindowDisplay(model, dataset);
  if(data.reviewedDoorApertures)dataset.doorAperturePatchState={regenerated:true,sourceGeometryKey:JSON.stringify(data.reviewedDoorApertures.patches.map(({notes,...p})=>p))};
  return dataset;
}
