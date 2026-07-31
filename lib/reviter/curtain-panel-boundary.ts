/**
 * Recovering the clipped outline of an edge curtain panel.
 *
 * Revit caches a curtain panel as a rectangular local shape. At a sloped host
 * boundary the placed box still has the final panel's AABB, but it does not
 * carry the diagonal cut: the unused corner remains filled. A placed diagonal
 * mullion is an independent reading of that boundary. Where its long axis
 * crosses the panel box and divides off an unambiguous smaller corner, use the
 * larger half as a conservative panel outline.
 */

import { ringArea, triangulate, type Point2 } from "./polygon.ts";
import type { ElementBoundsRecord } from "./types.ts";

const CURTAIN_PANEL_CATEGORY_ID = -2_000_170;
const CURTAIN_MULLION_CATEGORY_IDS = new Set([-2_000_171, -2_000_172]);
const SPATIAL_CELL_FEET = 8;
const PLANE_TOLERANCE_FEET = 0.5;
const MIN_DIAGONAL_COMPONENT = 0.08;
const MIN_REMOVED_AREA_RATIO = 0.02;
const MIN_RETAINED_AREA_RATIO = 0.55;
const MAX_BUCKET_CELLS = 512;

type Vec3Tuple = [number, number, number];

export type InferredCurtainPanelGeometry = {
  /** World-space feet; the scene origin is subtracted only when batching. */
  positions: number[];
  indices: number[];
};

type OrientedFrame = {
  center: Vec3Tuple;
  axes: [Vec3Tuple, Vec3Tuple, Vec3Tuple];
  lengths: [number, number, number];
};

function subtract(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scale(a: Vec3Tuple, value: number): Vec3Tuple {
  return [a[0] * value, a[1] * value, a[2] * value];
}

function add(...vectors: Vec3Tuple[]): Vec3Tuple {
  return vectors.reduce<Vec3Tuple>(
    (sum, vector) => [
      sum[0] + vector[0],
      sum[1] + vector[1],
      sum[2] + vector[2],
    ],
    [0, 0, 0],
  );
}

function normalize(vector: Vec3Tuple): { axis: Vec3Tuple; length: number } | null {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= 1e-6) return null;
  return { axis: scale(vector, 1 / length), length };
}

/**
 * `instanceCorners` preserves box order: the three edges out of corner zero
 * end at corners 1, 3 and 4.
 */
function orientedFrame(corners: readonly Vec3Tuple[] | undefined): OrientedFrame | null {
  if (!corners || corners.length !== 8) return null;
  const first = corners[0]!;
  const edges = [corners[1], corners[3], corners[4]].map((corner) =>
    normalize(subtract(corner!, first)));
  if (edges.some((edge) => !edge)) return null;
  const center = scale(
    corners.reduce<Vec3Tuple>((sum, corner) => add(sum, corner), [0, 0, 0]),
    1 / corners.length,
  );
  return {
    center,
    axes: edges.map((edge) => edge!.axis) as OrientedFrame["axes"],
    lengths: edges.map((edge) => edge!.length) as OrientedFrame["lengths"],
  };
}

function projectedRange(
  corners: readonly Vec3Tuple[],
  center: Vec3Tuple,
  axis: Vec3Tuple,
): [number, number] {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const corner of corners) {
    const projection = dot(subtract(corner, center), axis);
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  return [minimum, maximum];
}

function signedDistance(point: Point2, linePoint: Point2, lineDirection: Point2): number {
  return (
    lineDirection[0] * (point[1] - linePoint[1]) -
    lineDirection[1] * (point[0] - linePoint[0])
  );
}

function clipHalfPlane(
  polygon: readonly Point2[],
  linePoint: Point2,
  lineDirection: Point2,
  keepPositive: boolean,
): { polygon: Point2[]; crossings: Point2[] } {
  const output: Point2[] = [];
  const crossings: Point2[] = [];
  const inside = (distance: number) =>
    keepPositive ? distance >= -1e-8 : distance <= 1e-8;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    const startDistance = signedDistance(start, linePoint, lineDirection);
    const endDistance = signedDistance(end, linePoint, lineDirection);
    const startInside = inside(startDistance);
    const endInside = inside(endDistance);
    if (startInside) output.push(start);
    if (startInside === endInside) continue;
    const fraction = startDistance / (startDistance - endDistance);
    const crossing: Point2 = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ];
    output.push(crossing);
    crossings.push(crossing);
  }
  return { polygon: output, crossings };
}

