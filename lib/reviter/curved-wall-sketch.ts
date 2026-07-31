import type { Bounds3 } from "./types.ts";
import type { SketchCurve } from "./sketch-curves.ts";
import type { WallArc } from "./native-geometry.ts";

const POINT_TOLERANCE_FEET = 1e-6;
const ENVELOPE_TOLERANCE_FEET = 0.75;

function circleThrough(
  first: readonly [number, number, number],
  middle: readonly [number, number, number],
  last: readonly [number, number, number],
): { x: number; y: number; radius: number } | null {
  const [ax, ay] = first;
  const [bx, by] = middle;
  const [cx, cy] = last;
  const determinant =
    2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
    return null;
  }
  const aa = ax * ax + ay * ay;
  const bb = bx * bx + by * by;
  const cc = cx * cx + cy * cy;
  const x =
    (aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) /
    determinant;
  const y =
    (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) /
    determinant;
  const radius = Math.hypot(ax - x, ay - y);
  return Number.isFinite(radius) && radius > POINT_TOLERANCE_FEET
    ? { x, y, radius }
    : null;
}

function unwrappedAngles(
  points: readonly (readonly [number, number, number])[],
  centre: { x: number; y: number },
): number[] {
  const angles = points.map(([x, y]) => Math.atan2(y - centre.y, x - centre.x));
  for (let index = 1; index < angles.length; index += 1) {
    while (angles[index]! - angles[index - 1]! > Math.PI) {
      angles[index] -= 2 * Math.PI;
    }
    while (angles[index]! - angles[index - 1]! < -Math.PI) {
      angles[index] += 2 * Math.PI;
    }
  }
  return angles;
}

function arcPlanBounds(arc: WallArc): Bounds3 {
  const angles = [arc.startAngle, arc.endAngle];
  for (
    let quadrant = Math.floor(arc.startAngle / (Math.PI / 2)) - 1;
    quadrant <= Math.ceil(arc.endAngle / (Math.PI / 2)) + 1;
    quadrant += 1
  ) {
    const angle = quadrant * (Math.PI / 2);
    if (angle > arc.startAngle && angle < arc.endAngle) angles.push(angle);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const angle of angles) {
    for (const radius of [
      arc.radius - arc.thickness / 2,
      arc.radius + arc.thickness / 2,
    ]) {
      xs.push(arc.centre.x + radius * Math.cos(angle));
      ys.push(arc.centre.y + radius * Math.sin(angle));
    }
  }
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys), z: arc.baseElevation },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: arc.topElevation },
  };
}

/**
 * Recover a curved BasicWall from its persisted arc location curve.
 *
 * Some curved walls in Revit 2027 carry their physical location arc but no
 * cylinder triple. Their axis-aligned envelope then fills the whole chord of
 * the arc. The wall type's compound layers independently provide thickness;
 * the element envelope supplies only the base/top elevations and a final
 * agreement check.
 */
export function curvedWallArcFromSketch(
  elementId: number,
  curves: readonly SketchCurve[],
  thicknessFeet: number,
  bounds: Bounds3,
): WallArc | null {
  const arcs = curves.filter(
    (curve) => curve.kind === "arc" && curve.interior.length > 0,
  );
  if (
    arcs.length !== 1 ||
    !Number.isFinite(thicknessFeet) ||
    thicknessFeet <= POINT_TOLERANCE_FEET
  ) {
    return null;
  }
  const curve = arcs[0]!;
  const points = [curve.start, ...curve.interior, curve.end];
  const circle = circleThrough(
    points[0]!,
    points[Math.floor(points.length / 2)]!,
    points.at(-1)!,
  );
  if (!circle || thicknessFeet >= circle.radius * 2) return null;
  const angles = unwrappedAngles(points, circle);
  const first = angles[0]!;
  const last = angles.at(-1)!;
  const startAngle = Math.min(first, last);
  const endAngle = Math.max(first, last);
  if (endAngle - startAngle <= 1e-4 || endAngle - startAngle > Math.PI * 2) {
    return null;
  }
  const result: WallArc = {
    elementId,
    centre: { x: circle.x, y: circle.y },
    radius: circle.radius,
    thickness: thicknessFeet,
    startAngle,
    endAngle,
    baseElevation: bounds.min.z,
    topElevation: bounds.max.z,
    xDir: { x: 1, y: 0 },
    yDir: { x: 0, y: 1 },
  };
  const recovered = arcPlanBounds(result);
  const error = Math.max(
    Math.abs(recovered.min.x - bounds.min.x),
    Math.abs(recovered.min.y - bounds.min.y),
    Math.abs(recovered.max.x - bounds.max.x),
    Math.abs(recovered.max.y - bounds.max.y),
  );
  return error <= ENVELOPE_TOLERANCE_FEET ? result : null;
}
