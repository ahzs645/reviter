import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";
import type {
  BoundaryReference,
  BoundarySection,
  BoundarySegment,
} from "./room-boundaries.ts";
import {
  containsRoomPoint,
  roomArea,
  type DirectoryRoom,
  type RoomPoint,
} from "./room-directory.ts";

type DividerReview = {
  version: number;
  kind: string;
  sourceModelSha256: string;
  registeredSourceSha256: string;
  sectionId: string;
  displayOnly: boolean;
  removedInternalDividerIndices: number[];
  removedInternalDividerSegments: { index: number; segment: BoundarySegment }[];
};
type MergeReview = {
  version: number;
  kind: string;
  sourceModelSha256: string;
  mergedSourceKeys: string[];
  mergedOriginalAreas: { key: string; ringsFeet: RoomPoint[][] }[];
};
export type AppliedModelBoundaryReview = {
  roomKey: string;
  removedWallSegmentIndices: number[];
  nativeBarrierChecked: true;
  donorKeys: string[];
};
const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (s, rings) =>
      s +
      roomArea(rings[0]! as RoomPoint[]) -
      rings.slice(1).reduce((n, r) => n + roomArea(r as RoomPoint[]), 0),
    0,
  );
const finiteSegment = (line: unknown): line is BoundarySegment =>
  Array.isArray(line) &&
  line.length === 2 &&
  line.every(
    (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
  );
/** A reviewed merge may disregard a DWG interior partition absent from this
 * exact native model. This affects display face composition only. Retain the
 * authored reference and its original indices for provenance and navigation.
 * Missing/invalid proof silently keeps the original section unchanged. */
export function sectionForModelBoundaryReview(
  dataset: IndoorDataset,
  annotations: readonly DirectoryRoom[],
  reference: BoundaryReference,
  section: BoundarySection,
): { section: BoundarySection; applied: AppliedModelBoundaryReview[] } {
  const removed = new Set<number>(),
    applied: AppliedModelBoundaryReview[] = [];
  if (reference.sourceSha256.length !== 64) return { section, applied };
  for (const room of annotations) {
    if (
      room.status === "deleted" ||
      room.levelId !== section.levelId ||
      room.dwg?.sectionId !== section.sectionId ||
      room.dwg.sha256 !== reference.sourceSha256
    )
      continue;
    const review = room.modelBoundaryReview as DividerReview | undefined,
      merge = room.manualBoundaryReview as MergeReview | undefined;
    if (
      !review ||
      !merge ||
      merge.version !== 1 ||
      review.version !== 1 ||
      review.kind !== "native-model-overrides-registered-internal-divider" ||
      review.displayOnly !== true ||
      review.sourceModelSha256 !== dataset.source.modelSha256 ||
      merge.sourceModelSha256 !== dataset.source.modelSha256 ||
      review.registeredSourceSha256 !== reference.sourceSha256 ||
      review.sectionId !== section.sectionId ||
      merge.kind !== "merged-source-area-review"
    )
      continue;
    const record = dataset.records.find(
      (r) => r.key === room.key && r.levelId === section.levelId,
    );
    if (
      !record ||
      record.circulation ||
      record.stair ||
      !record.walkable ||
      !Array.isArray(merge.mergedSourceKeys) ||
      !merge.mergedSourceKeys.includes(room.key) ||
      merge.mergedSourceKeys.length < 2 ||
      merge.mergedSourceKeys.length > 8
    )
      continue;
    const donorKeys = merge.mergedSourceKeys.filter((k) => k !== room.key),
      donors = donorKeys.map((k) => annotations.find((a) => a.key === k));
    if (
      donors.some(
        (a) =>
          !a ||
          a.status !== "deleted" ||
          a.mergedInto !== room.key ||
          a.levelId !== section.levelId,
      ) ||
      donorKeys.some((k) => dataset.records.some((r) => r.key === k))
    )
      continue;
    if (
      !Array.isArray(merge.mergedOriginalAreas) ||
      donors.some(
        (a) =>
          !merge.mergedOriginalAreas.some(
            (m) =>
              m.key === a!.key &&
              JSON.stringify(m.ringsFeet) ===
                JSON.stringify([a!.polygonFeet, ...(a!.holesFeet ?? [])]),
          ),
      )
    )
      continue;
    const indices = review.removedInternalDividerIndices;
    if (
      !Array.isArray(indices) ||
      !indices.length ||
      indices.length > 16 ||
      new Set(indices).size !== indices.length ||
      !Array.isArray(review.removedInternalDividerSegments) ||
      review.removedInternalDividerSegments.length !== indices.length
    )
      continue;
    if (
      indices.some(
        (i) =>
          !Number.isInteger(i) ||
          i < 0 ||
          i >= section.wallSegments.length ||
          !finiteSegment(section.wallSegments[i]) ||
          !review.removedInternalDividerSegments.some(
            (p) =>
              p.index === i &&
              JSON.stringify(p.segment) ===
                JSON.stringify(section.wallSegments[i]),
          ),
      )
    )
      continue;
    const segments = indices.map((i) => section.wallSegments[i]!),
      base = segments[0]!,
      length = Math.hypot(base[1][0] - base[0][0], base[1][1] - base[0][1]);
    if (length < 0.5 || length > 30) continue;
    const axis: RoomPoint = [
        (base[1][0] - base[0][0]) / length,
        (base[1][1] - base[0][1]) / length,
      ],
      normal: RoomPoint = [-axis[1], axis[0]];
    const project = (p: RoomPoint, a: RoomPoint) => p[0] * a[0] + p[1] * a[1],
      points = segments.flat();
    if (
      segments.some(([a, b]) => {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return (
          l < 0.5 ||
          Math.abs(((b[0] - a[0]) * axis[0] + (b[1] - a[1]) * axis[1]) / l) <
            0.9999
        );
      })
    )
      continue;
    const us = points.map((p) => project(p, axis)),
      vs = points.map((p) => project(p, normal)),
      u0 = Math.min(...us),
      u1 = Math.max(...us),
      v0 = Math.min(...vs),
      v1 = Math.max(...vs);
    if (u1 - u0 > 30 || v1 - v0 > 1.5) continue;
    const mid = (v0 + v1) / 2,
      side = project(room.labelPointFeet, normal) - mid;
    if (
      !Number.isFinite(side) ||
      Math.abs(side) < 0.1 ||
      !donors.some(
        (d) => (project(d!.labelPointFeet, normal) - mid) * side < -0.01,
      )
    )
      continue;
    const polygon = room.polygonFeet;
    if (
      !containsRoomPoint(room.labelPointFeet, polygon) ||
      donors.some((a) => !containsRoomPoint(a!.labelPointFeet, polygon))
    )
      continue;
    // Ignore contacts with the adjoining outer wall at each divider end. Every
    // internal face must remain free of native material; no gap-size heuristic
    // can turn a real partition into an open passage.
    const inset = 0.1,
      lo = v0 - 0.005,
      hi = v1 + 0.005;
    const point = (u: number, v: number): RoomPoint => [
      u * axis[0] + v * normal[0],
      u * axis[1] + v * normal[1],
    ];
    const seam: RoomPoint[][] = [
      [
        point(u0 + inset, lo),
        point(u1 - inset, lo),
        point(u1 - inset, hi),
        point(u0 + inset, hi),
      ],
    ];
    const nativeWalls = dataset.walls.filter(
      (w) => w.levelId === section.levelId,
    );
    if (nativeWalls.filter((w) => !w.approximate).length < 2) continue;
    try {
      if (
        nativeWalls.some(
          (w) => area(pc.intersection(seam, w.ringsFeet)) > 0.002,
        )
      )
        continue;
      const floors =
        dataset.walkingSupport?.floors
          .filter(
            (f) => Math.abs(f.elevationFeet - record.elevationFeet) < 0.15,
          )
          .flatMap(
            (f) =>
              (f as typeof f & { partsFeet?: RoomPoint[][][] }).partsFeet ?? [
                f.ringsFeet,
              ],
          ) ?? [];
      if (!floors.length || area(pc.difference(seam, ...floors)) > 0.002)
        continue;
      const labels = [
        room.labelPointFeet,
        ...donors.map((d) => d!.labelPointFeet),
      ];
      if (
        labels.some(
          (p) =>
            !floors.some(
              (rings) =>
                containsRoomPoint(p, rings[0] as RoomPoint[]) &&
                !rings
                  .slice(1)
                  .some((h) => containsRoomPoint(p, h as RoomPoint[])),
            ),
        )
      )
        continue;
    } catch {
      continue;
    }
    for (const i of indices) removed.add(i);
    applied.push({
      roomKey: room.key,
      removedWallSegmentIndices: [...indices],
      nativeBarrierChecked: true,
      donorKeys,
    });
  }
  return {
    section: removed.size
      ? {
          ...section,
          wallSegments: section.wallSegments.filter((_, i) => !removed.has(i)),
        }
      : section,
    applied,
  };
}
