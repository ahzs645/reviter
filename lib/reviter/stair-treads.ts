/**
 * Straight stair treads recovered from the run's own persisted sketch curves.
 *
 * Revit stores a straight run's plan tread lines several times (once for each
 * adjoining face/representation) and stores one rising segment per tread along
 * each walking line.  Neither set is useful as a closed boundary on its own,
 * but together they are an exact description of the stepped top surface:
 *
 * - repeated, parallel plan lines are the tread boundaries;
 * - the short rising segments give direction, tread depth and riser height;
 * - the independently decoded element bounds anchor the vertical band.
 *
 * This deliberately declines winders, spiral stairs and ambiguous line sets.
 * Revit 2027 spiral runs are handled separately by the exact StairsRun plus
 * GCylindricalHelix route; declining them here prevents the straight-flight
 * heuristic from competing with that stronger evidence.
 */
import { noteLimit } from "./limit-census.ts";
import { assembleRings, type SketchCurve, type Point3 } from "./sketch-curves.ts";
import { triangulate } from "./polygon.ts";
import type { Bounds3 } from "./types.ts";

const POINT_TOLERANCE_FEET = 1e-4;
const PLAN_TOLERANCE_FEET = 0.5;
const MIN_REPEAT_COUNT = 3;
const MIN_TREADS = 3;
const MAX_TREADS = 100;
const MIN_RISE_FEET = 0.2;
const MAX_RISE_FEET = 1.5;
const MIN_TREAD_DEPTH_FEET = 0.2;
const MAX_TREAD_DEPTH_FEET = 4;
const PARALLEL_COSINE = 0.995;
const PERPENDICULAR_COSINE = 0.12;
const RELATIVE_SIZE_TOLERANCE = 0.08;
const MIN_FLATTENED_BAND_COVERAGE = 0.8;
const FLATTENED_FLIGHT_DEPTH_MULTIPLIER = 2.5;
const FLATTENED_BAND_AREA_MULTIPLIER = 1.25;

export type RecoveredStairTreads = {
  /** One four-corner horizontal tread, ordered around its perimeter. */
  treads: [Point3, Point3, Point3, Point3][];
  riserHeightFeet: number;
  treadDepthFeet: number;
  source: "native-stair-sketch";
};

export type RecoveredConnectedStairTreadOptions = {
  actualRunWidthFeet: number;
  maximumRiserCount: number;
};

type PlanLine = {
  start: Point3;
  end: Point3;
  count: number;
  length: number;
  center: [number, number];
};

function quantized(value: number): number {
  return Math.round(value / POINT_TOLERANCE_FEET);
}

function pointKey(point: Point3): string {
  return `${quantized(point[0])},${quantized(point[1])},${quantized(point[2])}`;
}

