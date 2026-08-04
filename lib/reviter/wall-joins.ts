/**
 * Recover non-square wall end trims from adjacent native wall runs.
 *
 * A wall's centre-plane triple gives its location line and thickness, while its
 * independent duplicated-bounds record gives the AABB of the joined body.  A
 * neighbouring wall supplies the only missing datum: the face against which an
 * end was trimmed.  This module accepts a join only when those three readings
 * agree.  It never keys on an element id and never moves the location line.
 */
import type { WallSolid } from "./native-geometry.ts";
import type { Bounds3, ElementBoundsRecord } from "./types.ts";

const WALL_CATEGORY_ID = -2_000_011;
const MIN_JOIN_ANGLE_SINE = 0.05;
const MIN_ERROR_IMPROVEMENT_FEET = 1e-4;
const BOUNDS_SLACK_FEET = 0.01;
const MIN_Z_OVERLAP_FEET = 0.05;
// An indexing cell, not an admission threshold. Runs are inserted into every
// cell their thickness-expanded segment crosses, so cell size changes only the
// number of candidates inspected, never which joins are eligible.
const INDEX_CELL_FEET = 8;

type Point2 = { x: number; y: number };
type JoinCorners = [Point2, Point2];

type Run = {
  record: ElementBoundsRecord;
  solid: WallSolid;
};

function cross(left: Point2, right: Point2): number {
  return left.x * right.y - left.y * right.x;
}

function subtract(left: Point2, right: Point2): Point2 {
  return { x: left.x - right.x, y: left.y - right.y };
}

function pointAt(origin: Point2, direction: Point2, distance: number): Point2 {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  };
}

function frame(solid: WallSolid): { direction: Point2; normal: Point2; length: number } | null {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.05) return null;
  const direction = { x: dx / length, y: dy / length };
  return {
    direction,
    normal: { x: -direction.y, y: direction.x },
    length,
  };
}

function ordinaryCorners(solid: WallSolid, atStart: boolean): JoinCorners | null {
  const local = frame(solid);
  if (!local) return null;
  const centre = atStart ? solid.start : solid.end;
  const half = solid.thickness / 2;
  return [
    pointAt(centre, local.normal, half),
    pointAt(centre, local.normal, -half),
  ];
}

function allCorners(solid: WallSolid): Point2[] {
  const start = solid.startCorners ?? ordinaryCorners(solid, true);
  const end = solid.endCorners ?? ordinaryCorners(solid, false);
  return start && end ? [...start, ...end] : [];
}

function envelopeError(solid: WallSolid, envelope: Bounds3): number {
  const corners = allCorners(solid);
  if (!corners.length) return Infinity;
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return Math.abs(minX - envelope.min.x)
    + Math.abs(minY - envelope.min.y)
    + Math.abs(maxX - envelope.max.x)
    + Math.abs(maxY - envelope.max.y);
}

function insideEnvelope(point: Point2, envelope: Bounds3): boolean {
  return point.x >= envelope.min.x - BOUNDS_SLACK_FEET
    && point.x <= envelope.max.x + BOUNDS_SLACK_FEET
    && point.y >= envelope.min.y - BOUNDS_SLACK_FEET
    && point.y <= envelope.max.y + BOUNDS_SLACK_FEET;
}

function touchesEnvelope(corners: JoinCorners, envelope: Bounds3): boolean {
  return corners.some((point) =>
    Math.abs(point.x - envelope.min.x) <= BOUNDS_SLACK_FEET
    || Math.abs(point.x - envelope.max.x) <= BOUNDS_SLACK_FEET
    || Math.abs(point.y - envelope.min.y) <= BOUNDS_SLACK_FEET
    || Math.abs(point.y - envelope.max.y) <= BOUNDS_SLACK_FEET);
}

function linesIntersect(
  leftOrigin: Point2,
  leftDirection: Point2,
  rightOrigin: Point2,
  rightDirection: Point2,
): { point: Point2; leftDistance: number; rightDistance: number } | null {
  const determinant = cross(leftDirection, rightDirection);
  if (Math.abs(determinant) < MIN_JOIN_ANGLE_SINE) return null;
  const delta = subtract(rightOrigin, leftOrigin);
  const leftDistance = cross(delta, rightDirection) / determinant;
  const rightDistance = cross(delta, leftDirection) / determinant;
  return {
    point: pointAt(leftOrigin, leftDirection, leftDistance),
    leftDistance,
    rightDistance,
  };
}

function zOverlaps(left: WallSolid, right: WallSolid): boolean {
  return Math.min(left.topElevation, right.topElevation)
    - Math.max(left.baseElevation, right.baseElevation) >= MIN_Z_OVERLAP_FEET;
}

