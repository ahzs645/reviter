import {nativeRationalOverlay,nativeRationalScalarToIEEE,NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,type NativeRationalParts} from "./native-rational-overlay.ts";
import {prepareNativeContainedCellDisplay,validateNativeContainedCellDisplay} from "./native-contained-cell-display.ts";
import {freezeNativeRationalParts,encodeNativeExactTopology,createNativeExactTopologyIndex,nativeRationalArea,nativeRationalMeasuredArea,nativeRationalAreaCompare,nativeRationalPointInParts,nativeRationalPathSupported,nativeRationalFootprintSupported,nativeRationalThresholdHalf,nativeExactPartsForProposals} from "./native-exact-planar-topology.ts";
import { NATIVE_EXACT_GEOS_BINDING } from "./native-exact-geos-overlay.ts";
import {
  nativePlanarPointInParts,
  nativePlanarPathSupported,
} from "./native-planar-path-support.ts";
import { nativeDoorClearOpening } from "./native-door-clear-opening";
import { nativeDoorFloorBlockers } from "./native-door-floor-support.ts";
import { nativeWallPositionMaterialBinding } from "./native-wall-position-repairs.ts";
import { nativeCirculationBinding } from "./native-circulation-binding.ts";
import { nativeRoomIdentityRings } from "./native-floor-opening-ownership.ts";
import { nativeRationalIntersectionOperand } from "./native-rational-intersection-broadphase.ts";
import {
  createNativeHostApertureQuery,
  createNativeRoutingMaterialQuery,
} from "./native-routing-material.ts";
import { createNativeBoundaryMaterialQuery,createNativeExactBoundaryMaterialQuery } from "./native-boundary-material.ts";
import { nativeConnectorAnchors } from "./native-connector-anchors.ts";
import { nativeMaterialPlanWalls } from "./native-material-plan.ts";
import { indoorExclusionParts } from "./indoor-exclusions.ts";
import pc from "polygon-clipping";
import {
  createNativeIndoorEnvelopeIndex,
  type NativeIndoorEnvelopeIndex,
} from "./native-indoor-envelopes.ts";
import {
  nativeBarrierTopology,
  NATIVE_BARRIER_TOPOLOGY_VERSION,
} from "./native-barrier-topology.ts";
import { nativeWalkingRegion } from "./native-circulation-links.ts";
import {
  routingFloorPlateRecords,
  nativeFloorPolygons,
  nativeLowSlabRecords,
} from "./routing-floor-support.ts";
import {
  clearanceSeparatedNativeCells,
  nativeFloorDifference,
  nativeFloorUnion,
  nativeFloorIntersection,
} from "./native-circulation-clearance.ts";
import { recoverNativeWallJunctionRepairs } from "./native-room-presentation.ts";
import { buildIndoorGrid } from "./indoor-grid.ts";
import { indoorRegionBlocker } from "./indoor-region.ts";
import {
  containsRoomPoint,
  type DirectoryRoom,
  type RoomPoint,
} from "./room-directory.ts";
import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";
import type { ConvertResult } from "./types.ts";
type Rings = RoomPoint[][];
const area = (parts: Rings[]) =>
  parts.reduce(
    (s, p) =>
      s +
      p.reduce(
        (v, r, i) =>
          v +
          (i ? -1 : 1) *
            Math.abs(
              r.reduce(
                (a, q, j) =>
                  a +
                  q[0] * r[(j + 1) % r.length]![1] -
                  q[1] * r[(j + 1) % r.length]![0],
                0,
              ) / 2,
            ),
        0,
      ),
    0,
  );
const contains = (point: RoomPoint, rings: Rings) =>
  containsRoomPoint(point, rings[0]!) &&
  !rings.slice(1).some((h) => containsRoomPoint(point, h));
const bounds = (rings: Rings) => {
  const p = rings.flat();
  return [
    Math.min(...p.map((q) => q[0])),
    Math.min(...p.map((q) => q[1])),
    Math.max(...p.map((q) => q[0])),
    Math.max(...p.map((q) => q[1])),
  ];
};
const overlaps = (a: number[], b: number[]) =>
  a[0]! <= b[2]! && a[2]! >= b[0]! && a[1]! <= b[3]! && a[3]! >= b[1]!;
// Preserve the historical grid only for legacy outline mode. Strict native
// faces retain their original coordinates and use analytical path predicates.
const legacyTopology = (rings: Rings): Rings =>
  rings.map((r) =>
    r
      .map(
        (p) =>
          [
            Math.round(p[0] * 1e6) / 1e6,
            Math.round(p[1] * 1e6) / 1e6,
          ] as RoomPoint,
      )
      .filter(
        (p, i, ps) => !i || p[0] !== ps[i - 1]![0] || p[1] !== ps[i - 1]![1],
      ),
  );
export function isNativeCirculationOwner(record: IndoorRecord): boolean {
  const use = record.properties.spaceUse as
    | { kind?: string; evidence?: string }
    | undefined;
  return (
    record.circulation &&
    record.walkable &&
    record.access !== "staff" &&
    (!record.stair ||
      (["flight-and-landing", "up-flight-only"].includes(
        String(record.properties.stairAccess),
      ) &&
        use?.kind === "hallway" &&
        use.evidence === "user-reported"))
  );
}
/** Geometry/access edits invalidate cells; names and destination descriptions do not. */
export function nativeCirculationGeometryKey(data: IndoorDataset): string {
  return nativeCirculationBinding(
    [
      data.source.modelSha256,
      NATIVE_BARRIER_TOPOLOGY_VERSION,
      ...(data.nativeIndoorEnvelopes
        ? [
            "native-indoor-envelope-v1",
            data.nativeIndoorEnvelopes,
            "native-source-intermediate-landings-v5",
              "native-source-exact-free-face-v12-qualified-steps-exact-approach-identities",
              "native-door-approach-original-source-bounds-v1",
            NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
            NATIVE_EXACT_GEOS_BINDING,
            nativeConnectorAnchors(data),
            ...(data.nativePhysicalLevels ? [data.nativePhysicalLevels] : []),
          ]
        : []),
      ...(data.nativeMaterialSections
        ? [
            "native-material-sections-v1",
            data.nativeMaterialSections,
            data.nativeIndoorEnvelopes
              ? nativeWallPositionMaterialBinding(
                  data.nativeWallPositionRepairs,
                )
              : data.nativeWallPositionRepairs,
          ]
        : []),
      ...(data.nativeDerivedFrameReturns
        ? ["native-derived-frame-returns-v1", data.nativeDerivedFrameReturns]
        : []),
      ...(data.nativeSourceStairMaterials?.authoredTreadRoles
        ? ["native-authored-stair-tread-roles-v1", data.nativeSourceStairMaterials.authoredTreadRoles]
        : []),
      ...(data.nativeIndoorEnvelopes && data.stairDisplay?.sourceFlights
        ? ["native-source-stair-mask-inventory-v1",data.stairDisplay.sourceModelSha256,data.stairDisplay.sourceFlights.map(f=>[f.stairElementId,f.treads])]
        : []),
      ...(data.nativeProvisionalCornerSeals
        ? [
            "native-provisional-corner-seals-v1",
            data.nativeProvisionalCornerSeals,
          ]
        : []),
      data.records.map((r) => [
        r.key,
        r.levelId,
        r.elevationFeet,
        r.circulation,
        r.stair,
        r.walkable,
        r.access,
        r.ringsFeet,
        r.properties.floorOpeningsFeet,
        ...(r.properties.nativeFloorOpeningOwnership !== undefined
          ? [r.properties.nativeFloorOpeningOwnership]
          : []),
        r.properties.spaceUse,
        r.properties.stairAccess,
      ]),
      data.walls,
      data.doors,
      data.walkingSupport,
      ...(data.nativeIndoorEnvelopes && data.doorAperturePatchState
        ? [data.doorAperturePatchState]
        : []),
    ],
    !!data.nativeIndoorEnvelopes,
  );
}
/** Native surfaces establish geometry. Source contours classify complete cells;
 * they never clip the exterior, dilate a boundary or close a wall gap. */