function undirectedLineKey(start: Point3, end: Point3): string {
  const a = pointKey(start);
  const b = pointKey(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function planPointKey(point: Point3): string {
  return `${quantized(point[0])},${quantized(point[1])}`;
}

function undirectedPlanLineKey(start: Point3, end: Point3): string {
  const a = planPointKey(start);
  const b = planPointKey(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function planLength(start: Point3, end: Point3): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function relativeAgreement(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= Math.max(POINT_TOLERANCE_FEET, expected * RELATIVE_SIZE_TOLERANCE);
}

function planBoundsFit(lines: PlanLine[], bounds: Bounds3): boolean {
  const xs = lines.flatMap((line) => [line.start[0], line.end[0]]);
  const ys = lines.flatMap((line) => [line.start[1], line.end[1]]);
  return (
    Math.abs(Math.min(...xs) - bounds.min.x) <= PLAN_TOLERANCE_FEET &&
    Math.abs(Math.max(...xs) - bounds.max.x) <= PLAN_TOLERANCE_FEET &&
    Math.abs(Math.min(...ys) - bounds.min.y) <= PLAN_TOLERANCE_FEET &&
    Math.abs(Math.max(...ys) - bounds.max.y) <= PLAN_TOLERANCE_FEET
  );
}

/**
 * Recover a straight flight's tread rectangles, or `null` when its native curve
 * evidence is not the unambiguous repeated-line representation described above.
 */
export function recoverStraightStairTreads(
  curves: readonly SketchCurve[],
  bounds: Bounds3,
): RecoveredStairTreads | null {
  const repeated = new Map<string, PlanLine>();
  for (const curve of curves) {
    if (curve.kind !== "line") continue;
    if (Math.abs(curve.end[2] - curve.start[2]) > POINT_TOLERANCE_FEET) continue;
    const length = planLength(curve.start, curve.end);
    if (length < POINT_TOLERANCE_FEET) continue;
    const key = undirectedLineKey(curve.start, curve.end);
    const existing = repeated.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      repeated.set(key, {
        start: curve.start,
        end: curve.end,
        count: 1,
        length,
        center: [
          (curve.start[0] + curve.end[0]) / 2,
          (curve.start[1] + curve.end[1]) / 2,
        ],
      });
    }
  }

  const candidates = [...repeated.values()].filter((line) => line.count >= MIN_REPEAT_COUNT);
  if (candidates.length < MIN_TREADS + 1 || candidates.length > MAX_TREADS + 1) {
    if (candidates.length > MAX_TREADS + 1) noteLimit("max-treads");
    return null;
  }

  const width = median(candidates.map((line) => line.length));
  const reference = candidates[0]!;
  const crossX = (reference.end[0] - reference.start[0]) / reference.length;
  const crossY = (reference.end[1] - reference.start[1]) / reference.length;
  for (const line of candidates) {
    if (!relativeAgreement(line.length, width)) return null;
    const dx = (line.end[0] - line.start[0]) / line.length;
    const dy = (line.end[1] - line.start[1]) / line.length;
    if (Math.abs(dx * crossX + dy * crossY) < PARALLEL_COSINE) return null;
  }
  if (!planBoundsFit(candidates, bounds)) return null;

  const treadCount = candidates.length - 1;
  const boundsRise = bounds.max.z - bounds.min.z;
  if (boundsRise <= 0) return null;
  const expectedRise = boundsRise / treadCount;
  if (expectedRise < MIN_RISE_FEET || expectedRise > MAX_RISE_FEET) return null;

  // Short rising segments distinguish a stair grid from any other repeated
  // parallel hatch. Normalising them low-to-high also gives the ascent vector.
  const rising = curves.flatMap((curve) => {
    if (curve.kind !== "line") return [];
    const dz = curve.end[2] - curve.start[2];
    if (Math.abs(dz) < MIN_RISE_FEET || Math.abs(dz) > MAX_RISE_FEET) return [];
    const low = dz > 0 ? curve.start : curve.end;
    const high = dz > 0 ? curve.end : curve.start;
    const depth = planLength(low, high);
    if (depth < MIN_TREAD_DEPTH_FEET || depth > MAX_TREAD_DEPTH_FEET) return [];
    return [{ dx: high[0] - low[0], dy: high[1] - low[1], dz: high[2] - low[2], depth }];
  });
  const matchingRise = rising.filter((segment) => relativeAgreement(segment.dz, expectedRise));
  if (matchingRise.length < treadCount) return null;

  const treadDepth = median(matchingRise.map((segment) => segment.depth));
  const matching = matchingRise.filter((segment) => relativeAgreement(segment.depth, treadDepth));
  if (matching.length < treadCount) return null;
  let runX = matching.reduce((sum, segment) => sum + segment.dx / segment.depth, 0);
  let runY = matching.reduce((sum, segment) => sum + segment.dy / segment.depth, 0);
  const runLength = Math.hypot(runX, runY);
  if (runLength < POINT_TOLERANCE_FEET) return null;
  runX /= runLength;
  runY /= runLength;
  if (Math.abs(runX * crossX + runY * crossY) > PERPENDICULAR_COSINE) return null;

  const ordered = [...candidates].sort(
    (a, b) => a.center[0] * runX + a.center[1] * runY - (b.center[0] * runX + b.center[1] * runY),
  );
  const centerDepths: number[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const a = ordered[index]!.center;
    const b = ordered[index + 1]!.center;
    centerDepths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const recoveredDepth = median(centerDepths);
  if (!relativeAgreement(recoveredDepth, treadDepth)) return null;
  if (centerDepths.some((depth) => !relativeAgreement(depth, recoveredDepth))) return null;

  const treads: [Point3, Point3, Point3, Point3][] = [];
  for (let index = 0; index < treadCount; index += 1) {
    const lower = ordered[index]!;
    const upper = ordered[index + 1]!;
    const direct =
      Math.hypot(lower.start[0] - upper.start[0], lower.start[1] - upper.start[1]) +
      Math.hypot(lower.end[0] - upper.end[0], lower.end[1] - upper.end[1]);
    const crossed =
      Math.hypot(lower.start[0] - upper.end[0], lower.start[1] - upper.end[1]) +
      Math.hypot(lower.end[0] - upper.start[0], lower.end[1] - upper.start[1]);
    const upperStart = direct <= crossed ? upper.start : upper.end;
    const upperEnd = direct <= crossed ? upper.end : upper.start;
    const topZ = bounds.min.z + expectedRise * (index + 1);
    treads.push([
      [lower.start[0], lower.start[1], topZ],
      [upperStart[0], upperStart[1], topZ],
      [upperEnd[0], upperEnd[1], topZ],
      [lower.end[0], lower.end[1], topZ],
    ]);
  }

  return {
    treads,
    riserHeightFeet: expectedRise,
    treadDepthFeet: recoveredDepth,
    source: "native-stair-sketch",
  };
}

function planNear(left: Point3, right: Point3): boolean {
  return (
    Math.abs(left[0] - right[0]) <= POINT_TOLERANCE_FEET &&
    Math.abs(left[1] - right[1]) <= POINT_TOLERANCE_FEET
  );
}

function quarterPoint(line: PlanLine, fraction: number): Point3 {
  return [
    line.start[0] + (line.end[0] - line.start[0]) * fraction,
    line.start[1] + (line.end[1] - line.start[1]) * fraction,
    line.start[2],
  ];
}

/**
 * Recover a curved or winder flight from its persisted cross-width tread
 * boundaries and the two quarter-width rising guide chains.
 *
 * Unlike the straight-flight route, the boundaries may rotate at every step.
 * Revit repeats each complete cross-width boundary and stores rising lines
 * between its quarter points. Those links provide an exact adjacency graph and
 * the elevation of every tread, so no nearest-neighbour ordering is inferred.
 */
export function recoverConnectedStairTreads(
  curves: readonly SketchCurve[],
  bounds: Bounds3,
  options: RecoveredConnectedStairTreadOptions,
): RecoveredStairTreads | null {
  if (
    !Number.isFinite(options.actualRunWidthFeet) ||
    options.actualRunWidthFeet <= 0 ||
    !Number.isSafeInteger(options.maximumRiserCount) ||
    options.maximumRiserCount < MIN_TREADS ||
    options.maximumRiserCount > MAX_TREADS
  ) {
    return null;
  }

  const repeated = new Map<string, PlanLine>();
  for (const curve of curves) {
    if (
      curve.kind !== "line" ||
      Math.abs(curve.end[2] - curve.start[2]) > POINT_TOLERANCE_FEET
    ) {
      continue;
    }
    const length = planLength(curve.start, curve.end);
    if (
      length < POINT_TOLERANCE_FEET ||
      !relativeAgreement(length, options.actualRunWidthFeet)
    ) {
      continue;
    }
    const key = undirectedLineKey(curve.start, curve.end);
    const existing = repeated.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      repeated.set(key, {
        start: curve.start,
        end: curve.end,
        count: 1,
        length,
        center: [
          (curve.start[0] + curve.end[0]) / 2,
          (curve.start[1] + curve.end[1]) / 2,
        ],
      });
    }
  }
  const boundaries = [...repeated.values()].filter(
    (line) => line.count >= MIN_REPEAT_COUNT,
  );
  if (
    boundaries.length < MIN_TREADS + 1 ||
    boundaries.length > options.maximumRiserCount + 1 ||
    !planBoundsFit(boundaries, bounds)
  ) {
    return null;
  }

  type Edge = { from: number; to: number; topZ: number; depths: number[] };
  const edges = new Map<string, Edge>();
  for (const curve of curves) {
    if (curve.kind !== "line") continue;
    const dz = curve.end[2] - curve.start[2];
    if (Math.abs(dz) < MIN_RISE_FEET || Math.abs(dz) > MAX_RISE_FEET) continue;
    const low = dz > 0 ? curve.start : curve.end;
    const high = dz > 0 ? curve.end : curve.start;
    const depth = planLength(low, high);
    if (depth < MIN_TREAD_DEPTH_FEET || depth > MAX_TREAD_DEPTH_FEET) continue;
    const match = (point: Point3): number | null => {
      const matches = boundaries.flatMap((boundary, index) =>
        planNear(point, quarterPoint(boundary, 0.25)) ||
          planNear(point, quarterPoint(boundary, 0.75))
          ? [index]
          : [],
      );
      return matches.length === 1 ? matches[0]! : null;
    };
    const from = match(low);
    const to = match(high);
    if (from == null || to == null || from === to) continue;
    const key = `${from}:${to}`;
    const previous = edges.get(key);
    if (
      previous &&
      Math.abs(previous.topZ - high[2]) > POINT_TOLERANCE_FEET
    ) {
      return null;
    }
    if (previous) previous.depths.push(depth);
    else edges.set(key, { from, to, topZ: high[2], depths: [depth] });
  }
  if (edges.size !== boundaries.length - 1) return null;

  const incoming = new Map<number, number>();
  const outgoing = new Map<number, Edge>();
  for (const edge of edges.values()) {
    if (outgoing.has(edge.from) || incoming.has(edge.to)) return null;
    outgoing.set(edge.from, edge);
    incoming.set(edge.to, edge.from);
  }
  const starts = boundaries.flatMap((_, index) =>
    !incoming.has(index) && outgoing.has(index) ? [index] : [],
  );
  if (starts.length !== 1) return null;

  const ordered: PlanLine[] = [];
  const orderedEdges: Edge[] = [];
  const seen = new Set<number>();
  let current = starts[0]!;
  while (!seen.has(current)) {
    seen.add(current);
    ordered.push(boundaries[current]!);
    const edge = outgoing.get(current);
    if (!edge) break;
    orderedEdges.push(edge);
    current = edge.to;
  }
  if (
    ordered.length !== boundaries.length ||
    orderedEdges.length !== boundaries.length - 1
  ) {
    return null;
  }

  const treads: [Point3, Point3, Point3, Point3][] = [];
  for (let index = 0; index < orderedEdges.length; index += 1) {
    const lower = ordered[index]!;
    const upper = ordered[index + 1]!;
    const direct =
      Math.hypot(
        lower.start[0] - upper.start[0],
        lower.start[1] - upper.start[1],
      ) +
      Math.hypot(
        lower.end[0] - upper.end[0],
        lower.end[1] - upper.end[1],
      );
    const crossed =
      Math.hypot(
        lower.start[0] - upper.end[0],
        lower.start[1] - upper.end[1],
      ) +
      Math.hypot(
        lower.end[0] - upper.start[0],
        lower.end[1] - upper.start[1],
      );
    const upperStart = direct <= crossed ? upper.start : upper.end;
    const upperEnd = direct <= crossed ? upper.end : upper.start;
    const topZ = orderedEdges[index]!.topZ;
    treads.push([
      [lower.start[0], lower.start[1], topZ],
      [upperStart[0], upperStart[1], topZ],
      [upperEnd[0], upperEnd[1], topZ],
      [lower.end[0], lower.end[1], topZ],
    ]);
  }
  // The first or last riser line may be omitted when Revit stores that end as
  // the run boundary itself. Consecutive guide elevations still give every
  // independently persisted riser height without inventing the missing end.
  const rises = orderedEdges
    .slice(1)
    .map((edge, index) => edge.topZ - orderedEdges[index]!.topZ);
  if (rises.length === 0) return null;
  if (
    rises.some(
      (rise) =>
        rise < MIN_RISE_FEET ||
        rise > MAX_RISE_FEET ||
        !relativeAgreement(rise, median(rises)),
    )
  ) {
    return null;
  }
  return {
    treads,
    riserHeightFeet: median(rises),
    treadDepthFeet: median(orderedEdges.flatMap((edge) => edge.depths)),
    source: "native-stair-sketch",
  };
}

/**
 * Recover a multi-flight run from Revit's flattened tread plan plus its
 * independently persisted sloping guide chains.
 *
 * Some assembled/switchback runs do not repeat their cross-width lines at
 * every tread elevation. Instead, those lines are all stored on one or two
 * plan elevations while two guide chains retain the real rise. A guide point
 * lands exactly at one-quarter or three-quarters of its corresponding tread
 * line. That exact incidence lets us join the two representations without
 * guessing a direction, spacing, width, or elevation.
 */
export function recoverGuideChainStairTreads(
  curves: readonly SketchCurve[],
  bounds: Bounds3,
  options: RecoveredConnectedStairTreadOptions,
): RecoveredStairTreads | null {
  if (
    !Number.isFinite(options.actualRunWidthFeet) ||
    options.actualRunWidthFeet <= 0 ||
    !Number.isSafeInteger(options.maximumRiserCount) ||
    options.maximumRiserCount < MIN_TREADS ||
    options.maximumRiserCount > MAX_TREADS
  ) {
    return null;
  }

  // The same plan line may be emitted at both the bottom and top elevation.
  // Collapse only in XY here: elevation deliberately comes from the guide
  // chains, never from these flattened plan records.
  const planLines = new Map<string, PlanLine>();
  const minimumWidth = options.actualRunWidthFeet * 0.7;
  const maximumWidth = options.actualRunWidthFeet * 2.5;
  for (const curve of curves) {
    if (
      curve.kind !== "line" ||
      Math.abs(curve.end[2] - curve.start[2]) > POINT_TOLERANCE_FEET
    ) {
      continue;
    }
    const length = planLength(curve.start, curve.end);
    if (length < minimumWidth || length > maximumWidth) continue;
    const key = undirectedPlanLineKey(curve.start, curve.end);
    const existing = planLines.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      planLines.set(key, {
        start: curve.start,
        end: curve.end,
        count: 1,
        length,
        center: [
          (curve.start[0] + curve.end[0]) / 2,
          (curve.start[1] + curve.end[1]) / 2,
        ],
      });
    }
  }
  const boundaries = [...planLines.values()];
  if (boundaries.length < MIN_TREADS + 1 || boundaries.length > MAX_TREADS + 1) {
    if (boundaries.length > MAX_TREADS + 1) noteLimit("max-treads");
    return null;
  }

  type Guide = {
    low: Point3;
    high: Point3;
    rise: number;
    depth: number;
  };
  const guides: Guide[] = [];
  for (const curve of curves) {
    if (curve.kind !== "line") continue;
    const dz = curve.end[2] - curve.start[2];
    if (Math.abs(dz) < MIN_RISE_FEET || Math.abs(dz) > MAX_RISE_FEET) continue;
    const low = dz > 0 ? curve.start : curve.end;
    const high = dz > 0 ? curve.end : curve.start;
    const depth = planLength(low, high);
    if (depth < MIN_TREAD_DEPTH_FEET) continue;
    guides.push({ low, high, rise: high[2] - low[2], depth });
  }
  if (guides.length < MIN_TREADS) return null;

  // Exact Revit stair guides share one persisted riser height. Keep the
  // dominant cohort and decline mixed or weak evidence.
  const riseBuckets = new Map<number, Guide[]>();
  for (const guide of guides) {
    const key = quantized(guide.rise);
    const bucket = riseBuckets.get(key);
    if (bucket) bucket.push(guide);
    else riseBuckets.set(key, [guide]);
  }
  const rankedBuckets = [...riseBuckets.values()].sort(
    (left, right) => right.length - left.length,
  );
  const dominant = rankedBuckets[0] ?? [];
  if (
    dominant.length < MIN_TREADS ||
    (rankedBuckets[1]?.length ?? 0) === dominant.length
  ) {
    return null;
  }

  const matchBoundary = (point: Point3): number | null => {
    const matches = boundaries.flatMap((boundary, index) =>
      planNear(point, quarterPoint(boundary, 0.25)) ||
        planNear(point, quarterPoint(boundary, 0.75))
        ? [index]
        : [],
    );
    return matches.length === 1 ? matches[0]! : null;
  };

  type Edge = {
    from: number;
    to: number;
    topZ: number;
    rises: number[];
    depths: number[];
  };
  const edges = new Map<string, Edge>();
  for (const guide of dominant) {
    const from = matchBoundary(guide.low);
    const to = matchBoundary(guide.high);
    if (from == null || to == null || from === to) continue;
    const key = `${from}:${to}`;
    const previous = edges.get(key);
    if (
      previous &&
      Math.abs(previous.topZ - guide.high[2]) > POINT_TOLERANCE_FEET
    ) {
      return null;
    }
    if (previous) {
      previous.rises.push(guide.rise);
      previous.depths.push(guide.depth);
    } else {
      edges.set(key, {
        from,
        to,
        topZ: guide.high[2],
        rises: [guide.rise],
        depths: [guide.depth],
      });
    }
  }
  if (edges.size < MIN_TREADS || edges.size > options.maximumRiserCount + 1) {
    return null;
  }

  const incoming = new Map<number, number>();
  const outgoing = new Map<number, Edge>();
  for (const edge of edges.values()) {
    if (outgoing.has(edge.from) || incoming.has(edge.to)) return null;
    outgoing.set(edge.from, edge);
    incoming.set(edge.to, edge.from);
  }
  const starts = boundaries.flatMap((_, index) =>
    !incoming.has(index) && outgoing.has(index) ? [index] : [],
  );
  if (starts.length !== 1) return null;

  const ordered: PlanLine[] = [];
  const orderedEdges: Edge[] = [];
  const seen = new Set<number>();
  let current = starts[0]!;
  while (!seen.has(current)) {
    seen.add(current);
    ordered.push(boundaries[current]!);
    const edge = outgoing.get(current);
    if (!edge) break;
    orderedEdges.push(edge);
    current = edge.to;
  }
  if (
    orderedEdges.length !== edges.size ||
    ordered.length !== edges.size + 1
  ) {
    return null;
  }

  const boundsTolerance = PLAN_TOLERANCE_FEET;
  const withinBounds = (point: Point3): boolean =>
    point[0] >= bounds.min.x - boundsTolerance &&
    point[0] <= bounds.max.x + boundsTolerance &&
    point[1] >= bounds.min.y - boundsTolerance &&
    point[1] <= bounds.max.y + boundsTolerance;
  if (ordered.some((line) => !withinBounds(line.start) || !withinBounds(line.end))) {
    return null;
  }

  const treads: [Point3, Point3, Point3, Point3][] = [];
  for (let index = 0; index < orderedEdges.length; index += 1) {
    const lower = ordered[index]!;
    const upper = ordered[index + 1]!;
    const direct =
      Math.hypot(
        lower.start[0] - upper.start[0],
        lower.start[1] - upper.start[1],
      ) +
      Math.hypot(
        lower.end[0] - upper.end[0],
        lower.end[1] - upper.end[1],
      );
    const crossed =
      Math.hypot(
        lower.start[0] - upper.end[0],
        lower.start[1] - upper.end[1],
      ) +
      Math.hypot(
        lower.end[0] - upper.start[0],
        lower.end[1] - upper.start[1],
      );
    const upperStart = direct <= crossed ? upper.start : upper.end;
    const upperEnd = direct <= crossed ? upper.end : upper.start;
    const topZ = orderedEdges[index]!.topZ;
    if (
      topZ < bounds.min.z - boundsTolerance ||
      topZ > bounds.max.z + boundsTolerance
    ) {
      return null;
    }
    treads.push([
      [lower.start[0], lower.start[1], topZ],
      [upperStart[0], upperStart[1], topZ],
      [upperEnd[0], upperEnd[1], topZ],
      [lower.end[0], lower.end[1], topZ],
    ]);
  }

  return {
    treads,
    riserHeightFeet: median(dominant.map((guide) => guide.rise)),
    treadDepthFeet: median(orderedEdges.flatMap((edge) => edge.depths)),
    source: "native-stair-sketch",
  };
}

type ProfileCurve = {
  curve: SketchCurve;
  count: number;
  elevations: number[];
};

function profileSamples(profile: ProfileCurve): Point3[] {
  return [
    profile.curve.start,
    ...profile.curve.interior,
    profile.curve.end,
  ];
}

function distanceToSegmentPlan(
  point: Point3,
  start: Point3,
  end: Point3,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= POINT_TOLERANCE_FEET ** 2) {
    return planLength(point, start);
  }
  const parameter = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + parameter * dx),
    point[1] - (start[1] + parameter * dy),
  );
}

