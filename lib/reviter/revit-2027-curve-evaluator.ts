/**
 * Point and first derivative of the persisted analytic curves that Revit
 * 2027 hangs beneath a SurfRev or RuledSurf as its profile.
 *
 * Each convention is the one the existing decoders and certified paths
 * already rely on: a GLine is `origin + t*direction`, a GArc is
 * `center + radius*(cos t*x + sin t*y)`, a GCylindricalHelix adds
 * `pitchOver2Pi*t` along its axis. A GEllipse is read as the GArc
 * construction with separate radii, `center + xLen*cos t*x + yLen*sin t*y`.
 * A GHermiteSpline is the cubic Hermite interpolant of its nodes, each node's
 * tangent the derivative by the curve's own parameter: in the technical
 * school's curved beams the tangents measure 45.65 to 46.67 ft per unit
 * parameter where the chord between nodes 1/32 apart is 1.4267 to 1.4578 ft,
 * i.e. 45.65 to 46.65 ft per unit.
 *
 * None of these is trusted on its own when it meshes a new face: the trimmed
 * surface path evaluates every trim sample on both faces that share it, so a
 * wrong convention fails closed instead of drawing a plausible shape.
 */
import {
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "./revit-2027-garc.ts";
import {
  REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
  type Revit2027GCylindricalHelix,
} from "./revit-2027-gcylindrical-helix.ts";
import {
  REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT,
  type Revit2027GEllipse,
} from "./revit-2027-gellipse.ts";
import {
  REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
  type Revit2027GHermiteSpline,
} from "./revit-2027-ghermite-spline.ts";
import {
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  type Revit2027GLine,
} from "./revit-2027-gline.ts";
import type { Revit2027Point3 } from "./revit-2027-owner-mesh-grid.ts";

export type Revit2027ProfileCurve =
  | { kind: "line"; curve: Revit2027GLine }
  | { kind: "arc"; curve: Revit2027GArc }
  | { kind: "ellipse"; curve: Revit2027GEllipse }
  | { kind: "helix"; curve: Revit2027GCylindricalHelix }
  | { kind: "spline"; curve: Revit2027GHermiteSpline };

export type Revit2027CurveSample = {
  point: Revit2027Point3;
  derivative: Revit2027Point3;
};

/** Profile curve slots a certified surface evaluator can read. */
export const REVIT_2027_PROFILE_CURVE_SOURCE_CLASS_SLOTS = [
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT,
  REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT,
  REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
] as const;

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

/**
 * Wrap one indexed curve span as a profile, or null when its slot is not an
 * evaluated curve or its persisted fields are not finite and non-degenerate.
 */
export function revit2027ProfileCurve(
  sourceClassSlot: number,
  value: unknown,
): Revit2027ProfileCurve | null {
  if (value == null || typeof value !== "object") return null;
  if (sourceClassSlot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT) {
    const curve = value as Revit2027GLine;
    return finite([...curve.origin, ...curve.direction, ...curve.endParameters]) &&
        Math.hypot(...curve.direction) > Number.EPSILON
      ? { kind: "line", curve }
      : null;
  }
  if (sourceClassSlot === REVIT_2027_GARC_SOURCE_CLASS_SLOT) {
    const curve = value as Revit2027GArc;
    return finite([
          ...curve.center,
          ...curve.xDirection,
          ...curve.yDirection,
          curve.radius,
          ...curve.endParameters,
        ]) && curve.radius > 0
      ? { kind: "arc", curve }
      : null;
  }
  if (sourceClassSlot === REVIT_2027_GELLIPSE_SOURCE_CLASS_SLOT) {
    const curve = value as Revit2027GEllipse;
    return finite([
          ...curve.center,
          ...curve.xDirection,
          ...curve.yDirection,
          curve.xRadius,
          curve.yRadius,
          ...curve.endParameters,
        ]) && curve.xRadius > 0 && curve.yRadius > 0
      ? { kind: "ellipse", curve }
      : null;
  }
  if (sourceClassSlot === REVIT_2027_GCYLINDRICAL_HELIX_SOURCE_CLASS_SLOT) {
    const curve = value as Revit2027GCylindricalHelix;
    return finite([
          ...curve.basePoint,
          ...curve.xVector,
          ...curve.yVector,
          ...curve.zVector,
          curve.radius,
          curve.pitchOver2Pi,
          ...curve.endParameters,
        ]) && curve.radius > 0
      ? { kind: "helix", curve }
      : null;
  }
  if (sourceClassSlot === REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT) {
    const curve = value as Revit2027GHermiteSpline;
    return interpolatingSpline(curve) ? { kind: "spline", curve } : null;
  }
  return null;
}

/**
 * A spline this evaluator reads: open, at least two finite nodes with rising
 * parameters, and end parameters inside the nodes' own range. A periodic one
 * would need its closing segment, which is not read.
 */
function interpolatingSpline(curve: Revit2027GHermiteSpline): boolean {
  const nodes = curve.nodes;
  if (curve.periodic || !Array.isArray(nodes) || nodes.length < 2) return false;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (!finite([...node.point, ...node.tangent, node.parameter])) return false;
    if (index > 0 && !(node.parameter > nodes[index - 1]!.parameter)) return false;
  }
  const [start, end] = curve.endParameters;
  const first = nodes[0]!.parameter;
  const last = nodes[nodes.length - 1]!.parameter;
  const slack = (last - first) * 1e-9;
  return finite([start, end]) && start < end &&
    start >= first - slack && end <= last + slack;
}

