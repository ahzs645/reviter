/**
 * One evaluator for every persisted Face surface a certified path can draw:
 * the point and both first partial derivatives at any face-local UV.
 *
 * The formulas are the ones the rectangular paths already use, lifted out of
 * their fixed grids so a trimmed face can be sampled anywhere inside its
 * loops. Plane is `origin + u*x + v*y`; CylSurf and ConeSurf revolve their
 * radial term by `u`; SurfRev is Revit's persisted order, revolution angle
 * first and profile parameter second, with the profile read in the surface's
 * local XZ plane; RuledSurf joins its two profiles at the same interval
 * fraction `u` and mixes them by `v`; HermiteSurf is the bicubic patch.
 *
 * A SurfRev used to resolve only a GArc profile. Among the 2025 RAC
 * sample's boxed elements, 875 SurfRev faces revolve a GLine (turned
 * cylinders, cones and flat annuli) and 7 a GEllipse, and 59 RuledSurf faces
 * rule GArc, GEllipse or GLine profiles; all four curve kinds are evaluated
 * here.
 */
import {
  evaluateRevit2027ProfileCurve,
  revit2027ProfileCurve,
  revit2027ProfileInterval,
  type Revit2027ProfileCurve,
} from "./revit-2027-curve-evaluator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import {
  evaluateRevit2027HermiteSurface,
} from "./revit-2027-hermite-owner-mesh.ts";
import {
  REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027HermiteSurface,
} from "./revit-2027-hermite-surface.ts";
import {
  revit2027OwnerCurves,
  revit2027OwnerSurface,
  type Revit2027OwnerMeshIndex,
} from "./revit-2027-owner-mesh-index.ts";
import type {
  Revit2027Point3,
  Revit2027SurfaceSample,
} from "./revit-2027-owner-mesh-grid.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027ConeSurface,
  type Revit2027CylinderSurface,
  type Revit2027PlaneSurface,
  type Revit2027RuledSurface,
  type Revit2027SurfaceOfRevolution,
} from "./revit-2027-surfaces.ts";

export type Revit2027SurfaceEvaluatorKind =
  | "plane"
  | "cylinder"
  | "cone"
  | "surface-of-revolution"
  | "ruled"
  | "hermite";

export type Revit2027SurfaceEvaluator = {
  kind: Revit2027SurfaceEvaluatorKind;
  /** Persisted `Surface.orientFlag`: the emitted normal is `±(Su × Sv)`. */
  orientFlag: boolean;
  /** The angular period of `u` for surfaces that revolve, else null. */
  uPeriod: number | null;
  evaluate: (u: number, v: number) => Revit2027SurfaceSample | null;
};

export type Revit2027SurfaceEvaluatorIssueCode =
  | "surface-unresolved"
  | "unsupported-surface"
  | "profile-unresolved"
  | "invalid-surface";

export type Revit2027SurfaceEvaluatorResult =
  | { ok: true; evaluator: Revit2027SurfaceEvaluator }
  | { ok: false; code: Revit2027SurfaceEvaluatorIssueCode; detail: string };

/**
 * Basis tolerance for the revolved frames. The rectangular SurfRev path
 * already holds the same frames to 1e-9, so this only turns away a frame
 * that is not a rotation at all.
 */
const BASIS_TOLERANCE = 1e-6;

type Vector = readonly [number, number, number];

function dot(left: Vector, right: Vector): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector, right: Vector): Revit2027Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

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

function finiteSample(
  sample: Revit2027SurfaceSample,
): Revit2027SurfaceSample | null {
  return [...sample.point, ...sample.tangentU, ...sample.tangentV].every(
      Number.isFinite,
    )
    ? sample
    : null;
}

/**
 * Whether three persisted axes form an orthonormal frame of either hand.
 *
 * Handedness does not change the orientation rule: the emitted normal is
 * `±(Su × Sv)` by `orientFlag` alone, which is what the cylinder adapter's
 * signed-frame mapping reduces to for its left-handed CylSurf frames. The
 * 2025 RAC sample persists 1,010 unmeshed SurfRev faces on left-handed
 * frames, and every one of their trim samples meets the neighbouring face.
 */