function distanceToProfilePlan(
  point: Point3,
  profile: ProfileCurve,
): number {
  const samples = profileSamples(profile);
  let distance = Infinity;
  for (let index = 0; index + 1 < samples.length; index += 1) {
    distance = Math.min(
      distance,
      distanceToSegmentPlan(point, samples[index]!, samples[index + 1]!),
    );
  }
  return distance;
}

function planProfiles(
  curves: readonly SketchCurve[],
): ProfileCurve[] {
  const profiles = new Map<string, ProfileCurve>();
  for (const curve of curves) {
    if (Math.abs(curve.end[2] - curve.start[2]) > POINT_TOLERANCE_FEET) {
      continue;
    }
    const key = undirectedPlanLineKey(curve.start, curve.end);
    const existing = profiles.get(`${curve.kind}:${key}`);
    if (existing) {
      existing.count += 1;
      existing.elevations.push(curve.start[2]);
    } else {
      profiles.set(`${curve.kind}:${key}`, {
        curve,
        count: 1,
        elevations: [curve.start[2]],
      });
    }
  }
  return [...profiles.values()];
}

function resampleProfile(
  profile: ProfileCurve,
  count: number,
): Point3[] {
  const samples = profileSamples(profile);
  const cumulative = [0];
  for (let index = 0; index + 1 < samples.length; index += 1) {
    cumulative.push(
      cumulative[index]! +
        planLength(samples[index]!, samples[index + 1]!),
    );
  }
  const total = cumulative.at(-1)!;
  if (total <= POINT_TOLERANCE_FEET) return [];
  const output: Point3[] = [];
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const target = (total * sampleIndex) / (count - 1);
    let segment = 0;
    while (
      segment + 1 < cumulative.length &&
      cumulative[segment + 1]! < target
    ) {
      segment += 1;
    }
    const start = samples[segment]!;
    const end = samples[Math.min(segment + 1, samples.length - 1)]!;
    const span = cumulative[Math.min(segment + 1, cumulative.length - 1)]! -
      cumulative[segment]!;
    const fraction = span <= POINT_TOLERANCE_FEET
      ? 0
      : (target - cumulative[segment]!) / span;
    output.push([
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
      start[2],
    ]);
  }
  return output;
}