/** Independent planes retain the full unchanged source dataset as authority.
 * A plane draft is incomplete compiler work, never a publishable dataset. */
export function nativeCirculationElevations(data: IndoorDataset): number[] {
  const strictNative = !!data.nativeIndoorEnvelopes;
  return [...new Set([
    ...data.records.filter(r => strictNative ? r.walkable : isNativeCirculationOwner(r)).map(r => r.elevationFeet),
    ...(strictNative ? data.walkingSupport?.floors.map(f => f.elevationFeet) ?? [] : []),
  ])].sort((a, b) => a - b);
}

export function prepareNativeCirculationGeometry(model: ConvertResult, data: IndoorDataset) {
  return prepareNativeCirculationElevations(model, data, nativeCirculationElevations(data));
}

function prepareNativeCirculationElevations(
  model: ConvertResult,
  data: IndoorDataset,
  elevations: readonly number[],
) {
  const report = {
    accepted: 0,
    rejected: 0,
    exactOverlayFallbacks: 0,
    diagnostics: [] as string[],
  };
  const exactFaces: {id:string;parts:NativeRationalParts}[] = [];
  const displayResidualFaces: {id:string;parts:NativeRationalParts}[] = [];
  const cells: NonNullable<IndoorDataset["circulationGeometry"]>["cells"] = [];
  const reviewSurfaces: NonNullable<
    IndoorDataset["circulationGeometry"]
  >["reviewSurfaces"] = [];
  const fixtures: NonNullable<
    IndoorDataset["circulationGeometry"]
  >["fixtures"] = [];
  const envelopeIndex = createNativeIndoorEnvelopeIndex(
    data.nativeIndoorEnvelopes,
    data.source.modelSha256,
  );
  const materialIndex = createNativeRoutingMaterialQuery(data);
  const strictNative = !!data.nativeIndoorEnvelopes;
  // Strict source geometry never enters legacy BufferOp(0) repair or grid
  // retries. Preserve original operands; reject an unclassifiable overlay.
  const floorIntersection = (subject: Rings, parts: Rings[]) =>
    nativeFloorIntersection(subject, parts, { strict: strictNative });
  const floorDifference = (subject: Rings, parts: Rings[]) =>
    nativeFloorDifference(subject, parts, { strict: strictNative });
  const floorUnion = (parts: Rings[]) =>
    nativeFloorUnion(parts, { strict: strictNative });
  const topology = strictNative ? (rings: Rings) => rings : legacyTopology;
  const originalIds = new Set(model.elementBounds.map((r) => r.elementId));
  const anchors = strictNative
    ? nativeConnectorAnchors(data).filter((a) =>
        originalIds.has(a.nativeElementId),
      )
    : [];
  const recordsByKey = new Map(data.records.map((r) => [r.key, r]));
  const eligible = (r: IndoorRecord) =>
    strictNative ? r.walkable : isNativeCirculationOwner(r);
  const preparedRoomKeys = new Set<string>(
    strictNative ? data.records.map((r) => r.key) : [],
  );
  for (const z of elevations) {
    const owners = data.records.filter(
      (r) => Math.abs(r.elevationFeet - z) < 0.05 && eligible(r),
    );
    const region = nativeWalkingRegion(
      model,
      data,
      z,
      true,
      undefined,
      envelopeIndex,
      materialIndex,
    );
    report.diagnostics.push(...(region.diagnostics ?? []));
    if (!region.floors.length) continue;
    owners.forEach((r) => preparedRoomKeys.add(r.key));
    const levels = new Set([
      ...owners.map((r) => r.levelId),
      ...(strictNative
        ? data.nativeLevels
            .filter((l) => Math.abs(l.elevationFeet - z) < 0.05)
            .map((l) => l.id)
        : []),
    ]);
    const fixtureLevels = [...levels].filter((id) =>
      data.nativeLevels.some(
        (l) => l.id === id && Math.abs(l.elevationFeet - z) < 0.05,
      ),
    );
    for (const slab of nativeLowSlabRecords(model, z)) {
      // A supported upper-storey floor is overhead structure, not a furniture cap.
      // Several native planes can share one campus display floor.
      const parts = nativeFloorPolygons(slab, strictNative);
      const isOverheadFloor = strictNative
        ? routingFloorPlateRecords(model, slab.boundsFeet.max.z).some(
            (f) => f.elementId === slab.elementId,
          ) &&
          envelopeIndex
            .parts(slab.boundsFeet.max.z)
            .some((enclosure) =>
              parts.some(
                (part) => area(floorIntersection(part, [enclosure])) > 1,
              ),
            )
        : data.records
            .filter(
              (r) =>
                r.walkable &&
                Math.abs(r.elevationFeet - slab.boundsFeet.max.z) < 0.05,
            )
            .some((r) =>
              parts.some(
                (p) =>
                  area(
                    pc.intersection(
                      topology(p),
                      topology(r.ringsFeet),
                    ) as Rings[],
                  ) > 1,
              ),
            );
      if (isOverheadFloor) continue;
      for (const [part, rings] of nativeFloorPolygons(slab, strictNative).entries())
        if (
          fixtureLevels.length &&
          region.floors.some(
            (f) =>
              (region.exact
                ? nativeRationalScalarToIEEE(nativeRationalArea(nativeRationalOverlay("intersection",[rings],region.exact.floors)))
                : area(pc.intersection(topology(rings), topology(f)) as Rings[])) > 0.1,
          )
        )
          fixtures.push({
            id: `native-fixture:${z.toFixed(6)}:${slab.elementId}:${part}`,
            nativeElementId: slab.elementId,
            levelIds: fixtureLevels,
            elevationFeet: z,
            heightFeet: slab.boundsFeet.max.z - z,
            ringsFeet: topology(rings),
          });
    }
    const repairs = strictNative
      ? []
      : [...levels].flatMap((level) =>
          recoverNativeWallJunctionRepairs(
            nativeMaterialPlanWalls(data, level, undefined, 0.1),
            data.doors?.filter((d) => d.levelId === level) ?? [],
          ).map((r) => r.ringsFeet),
        );
    const protectedAreas = strictNative
      ? []
      : data.records
          .filter(
            (r) =>
              Math.abs(r.elevationFeet - z) < 0.05 &&
              !isNativeCirculationOwner(r),
          )
          .map((r) => r.ringsFeet);
    const thresholds = (data.doors ?? [])
      .filter((d) => levels.has(d.levelId) && d.footprintFeet)
      .map((d) => [d.footprintFeet!] as Rings);
    if (strictNative) {
      if (!region.exact) throw new Error("Missing original exact native walking authority.");
      const physicalFaces = nativeRationalOverlay("difference", region.exact.free, thresholds);
      const exactArea = nativeRationalMeasuredArea;
      for (const part of physicalFaces) {
        const faceId=`native-face:${z.toFixed(6)}:${exactFaces.length}`, face:NativeRationalParts=[part];
        // Every true positive source piece survives, even when too small,
        // restricted or unlabelled for a public route.
        exactFaces.push({id:faceId,parts:face});
        if (!nativeRationalFootprintSupported(face,region.exact.walkable)) {report.rejected++;continue;}
        const measured = owners.map(record=>{
          const identity=[nativeRoomIdentityRings(data,record)];
          const nearbyFace=nativeRationalIntersectionOperand(identity,face);
          return {record,overlap:nearbyFace.length?nativeRationalOverlay("intersection",identity,nearbyFace):[]};
        });
        const claims=measured.flatMap(m=>m.overlap);
        const coverage=claims.length?exactArea(nativeRationalOverlay("union",claims))/exactArea(face):0;
        let members=measured.filter(m=>{
          return nativeRationalAreaCompare(m.overlap,[])>0 &&
            (nativeRationalAreaCompare(m.overlap,nativeRationalOverlay("union",[nativeRoomIdentityRings(data,m.record)]),2n)>=0 || nativeRationalAreaCompare(m.overlap,face,2n)>=0);
        }).map(m=>m.record);
        const sourceAnchors=anchors.filter(a=>Math.abs(a.pointFeet[2]-z)<.05 && nativeRationalPointInParts(a.pointFeet,face) && routingFloorPlateRecords(model,z).some(f=>nativeRationalPointInParts(a.pointFeet,nativeRationalOverlay("union",nativeFloorPolygons(f,true)))));
        const usedAnchors=members.length?sourceAnchors.filter(a=>a.roomKey===''):sourceAnchors;
        if(usedAnchors.length&&!members.length) members=[...new Set(usedAnchors.map(a=>a.roomKey))].flatMap(k=>recordsByKey.has(k)?[recordsByKey.get(k)!]:[]);
        if(members.some(r=>!r.walkable||r.access==='staff') || (!members.length&&!usedAnchors.length)) {report.rejected++;continue;}
        const nativeFloorIds=routingFloorPlateRecords(model,z).filter(f=>nativeRationalOverlay("intersection",face,nativeFloorPolygons(f,true)).length>0).map(f=>f.elementId);
        // This nearest representation is ONLY a broad-phase/search proposal.
        // The exactFaceId above is the route/floor/clearance authority.
        const rings=part.map(r=>r.map(([x,y])=>[nativeRationalScalarToIEEE(x),nativeRationalScalarToIEEE(y)] as RoomPoint));
        const id=`native-cell:${z.toFixed(6)}:${cells.length}`;
        const drawing=prepareNativeContainedCellDisplay(id,face);
        if(drawing.residual)displayResidualFaces.push(drawing.residual);
        cells.push({id,exactFaceId:faceId,containedDisplay:drawing.display,
          levelIds:[...new Set([...members.map(r=>r.levelId),...usedAnchors.map(a=>a.levelId),...data.nativeLevels.filter(l=>Math.abs(l.elevationFeet-z)<.05).map(l=>l.id)])].sort((a,b)=>a-b),
          elevationFeet:z,roomKeys:members.map(r=>r.key).sort(),nativeFloorIds,
          ...(usedAnchors.length?{connectorAnchors:usedAnchors.map(({edgeId,nodeId,roomKey,nativeElementId})=>({edgeId,nodeId,roomKey,nativeElementId}))}:{}),
          ringsFeet:rings,sourceCoverage:coverage});
      }
      continue;
    }
    const wallBarriers = new Set(region.wallBarriers ?? []);
    const obstacles = [
      ...(strictNative
        ? (region.wallBarriers ?? [])
        : nativeBarrierTopology(region.wallBarriers ?? [])),
      ...region.barriers.filter((barrier) => !wallBarriers.has(barrier)),
      ...region.masks,
      ...repairs,
      ...thresholds,
      ...protectedAreas,
      ...indoorExclusionParts(data, z),
    ].map((r) => ({ rings: topology(r), box: bounds(r) }));
    const parts: Rings[] = [];
    for (const rawFloor of region.floors) {
      const floor = topology(rawFloor),
        box = bounds(floor);
      const nearby = obstacles
        .filter((o) => overlaps(box, o.box))
        .map((o) => o.rings);
      try {
        const local = nearby.flatMap((o) =>
          (pc.intersection(floor, o) as Rings[]).map(topology),
        );
        let free: Rings[] = [floor];
        for (let i = 0; i < local.length; i += 100)
          free = (
            pc.difference(free, ...local.slice(i, i + 100)) as Rings[]
          ).map(topology);
        parts.push(...free);
      } catch (error) {
        try {
          parts.push(...floorDifference(floor, nearby).map(topology));
          report.exactOverlayFallbacks++;
        } catch (fallback) {
          report.diagnostics.push(
            `Elevation ${z}: native slab topology rejected: ${String(error)}; independent exact overlay: ${String(fallback)}`,
          );
        }
      }
    }
    let free: Rings[] = [];
    try {
      free = parts.length
        ? (pc.union(parts[0]!, ...parts.slice(1)) as Rings[])
        : [];
    } catch (error) {
      try {
        free = floorUnion(parts).map(topology);
        report.exactOverlayFallbacks++;
      } catch (fallback) {
        report.diagnostics.push(
          `Elevation ${z}: native cell union rejected: ${String(error)}; independent exact overlay: ${String(fallback)}`,
        );
        continue;
      }
    }
    const ownerBoxes = owners.map((record) => ({
      record,
      box: bounds(nativeRoomIdentityRings(data, record)),
    }));
    const candidatesToClassify = free.map((rings) => ({
      rings,
      separated: false,
    }));
    for (const { rings, separated } of candidatesToClassify) {
      try {
        if (area([rings]) < 1) continue;
        const box = bounds(rings);
        const candidates = ownerBoxes.filter((r) => overlaps(box, r.box));
        const claims = candidates.flatMap(({ record }) =>
          floorIntersection(rings, [
            topology(nativeRoomIdentityRings(data, record)),
          ]),
        );
        const sourceAnchors = anchors.filter(
          (a) =>
            Math.abs(a.pointFeet[2] - z) < 0.05 &&
            nativePlanarPointInParts(a.pointFeet, [rings]) &&
            routingFloorPlateRecords(model, z).some((f) =>
              nativeFloorPolygons(f, strictNative).some((p) =>
                nativePlanarPointInParts(a.pointFeet, [p]),
              ),
            ),
        );
        if (!claims.length && !sourceAnchors.length) {
          report.rejected++;
          continue;
        }
        const owned = claims.length ? floorUnion(claims) : [],
          coverage = area(owned as Rings[]) / area([rings]);
        // An incomplete enclosure must not claim a whole slab or unlabelled wing.
        // Coverage is classification evidence, never a boundary-generating grid.
        let members = candidates
          .filter(
            ({ record }) =>
              area(
                floorIntersection(rings, [
                  topology(nativeRoomIdentityRings(data, record)),
                ]),
              ) > 0.25 &&
              (!strictNative ||
                (() => {
                  const overlap = area(
                    floorIntersection(rings, [
                      topology(nativeRoomIdentityRings(data, record)),
                    ]),
                  );
                  return (
                    overlap / area([nativeRoomIdentityRings(data, record)]) >=
                      0.5 || overlap / area([rings]) >= 0.5
                  );
                })()),
          )
          .map((r) => r.record);
        const usedAnchors = members.length
          ? sourceAnchors.filter((a) => a.roomKey === "")
          : sourceAnchors;
        if (usedAnchors.length && !members.length)
          members = [...new Set(usedAnchors.map((a) => a.roomKey))].flatMap(
            (key) => (recordsByKey.has(key) ? [recordsByKey.get(key)!] : []),
          );
        if (coverage < 0.65 && !strictNative) {
          if (!separated) {
            const separatedCells = clearanceSeparatedNativeCells(rings);
            candidatesToClassify.push(
              ...separatedCells.map((rings) => ({ rings, separated: true })),
            );
          } else {
            // Preserve only physically supported source claims in unresolved
            // components. One accepted fragment must not erase their identities
            // or restore the entire old contour across obstacles and fixtures.
            for (const { record } of candidates)
              for (const part of pc.intersection(
                rings,
                topology(nativeRoomIdentityRings(data, record)),
              ) as Rings[])
                if (area([part]) > 1)
                  reviewSurfaces.push({
                    roomKey: record.key,
                    levelId: record.levelId,
                    elevationFeet: z,
                    ringsFeet: part,
                  });
          }
          report.rejected++;
          report.diagnostics.push(
            `Elevation ${z}: unclassified native cell (${(coverage * 100).toFixed(1)}% circulation claim; ${area([rings]).toFixed(2)} sq ft); owners ${members.map((r) => r.key).join(",")}.`,
          );
          continue;
        }
        if (
          strictNative &&
          members.some((r) => r.access === "staff" || !r.walkable)
        ) {
          report.rejected++;
          report.diagnostics.push(
            `Elevation ${z}: shared native face has restricted/unsupported ownership; no public route generated.`,
          );
          continue;
        }
        if (!members.length && !usedAnchors.length) {
          report.rejected++;
          continue;
        }
        const nativeFloorIds = routingFloorPlateRecords(model, z)
          .filter(
            (r) =>
              area(
                floorIntersection(
                  rings,
                  nativeFloorPolygons(r, strictNative).map(topology),
                ),
              ) > 0.002,
          )
          .map((r) => r.elementId);
        cells.push({
          id: `native-cell:${z.toFixed(6)}:${cells.length}`,
          levelIds: [
            ...new Set([
              ...members.map((r) => r.levelId),
              ...usedAnchors.map((a) => a.levelId),
              ...(strictNative
                ? data.nativeLevels
                    .filter((l) => Math.abs(l.elevationFeet - z) < 0.05)
                    .map((l) => l.id)
                : []),
            ]),
          ].sort((a, b) => a - b),
          elevationFeet: z,
          roomKeys: members.map((r) => r.key).sort(),
          nativeFloorIds,
          ...(usedAnchors.length
            ? {
                connectorAnchors: usedAnchors.map(
                  ({ edgeId, nodeId, roomKey, nativeElementId }) => ({
                    edgeId,
                    nodeId,
                    roomKey,
                    nativeElementId,
                  }),
                ),
              }
            : {}),
          ringsFeet: rings,
          sourceCoverage: coverage,
        });
      } catch (error) {
        report.rejected++;
        report.diagnostics.push(
          `Elevation ${z}: cell classification rejected: ${String(error)}`,
        );
      }
    }
  }
  report.accepted = cells.length;
  return {
    geometry: {
      version: 1 as const,
      sourceModelSha256: data.source.modelSha256,
      sourceGeometryKey: nativeCirculationGeometryKey(data),
      ...(strictNative?{
        exactTopology:encodeNativeExactTopology({sourceModelSha256:data.source.modelSha256,sourceGeometryKey:nativeCirculationGeometryKey(data),kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION},exactFaces),
        ...(displayResidualFaces.length?{displayResidualTopology:encodeNativeExactTopology({sourceModelSha256:data.source.modelSha256,sourceGeometryKey:nativeCirculationGeometryKey(data),kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION},displayResidualFaces)}:{}),
      }:{}),
      preparedRoomKeys: [...preparedRoomKeys].sort(),
      reviewSurfaces,
      fixtures,
      cells,
    },
    report,
  };
}