function orthonormalFrame(x: Vector, y: Vector, z: Vector): boolean {
  const near = (value: number, target: number): boolean =>
    Math.abs(value - target) <= BASIS_TOLERANCE;
  return [...x, ...y, ...z].every(Number.isFinite) &&
    near(dot(x, x), 1) &&
    near(dot(y, y), 1) &&
    near(dot(z, z), 1) &&
    near(dot(x, y), 0) &&
    near(dot(x, z), 0) &&
    near(dot(y, z), 0) &&
    near(Math.abs(dot(x, cross(y, z))), 1);
}

function planeEvaluator(surface: Revit2027PlaneSurface): Revit2027SurfaceEvaluatorResult {
  const normal = cross(surface.xVector, surface.yVector);
  if (
    ![...surface.origin, ...surface.xVector, ...surface.yVector].every(
      Number.isFinite,
    ) ||
    Math.hypot(...normal) <= Number.EPSILON
  ) {
    return { ok: false, code: "invalid-surface", detail: "degenerate Plane frame" };
  }
  return {
    ok: true,
    evaluator: {
      kind: "plane",
      orientFlag: surface.surface.orientFlag,
      uPeriod: null,
      // The `(origin + u*x) + v*y` order matches the planar path's evaluator.
      evaluate: (u, v) =>
        finiteSample({
          point: combine(combine(surface.origin, [surface.xVector, u]), [
            surface.yVector,
            v,
          ]),
          tangentU: surface.xVector,
          tangentV: surface.yVector,
        }),
    },
  };
}

function cylinderEvaluator(
  surface: Revit2027CylinderSurface,
): Revit2027SurfaceEvaluatorResult {
  if (
    !orthonormalFrame(surface.xVector, surface.yVector, surface.zVector) ||
    !Number.isFinite(surface.radius) ||
    surface.radius <= 0
  ) {
    return { ok: false, code: "invalid-surface", detail: "invalid CylSurf frame or radius" };
  }
  const { center, xVector, yVector, zVector, radius } = surface;
  return {
    ok: true,
    evaluator: {
      kind: "cylinder",
      orientFlag: surface.surface.orientFlag,
      uPeriod: Math.PI * 2,
      evaluate: (u, v) => {
        const cosine = Math.cos(u);
        const sine = Math.sin(u);
        return finiteSample({
          point: combine(
            center,
            [xVector, radius * cosine],
            [yVector, radius * sine],
            [zVector, v],
          ),
          tangentU: combine(ZERO, [xVector, -radius * sine], [
            yVector,
            radius * cosine,
          ]),
          tangentV: zVector,
        });
      },
    },
  };
}

function coneEvaluator(surface: Revit2027ConeSurface): Revit2027SurfaceEvaluatorResult {
  if (
    !orthonormalFrame(surface.xVector, surface.yVector, surface.zVector) ||
    !Number.isFinite(surface.halfAngle) ||
    !(Math.abs(Math.sin(surface.halfAngle)) > Number.EPSILON)
  ) {
    return { ok: false, code: "invalid-surface", detail: "invalid ConeSurf frame or half angle" };
  }
  const { center, xVector, yVector, zVector } = surface;
  const radial = Math.sin(surface.halfAngle);
  const axial = Math.cos(surface.halfAngle);
  return {
    ok: true,
    evaluator: {
      kind: "cone",
      orientFlag: surface.surface.orientFlag,
      uPeriod: Math.PI * 2,
      evaluate: (u, v) => {
        const cosine = Math.cos(u);
        const sine = Math.sin(u);
        return finiteSample({
          point: combine(
            center,
            [xVector, v * radial * cosine],
            [yVector, v * radial * sine],
            [zVector, v * axial],
          ),
          tangentU: combine(ZERO, [xVector, -v * radial * sine], [
            yVector,
            v * radial * cosine,
          ]),
          tangentV: combine(
            ZERO,
            [xVector, radial * cosine],
            [yVector, radial * sine],
            [zVector, axial],
          ),
        });
      },
    },
  };
}