function profileTreadQuads(
  first: ProfileCurve,
  second: ProfileCurve,
  topZ: number,
): [Point3, Point3, Point3, Point3][] {
  const sampleCount = Math.max(
    2,
    profileSamples(first).length,
    profileSamples(second).length,
  );
  const firstSamples = resampleProfile(first, sampleCount);
  let secondSamples = resampleProfile(second, sampleCount);
  if (
    firstSamples.length !== sampleCount ||
    secondSamples.length !== sampleCount
  ) {
    return [];
  }
  const direct =
    planLength(firstSamples[0]!, secondSamples[0]!) +
    planLength(firstSamples.at(-1)!, secondSamples.at(-1)!);
  const crossed =
    planLength(firstSamples[0]!, secondSamples.at(-1)!) +
    planLength(firstSamples.at(-1)!, secondSamples[0]!);
  if (crossed < direct) secondSamples = [...secondSamples].reverse();
  const quads: [Point3, Point3, Point3, Point3][] = [];
  let rejectedBridgeSegments = 0;
  for (let index = 0; index + 1 < sampleCount; index += 1) {
    const firstDepth = planLength(firstSamples[index]!, secondSamples[index]!);
    const secondDepth = planLength(
      firstSamples[index + 1]!,
      secondSamples[index + 1]!,
    );
    // Profiles with nearby endpoints can bow onto opposite sides of a curved
    // run. Resampling those curves by fraction then joins their interiors with
    // a broad chord — object 1460781 produced 13.7 ft "tread" edges through
    // the centre of its two flights. A winder may legitimately fan wider than
    // the ordinary tread-depth ceiling at its outside edge, but one edge must
    // remain on the walking side. If both exceed the same 4 ft evidence limit
    // used by the guide decoders, this patch is a profile bridge, not a tread.
    if (
      firstDepth > MAX_TREAD_DEPTH_FEET &&
      secondDepth > MAX_TREAD_DEPTH_FEET
    ) {
      rejectedBridgeSegments += 1;
      continue;
    }
    quads.push([
      [firstSamples[index]![0], firstSamples[index]![1], topZ],
      [secondSamples[index]![0], secondSamples[index]![1], topZ],
      [
        secondSamples[index + 1]![0],
        secondSamples[index + 1]![1],
        topZ,
      ],
      [firstSamples[index + 1]![0], firstSamples[index + 1]![1], topZ],
    ]);
  }
  // A paired set of complementary arcs is not a tread-depth bridge: it is the
  // two persisted halves of a circular stair landing. UNBC run 1460781 writes
  // its mid-flight landing this way. Joining corresponding samples produces
  // 13.7 ft chords through the landing, while dropping those chords leaves
  // only 5.1 ft² of edge fragments where the paired IFC has a 149.1 ft² disk.
  //
  // Admit the disk only when the combined native samples independently prove
  // one complete circle: dense angular coverage and a common radius within
  // one percent. Opposing arcs at different radii retain the conservative
  // bridge rejection above. Fan cells use degenerate fourth corners so the
  // existing quad renderer emits one triangle per sector and cancels shared
  // radial sides exactly like ordinary equal-height tread cells.
  if (rejectedBridgeSegments > 0) {
    const landing = fullCircleLandingQuads(firstSamples, secondSamples, topZ);
    if (landing.length) return landing;
  }
  return quads;
}

