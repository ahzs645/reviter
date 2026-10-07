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
// A 0.3 micrometre coordinate grid dissolves floating-point copies of the
// same native face. It is numerical topology precision, not a passage repair.
const topology = (rings: Rings): Rings =>
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
  return JSON.stringify([
    data.source.modelSha256,
    NATIVE_BARRIER_TOPOLOGY_VERSION,
    ...(data.nativeIndoorEnvelopes
      ? ["native-indoor-envelope-v1", data.nativeIndoorEnvelopes]
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
      r.properties.spaceUse,
      r.properties.stairAccess,
    ]),
    data.walls,
    data.doors,
    data.walkingSupport,
  ]);
}
/** Native surfaces establish geometry. Source contours classify complete cells;
 * they never clip the exterior, dilate a boundary or close a wall gap. */
export function prepareNativeCirculationGeometry(
  model: ConvertResult,
  data: IndoorDataset,
) {
  const report = {
    accepted: 0,
    rejected: 0,
    exactOverlayFallbacks: 0,
    diagnostics: [] as string[],
  };
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
  const strictNative = !!data.nativeIndoorEnvelopes;
  const eligible = (r: IndoorRecord) =>
    strictNative ? r.walkable : isNativeCirculationOwner(r);
  const preparedRoomKeys = new Set<string>(
    strictNative ? data.records.map((r) => r.key) : [],
  );
  for (const z of [
    ...new Set(data.records.filter(eligible).map((r) => r.elevationFeet)),
  ].sort((a, b) => a - b)) {
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
    );
    report.diagnostics.push(...(region.diagnostics ?? []));
    if (!region.floors.length) continue;
    owners.forEach((r) => preparedRoomKeys.add(r.key));
    const levels = new Set(owners.map((r) => r.levelId));
    const fixtureLevels = [...levels].filter((id) =>
      data.nativeLevels.some(
        (l) => l.id === id && Math.abs(l.elevationFeet - z) < 0.05,
      ),
    );
    for (const slab of nativeLowSlabRecords(model, z)) {
      // A supported upper-storey floor is overhead structure, not a furniture cap.
      // Several native planes can share one campus display floor.
      const parts = nativeFloorPolygons(slab);
      const upperOwners = data.records.filter(
        (r) =>
          r.walkable &&
          Math.abs(r.elevationFeet - slab.boundsFeet.max.z) < 0.05,
      );
      if (
        upperOwners.some((r) =>
          parts.some(
            (p) =>
              area(
                pc.intersection(topology(p), topology(r.ringsFeet)) as Rings[],
              ) > 1,
          ),
        )
      )
        continue;
      for (const [part, rings] of nativeFloorPolygons(slab).entries())
        if (
          fixtureLevels.length &&
          region.floors.some(
            (f) =>
              area(pc.intersection(topology(rings), topology(f)) as Rings[]) >
              0.1,
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
    const repairs = [...levels].flatMap((level) =>
      recoverNativeWallJunctionRepairs(
        data.walls.filter((w) => w.levelId === level),
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
    const wallBarriers = new Set(region.wallBarriers ?? []);
    const obstacles = [
      ...nativeBarrierTopology(region.wallBarriers ?? []),
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
          parts.push(...nativeFloorDifference(floor, nearby).map(topology));
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
        free = nativeFloorUnion(parts).map(topology);
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
      box: bounds(record.ringsFeet),
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
          nativeFloorIntersection(rings, [topology(record.ringsFeet)]),
        );
        if (!claims.length) {
          report.rejected++;
          continue;
        }
        const owned = pc.union(claims[0]!, ...claims.slice(1)),
          coverage = area(owned as Rings[]) / area([rings]);
        // An incomplete enclosure must not claim a whole slab or unlabelled wing.
        // Coverage is classification evidence, never a boundary-generating grid.
        const members = candidates
          .filter(
            ({ record }) =>
              area(
                nativeFloorIntersection(rings, [topology(record.ringsFeet)]),
              ) > 0.25 &&
              (!strictNative ||
                (() => {
                  const overlap = area(
                    nativeFloorIntersection(rings, [
                      topology(record.ringsFeet),
                    ]),
                  );
                  return (
                    overlap / area([record.ringsFeet]) >= 0.5 ||
                    overlap / area([rings]) >= 0.5
                  );
                })()),
          )
          .map((r) => r.record);
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
                topology(record.ringsFeet),
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
        if (!members.length) {
          report.rejected++;
          continue;
        }
        const nativeFloorIds = routingFloorPlateRecords(model, z)
          .filter(
            (r) =>
              area(
                pc.intersection(
                  rings,
                  nativeFloorPolygons(r).map(topology),
                ) as Rings[],
              ) > 0.002,
          )
          .map((r) => r.elementId);
        cells.push({
          id: `native-cell:${z.toFixed(6)}:${cells.length}`,
          levelIds: [...new Set(members.map((r) => r.levelId))].sort(
            (a, b) => a - b,
          ),
          elevationFeet: z,
          roomKeys: members.map((r) => r.key).sort(),
          nativeFloorIds,
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
      preparedRoomKeys: [...preparedRoomKeys].sort(),
      reviewSurfaces,
      fixtures,
      cells,
    },
    report,
  };
}

/** Extend route support only into the owned half of its enabled physical
 * doorway. Exact slab/column/opening proof remains required and the opposite
 * side still needs the original door portal. The saved cell stays unchanged. */
type IndexedApproachPart = {
  rings: Rings;
  box: ReturnType<typeof bounds>;
  nativeId?: number;
  column?: boolean;
};
type DoorApproachContext = {
  edges: Map<string, IndoorDataset["edges"][number]>;
  nodes: Map<string, IndoorDataset["nodes"][number]>;
  records: Map<string, IndoorRecord>;
  doors: Map<string, NonNullable<IndoorDataset["doors"]>>;
  envelopes: NativeIndoorEnvelopeIndex;
  levels: Map<
    string,
    {
      floors: IndexedApproachPart[];
      envelopes: IndexedApproachPart[];
      masks: IndexedApproachPart[];
    }
  >;
};
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
  level = {
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
      ...data.walls
        .filter((w) => cell.levelIds.includes(w.levelId))
        .map((w) => ({
          ...indexed(w.ringsFeet),
          nativeId: w.nativeElementId,
          column: w.kind === "column",
        })),
      ...(data.circulationGeometry?.fixtures ?? [])
        .filter((f) => Math.abs(f.elevationFeet - cell.elevationFeet) < 0.05)
        .map((f) => indexed(f.ringsFeet)),
      ...indoorExclusionParts(data, cell.elevationFeet).map(indexed),
      ...data.records
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
): Rings {
  if (!data.nativeIndoorEnvelopes) return cell.ringsFeet;
  let rings = cell.ringsFeet;
  const level = nativeDoorLevelParts(data, context, cell);
  const candidateDoors = new Set(
    cell.roomKeys.flatMap((k) => context.doors.get(k) ?? []),
  );
  for (const door of candidateDoors) {
    const edge = context.edges.get(door.id),
      footprint = door.footprintFeet,
      normal = door.normalFeet;
    if (
      !edge ||
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
      const owner = context.records.get(node!.roomKey);
      if (
        !cell.roomKeys.includes(node!.roomKey) ||
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
          sa = side(a) * sign - 0.00001,
          sb = side(b) * sign - 0.00001;
        if (sa >= 0) half.push(a);
        if (sa >= 0 !== sb >= 0) {
          const t = sa / (sa - sb);
          half.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      if (half.length < 3) continue;
      const box = bounds([half]),
        near = (part: IndexedApproachPart) => overlaps(box, part.box);
      const floors = level.floors.filter(near).map((p) => p.rings),
        envelope = level.envelopes.filter(near).map((p) => p.rings);
      if (!floors.length || !envelope.length) continue;
      const masks = level.masks
        .filter(
          (p) =>
            (p.column || p.nativeId !== door.hostWallNativeElementId) &&
            near(p),
        )
        .map((p) => p.rings);
      try {
        let parts = pc.intersection([half], floors) as Rings[];
        parts = pc.intersection(parts, envelope) as Rings[];
        if (masks.length) parts = pc.difference(parts, ...masks) as Rings[];
        for (const part of parts) {
          const joined = pc.union(rings, part) as Rings[];
          if (
            joined.length === 1 &&
            contains([node!.pointFeet[0], node!.pointFeet[1]], joined[0]!)
          )
            rings = joined[0]!;
        }
      } catch {
        /* Unknown doorway support remains blocked. */
      }
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
  const context: DoorApproachContext = {
    edges: new Map(data.edges.map((e) => [e.id, e])),
    nodes: new Map(data.nodes.map((n) => [n.id, n])),
    records: new Map(data.records.map((r) => [r.key, r])),
    doors: new Map(),
    envelopes: createNativeIndoorEnvelopeIndex(
      data.nativeIndoorEnvelopes,
      data.source.modelSha256,
    ),
    levels: new Map(),
  };
  for (const door of data.doors ?? [])
    for (const key of door.roomKeys)
      context.doors.set(key, [...(context.doors.get(key) ?? []), door]);
  let added = 0;
  for (const cell of data.circulationGeometry?.cells ?? []) {
    const routeRings = nativeCellDoorApproach(data, context, cell);
    const selected = data.nodes.filter(
      (n) =>
        cell.roomKeys.includes(n.roomKey) &&
        Math.abs(n.pointFeet[2] - cell.elevationFeet) < 0.05 &&
        n.kind !== "junction" &&
        contains([n.pointFeet[0], n.pointFeet[1]], routeRings),
    );
    if (selected.length < 2) continue;
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
      const fromNode = selected.find((n) => n.id === branch.from)!,
        toNode = selected.find((n) => n.id === branch.to)!;
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
              contains(a, f.ringsFeet) &&
              contains(b, f.ringsFeet) &&
              data.nativeIndoorEnvelopes!.levels.some(
                (scope) =>
                  Math.abs(scope.elevationFeet - cell.elevationFeet) < 0.05 &&
                  scope.sourceElementIds.includes(f.nativeElementId) &&
                  scope.partsFeet.some(
                    (part) => contains(a, part) && contains(b, part),
                  ),
              ),
          );
        if (!sharedNativeSlab) continue;
      }
      const a = positions.get(branch.from),
        b = positions.get(branch.to);
      if (!a || !b) continue;
      const points = [a, ...branch.points, b].filter(
        (p, i, ps) =>
          !i || Math.hypot(p[0] - ps[i - 1]![0], p[1] - ps[i - 1]![1]) > 1e-8,
      );
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
        roomKeys: cell.roomKeys,
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