function candidateCorners(
  target: WallSolid,
  neighbour: WallSolid,
  atStart: boolean,
  neighbourFaceSign: 1 | -1,
): JoinCorners | null {
  const targetFrame = frame(target);
  const neighbourFrame = frame(neighbour);
  if (!targetFrame || !neighbourFrame || !zOverlaps(target, neighbour)) return null;

  const centreJoin = linesIntersect(
    target.start,
    targetFrame.direction,
    neighbour.start,
    neighbourFrame.direction,
  );
  if (!centreJoin) return null;

  // The centre-line intersection must belong to this end and to the neighbour's
  // finite run.  The allowance is made solely from the two native thicknesses:
  // a join can reach a face, but not an unrelated crossing elsewhere in plan.
  const reach = Math.max(target.thickness, neighbour.thickness) * 2;
  const targetStation = atStart ? 0 : targetFrame.length;
  if (Math.abs(centreJoin.leftDistance - targetStation) > reach) return null;
  if (
    centreJoin.rightDistance < -reach
    || centreJoin.rightDistance > neighbourFrame.length + reach
  ) return null;

  const neighbourFace = pointAt(
    neighbour.start,
    neighbourFrame.normal,
    neighbourFaceSign * neighbour.thickness / 2,
  );
  const targetCentre = atStart ? target.start : target.end;
  const corners: Point2[] = [];
  for (const targetSideSign of [1, -1] as const) {
    const targetSide = pointAt(
      targetCentre,
      targetFrame.normal,
      targetSideSign * target.thickness / 2,
    );
    const intersection = linesIntersect(
      targetSide,
      targetFrame.direction,
      neighbourFace,
      neighbourFrame.direction,
    );
    if (!intersection || Math.abs(intersection.leftDistance) > reach) return null;
    corners.push(intersection.point);
  }
  return corners as JoinCorners;
}

function fitEnd(target: Run, neighbours: readonly Run[], atStart: boolean): boolean {
  const key = atStart ? "startCorners" : "endCorners";
  const original = target.solid[key];
  let best = original;
  let bestError = envelopeError(target.solid, target.record.boundsFeet);

  for (const neighbour of neighbours) {
    if (neighbour.solid === target.solid || neighbour.record.elementId === target.record.elementId) {
      continue;
    }
    for (const faceSign of [1, -1] as const) {
      const corners = candidateCorners(target.solid, neighbour.solid, atStart, faceSign);
      if (
        !corners
        || corners.some((point) => !insideEnvelope(point, target.record.boundsFeet))
        // If this end contributes no extremum to the independently persisted
        // joined-body AABB, that AABB cannot corroborate which adjacent face did
        // the trimming. Decline the otherwise plausible crossing.
        || !touchesEnvelope(corners, target.record.boundsFeet)
      ) {
        continue;
      }
      target.solid[key] = corners;
      const error = envelopeError(target.solid, target.record.boundsFeet);
      if (error + MIN_ERROR_IMPROVEMENT_FEET < bestError) {
        best = corners;
        bestError = error;
      }
    }
  }

  target.solid[key] = best;
  return best !== original;
}

function cell(value: number): number {
  return Math.floor(value / INDEX_CELL_FEET);
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

class RunIndex {
  private readonly buckets = new Map<string, Run[]>();

  constructor(runs: readonly Run[]) {
    for (const run of runs) {
      // Candidate admission allows an intersection up to twice the neighbour's
      // thickness beyond its finite centreline. Expanding by that same native
      // quantity guarantees an eligible neighbour occupies a queried cell.
      const expansion = run.solid.thickness * 2;
      const minX = cell(Math.min(run.solid.start.x, run.solid.end.x) - expansion);
      const maxX = cell(Math.max(run.solid.start.x, run.solid.end.x) + expansion);
      const minY = cell(Math.min(run.solid.start.y, run.solid.end.y) - expansion);
      const maxY = cell(Math.max(run.solid.start.y, run.solid.end.y) + expansion);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = cellKey(x, y);
          const bucket = this.buckets.get(key);
          if (bucket) bucket.push(run);
          else this.buckets.set(key, [run]);
        }
      }
    }
  }

  near(run: Run, atStart: boolean): Run[] {
    const endpoint = atStart ? run.solid.start : run.solid.end;
    const expansion = run.solid.thickness * 2;
    const minX = cell(endpoint.x - expansion);
    const maxX = cell(endpoint.x + expansion);
    const minY = cell(endpoint.y - expansion);
    const maxY = cell(endpoint.y + expansion);
    const candidates = new Set<Run>();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const candidate of this.buckets.get(cellKey(x, y)) ?? []) {
          candidates.add(candidate);
        }
      }
    }
    return [...candidates];
  }
}

/**
 * Mutate eligible wall solids with independently corroborated joined corners.
 * Returns the number of wall ends recovered.
 */
export function recoverWallJoinCorners(records: readonly ElementBoundsRecord[]): number {
  const runs: Run[] = [];
  for (const record of records) {
    // A real bounds block is the independent joined-body reading. Synthesised
    // envelopes are derived from the same solid and cannot validate a trim.
    if (record.categoryId !== WALL_CATEGORY_ID || record.recordOffset < 0) continue;
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    for (const solid of solids) runs.push({ record, solid });
  }

  const index = new RunIndex(runs);
  let recovered = 0;
  for (const run of runs) {
    if (fitEnd(run, index.near(run, true), true)) recovered += 1;
    if (fitEnd(run, index.near(run, false), false)) recovered += 1;
  }
  return recovered;
}