function polygonAreaPlan(points: readonly Point3[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += point[0] * next[1] - next[0] * point[1];
  }
  return twiceArea / 2;
}

function profileCell(
  first: ProfileCurve,
  second: ProfileCurve,
  topZ: number,
): Point3[] {
  const direct =
    planLength(first.curve.start, second.curve.start) +
    planLength(first.curve.end, second.curve.end);
  const crossed =
    planLength(first.curve.start, second.curve.end) +
    planLength(first.curve.end, second.curve.start);
  const secondStart = direct <= crossed ? second.curve.start : second.curve.end;
  const secondEnd = direct <= crossed ? second.curve.end : second.curve.start;
  return [
    [first.curve.start[0], first.curve.start[1], topZ],
    [secondStart[0], secondStart[1], topZ],
    [secondEnd[0], secondEnd[1], topZ],
    [first.curve.end[0], first.curve.end[1], topZ],
  ];
}

function clipPolygonToConvexCell(
  subject: readonly Point3[],
  cell: readonly Point3[],
): Point3[] {
  const winding = Math.sign(polygonAreaPlan(cell));
  if (winding === 0) return [];
  const cross = (a: Point3, b: Point3, c: Point3) =>
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
  // Every turn must agree with the cell winding. A bow-tie or a concave cell
  // is not a safe clipping half-plane set.
  if (cell.some((point, index) =>
    cross(point, cell[(index + 1) % cell.length]!, cell[(index + 2) % cell.length]!) *
      winding < -POINT_TOLERANCE_FEET
  )) {
    return [];
  }

  let output = [...subject];
  for (let edgeIndex = 0; edgeIndex < cell.length; edgeIndex += 1) {
    const clipStart = cell[edgeIndex]!;
    const clipEnd = cell[(edgeIndex + 1) % cell.length]!;
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (point: Point3) =>
      cross(clipStart, clipEnd, point) * winding >= -POINT_TOLERANCE_FEET;
    const intersection = (start: Point3, end: Point3): Point3 => {
      const runX = end[0] - start[0];
      const runY = end[1] - start[1];
      const clipX = clipEnd[0] - clipStart[0];
      const clipY = clipEnd[1] - clipStart[1];
      const denominator = runX * clipY - runY * clipX;
      if (Math.abs(denominator) <= POINT_TOLERANCE_FEET ** 2) return end;
      const t =
        ((clipStart[0] - start[0]) * clipY -
          (clipStart[1] - start[1]) * clipX) /
        denominator;
      return [
        start[0] + runX * t,
        start[1] + runY * t,
        start[2],
      ];
    };
    let previous = input.at(-1)!;
    let previousInside = inside(previous);
    for (const point of input) {
      const pointInside = inside(point);
      if (pointInside !== previousInside) {
        output.push(intersection(previous, point));
      }
      if (pointInside) output.push(point);
      previous = point;
      previousInside = pointInside;
    }
  }
  return output;
}