/**
 * Whether a profile lies in its SurfRev's local XZ plane, which is the only
 * placement Revit's persisted SurfRev formula reads without loss.
 */
function profileInLocalXz(profile: Revit2027ProfileCurve): boolean {
  const flat = (value: number): boolean => Math.abs(value) <= BASIS_TOLERANCE;
  switch (profile.kind) {
    case "line":
      return flat(profile.curve.origin[1]) && flat(profile.curve.direction[1]);
    case "arc":
    case "ellipse":
      return flat(profile.curve.center[1]) &&
        flat(profile.curve.xDirection[1]) &&
        flat(profile.curve.yDirection[1]);
    case "helix":
    case "spline":
      // A SurfRev does not hang either kind; the owner index registers them
      // only beneath a RuledSurf.
      return false;
  }
}

function surfaceOfRevolutionEvaluator(
  surface: Revit2027SurfaceOfRevolution,
  profile: Revit2027ProfileCurve,
): Revit2027SurfaceEvaluatorResult {
  if (!orthonormalFrame(surface.xVector, surface.yVector, surface.zVector)) {
    return { ok: false, code: "invalid-surface", detail: "SurfRev frame is not orthonormal" };
  }
  if (!profileInLocalXz(profile)) {
    return { ok: false, code: "profile-unresolved", detail: `${profile.kind} profile is not in the SurfRev local XZ plane` };
  }
  const { center, xVector, yVector, zVector } = surface;
  return {
    ok: true,
    evaluator: {
      kind: "surface-of-revolution",
      orientFlag: surface.surface.orientFlag,
      uPeriod: Math.PI * 2,
      evaluate: (u, v) => {
        const local = evaluateRevit2027ProfileCurve(profile, v);
        const cosine = Math.cos(u);
        const sine = Math.sin(u);
        const radialDirection = combine(ZERO, [xVector, cosine], [yVector, sine]);
        const angularDirection = combine(ZERO, [xVector, -sine], [yVector, cosine]);
        return finiteSample({
          point: combine(
            center,
            [radialDirection, local.point[0]],
            [zVector, local.point[2]],
          ),
          tangentU: combine(ZERO, [angularDirection, local.point[0]]),
          tangentV: combine(
            ZERO,
            [radialDirection, local.derivative[0]],
            [zVector, local.derivative[2]],
          ),
        });
      },
    },
  };
}

/**
 * One side of a RuledSurf: its persisted profile curve, or the fixed point
 * Revit writes in its place when that profile descriptor is null. The 2025
 * RAC sample persists 30 such faces, each a GArc swept to one apex point
 * whose trim closes through that apex.
 */
type RuledRail = (fraction: number) => {
  point: Revit2027Point3;
  derivative: Revit2027Point3;
};

function ruledRail(
  profile: Revit2027ProfileCurve | Revit2027Point3,
): RuledRail | null {
  if (!("kind" in profile)) {
    if (!profile.every(Number.isFinite)) return null;
    return () => ({ point: profile, derivative: [0, 0, 0] });
  }
  const [start, end] = revit2027ProfileInterval(profile);
  const span = end - start;
  if (!Number.isFinite(span) || span === 0) return null;
  return (fraction) => {
    const sample = evaluateRevit2027ProfileCurve(profile, start + span * fraction);
    return {
      point: sample.point,
      derivative: combine(ZERO, [sample.derivative, span]),
    };
  };
}

function ruledEvaluator(
  surface: Revit2027RuledSurface,
  first: Revit2027ProfileCurve | Revit2027Point3,
  second: Revit2027ProfileCurve | Revit2027Point3,
): Revit2027SurfaceEvaluatorResult {
  const firstRail = ruledRail(first);
  const secondRail = ruledRail(second);
  if (!firstRail || !secondRail || (!("kind" in first) && !("kind" in second))) {
    return { ok: false, code: "profile-unresolved", detail: "RuledSurf rail is empty or both rails are points" };
  }
  return {
    ok: true,
    evaluator: {
      kind: "ruled",
      orientFlag: surface.surface.orientFlag,
      uPeriod: null,
      evaluate: (u, v) => {
        const a = firstRail(u);
        const b = secondRail(u);
        return finiteSample({
          point: combine(ZERO, [a.point, 1 - v], [b.point, v]),
          tangentU: combine(ZERO, [a.derivative, 1 - v], [b.derivative, v]),
          tangentV: combine(b.point, [a.point, -1]),
        });
      },
    },
  };
}

