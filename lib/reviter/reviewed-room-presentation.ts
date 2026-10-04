import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import type { ConvertResult } from "./types.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import { containsRoomPoint, roomArea } from "./room-directory.ts";
import { nativeMeshBarrierCuts } from "./native-mesh-barrier-cuts.ts";
import { recoverNativeWallJunctionRepairs } from "./native-room-presentation.ts";
type Point = [number, number];
type Rings = Point[][];
const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (s, r) =>
      s +
      roomArea(r[0]! as Point[]) -
      r.slice(1).reduce((s, h) => s + roomArea(h as Point[]), 0),
    0,
  );
const contains = (p: Point, r: Rings) =>
  containsRoomPoint(p, r[0]!) &&
  !r.slice(1).some((h) => containsRoomPoint(p, h));
const box = (r: Rings) => {
  const ps = r.flat();
  return [
    Math.min(...ps.map((p) => p[0])),
    Math.min(...ps.map((p) => p[1])),
    Math.max(...ps.map((p) => p[0])),
    Math.max(...ps.map((p) => p[1])),
  ];
};
const overlaps = (a: number[], b: number[]) =>
  a[0]! <= b[2]! && a[2]! >= b[0]! && a[1]! <= b[3]! && a[3]! >= b[1]!;
const round = (rs: Rings): Rings =>
  rs.map((r) => r.map((p) => p.map((n) => Math.round(n * 1e4) / 1e4) as Point));
/** Explicit room-boundary reviews can close a short partition/facade end seam
 * for display. Recompute the bounded native cell, measured native-axis cap,
 * first material contact, unique label and full floor coverage. This never
 * appends a physical wall, threshold, routing node or graph edge. */