/** The persisted parameter interval of one profile curve. */
export function revit2027ProfileInterval(
  profile: Revit2027ProfileCurve,
): readonly [number, number] {
  return profile.curve.endParameters;
}

type Vector = readonly [number, number, number];

/** `base + Σ vector × scale`. */
function combine(
  base: Vector,
  ...terms: readonly (readonly [Vector, number])[]
): Revit2027Point3 {
  const out: [number, number, number] = [base[0], base[1], base[2]];
  for (const [vector, scale] of terms) {
    out[0] += vector[0] * scale;
    out[1] += vector[1] * scale;
    out[2] += vector[2] * scale;
  }
  return out;
}

const ZERO: Vector = [0, 0, 0];

/** Evaluate one profile curve and its derivative at a native parameter. */
export function evaluateRevit2027ProfileCurve(
  profile: Revit2027ProfileCurve,
  parameter: number,
): Revit2027CurveSample {
  const cosine = Math.cos(parameter);
  const sine = Math.sin(parameter);
  switch (profile.kind) {
    case "line": {
      const { origin, direction } = profile.curve;
      return {
        point: combine(origin, [direction, parameter]),
        derivative: combine(ZERO, [direction, 1]),
      };
    }
    case "arc": {
      const { center, xDirection, yDirection, radius } = profile.curve;
      return {
        point: combine(center, [xDirection, radius * cosine], [yDirection, radius * sine]),
        derivative: combine(ZERO, [xDirection, -radius * sine], [yDirection, radius * cosine]),
      };
    }
    case "ellipse": {
      const { center, xDirection, yDirection, xRadius, yRadius } = profile.curve;
      return {
        point: combine(center, [xDirection, xRadius * cosine], [yDirection, yRadius * sine]),
        derivative: combine(ZERO, [xDirection, -xRadius * sine], [yDirection, yRadius * cosine]),
      };
    }
    case "spline":
      return evaluateSpline(profile.curve, parameter);
    case "helix": {
      const { basePoint, xVector, yVector, zVector, radius, pitchOver2Pi } = profile.curve;
      return {
        point: combine(
          basePoint,
          [xVector, radius * cosine],
          [yVector, radius * sine],
          [zVector, pitchOver2Pi * parameter],
        ),
        derivative: combine(
          ZERO,
          [xVector, -radius * sine],
          [yVector, radius * cosine],
          [zVector, pitchOver2Pi],
        ),
      };
    }
  }
}

/**
 * The cubic Hermite segment between the two nodes around the parameter; a
 * parameter outside the nodes continues the end segment's cubic.
 */
function evaluateSpline(
  curve: Revit2027GHermiteSpline,
  parameter: number,
): Revit2027CurveSample {
  const nodes = curve.nodes;
  let low = 0;
  let high = nodes.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (nodes[middle]!.parameter <= parameter) low = middle;
    else high = middle - 1;
  }
  const a = nodes[low]!;
  const b = nodes[low + 1]!;
  const h = b.parameter - a.parameter;
  const s = (parameter - a.parameter) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return {
    point: combine(
      ZERO,
      [a.point, 2 * s3 - 3 * s2 + 1],
      [a.tangent, (s3 - 2 * s2 + s) * h],
      [b.point, -2 * s3 + 3 * s2],
      [b.tangent, (s3 - s2) * h],
    ),
    derivative: combine(
      ZERO,
      [a.point, (6 * s2 - 6 * s) / h],
      [a.tangent, 3 * s2 - 4 * s + 1],
      [b.point, (-6 * s2 + 6 * s) / h],
      [b.tangent, 3 * s2 - 2 * s],
    ),
  };
}