/**
 * Clip one flattened tread band to the run's independently closed plan ring.
 *
 * A concave multi-flight run can persist one tread line across several arms of
 * its footprint. Joining the line endpoints directly fills the void between
 * those arms. Triangulating the native outer ring first makes every clipping
 * subject convex and, importantly, keeps disconnected intersections as
 * separate cells instead of inventing a bridge between them.
 */
function clippedProfileTreadQuads(
  first: ProfileCurve,
  second: ProfileCurve,
  topZ: number,
  footprint: readonly Point3[],
  footprintIndices: readonly number[],
): [Point3, Point3, Point3, Point3][] {
  const cell = profileCell(first, second, topZ);
  if (!footprintIndices.length) return [];
  const quads: [Point3, Point3, Point3, Point3][] = [];
  for (let index = 0; index + 2 < footprintIndices.length; index += 3) {
    const subject = [
      footprint[footprintIndices[index]!]!,
      footprint[footprintIndices[index + 1]!]!,
      footprint[footprintIndices[index + 2]!]!,
    ].map(([x, y]) => [x, y, topZ] as Point3);
    const clipped = clipPolygonToConvexCell(subject, cell);
    if (clipped.length < 3) continue;
    for (let corner = 1; corner + 1 < clipped.length; corner += 1) {
      const a = clipped[0]!;
      const b = clipped[corner]!;
      const c = clipped[corner + 1]!;
      if (Math.abs(polygonAreaPlan([a, b, c])) <= POINT_TOLERANCE_FEET ** 2) {
        continue;
      }
      quads.push([a, b, c, a]);
    }
  }
  return quads;
}

function safeFlattenedTreadBand(
  first: ProfileCurve,
  second: ProfileCurve,
  topZ: number,
  maximumLocalDepth: number,
  footprint: readonly Point3[] | null,
  footprintIndices: readonly number[],
): [Point3, Point3, Point3, Point3][] {
  const depth = profilePairDistance(first, second);
  // A minimum-spanning path may connect separate flights so the persisted
  // bottom profile can order the whole run. Such a link is not itself a tread.
  if (depth > maximumLocalDepth + POINT_TOLERANCE_FEET) return [];

  const band = footprint
    ? clippedProfileTreadQuads(
        first,
        second,
        topZ,
        footprint,
        footprintIndices,
      )
    : profileTreadQuads(first, second, topZ);
  if (!band.length) return [];

  const localWidth = (
    planLength(first.curve.start, first.curve.end) +
    planLength(second.curve.start, second.curve.end)
  ) / 2;
  const maximumArea =
    localWidth * depth * FLATTENED_BAND_AREA_MULTIPLIER;
  const area = band.reduce(
    (total, tread) => total + Math.abs(polygonAreaPlan(tread)),
    0,
  );
  if (
    !Number.isFinite(area) ||
    area <= POINT_TOLERANCE_FEET ** 2 ||
    area > maximumArea + POINT_TOLERANCE_FEET
  ) {
    return [];
  }
  return band;
}

function fullCircleLandingQuads(
  firstSamples: readonly Point3[],
  secondSamples: readonly Point3[],
  topZ: number,
): [Point3, Point3, Point3, Point3][] {
  const unique = new Map<string, Point3>();
  for (const point of [...firstSamples, ...secondSamples]) {
    unique.set(planPointKey(point), [point[0], point[1], topZ]);
  }
  const points = [...unique.values()];
  if (points.length < 8) return [];

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const center: Point3 = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    topZ,
  ];
  const radii = points.map((point) => planLength(center, point));
  const radius = median(radii);
  if (radius <= MAX_TREAD_DEPTH_FEET) return [];
  if (
    Math.max(...radii) - Math.min(...radii) >
    Math.max(0.02, radius * 0.01)
  ) {
    return [];
  }

  const ordered = points
    .map((point) => ({
      point,
      angle: Math.atan2(point[1] - center[1], point[0] - center[0]),
    }))
    .sort((left, right) => left.angle - right.angle);
  let maximumGap = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const angle = ordered[index]!.angle;
    const next = index + 1 < ordered.length
      ? ordered[index + 1]!.angle
      : ordered[0]!.angle + Math.PI * 2;
    maximumGap = Math.max(maximumGap, next - angle);
  }
  // Native arcs are sampled at pi/16. Keep a little room for deduplicated
  // endpoints and coarse fixtures, but a semicircle or partial arc must fail.
  if (maximumGap > Math.PI / 5) return [];

  return ordered.map(({ point }, index) => [
    center,
    point,
    ordered[(index + 1) % ordered.length]!.point,
    center,
  ]);
}

type RisingGuide = {
  low: Point3;
  high: Point3;
  rise: number;
};