export function reviewedRoomInteriors(
  dataset: IndoorDataset,
  annotations: RoomDirectoryData["annotations"],
  model: ConvertResult,
  floorsByRecord: ReadonlyMap<string, ArchitecturalPlanGeometry["floors"]>,
) {
  const rooms: NonNullable<IndoorDataset["presentation"]>["rooms"] = [];
  const cuts = new Map<number, IndoorDataset["walls"]>();
  for (const annotation of annotations) {
    const review = annotation.manualBoundaryReview as
      | {
          version?: number;
          sourceModelSha256?: string;
          kind?: string;
          displayClosures?: {
            nativeWallId: number;
            reachFeet: number;
            ringsFeet: Rings;
          }[];
        }
      | undefined;
    if (
      review?.version !== 1 ||
      review.sourceModelSha256 !== dataset.source.modelSha256 ||
      review.kind !== "manual-native-wall-face-review" ||
      !Array.isArray(review.displayClosures) ||
      !review.displayClosures.length ||
      review.displayClosures.length > 12
    )
      continue;
    const record = dataset.records.find((r) => r.key === annotation.key);
    if (!record || !record.walkable || record.circulation || record.stair)
      continue;
    try {
      const elevation = dataset.nativeLevels.find(
        (l) => l.id === record.levelId,
      )?.elevationFeet;
      if (elevation === undefined) continue;
      let mesh = cuts.get(record.levelId);
      if (!mesh) {
        mesh = nativeMeshBarrierCuts(model, record.levelId, elevation + 4);
        cuts.set(record.levelId, mesh);
      }
      const scope = box(record.ringsFeet).map((v, i) => v + (i < 2 ? -3 : 3));
      const walls = [
        ...dataset.walls.filter(
          (w) => !w.approximate && w.levelId === record.levelId,
        ),
        ...mesh,
      ]
        .filter((w) => overlaps(scope, box(w.ringsFeet)))
        .map((w) => ({ ...w, ringsFeet: round(w.ringsFeet) }));
      if (!walls.length) continue;
      const doors = (dataset.doors ?? []).filter(
        (d) =>
          d.levelId === record.levelId &&
          d.footprintFeet &&
          overlaps(scope, box([d.footprintFeet])),
      );
      const material = pc.union(
        walls[0]!.ringsFeet,
        ...walls.slice(1).map((w) => w.ringsFeet),
        ...recoverNativeWallJunctionRepairs(walls, doors).map(
          (p) => p.ringsFeet,
        ),
        ...doors.map((d) => [d.footprintFeet!]),
      );
      let valid = true;
      for (const closure of review.displayClosures) {
        const solid = model.elementBounds.find(
          (e) => e.elementId === closure.nativeWallId,
        )?.solid;
        if (
          !solid ||
          !Number.isFinite(closure.reachFeet) ||
          closure.reachFeet <= 0.05 ||
          closure.reachFeet > 1.5 ||
          !Array.isArray(closure.ringsFeet)
        ) {
          valid = false;
          break;
        }
        let matched = false;
        for (const endpoint of ["start", "end"] as const) {
          const a = solid[endpoint],
            b = solid[endpoint === "start" ? "end" : "start"],
            len = Math.hypot(a.x - b.x, a.y - b.y);
          if (len < 0.1) continue;
          const u: Point = [(a.x - b.x) / len, (a.y - b.y) / len],
            v: Point = [-u[1], u[0]],
            at = (t: number, side: number): Point => [
              a.x + t * u[0] + ((side * solid.thickness) / 2) * v[0],
              a.y + t * u[1] + ((side * solid.thickness) / 2) * v[1],
            ];
          const expected = round([
            [
              at(-0.002, -1),
              at(closure.reachFeet + 0.002, -1),
              at(closure.reachFeet + 0.002, 1),
              at(-0.002, 1),
            ],
          ]);
          if (area(pc.xor(expected, closure.ringsFeet)) > 0.0001) continue;
          const hits = pc
            .intersection(
              [[at(0.001, -1), at(1.5, -1), at(1.5, 1), at(0.001, 1)]],
              material,
            )
            .flat(2)
            .map((q) => (q[0]! - a.x) * u[0] + (q[1]! - a.y) * u[1])
            .filter((t) => t > 0.01);
          if (
            hits.length &&
            Math.abs(Math.min(...hits) - closure.reachFeet) < 0.005
          ) {
            matched = true;
            break;
          }
        }
        if (!matched) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      const closed = pc.union(
        material,
        ...review.displayClosures.map((c) => c.ringsFeet),
      );
      const cells = closed
        .flatMap((r) => r.slice(1).map((h) => [h] as Rings))
        .filter((r) => contains(annotation.labelPointFeet, r));
      if (cells.length !== 1) continue;
      const free = pc.difference(
        cells[0]!,
        ...walls.map((w) => w.ringsFeet),
      ) as Rings[];
      if (free.length !== 1) continue;
      const rings = free[0]!,
        a = area([rings]);
      if (a <= 0 || area(pc.xor(rings, record.ringsFeet)) > 0.01) continue;
      if (
        annotations.some(
          (other) =>
            other.key !== annotation.key &&
            other.levelId === annotation.levelId &&
            other.status !== "deleted" &&
            contains(other.labelPointFeet, rings),
        )
      )
        continue;
      let uncovered: pc.MultiPolygon = [rings];
      for (const floor of floorsByRecord.get(record.key) ?? [])
        uncovered = pc.difference(uncovered, floor);
      if (area(uncovered) > 0.002) continue;
      const ids = [...new Set(walls.map((w) => w.nativeElementId))].sort(
        (a, b) => a - b,
      );
      rooms.push({
        roomKey: record.key,
        levelId: record.levelId,
        sourceGeometryKey: JSON.stringify([record.levelId, record.ringsFeet]),
        interiorRingsFeet: rings,
        blockPartsFeet: [rings],
        boundarySource: "reviewed-native-wall-enclosure",
        boundaryElementIds: ids,
        sourceCoverage: 1,
        cellCoverage: 1,
        boundaryEvidence:
          "Explicit native wall-face room review; measured partition-to-facade display closures only; original native doors and routing barriers retained.",
        reviewProof: {
          sourceModelSha256: dataset.source.modelSha256,
          closures: review.displayClosures,
          nativeFloorCoveredSquareFeet: a,
        },
      });
    } catch {
      /* An unproved review stays a flat source area. */
    }
  }
  return rooms;
}