function hermiteEvaluator(
  surface: Revit2027HermiteSurface,
): Revit2027SurfaceEvaluatorResult {
  if (
    !surface.constructedOk ||
    surface.periodic[0] ||
    surface.periodic[1] ||
    surface.nodes.length !==
      surface.uParameters.length * surface.vParameters.length
  ) {
    return { ok: false, code: "invalid-surface", detail: "HermiteSurf grid is not a complete non-periodic patch" };
  }
  return {
    ok: true,
    evaluator: {
      kind: "hermite",
      orientFlag: surface.orientFlag,
      uPeriod: null,
      evaluate: (u, v) => {
        const sample = evaluateRevit2027HermiteSurface(surface, u, v);
        return sample ? finiteSample(sample) : null;
      },
    },
  };
}

/**
 * The last persisted profile curve with this token beneath one Face. A
 * retained `-1` descriptor does not advance the token namespace, so it can
 * only name the one curve its surface queued.
 */
function profileByToken(
  index: Revit2027OwnerMeshIndex,
  faceToken: number,
  token: number,
): Revit2027ProfileCurve | null {
  const curves = revit2027OwnerCurves(index, faceToken);
  const record = token === -1
    ? (curves.length === 1 ? curves[0] : undefined)
    : token > 0
    ? curves.findLast((curve) => curve.token === token)
    : undefined;
  return record ? revit2027ProfileCurve(record.sourceClassSlot, record.value) : null;
}

/**
 * Build the evaluator for one indexed Face's persisted surface, or report
 * why it cannot be evaluated.
 */
export function revit2027FaceSurfaceEvaluator(
  index: Revit2027OwnerMeshIndex,
  faceToken: number,
  face: Revit2027FaceStatic,
): Revit2027SurfaceEvaluatorResult {
  const slot = face.surface.sourceClassSlot;
  const surface = slot == null
    ? undefined
    : revit2027OwnerSurface<unknown>(index, slot, faceToken);
  if (surface == null) {
    return {
      ok: false,
      code: slot == null ? "unsupported-surface" : "surface-unresolved",
      detail: `surface slot ${slot ?? "null"}`,
    };
  }
  switch (slot) {
    case REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT:
      return planeEvaluator(surface as Revit2027PlaneSurface);
    case REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT:
      return cylinderEvaluator(surface as Revit2027CylinderSurface);
    case REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT:
      return coneEvaluator(surface as Revit2027ConeSurface);
    case REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT: {
      const revolved = surface as Revit2027SurfaceOfRevolution;
      const profile = profileByToken(index, faceToken, revolved.profileCurve.token);
      if (!profile) {
        return { ok: false, code: "profile-unresolved", detail: "SurfRev profile curve is not an evaluated kind" };
      }
      return surfaceOfRevolutionEvaluator(revolved, profile);
    }
    case REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT: {
      const ruled = surface as Revit2027RuledSurface;
      const first = ruled.profileCurve1.token === 0
        ? ruled.point1
        : profileByToken(index, faceToken, ruled.profileCurve1.token);
      const second = ruled.profileCurve2.token === 0
        ? ruled.point2
        : profileByToken(index, faceToken, ruled.profileCurve2.token);
      if (!first || !second) {
        return { ok: false, code: "profile-unresolved", detail: "RuledSurf profile curve is not an evaluated kind" };
      }
      return ruledEvaluator(ruled, first, second);
    }
    case REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT:
      return hermiteEvaluator(surface as Revit2027HermiteSurface);
    default:
      return { ok: false, code: "unsupported-surface", detail: `surface slot ${slot}` };
  }
}