export type NativeCirculationPlaneDraft = {
  kind: "native-circulation-plane-draft";
  version: 1;
  elevationFeet: number;
  resultBinding: string;
  result: ReturnType<typeof prepareNativeCirculationGeometry>;
};

/** Pure physical work for one original plane; no route/arrival edits occur. */
export function prepareNativeCirculationPlaneDraft(model: ConvertResult, data: IndoorDataset, elevationFeet: number): NativeCirculationPlaneDraft {
  if (!data.nativeIndoorEnvelopes || !Number.isFinite(elevationFeet) || !nativeCirculationElevations(data).includes(elevationFeet))
    throw Error("A native plane draft requires a current original physical plane.");
  const result=prepareNativeCirculationElevations(model,data,[elevationFeet]);
  return {kind:"native-circulation-plane-draft",version:1,elevationFeet,resultBinding:nativeCirculationBinding([elevationFeet,result],true),result};
}

/** Merge only the complete current plane inventory, in original elevation
 * order. Local worker IDs and rational carriers are rebuilt in that order so
 * completion order cannot change published IDs, coordinates or diagnostics. */
export function mergeNativeCirculationPlaneDrafts(data: IndoorDataset, drafts: readonly NativeCirculationPlaneDraft[]): ReturnType<typeof prepareNativeCirculationGeometry> {
  if (!data.nativeIndoorEnvelopes) throw Error("Parallel plane merging requires native geometry.");
  const elevations=nativeCirculationElevations(data), key=nativeCirculationGeometryKey(data);
  if(drafts.length!==elevations.length || new Set(drafts.map(d=>d.elevationFeet)).size!==drafts.length)
    throw Error("Native plane drafts are missing or duplicated.");
  const ordered=elevations.map(z=>{
    const draft=drafts.find(d=>d.elevationFeet===z);
    if(!draft||draft.kind!=="native-circulation-plane-draft"||draft.version!==1)throw Error("Invalid native plane draft inventory.");
    return draft;
  });
  const exactFaces:{id:string;parts:NativeRationalParts}[]=[], residualFaces:{id:string;parts:NativeRationalParts}[]=[];
  const cells:NonNullable<IndoorDataset["circulationGeometry"]>["cells"]=[],fixtures:NonNullable<IndoorDataset["circulationGeometry"]>["fixtures"]=[],reviewSurfaces:NonNullable<IndoorDataset["circulationGeometry"]>["reviewSurfaces"]=[];
  const report={accepted:0,rejected:0,exactOverlayFallbacks:0,diagnostics:[] as string[]};
  const binding={sourceModelSha256:data.source.modelSha256,sourceGeometryKey:key,kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION};
  const preparedRoomKeys=[...new Set(data.records.map(r=>r.key))].sort(),sourceAnchors=nativeConnectorAnchors(data);
  for(const draft of ordered){
    const {geometry:g,report:r}=draft.result,z=draft.elevationFeet;
    // This detects damaged checkpoint classifications/diagnostics as well as
    // geometry. It is integrity only; the runner independently binds the
    // actual source files and worker algorithm that computed the draft.
    if(draft.resultBinding!==nativeCirculationBinding([z,draft.result],true))throw Error("Native plane draft result changed.");
    if(g.version!==1||g.sourceModelSha256!==binding.sourceModelSha256||g.sourceGeometryKey!==key||!g.exactTopology||JSON.stringify(g.preparedRoomKeys)!==JSON.stringify(preparedRoomKeys)||r.accepted!==g.cells.length||g.cells.some(c=>c.elevationFeet!==z)||g.fixtures.some(f=>f.elevationFeet!==z)||g.reviewSurfaces.some(s=>s.elevationFeet!==z))
      throw Error("Native plane draft does not match the complete current source binding.");
    const index=createNativeExactTopologyIndex(g.exactTopology,binding),residual=g.displayResidualTopology?createNativeExactTopologyIndex(g.displayResidualTopology,binding):undefined;
    const faceIds=new Map<string,string>();
    for(const [i,oldId]of index.ids().entries()){
      if(oldId!==`native-face:${z.toFixed(6)}:${i}`)throw Error("Native plane face order changed.");
      const id=`native-face:${z.toFixed(6)}:${exactFaces.length}`;
      faceIds.set(oldId,id);exactFaces.push({id,parts:index.parts(oldId)!});
    }
    const usedResiduals=new Set<string>();
    for(const [i,cell]of g.cells.entries()){
      const expected=`native-cell:${z.toFixed(6)}:${i}`,exactFaceId=cell.exactFaceId&&faceIds.get(cell.exactFaceId);
      if(cell.id!==expected||!exactFaceId||!cell.containedDisplay)throw Error("Native plane cell identity changed.");
      const source=index.parts(cell.exactFaceId!)!;
      const cellAnchors=(cell.connectorAnchors??[]).map(a=>sourceAnchors.find(s=>s.edgeId===a.edgeId&&s.nodeId===a.nodeId&&s.roomKey===a.roomKey&&s.nativeElementId===a.nativeElementId&&Math.abs(s.pointFeet[2]-z)<.05&&nativeRationalPointInParts(s.pointFeet,source)));
      if(cellAnchors.some(a=>!a)||cell.roomKeys.some(k=>!data.records.some(r=>r.key===k&&r.walkable&&r.access!=="staff"&&(Math.abs(r.elevationFeet-z)<.05||cellAnchors.some(a=>a?.roomKey===k)))))
        throw Error("Native plane draft has an unknown, restricted or unsupported source owner.");
      validateNativeContainedCellDisplay(cell.containedDisplay,source,residual);
      const id=`native-cell:${z.toFixed(6)}:${cells.length}`,display=structuredClone(cell.containedDisplay),oldResidual=display.exactResidualFaceId;
      if(oldResidual){
        if(oldResidual!==`${expected}:render-residual`||usedResiduals.has(oldResidual)||!residual?.parts(oldResidual))throw Error("Native plane residual identity changed.");
        usedResiduals.add(oldResidual);display.exactResidualFaceId=`${id}:render-residual`;
        residualFaces.push({id:display.exactResidualFaceId,parts:residual.parts(oldResidual)!});
      }
      cells.push({...cell,id,exactFaceId,containedDisplay:display});
    }
    if((residual?.ids().length??0)!==usedResiduals.size)throw Error("Native plane has unowned positive residuals.");
    fixtures.push(...g.fixtures);reviewSurfaces.push(...g.reviewSurfaces);
    report.rejected+=r.rejected;report.exactOverlayFallbacks+=r.exactOverlayFallbacks;report.diagnostics.push(...r.diagnostics);
  }
  report.accepted=cells.length;
  return {geometry:{version:1,sourceModelSha256:binding.sourceModelSha256,sourceGeometryKey:key,exactTopology:encodeNativeExactTopology(binding,exactFaces),...(residualFaces.length?{displayResidualTopology:encodeNativeExactTopology(binding,residualFaces)}:{}),preparedRoomKeys,reviewSurfaces,fixtures,cells},report};
}