function dominantRisingGuides(
  curves: readonly SketchCurve[],
): RisingGuide[] {
  const buckets = new Map<number, RisingGuide[]>();
  const seen = new Set<string>();
  for (const curve of curves) {
    if (curve.kind !== "line") continue;
    const delta = curve.end[2] - curve.start[2];
    if (
      Math.abs(delta) < MIN_RISE_FEET ||
      Math.abs(delta) > MAX_RISE_FEET
    ) {
      continue;
    }
    const low = delta > 0 ? curve.start : curve.end;
    const high = delta > 0 ? curve.end : curve.start;
    const key = `${pointKey(low)}>${pointKey(high)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const guide = { low, high, rise: high[2] - low[2] };
    const riseKey = quantized(guide.rise);
    const bucket = buckets.get(riseKey);
    if (bucket) bucket.push(guide);
    else buckets.set(riseKey, [guide]);
  }
  return [...buckets.values()].sort(
    (left, right) => right.length - left.length,
  )[0] ?? [];
}

function longestGuideChain(guides: readonly RisingGuide[]): RisingGuide[] {
  const byLow = new Map<string, RisingGuide>();
  const highKeys = new Set<string>();
  for (const guide of guides) {
    const lowKey = pointKey(guide.low);
    if (byLow.has(lowKey)) continue;
    byLow.set(lowKey, guide);
    highKeys.add(pointKey(guide.high));
  }
  const starts = guides.filter((guide) => !highKeys.has(pointKey(guide.low)));
  const chains = starts.map((start) => {
    const chain: RisingGuide[] = [];
    const seen = new Set<string>();
    let current: RisingGuide | undefined = start;
    while (current && !seen.has(pointKey(current.low))) {
      seen.add(pointKey(current.low));
      chain.push(current);
      current = byLow.get(pointKey(current.high));
    }
    return chain;
  });
  return chains.sort((left, right) => right.length - left.length)[0] ?? [];
}

/**
 * Recover curved, spiral/winder, and monumental tread profiles from the run's
 * repeated horizontal curves plus one complete persisted rising guide chain.
 *
 * Guide endpoints select the profiles and their elevations. Curves retain the
 * full cross-width shape (including arcs); no run width or nearest-neighbour
 * tread order is inferred. The run bounds independently certify the exact
 * number of riser intervals represented by the chain.
 */
export function recoverProfiledGuideStairTreads(
  curves: readonly SketchCurve[],
  bounds: Bounds3,
  options: RecoveredConnectedStairTreadOptions,
): RecoveredStairTreads | null {
  const repeatedProfiles = planProfiles(curves).filter(
    (profile) =>
      profile.count >= 2 &&
      profileSamples(profile).length >= 2,
  );
  // Curved runs persist their tread profiles as arcs and duplicate guide-plan
  // lines beside them. Monumental straight runs use the inverse pattern: their
  // true profiles repeat five or eight times, while guide-plan lines repeat
  // only twice. Select the stronger native cohort before matching endpoints.
  const repeatedArcs = repeatedProfiles.filter(
    (profile) => profile.curve.kind === "arc",
  );
  const profiles = repeatedArcs.length >= MIN_TREADS + 1
    ? repeatedArcs
    : repeatedProfiles.filter(
        (profile) =>
          profile.curve.kind === "line" && profile.count >= 3,
      );
  const guides = dominantRisingGuides(curves);
  const chain = longestGuideChain(guides);
  if (profiles.length < MIN_TREADS + 1 || chain.length < MIN_TREADS) {
    return null;
  }
  const rise = median(chain.map((guide) => guide.rise));
  const representedRisers = Math.round(
    (bounds.max.z - bounds.min.z) / rise,
  );
  if (
    representedRisers < MIN_TREADS ||
    representedRisers > options.maximumRiserCount ||
    chain.length !== representedRisers - 1 ||
    !relativeAgreement(
      bounds.max.z - bounds.min.z,
      representedRisers * rise,
    )
  ) {
    return null;
  }

  const match = (point: Point3): number | null => {
    const ranked = profiles
      .map((profile, index) => ({
        index,
        distance: distanceToProfilePlan(point, profile),
      }))
      .sort((left, right) => left.distance - right.distance);
    const first = ranked[0];
    const second = ranked[1];
    if (
      !first ||
      first.distance > 2 ||
      (second && second.distance - first.distance < 0.25)
    ) {
      return null;
    }
    return first.index;
  };

  const lowProfiles = chain.map((guide) => match(guide.low));
  const highProfiles = chain.map((guide) => match(guide.high));
  if (lowProfiles.some((profile) => profile == null)) return null;

  let pairs: readonly (readonly [number, number])[];
  const direct = chain.every(
    (_, index) =>
      highProfiles[index] != null &&
      lowProfiles[index] !== highProfiles[index] &&
      (index === 0 || lowProfiles[index] === highProfiles[index - 1]),
  );
  if (direct) {
    pairs = chain.map((_, index) => [
      lowProfiles[index]!,
      highProfiles[index]!,
    ] as const);
  } else {
    const orderedLow = lowProfiles as number[];
    if (
      new Set(orderedLow).size !== orderedLow.length ||
      orderedLow.slice(1).some(
        (profile, index) => profile !== highProfiles[index],
      )
    ) {
      return null;
    }
    const used = new Set(orderedLow);
    const first = profiles[orderedLow[0]!]!;
    const unused = profiles
      .map((profile, index) => ({ profile, index }))
      .filter(({ index }) => !used.has(index))
      .map(({ profile, index }) => ({
        index,
        distance:
          planLength(profile.curve.start, first.curve.start) +
          planLength(profile.curve.end, first.curve.end),
      }))
      .sort((left, right) => left.distance - right.distance);
    if (
      !unused[0] ||
      (unused[1] &&
        unused[1].distance - unused[0].distance < POINT_TOLERANCE_FEET)
    ) {
      return null;
    }
    pairs = orderedLow.map((profile, index) => [
      index === 0 ? unused[0]!.index : orderedLow[index - 1]!,
      profile,
    ] as const);
  }

  const treads = pairs.flatMap(([first, second], index) =>
    profileTreadQuads(
      profiles[first]!,
      profiles[second]!,
      chain[index]!.low[2],
    ),
  );
  if (treads.length < pairs.length) return null;
  return {
    treads,
    riserHeightFeet: rise,
    treadDepthFeet: median(
      pairs.map(([first, second]) =>
        (
          planLength(
            profiles[first]!.curve.start,
            profiles[second]!.curve.start,
          ) +
          planLength(
            profiles[first]!.curve.end,
            profiles[second]!.curve.end,
          )
        ) / 2
      ),
    ),
    source: "native-stair-sketch",
  };
}

function profilePairDistance(
  first: ProfileCurve,
  second: ProfileCurve,
): number {
  const direct =
    planLength(first.curve.start, second.curve.start) +
    planLength(first.curve.end, second.curve.end);
  const crossed =
    planLength(first.curve.start, second.curve.end) +
    planLength(first.curve.end, second.curve.start);
  return Math.min(direct, crossed) / 2;
}

/**
 * Recover a flattened complex run whose tread profiles are all persisted at
 * one plan elevation. Revit duplicates the straight profiles, retains each
 * exact-width winder profile once, and repeats the base profile at the run's
 * bottom elevation. Those three facts yield a unique minimum spanning path;
 * any branch, count mismatch, or missing base endpoint is declined.
 */
export function recoverFlattenedProfileStairTreads(
  curves: readonly SketchCurve[],
  bounds: Bounds3,
  options: RecoveredConnectedStairTreadOptions,
): RecoveredStairTreads | null {
  const all = planProfiles(curves).filter(
    (profile) => profile.curve.kind === "line",
  );
  const repeated = all.filter((profile) => profile.count >= 2);
  if (repeated.length < MIN_TREADS) return null;
  const directions = new Map<number, number>();
  for (const profile of repeated) {
    const dx = profile.curve.end[0] - profile.curve.start[0];
    const dy = profile.curve.end[1] - profile.curve.start[1];
    const angle = Math.round(
      (Math.atan2(dy, dx) % Math.PI) / 1e-4,
    );
    directions.set(angle, (directions.get(angle) ?? 0) + 1);
  }
  const dominantDirection = [...directions].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  if (dominantDirection == null) return null;
  const repeatedWideProfiles = all.filter((profile) =>
    profile.count >= 2 &&
    planLength(profile.curve.start, profile.curve.end) >=
      options.actualRunWidthFeet - POINT_TOLERANCE_FEET
  );
  const dominantProfiles = all.filter((profile) => {
    const length = planLength(profile.curve.start, profile.curve.end);
    const dx = profile.curve.end[0] - profile.curve.start[0];
    const dy = profile.curve.end[1] - profile.curve.start[1];
    const direction = Math.round(
      (Math.atan2(dy, dx) % Math.PI) / 1e-4,
    );
    return (
      (profile.count >= 2 &&
        direction === dominantDirection &&
        length >= options.actualRunWidthFeet - POINT_TOLERANCE_FEET) ||
      Math.abs(length - options.actualRunWidthFeet) <=
        Math.max(
          POINT_TOLERANCE_FEET,
          options.actualRunWidthFeet * 0.01,
        )
    );
  });
  const riserCount = options.maximumRiserCount;
  // Most flattened runs repeat one parallel cohort and retain rotated winder
  // profiles only once at the exact native run width. Monumental and broad
  // switchback runs can instead duplicate every cross-run profile, including
  // the rotated transition profiles. Accept that second representation only
  // when its independent profile count exactly equals the native riser count;
  // the graph, bottom-elevation and rise checks below still have to prove one
  // unbranched flight before any geometry is emitted.
  const profiles = repeatedWideProfiles.length === riserCount
    ? repeatedWideProfiles
    : dominantProfiles;
  if (profiles.length !== riserCount || riserCount > MAX_TREADS) {
    if (profiles.length === riserCount && riserCount > MAX_TREADS) noteLimit("max-treads");
    return null;
  }

  const included = new Set<number>([0]);
  const edges: { first: number; second: number; distance: number }[] = [];
  while (included.size < profiles.length) {
    let best:
      | { first: number; second: number; distance: number }
      | undefined;
    for (const first of included) {
      for (let second = 0; second < profiles.length; second += 1) {
        if (included.has(second)) continue;
        const distance = profilePairDistance(
          profiles[first]!,
          profiles[second]!,
        );
        if (!best || distance < best.distance) {
          best = { first, second, distance };
        }
      }
    }
    if (!best) return null;
    edges.push(best);
    included.add(best.second);
  }
  const adjacency = profiles.map(() => [] as number[]);
  for (const edge of edges) {
    adjacency[edge.first]!.push(edge.second);
    adjacency[edge.second]!.push(edge.first);
  }
  const endpoints = adjacency.flatMap((neighbours, index) =>
    neighbours.length === 1 ? [index] : [],
  );
  if (
    endpoints.length !== 2 ||
    adjacency.some((neighbours) => neighbours.length > 2)
  ) {
    return null;
  }
  const bottomEndpoints = endpoints.filter((index) =>
    profiles[index]!.elevations.some(
      (elevation) => Math.abs(elevation - bounds.min.z) <= POINT_TOLERANCE_FEET,
    ),
  );
  if (bottomEndpoints.length !== 1) return null;

  const ordered: number[] = [];
  let previous = -1;
  let current = bottomEndpoints[0]!;
  while (current >= 0) {
    ordered.push(current);
    const next = adjacency[current]!.find((candidate) => candidate !== previous);
    previous = current;
    current = next ?? -1;
  }
  if (ordered.length !== profiles.length) return null;
  const rise = (bounds.max.z - bounds.min.z) / riserCount;
  if (rise < MIN_RISE_FEET || rise > MAX_RISE_FEET) return null;
  const orderedDistances = ordered.slice(0, -1).map((profile, index) =>
    profilePairDistance(
      profiles[profile]!,
      profiles[ordered[index + 1]!]!,
    )
  );
  const ordinaryDepths = orderedDistances.filter((depth) =>
    depth >= MIN_TREAD_DEPTH_FEET && depth <= MAX_TREAD_DEPTH_FEET
  );
  if (ordinaryDepths.length < MIN_TREADS) return null;
  const nominalLocalDepth = median(ordinaryDepths);
  const maximumLocalDepth = Math.min(
    MAX_TREAD_DEPTH_FEET,
    Math.max(
      nominalLocalDepth + POINT_TOLERANCE_FEET,
      nominalLocalDepth * FLATTENED_FLIGHT_DEPTH_MULTIPLIER,
    ),
  );
  const footprint = assembleRings([...curves])[0];
  const certifiedFootprint =
    footprint?.length >= 3 &&
    footprint.every(([x, y]) =>
      x >= bounds.min.x - PLAN_TOLERANCE_FEET &&
      x <= bounds.max.x + PLAN_TOLERANCE_FEET &&
      y >= bounds.min.y - PLAN_TOLERANCE_FEET &&
      y <= bounds.max.y + PLAN_TOLERANCE_FEET
    )
      ? footprint
      : null;
  const footprintIndices = certifiedFootprint
    ? triangulate(certifiedFootprint.map(([x, y]) => [x, y] as [number, number]))
    : [];
  const treadBands = ordered.slice(0, -1).map((profile, index) => {
    const first = profiles[profile]!;
    const second = profiles[ordered[index + 1]!]!;
    const topZ = bounds.min.z + rise * (index + 1);
    return safeFlattenedTreadBand(
      first,
      second,
      topZ,
      maximumLocalDepth,
      certifiedFootprint,
      footprintIndices,
    );
  });
  const representedBands = treadBands.filter((band) => band.length > 0);
  // A legacy/sketched multi-flight run can leave its landing transitions in a
  // separate native object. In that representation the exact-count profile
  // path is still strong evidence for the flight bands, while a few wide MST
  // links correctly have no intersection with the run's own closed footprint.
  // Keep the independently clipped flight cells when at least four fifths of
  // the native riser intervals are present; a sparse or ambiguous profile set
  // still declines to the ordinary fallback.
  if (
    representedBands.length < MIN_TREADS ||
    representedBands.length / treadBands.length < MIN_FLATTENED_BAND_COVERAGE
  ) {
    return null;
  }
  const treads = representedBands.flat();
  return {
    treads,
    riserHeightFeet: rise,
    treadDepthFeet: median(
      orderedDistances.filter((depth) => depth <= maximumLocalDepth),
    ),
    source: "native-stair-sketch",
  };
}