function prism(
  polygon: readonly Point2[],
  frame: {
    center: Vec3Tuple;
    u: Vec3Tuple;
    v: Vec3Tuple;
    n: Vec3Tuple;
    nRange: [number, number];
  },
): InferredCurtainPanelGeometry | null {
  const cap = triangulate([...polygon], []);
  if (polygon.length < 3 || cap.length < 3) return null;
  const positions: number[] = [];
  for (const normalDistance of frame.nRange) {
    for (const [u, v] of polygon) {
      positions.push(...add(
        frame.center,
        scale(frame.u, u),
        scale(frame.v, v),
        scale(frame.n, normalDistance),
      ));
    }
  }
  const top = polygon.length;
  const indices: number[] = [];
  for (let index = 0; index < cap.length; index += 3) {
    indices.push(cap[index]!, cap[index + 2]!, cap[index + 1]!);
    indices.push(top + cap[index]!, top + cap[index + 1]!, top + cap[index + 2]!);
  }
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    indices.push(index, next, top + next, index, top + next, top + index);
  }
  return { positions, indices };
}

function inferOne(
  panel: ElementBoundsRecord,
  mullions: readonly ElementBoundsRecord[],
): InferredCurtainPanelGeometry | null {
  const panelCorners = panel.orientedBox as Vec3Tuple[] | undefined;
  const panelFrame = orientedFrame(panelCorners);
  if (!panelCorners || !panelFrame) return null;

  const thicknessIndex = panelFrame.lengths.indexOf(Math.min(...panelFrame.lengths));
  const faceIndices = [0, 1, 2].filter((index) => index !== thicknessIndex);
  const verticalIndex = faceIndices.reduce((best, index) =>
    Math.abs(panelFrame.axes[index]![2]) > Math.abs(panelFrame.axes[best]![2])
      ? index
      : best);
  const widthIndex = faceIndices.find((index) => index !== verticalIndex)!;
  const u = panelFrame.axes[widthIndex]!;
  const v = panelFrame.axes[verticalIndex]!;
  const n = panelFrame.axes[thicknessIndex]!;
  const uRange = projectedRange(panelCorners, panelFrame.center, u);
  const vRange = projectedRange(panelCorners, panelFrame.center, v);
  const nRange = projectedRange(panelCorners, panelFrame.center, n);
  const original: Point2[] = [
    [uRange[0], vRange[0]],
    [uRange[1], vRange[0]],
    [uRange[1], vRange[1]],
    [uRange[0], vRange[1]],
  ];
  const originalArea = ringArea(original);
  if (originalArea <= 1e-6) return null;

  let best: { polygon: Point2[]; retainedRatio: number } | null = null;
  for (const mullion of mullions) {
    const mullionCorners = mullion.orientedBox as Vec3Tuple[] | undefined;
    const mullionFrame = orientedFrame(mullionCorners);
    if (!mullionCorners || !mullionFrame) continue;
    const longIndex = mullionFrame.lengths.indexOf(Math.max(...mullionFrame.lengths));
    const longAxis = mullionFrame.axes[longIndex]!;
    const lineDirection: Point2 = [dot(longAxis, u), dot(longAxis, v)];
    const projectedLength = Math.hypot(...lineDirection);
    if (projectedLength < 0.9) continue;
    lineDirection[0] /= projectedLength;
    lineDirection[1] /= projectedLength;
    if (
      Math.abs(lineDirection[0]) < MIN_DIAGONAL_COMPONENT ||
      Math.abs(lineDirection[1]) < MIN_DIAGONAL_COMPONENT
    ) {
      continue;
    }

    const relativeCenter = subtract(mullionFrame.center, panelFrame.center);
    const linePoint: Point2 = [dot(relativeCenter, u), dot(relativeCenter, v)];
    const mullionNRange = projectedRange(mullionCorners, panelFrame.center, n);
    if (
      mullionNRange[1] < nRange[0] - PLANE_TOLERANCE_FEET ||
      mullionNRange[0] > nRange[1] + PLANE_TOLERANCE_FEET
    ) {
      continue;
    }

    const positive = clipHalfPlane(original, linePoint, lineDirection, true);
    const negative = clipHalfPlane(original, linePoint, lineDirection, false);
    const positiveArea = ringArea(positive.polygon);
    const negativeArea = ringArea(negative.polygon);
    const chosen = positiveArea >= negativeArea ? positive : negative;
    const chosenArea = Math.max(positiveArea, negativeArea);
    const retainedRatio = chosenArea / originalArea;
    if (
      chosen.crossings.length !== 2 ||
      retainedRatio < MIN_RETAINED_AREA_RATIO ||
      1 - retainedRatio < MIN_REMOVED_AREA_RATIO
    ) {
      continue;
    }

    // The infinite line is not enough: both rectangle intersections must land
    // on the finite mullion's long body, with only profile-sized tolerance.
    const halfLength = mullionFrame.lengths[longIndex]! / 2 + PLANE_TOLERANCE_FEET;
    if (chosen.crossings.some((point) =>
      Math.abs(
        (point[0] - linePoint[0]) * lineDirection[0] +
        (point[1] - linePoint[1]) * lineDirection[1],
      ) > halfLength)) {
      continue;
    }
    if (!best || retainedRatio < best.retainedRatio) {
      best = { polygon: chosen.polygon, retainedRatio };
    }
  }
  return best
    ? prism(best.polygon, { center: panelFrame.center, u, v, n, nRange })
    : null;
}

