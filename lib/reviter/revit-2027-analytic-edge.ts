import type { BrepPoint3 } from "./brep-tessellator.ts";
import {
  revit2027GEdgeNativeCurveKind,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import type { Revit2027GArc } from "./revit-2027-garc.ts";
import {
  type Revit2027AnalyticSurface,
  type RevitPoint2d,
} from "./revit-2027-surfaces.ts";

export type Revit2027AnalyticSurfaceEvaluationIssueCode =
  | "invalid-parameter"
  | "invalid-surface"
  | "missing-profile";

export type Revit2027AnalyticSurfaceEvaluationResult =
  | { ok: true; point: BrepPoint3 }
  | {
      ok: false;
      code: Revit2027AnalyticSurfaceEvaluationIssueCode;
      error: string;
    };

export type Revit2027LineEdgeEvaluationIssueCode =
  | Revit2027AnalyticSurfaceEvaluationIssueCode
  | "not-line-segment"
  | "edge-face-mismatch";

export type Revit2027LineEdgeEvaluationResult =
  | { ok: true; start: BrepPoint3; end: BrepPoint3 }
  | {
      ok: false;
      code: Revit2027LineEdgeEvaluationIssueCode;
      error: string;
    };

function add(
  left: BrepPoint3,
  right: BrepPoint3,
): BrepPoint3 {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
  ];
}

function scale(vector: BrepPoint3, scalar: number): BrepPoint3 {
  return [
    vector[0] * scalar,
    vector[1] * scalar,
    vector[2] * scalar,
  ];
}

function finitePoint(point: BrepPoint3): boolean {
  return point.every(Number.isFinite);
}

/**
 * Evaluate one persisted Revit 2027 analytic-surface parameter point.
 *
 * This is the browser-side mathematical counterpart of the already decoded
 * Plane, CylSurf, ConeSurf, and circular-profile SurfRev records. It does not
 * approximate an unknown surface and SurfRev remains unavailable without its
 * exact queued GArc profile.
 */
export function evaluateRevit2027AnalyticSurfacePoint(
  surface: Revit2027AnalyticSurface,
  uv: RevitPoint2d,
  profile?: Revit2027GArc,
): Revit2027AnalyticSurfaceEvaluationResult {
  if (uv.length !== 2 || !uv.every(Number.isFinite)) {
    return {
      ok: false,
      code: "invalid-parameter",
      error: "analytic-surface UV must contain two finite values",
    };
  }

  let point: BrepPoint3;
  if (surface.kind === "plane") {
    // Preserve the established `(origin + u*x) + v*y` operation order. The
    // equivalent regrouping changes low bits and can alter near-degenerate
    // triangulation decisions in the exact corpus.
    point = add(
      add(surface.origin, scale(surface.xVector, uv[0])),
      scale(surface.yVector, uv[1]),
    );
  } else if (surface.kind === "cylinder") {
    const radial = add(
      scale(surface.xVector, Math.cos(uv[0])),
      scale(surface.yVector, Math.sin(uv[0])),
    );
    point = add(
      surface.center,
      add(scale(radial, surface.radius), scale(surface.zVector, uv[1])),
    );
  } else if (surface.kind === "cone") {
    const radial = add(
      scale(surface.xVector, Math.cos(uv[0])),
      scale(surface.yVector, Math.sin(uv[0])),
    );
    point = add(
      surface.center,
      add(
        scale(radial, uv[1] * Math.sin(surface.halfAngle)),
        scale(surface.zVector, uv[1] * Math.cos(surface.halfAngle)),
      ),
    );
  } else {
    if (!profile) {
      return {
        ok: false,
        code: "missing-profile",
        error: "surface-of-revolution evaluation requires its queued GArc",
      };
    }
    const profilePoint = add(
      profile.center,
      scale(
        add(
          scale(profile.xDirection, Math.cos(uv[1])),
          scale(profile.yDirection, Math.sin(uv[1])),
        ),
        profile.radius,
      ),
    );
    const radial = add(
      scale(surface.xVector, Math.cos(uv[0])),
      scale(surface.yVector, Math.sin(uv[0])),
    );
    point = add(
      surface.center,
      add(
        scale(radial, profilePoint[0]),
        scale(surface.zVector, profilePoint[2]),
      ),
    );
  }

  if (!finitePoint(point)) {
    return {
      ok: false,
      code: "invalid-surface",
      error: "analytic-surface evaluation produced a non-finite point",
    };
  }
  return { ok: true, point };
}

/**
 * Reconstruct the exact intrinsic 3D line segment for a two-point GEdge on
 * one adjacent decoded surface.
 *
 * Loop direction is deliberately not applied here: the edge owns the shared
 * curve, while each coedge owns its face-local traversal direction.
 */
export function evaluateRevit2027GEdgeLineSegment(
  edge: Pick<
    Revit2027GEdgeStatic,
    | "faceReferences"
    | "firstAndLastEdgePoints"
    | "flags"
    | "interiorEdgePoints"
  >,
  faceToken: number,
  faceSide: 0 | 1,
  surface: Revit2027AnalyticSurface,
  profile?: Revit2027GArc,
): Revit2027LineEdgeEvaluationResult {
  if (revit2027GEdgeNativeCurveKind(edge) !== "line-segment") {
    return {
      ok: false,
      code: "not-line-segment",
      error: "GEdge is not a native-proven two-point line segment",
    };
  }
  if (edge.faceReferences[faceSide] !== faceToken) {
    return {
      ok: false,
      code: "edge-face-mismatch",
      error: "selected GEdge side does not reference the supplied Face",
    };
  }
  const uv = edge.firstAndLastEdgePoints.map((point) =>
    faceSide === 0 ? point.firstFaceUv : point.secondFaceUv
  );
  const start = evaluateRevit2027AnalyticSurfacePoint(
    surface,
    uv[0]!,
    profile,
  );
  if (!start.ok) return start;
  const end = evaluateRevit2027AnalyticSurfacePoint(
    surface,
    uv[1]!,
    profile,
  );
  if (!end.ok) return end;
  return { ok: true, start: start.point, end: end.point };
}
