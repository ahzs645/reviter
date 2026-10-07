import pc from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import type { DirectoryRoom, RoomPoint } from "./room-directory.ts";
import type { BoundaryReference } from "./room-boundaries.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import {
  isPlanarCirculation,
  type RecoveredOpenFront,
} from "./registered-open-fronts.ts";
import { directoryOpenPassages } from "./directory-openings.ts";
import {
  nativeWalkingRegion,
  type createNativeWalkingRegionQuery,
} from "./native-circulation-links.ts";
import { routingFloorPlateRecords } from "./routing-floor-support.ts";
import { roomArea } from "./room-directory.ts";
const area = (polys: pc.MultiPolygon) =>
  polys.reduce(
    (s, p) =>
      s +
      roomArea(p[0]! as RoomPoint[]) -
      p.slice(1).reduce((a, h) => a + roomArea(h as RoomPoint[]), 0),
    0,
  );
/** A finite crossing-centre span, not an interchangeable door or an accessibility
 * review. Each candidate is authorized by a continuous complete-body rectangle;
 * sampling only proposes its placement. Only source-proven circulation seams
 * qualify. The actual angle's body footprint must still fit the exported band. */
export function recoverIndoorOpeningSpan(
  model: ConvertResult,
  dataset: IndoorDataset,
  rooms: readonly DirectoryRoom[],
  front: RecoveredOpenFront,
  reference: BoundaryReference | undefined,
  geometry: ArchitecturalPlanGeometry,
  query?: ReturnType<typeof createNativeWalkingRegionQuery>,
): IndoorEdge["openingSpan"] | undefined {
  if (!front.openingId.startsWith("recovered-circulation-seam:") || !reference)
    return;
  const owners = front.rooms.map((key) => rooms.find((r) => r.key === key)),
    records = front.rooms.map((key) =>
      dataset.records.find((r) => r.key === key),
    );
  if (
    owners.some((r) => !r || !isPlanarCirculation(r)) ||
    records.some(
      (r) => !r || !r.circulation || !r.walkable || r.access === "staff",
    )
  )
    return;
  const [a, b] = records as [
      NonNullable<(typeof records)[0]>,
      NonNullable<(typeof records)[0]>,
    ],
    levelId = a.levelId,
    z = a.elevationFeet;
  if (
    a.levelId !== b.levelId ||
    a.building !== b.building ||
    Math.abs(z - b.elevationFeet) > 0.05 ||
    owners.some((r) => r!.dwg?.sha256 !== reference.sourceSha256) ||
    owners[0]!.dwg?.sectionId !== owners[1]!.dwg?.sectionId
  )
    return;
  const section = reference.sections.find(
    (s) =>
      s.levelId === levelId &&
      s.sectionId === owners[0]!.dwg?.sectionId &&
      s.registrationErrorFeet <= 0.05,
  );
  if (!section) return;
  const dx = front.to[0] - front.from[0],
    dy = front.to[1] - front.from[1],
    len = Math.hypot(dx, dy);
  if (len < 0.1 || len > 6) return;
  const n: RoomPoint = [dx / len, dy / len],
    t: RoomPoint = [-n[1], n[0]],
    origin: RoomPoint = [
      (front.from[0] + front.to[0]) / 2,
      (front.from[1] + front.to[1]) / 2,
    ];
  const near = (polygon: readonly RoomPoint[]) =>
    Math.min(...polygon.map((p) => p[0])) <= origin[0] + 6 &&
    Math.max(...polygon.map((p) => p[0])) >= origin[0] - 6 &&
    Math.min(...polygon.map((p) => p[1])) <= origin[1] + 6 &&
    Math.max(...polygon.map((p) => p[1])) >= origin[1] - 6;
  const localRooms = rooms.filter(
    (room) => front.rooms.includes(room.key) || near(room.polygonFeet),
  );
  const localGeometry = {
    ...geometry,
    walls: geometry.walls.filter((w) => near(w.polygon)),
    columns: geometry.columns.filter((w) => near(w.polygon)),
  };
  const region = query
      ? query(z, true)
      : nativeWalkingRegion(model, dataset, z, true),
    floors = routingFloorPlateRecords(model, z);
  if (!region.floors.length) return;
  const floor = pc.union(region.floors[0]!, ...region.floors.slice(1));
  const barriers = [...region.barriers, ...region.masks].filter((p) =>
    near(p[0]!),
  );
  barriers.push(
    ...localGeometry.walls.map((w) => [w.polygon]),
    ...localGeometry.columns.map((w) => [w.polygon]),
  );
  const holes = rooms
    .flatMap((r) => [
      ...(!dataset.nativeIndoorEnvelopes ? (r.holesFeet ?? []) : []),
      ...(r.floorOpeningsFeet ?? []),
    ])
    .filter(near);
  const validate = (offset: number, width: number): RoomPoint[] | undefined => {
    const centre: RoomPoint = [
      origin[0] + t[0] * offset,
      origin[1] + t[1] * offset,
    ];
    // directoryOpenPassages adds 0.2ft of normal overlap on both ends, yielding
    // exactly a two-foot-deep envelope at these +/-0.8ft source endpoints.
    const passage = directoryOpenPassages(
      localRooms,
      [
        {
          id: front.openingId,
          levelId,
          rooms: front.rooms,
          from: [centre[0] - 0.8 * n[0], centre[1] - 0.8 * n[1]],
          to: [centre[0] + 0.8 * n[0], centre[1] + 0.8 * n[1]],
          widthFeet: width,
          evidence: "registered-opening",
          sourceSha256: reference.sourceSha256,
        },
      ],
      reference,
      localGeometry,
      { nativeOnly: !!dataset.nativeIndoorEnvelopes },
    )[0];
    if (!passage?.footprint) return;
    try {
      const shape: pc.Polygon = [passage.footprint];
      if (
        area(pc.difference(shape, floor)) > 1e-8 ||
        barriers.some((p) => area(pc.intersection(shape, p)) > 1e-8) ||
        holes.some((h) => area(pc.intersection(shape, [h])) > 1e-8)
      )
        return;
      return passage.footprint;
    } catch {
      return;
    }
  };
  const runs: { lo: number; hi: number }[] = [];
  let run: { lo: number; hi: number } | undefined;
  for (let step = -15; step <= 15; step++) {
    const offset = step * 0.2;
    if (validate(offset, 2)) {
      if (run) run.hi = offset;
      else {
        run = { lo: offset, hi: offset };
        runs.push(run);
      }
    } else run = undefined;
  }
  runs.sort(
    (x, y) =>
      y.hi - y.lo - (x.hi - x.lo) ||
      Math.abs(x.lo + x.hi) - Math.abs(y.lo + y.hi) ||
      x.lo - y.lo,
  );
  for (const span of runs) {
    if (span.hi - span.lo < 0.4 - 1e-8) continue;
    const aperture = validate((span.lo + span.hi) / 2, span.hi - span.lo + 2);
    if (!aperture) continue;
    const pointsFeet = [span.lo, span.hi].map((offset) => [
      origin[0] + t[0] * offset,
      origin[1] + t[1] * offset,
      z,
    ]) as [[number, number, number], [number, number, number]];
    const nativeFloorElementIds = floors
      .filter((f) => {
        try {
          return (
            area(
              pc.intersection(
                [aperture],
                f.loops!.map((r) => r.map(([x, y]) => [x, y] as RoomPoint)),
              ),
            ) > 1e-8
          );
        } catch {
          return false;
        }
      })
      .map((f) => f.elementId);
    if (aperture.length !== 4) continue;
    return {
      version: 1,
      sourceModelSha256: dataset.source.modelSha256,
      levelId,
      pointsFeet,
      nativeFloorElementIds,
      walkingStripWidthFeet: 2,
      apertureFeet: aperture as [RoomPoint, RoomPoint, RoomPoint, RoomPoint],
    };
  }
}