function bucketRange(minimum: number, maximum: number): [number, number] {
  return [
    Math.floor((minimum - PLANE_TOLERANCE_FEET) / SPATIAL_CELL_FEET),
    Math.floor((maximum + PLANE_TOLERANCE_FEET) / SPATIAL_CELL_FEET),
  ];
}

function bucketKeys(record: ElementBoundsRecord): string[] {
  const x = bucketRange(record.boundsFeet.min.x, record.boundsFeet.max.x);
  const y = bucketRange(record.boundsFeet.min.y, record.boundsFeet.max.y);
  const z = bucketRange(record.boundsFeet.min.z, record.boundsFeet.max.z);
  const count = (x[1] - x[0] + 1) * (y[1] - y[0] + 1) * (z[1] - z[0] + 1);
  if (count > MAX_BUCKET_CELLS) return [];
  const keys: string[] = [];
  for (let xi = x[0]; xi <= x[1]; xi += 1) {
    for (let yi = y[0]; yi <= y[1]; yi += 1) {
      for (let zi = z[0]; zi <= z[1]; zi += 1) keys.push(`${xi}:${yi}:${zi}`);
    }
  }
  return keys;
}

/**
 * Infer only unambiguous diagonal edge cuts. The returned map is sparse:
 * ordinary rectangular panels and panels without a placed mullion remain on
 * their existing oriented-box path.
 */
export function inferCurtainPanelBoundaries(
  records: readonly ElementBoundsRecord[],
): Map<number, InferredCurtainPanelGeometry> {
  const mullionBuckets = new Map<string, ElementBoundsRecord[]>();
  for (const record of records) {
    if (!CURTAIN_MULLION_CATEGORY_IDS.has(record.categoryId ?? 0) || !record.orientedBox) continue;
    for (const key of bucketKeys(record)) {
      const bucket = mullionBuckets.get(key) ?? [];
      bucket.push(record);
      mullionBuckets.set(key, bucket);
    }
  }

  const inferred = new Map<number, InferredCurtainPanelGeometry>();
  for (const panel of records) {
    if (panel.categoryId !== CURTAIN_PANEL_CATEGORY_ID || !panel.orientedBox) continue;
    const nearby = new Map<number, ElementBoundsRecord>();
    for (const key of bucketKeys(panel)) {
      for (const mullion of mullionBuckets.get(key) ?? []) {
        nearby.set(mullion.elementId, mullion);
      }
    }
    const geometry = inferOne(panel, [...nearby.values()]);
    if (geometry) inferred.set(panel.elementId, geometry);
  }
  return inferred;
}