/** Extend route support only into the owned half of its enabled physical
 * doorway. Exact slab/column/opening proof remains required and the opposite
 * side still needs the original door portal. The saved cell stays unchanged. */
type IndexedApproachPart = {
  rings: Rings;
  exactParts?:NativeRationalParts;
  box: ReturnType<typeof bounds>;
  nativeId?: number;
  column?: boolean;
  repair?: boolean;
};
type DoorApproachContext = {
  floorBlockedDoors: Set<string>;
  edges: Map<string, IndoorDataset["edges"][number]>;
  nodes: Map<string, IndoorDataset["nodes"][number]>;
  records: Map<string, IndoorRecord>;
  doors: Map<string, NonNullable<IndoorDataset["doors"]>>;
  envelopes: NativeIndoorEnvelopeIndex;
  materials: ReturnType<typeof createNativeRoutingMaterialQuery>;
  boundaries: ReturnType<typeof createNativeBoundaryMaterialQuery>;
  exactBoundaries: ReturnType<typeof createNativeExactBoundaryMaterialQuery>;
  exactIndex?: ReturnType<typeof createNativeExactTopologyIndex>;
  exactApproaches:Map<Rings,NativeRationalParts>;
  levels: Map<
    string,
    {
      floors: IndexedApproachPart[];
      envelopes: IndexedApproachPart[];
      masks: IndexedApproachPart[];
      ownsAperture: ReturnType<typeof createNativeHostApertureQuery>;
    }
  >;
};
/** A connected, enabled physical portal side may terminate the exact native
 * cell that physically contains its ORIGINAL point even when majority
 * metadata association placed its owner in no cell (or another cell). The
 * portal keeps its identity and coordinates; the owner must be a walkable,
 * non-staff record on this elevation; its own door edge must be an enabled
 * connected two-owner physical door. Ownership is never inferred from
 * proximity: containment is tested against the cell's pure exact face, before
 * any threshold-half extension. Generic: no venue identifiers. */
const foreignPortalDoors = new WeakMap<
  DoorApproachContext,
  Map<string, { edge: IndoorDataset["edges"][number]; door: NonNullable<IndoorDataset["doors"]>[number] }>
>();
function nativeForeignPortalTerminal(
  data: IndoorDataset,
  context: DoorApproachContext,
  cell: NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number],
  node: IndoorDataset["nodes"][number] | undefined,
): boolean {
  if (!data.nativeIndoorEnvelopes || !node || node.kind !== "portal") return false;
  if (cell.roomKeys.includes(node.roomKey)) return false;
  if (Math.abs(node.pointFeet[2] - cell.elevationFeet) > 0.05) return false;
  const owner = context.records.get(node.roomKey);
  if (!owner || !owner.walkable || owner.access === "staff" || Math.abs(owner.elevationFeet - cell.elevationFeet) > 0.05) return false;
  // Cheap broad phase on the cell's IEEE rings (padded for a threshold half)
  // before any exact predicate; the exact tests below remain authoritative.
  const x = node.pointFeet[0]!, y = node.pointFeet[1]!;
  const ring = cell.ringsFeet[0] ?? [];
  if (!ring.length || x < Math.min(...ring.map((p) => p[0])) - 2 || x > Math.max(...ring.map((p) => p[0])) + 2 ||
      y < Math.min(...ring.map((p) => p[1])) - 2 || y > Math.max(...ring.map((p) => p[1])) + 2) return false;
  const pure = cell.exactFaceId ? context.exactIndex?.parts(cell.exactFaceId) : undefined;
  if (!pure) return false;
  let portals = foreignPortalDoors.get(context);
  if (!portals) {
    portals = new Map();
    const doors = new Map((data.doors ?? []).map((d) => [d.id, d]));
    for (const e of context.edges.values()) {
      if (e.kind !== "door" || !e.enabled) continue;
      const d = doors.get(e.id);
      if (d && d.nativeElementId === e.nativeElementId)
        for (const id of [e.from, e.to]) portals.set(id, { edge: e, door: d });
    }
    foreignPortalDoors.set(context, portals);
  }
  const found = portals.get(node.id), own = found?.edge, door = found?.door;
  if (!own || !door || door.state !== "connected" || !door.hostWallNativeElementId ||
      own.roomKeys.length !== 2 || !door.roomKeys.includes(node.roomKey) ||
      own.roomKeys.some((k) => !door.roomKeys.includes(k)) || context.floorBlockedDoors.has(door.id)) return false;
  if (nativeRationalPointInParts(node.pointFeet, pure)) return true;
  // A portal point normally lies on its own threshold half, outside the face
  // that excludes the doorway footprint. Candidacy then requires that exact
  // own half to join the pure face as ONE part containing the original point;
  // the guarded floor/envelope/mask extension below remains the authority.
  const footprint = nativeDoorClearOpening(data, door, cell.elevationFeet) ?? door.footprintFeet;
  if (!footprint || !door.normalFeet) return false;
  try {
    const joined = nativeRationalOverlay("union", pure, nativeRationalThresholdHalf(footprint, door.normalFeet, node.pointFeet));
    return joined.length === 1 && nativeRationalPointInParts(node.pointFeet, joined);
  } catch {
    return false;
  }
}
function nativeDoorLevelParts(
  data: IndoorDataset,
  context: DoorApproachContext,
  cell: NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number],
) {
  const key = JSON.stringify([cell.elevationFeet, cell.levelIds]);
  let level = context.levels.get(key);
  if (level) return level;
  const indexed = (rings: Rings): IndexedApproachPart => ({
    rings,
    box: bounds(rings),
  });
  const material = context.materials(cell.elevationFeet);
  level = {
    ownsAperture: createNativeHostApertureQuery(material),
    floors:
      data.walkingSupport?.sourceModelSha256 === data.source.modelSha256
        ? data.walkingSupport.floors
            .filter(
              (f) => Math.abs(f.elevationFeet - cell.elevationFeet) < 0.05,
            )
            .flatMap((f) => f.partsFeet ?? [f.ringsFeet])
            .map(indexed)
        : [],
    envelopes: context.envelopes.parts(cell.elevationFeet).map(indexed),
    masks: [
      ...(material.derivedParts ?? []).map(indexed),
      ...material.parts.map((p) => ({
        ...indexed(p.rings),
        nativeId: p.nativeElementId,
        column: p.column,
      })),
      ...data.walls
        .filter(
          (w) =>
            cell.levelIds.includes(w.levelId) &&
            (!material.known.has(w.nativeElementId) ||
              (w.reviewPatchId && material.present.has(w.nativeElementId))),
        )
        .flatMap((w) =>
          context.exactBoundaries(w).map(part=>({ ...indexed(nativeExactPartsForProposals([part])[0]),exactParts:[part],nativeId:w.nativeElementId,column:w.kind==="column",repair:!!w.reviewPatchId })),
        ),
      ...(data.circulationGeometry?.fixtures ?? [])
        .filter((f) => Math.abs(f.elevationFeet - cell.elevationFeet) < 0.05)
        .map((f) => indexed(f.ringsFeet)),
      ...indoorExclusionParts(data, cell.elevationFeet).map(indexed),
      ...(data.nativeIndoorEnvelopes ? [] : data.records)
        .filter((r) => Math.abs(r.elevationFeet - cell.elevationFeet) < 0.05)
        .flatMap((r) =>
          (
            (r.properties.floorOpeningsFeet as RoomPoint[][] | undefined) ?? []
          ).map((h) => indexed([h])),
        ),
    ],
  };
  context.levels.set(key, level);
  return level;
}
function nativeCellDoorApproach(
  data: IndoorDataset,
  context: DoorApproachContext,
  cell: NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number],
  permittedNodeIds?: Set<string>,
): Rings {
  if (!data.nativeIndoorEnvelopes) return cell.ringsFeet;
  let rings = cell.ringsFeet;
  let exactParts = cell.exactFaceId ? context.exactIndex?.parts(cell.exactFaceId) : undefined;
  if(!exactParts) throw new Error("Missing exact native cell authority.");
  context.exactApproaches.set(rings,exactParts);
  const level = nativeDoorLevelParts(data, context, cell);
  const candidateDoors = new Set(
    cell.roomKeys.flatMap((k) => context.doors.get(k) ?? []),
  );
  for (const door of data.doors ?? []) {
    if (candidateDoors.has(door)) continue;
    const edge = context.edges.get(door.id);
    if (edge && [edge.from, edge.to].some((id) => nativeForeignPortalTerminal(data, context, cell, context.nodes.get(id))))
      candidateDoors.add(door);
  }
  for (const door of candidateDoors) {
    const edge = context.edges.get(door.id),
      footprint =
        nativeDoorClearOpening(data, door, cell.elevationFeet) ??
        door.footprintFeet,
      normal = door.normalFeet;
    if (
      !edge ||
      context.floorBlockedDoors.has(door.id) ||
      edge.kind !== "door" ||
      !edge.enabled ||
      edge.nativeElementId !== door.nativeElementId ||
      door.state !== "connected" ||
      !door.hostWallNativeElementId ||
      !footprint ||
      !normal ||
      edge.roomKeys.length !== 2 ||
      edge.roomKeys.some((k) => !door.roomKeys.includes(k))
    )
      continue;
    const pair = [context.nodes.get(edge.from), context.nodes.get(edge.to)];
    if (
      door.roomKeys.some((key) => {
        const owner = context.records.get(key);
        return (
          !owner || Math.abs(owner.elevationFeet - cell.elevationFeet) > 0.05
        );
      }) ||
      pair.some(
        (n) =>
          !n ||
          Math.abs(n.pointFeet[2] - cell.elevationFeet) > 0.05 ||
          !door.roomKeys.includes(n.roomKey),
      )
    )
      continue;
    const center = footprint.reduce(
        (c, p) =>
          [
            c[0] + p[0] / footprint.length,
            c[1] + p[1] / footprint.length,
          ] as RoomPoint,
        [0, 0] as RoomPoint,
      ),
      side = (p: number[]) =>
        (p[0]! - center[0]) * normal[0] + (p[1]! - center[1]) * normal[1];
    if (side(pair[0]!.pointFeet) * side(pair[1]!.pointFeet) >= -1e-10) continue;
    for (const node of pair) {
      if (permittedNodeIds && !permittedNodeIds.has(node!.id)) continue;
      const owner = context.records.get(node!.roomKey);
      if (
        (!cell.roomKeys.includes(node!.roomKey) &&
          !nativeForeignPortalTerminal(data, context, cell, node)) ||
        !owner ||
        !owner.walkable ||
        owner.access === "staff"
      )
        continue;
      const sign = Math.sign(side(node!.pointFeet)),
        half: RoomPoint[] = [];
      for (let i = 0; i < footprint.length; i++) {
        const a = footprint[i]!,
          b = footprint[(i + 1) % footprint.length]!,
          sa = side(a) * sign,
          sb = side(b) * sign;
        if (sa >= 0) half.push(a);
        if (sa >= 0 !== sb >= 0) {
          const t = sa / (sa - sb);
          half.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      if (half.length < 3) continue;
      const box = bounds([footprint]),
        near = (part: IndexedApproachPart) => overlaps(box, part.box);
      const floors = level.floors.filter(near).map((p) => p.rings),
        envelope = level.envelopes.filter(near).map((p) => p.rings);
      if (!floors.length || !envelope.length) continue;
      const masks = level.masks
        .filter(
          (p) =>
            (p.column ||
              p.repair ||
              p.nativeId === undefined ||
              !level.ownsAperture(
                door.hostWallNativeElementId,
                door.nativeElementId,
                p.nativeId,
              )) &&
            near(p),
        )
        .flatMap((p) => p.exactParts??nativeRationalOverlay("union",[p.rings]));
      try {
        let parts=nativeRationalOverlay("intersection",nativeRationalThresholdHalf(footprint,normal,node!.pointFeet),floors);
        parts=nativeRationalOverlay("intersection",parts,envelope);
        if(masks.length)parts=nativeRationalOverlay("difference",parts,masks);
        for(const part of parts){
          const joined=nativeRationalOverlay("union",exactParts,[part]);
          if(joined.length===1&&nativeRationalPointInParts(node!.pointFeet,joined)){
            exactParts=freezeNativeRationalParts(joined);rings=nativeExactPartsForProposals(joined)[0];context.exactApproaches.set(rings,exactParts);
          }
        }
      } catch { /* Unknown exact doorway support remains blocked. */ }
    }
  }
  return rings;
}

/** Rebuild walk branches inside each physical cell, keeping all existing fixed
 * door/connector node coordinates. Closed thresholds stay separate graph edges. */
export function attachNativeCirculationCellRoutes(data: IndoorDataset): number {
  // A regeneration replaces its earlier derived branches; it must never revive
  // an old polyline because a rebuilt cell happens to reuse the same ID.
  const removed = data.edges.some(
    (edge) =>
      !!edge.nativeCellId ||
      (!!data.nativeIndoorEnvelopes && edge.kind === "walk"),
  );
  for (let i = data.edges.length - 1; i >= 0; i--)
    if (
      data.edges[i]!.nativeCellId ||
      (data.nativeIndoorEnvelopes && data.edges[i]!.kind === "walk")
    )
      data.edges.splice(i, 1);
  if(data.nativeIndoorEnvelopes && (!data.circulationGeometry?.exactTopology || data.circulationGeometry.sourceModelSha256!==data.source.modelSha256 || data.circulationGeometry.sourceGeometryKey!==nativeCirculationGeometryKey(data))) return 0;
  const context: DoorApproachContext = {
    floorBlockedDoors: nativeDoorFloorBlockers(data),
    edges: new Map(data.edges.map((e) => [e.id, e])),
    nodes: new Map(data.nodes.map((n) => [n.id, n])),
    records: new Map(data.records.map((r) => [r.key, r])),
    doors: new Map(),
    envelopes: createNativeIndoorEnvelopeIndex(
      data.nativeIndoorEnvelopes,
      data.source.modelSha256,
    ),
    materials: createNativeRoutingMaterialQuery(data),
    boundaries: createNativeBoundaryMaterialQuery(data),
    exactBoundaries:createNativeExactBoundaryMaterialQuery(data),
    levels: new Map(),
    exactApproaches:new Map(),
    ...(data.nativeIndoorEnvelopes?{exactIndex:createNativeExactTopologyIndex(data.circulationGeometry!.exactTopology!,{sourceModelSha256:data.source.modelSha256,sourceGeometryKey:nativeCirculationGeometryKey(data),kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION})}:{}),
  };
  for (const door of data.doors ?? [])
    for (const key of door.roomKeys)
      context.doors.set(key, [...(context.doors.get(key) ?? []), door]);
  const physicalDoorPairs = new Set(
    data.edges
      .filter((e) => e.kind === "door" && e.enabled)
      .map((e) => [e.from, e.to].sort().join("|")),
  );
  let added = 0;
  for (const cell of data.circulationGeometry?.cells ?? []) {
    const routeRings = nativeCellDoorApproach(data, context, cell);
    const selected = data.nodes.filter(
      (n) =>
        (cell.roomKeys.includes(n.roomKey) ||
          cell.connectorAnchors?.some((a) => a.nodeId === n.id) ||
          nativeForeignPortalTerminal(data, context, cell, n)) &&
        Math.abs(n.pointFeet[2] - cell.elevationFeet) < 0.05 &&
        n.kind !== "junction" &&
        (data.nativeIndoorEnvelopes
          ? nativeRationalPointInParts(n.pointFeet,context.exactApproaches.get(routeRings)!)
          : contains([n.pointFeet[0], n.pointFeet[1]], routeRings)),
    );
    if (selected.length < 2) continue;
    // Coincident arrival/native cap IDs are aliases, not a geometric strip.
    // Their point must belong to this exact physical cell; no old trace is
    // reconstructed and no neighbouring doorway half can supply the alias.
    if (data.nativeIndoorEnvelopes)
      for (let i = 0; i < selected.length; i++)
        for (let j = i + 1; j < selected.length; j++) {
          const a = selected[i]!,
            b = selected[j]!;
          if (
            a.roomKey !== b.roomKey ||
            a.levelId !== b.levelId ||
            Math.hypot(...a.pointFeet.map((v, k) => v - b.pointFeet[k]!)) >
              1e-8 ||
            !nativeRationalPathSupported([a.pointFeet,b.pointFeet],context.exactIndex!.parts(cell.exactFaceId!)!)
          )
            continue;
          const id = `${cell.id}:alias:${[a.id, b.id].sort().join("|")}`;
          if (data.edges.some((e) => e.id === id)) continue;
          data.edges.push({
            id,
            nativeCellId: cell.id,
            from: a.id,
            to: b.id,
            kind: "walk",
            roomKeys: a.roomKey ? [a.roomKey] : [],
            pointsFeet: [a.pointFeet, b.pointFeet],
            lengthMetres: 0,
            enabled: true,
            accessible: "unknown",
            evidence:
              "Coincident source arrival and native connector identity on the same checked physical native cell; no walking segment or geometry movement.",
          });
          added++;
        }
    const scope: DirectoryRoom[] = [
      {
        key: cell.id,
        levelId: cell.levelIds[0]!,
        polygonFeet: routeRings[0]!,
        holesFeet: routeRings.slice(1),
        labelPointFeet: [0, 0],
        confidence: 1,
      },
    ];
    const blocked = indoorRegionBlocker(scope, [], []);
    const grid = buildIndoorGrid(
      scope,
      [],
      selected.map((n) => ({
        id: n.id,
        roomKey: cell.id,
        point: [n.pointFeet[0], n.pointFeet[1]],
        maxSnapFeet: 1.2,
      })),
      { walls: [], columns: [] },
      [],
      0.6,
    );
    const positions = new Map(
      selected.map((n) => [
        n.id,
        [n.pointFeet[0], n.pointFeet[1]] as RoomPoint,
      ]),
    );
    for (const branch of grid.branches) {
      if (
        data.nativeIndoorEnvelopes &&
        physicalDoorPairs.has([branch.from, branch.to].sort().join("|"))
      )
        continue;
      const fromNode = selected.find((n) => n.id === branch.from)!,
        toNode = selected.find((n) => n.id === branch.to)!;
      if (
        data.nativeIndoorEnvelopes &&
        Math.hypot(
          ...fromNode.pointFeet.map((v, k) => v - toNode.pointFeet[k]!),
        ) < 1e-8
      )
        continue;
      // Existing explicit campus/split-level transitions retain their identities.
      if (
        fromNode.levelId !== toNode.levelId ||
        fromNode.surfaceId !== toNode.surfaceId
      ) {
        const a: RoomPoint = [fromNode.pointFeet[0], fromNode.pointFeet[1]],
          b: RoomPoint = [toNode.pointFeet[0], toNode.pointFeet[1]];
        const sharedNativeSlab =
          !!data.nativeIndoorEnvelopes &&
          data.walkingSupport?.sourceModelSha256 === data.source.modelSha256 &&
          data.walkingSupport.floors.some(
            (f) =>
              cell.nativeFloorIds.includes(f.nativeElementId) &&
              Math.abs(f.elevationFeet - cell.elevationFeet) < 0.05 &&
              nativeRationalPointInParts(a,nativeRationalOverlay("union",f.partsFeet??[f.ringsFeet])) &&
              nativeRationalPointInParts(b,nativeRationalOverlay("union",f.partsFeet??[f.ringsFeet])) &&
              data.nativeIndoorEnvelopes!.levels.some(
                (scope) =>
                  Math.abs(scope.elevationFeet - cell.elevationFeet) < 0.05 &&
                  scope.sourceElementIds.includes(f.nativeElementId) &&
                  scope.partsFeet.some(
                    (part) =>
                      nativeRationalPointInParts(a,nativeRationalOverlay("union",[part])) &&
                      nativeRationalPointInParts(b,nativeRationalOverlay("union",[part])),
                  ),
              ),
          );
        if (!sharedNativeSlab) continue;
      }
      const a = positions.get(branch.from),
        b = positions.get(branch.to);
      if (!a || !b) continue;
      let points = [a, ...branch.points, b].filter(
        (p, i, ps) =>
          !i || Math.hypot(p[0] - ps[i - 1]![0], p[1] - ps[i - 1]![1]) > 1e-8,
      );
      if (data.nativeIndoorEnvelopes) {
        // Only this branch's own terminal halves may extend its physical face.
        // A grid shortcut through an unrelated door must be replanned rather
        // than borrowing that doorway's checked material exemption.
        const ownRings = nativeCellDoorApproach(
          data,
          context,
          cell,
          new Set([branch.from, branch.to]),
        );
        if (!nativeRationalPathSupported(points,context.exactApproaches.get(ownRings)!)) {
          const ownScope: DirectoryRoom[] = [
            {
              ...scope[0]!,
              polygonFeet: ownRings[0]!,
              holesFeet: ownRings.slice(1),
            },
          ];
          const rebuilt = buildIndoorGrid(
            ownScope,
            [],
            [fromNode, toNode].map((n) => ({
              id: n.id,
              roomKey: cell.id,
              point: [n.pointFeet[0], n.pointFeet[1]] as RoomPoint,
              maxSnapFeet: 1.2,
            })),
            { walls: [], columns: [] },
            [],
            0.6,
          ).branches[0];
          if (!rebuilt) continue;
          const start = positions.get(rebuilt.from)!,
            end = positions.get(rebuilt.to)!;
          const rebuiltPoints = [start, ...rebuilt.points, end];
          if (!nativeRationalPathSupported(rebuiltPoints,context.exactApproaches.get(ownRings)!)) continue;
          points =
            rebuilt.from === branch.from
              ? rebuiltPoints
              : rebuiltPoints.toReversed();
        }
      }
      if (
        points.length < 2 ||
        points.slice(1).some((p, i) => blocked(points[i]!, p))
      )
        continue;
      const id = `${cell.id}:walk:${[branch.from, branch.to].sort().join("|")}`;
      if (data.edges.some((e) => e.id === id)) continue;
      data.edges.push({
        id,
        nativeCellId: cell.id,
        from: branch.from,
        to: branch.to,
        kind: "walk",
        // Whole-cell owners always remain; an admitted foreign portal adds its
        // own owner so that owner's access rules also apply to the branch.
        roomKeys: [...new Set([
          ...cell.roomKeys,
          ...[fromNode, toNode]
            .filter((n) => !cell.roomKeys.includes(n.roomKey) && nativeForeignPortalTerminal(data, context, cell, n))
            .map((n) => n.roomKey),
        ])].sort(),
        pointsFeet: points.map((p) => [p[0], p[1], cell.elevationFeet]),
        lengthMetres: points
          .slice(1)
          .reduce(
            (s, p, i) =>
              s +
              Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]) *
                data.alignment.horizontalMetresPerFoot,
            0,
          ),
        enabled: true,
        accessible: "unknown",
        evidence: `Native floor-bound circulation cell ${cell.id}; slab profiles ${cell.nativeFloorIds.join(",")}; walls, columns, all native doors, holes and low stair projections excluded; fixed connector coordinates preserved; body clearance/accessibility remain unverified.`,
      });
      added++;
    }
  }
  if (added || removed) {
    const adjacency = new Map<string, string[]>();
    for (const edge of data.edges.filter((e) => e.enabled))
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ])
        adjacency.set(a!, [...(adjacency.get(a!) ?? []), b!]);
    const seen = new Set<string>(),
      arrivalIds = new Set(
        data.records.flatMap((r) => (r.arrivalNodeId ? [r.arrivalNodeId] : [])),
      ),
      components: number[] = [];
    for (const node of data.nodes) {
      if (seen.has(node.id)) continue;
      const queue = [node.id];
      seen.add(node.id);
      let count = 0;
      for (let i = 0; i < queue.length; i++) {
        if (arrivalIds.has(queue[i]!)) count++;
        for (const next of adjacency.get(queue[i]!) ?? [])
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
      }
      components.push(count);
    }
    data.report.components = components.length;
    data.report.largestComponentArrivals = Math.max(0, ...components);
  }
  return added;
}
