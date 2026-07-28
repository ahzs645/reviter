import type {
  BrepPoint3,
  BrepProvenance,
  BrepTrimCurve,
  BrepTrimLoop,
  NeutralBrep,
  NeutralBrepFace,
} from "./brep-tessellator.ts";
import type {
  Revit2027EdgePoint,
  Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import type { Revit2027PlaneSurface } from "./revit-2027-surfaces.ts";

const DEFAULT_CONTINUITY_TOLERANCE = 1e-9;

export type Revit2027PlanarSampledEdgeUse = {
  edgeToken: number;
  edge: Revit2027GEdgeStatic;
  /** Selects the first or second persisted face-local UV pair. */
  faceSide: 0 | 1;
  /** Direction of this edge use in the owning loop. */
  direction: 1 | -1;
};

export type Revit2027PlanarSampledLoop = {
  loopToken: number;
  role: "outer" | "hole";
  edgeUses: readonly Revit2027PlanarSampledEdgeUse[];
};

export type Revit2027PlanarSampledFace = {
  faceToken: number;
  surface: Revit2027PlaneSurface;
  loops: readonly Revit2027PlanarSampledLoop[];
  /**
   * Orientation relative to the geometric surface. When omitted, the exact
   * persisted Surface orientation flag is used.
   */
  orientation?: 1 | -1;
  /**
   * Must be supplied only by an independently decoded face-material relation.
   * A geometry style or IFC material is not substituted here.
   */
  materialId?: string | number | null;
  objectMarker?: number;
  provenance: BrepProvenance;
};

export type Revit2027PlanarSampledBrepInput = {
  id: string;
  faces: readonly Revit2027PlanarSampledFace[];
  provenance: BrepProvenance;
  continuityTolerance?: number;
};

export type Revit2027PlanarSampledBrepIssueCode =
  | "invalid-options"
  | "invalid-face-token"
  | "invalid-plane"
  | "invalid-loop"
  | "invalid-edge-token"
  | "invalid-edge-use"
  | "edge-face-mismatch"
  | "duplicate-edge-use"
  | "non-finite-uv"
  | "degenerate-edge"
  | "open-loop";

export type Revit2027PlanarSampledBrepIssue = {
  code: Revit2027PlanarSampledBrepIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  message: string;
};

export type Revit2027PlanarSampledBrepResult =
  | { ok: true; brep: NeutralBrep }
  | { ok: false; issues: readonly Revit2027PlanarSampledBrepIssue[] };

type ParamPoint = readonly [number, number];

function finitePoint2(point: ParamPoint): boolean {
  return point.length === 2 && point.every(Number.isFinite);
}

function finitePoint3(point: BrepPoint3): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function samePoint(
  left: BrepPoint3,
  right: BrepPoint3,
  tolerance: number,
): boolean {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ) <= tolerance;
}

function cross(
  left: BrepPoint3,
  right: BrepPoint3,
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(point: BrepPoint3): BrepPoint3 | null {
  const magnitude = Math.hypot(point[0], point[1], point[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return [
    point[0] / magnitude,
    point[1] / magnitude,
    point[2] / magnitude,
  ];
}

function uvForSide(
  point: Revit2027EdgePoint,
  faceSide: 0 | 1,
): ParamPoint {
  return faceSide === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function edgeUvs(
  edgeUse: Revit2027PlanarSampledEdgeUse,
): readonly ParamPoint[] {
  const points = [
    edgeUse.edge.firstAndLastEdgePoints[0],
    ...edgeUse.edge.interiorEdgePoints,
    edgeUse.edge.firstAndLastEdgePoints[1],
  ].map((point) => uvForSide(point, edgeUse.faceSide));
  return edgeUse.direction === 1 ? points : points.reverse();
}

function planePoint(
  surface: Revit2027PlaneSurface,
  uv: ParamPoint,
): BrepPoint3 {
  return [
    surface.origin[0] + uv[0] * surface.xVector[0] + uv[1] * surface.yVector[0],
    surface.origin[1] + uv[0] * surface.xVector[1] + uv[1] * surface.yVector[1],
    surface.origin[2] + uv[0] * surface.xVector[2] + uv[1] * surface.yVector[2],
  ];
}

function adaptLoop(
  face: Revit2027PlanarSampledFace,
  loop: Revit2027PlanarSampledLoop,
  tolerance: number,
): { ok: true; loop: BrepTrimLoop } | {
  ok: false;
  issues: Revit2027PlanarSampledBrepIssue[];
} {
  const issues: Revit2027PlanarSampledBrepIssue[] = [];
  if (!Number.isSafeInteger(loop.loopToken) || loop.loopToken <= 0) {
    issues.push({
      code: "invalid-loop",
      faceToken: face.faceToken,
      loopToken: loop.loopToken,
      message: "loop token must be a positive safe integer",
    });
  }
  if (loop.edgeUses.length < 2) {
    issues.push({
      code: "invalid-loop",
      faceToken: face.faceToken,
      loopToken: loop.loopToken,
      message: "a persisted planar loop must contain at least two edge uses",
    });
  }

  const seenEdges = new Set<number>();
  const curves: BrepTrimCurve[] = [];
  let firstPoint: BrepPoint3 | null = null;
  let previousPoint: BrepPoint3 | null = null;
  for (const edgeUse of loop.edgeUses) {
    if (!Number.isSafeInteger(edgeUse.edgeToken) || edgeUse.edgeToken <= 0) {
      issues.push({
        code: "invalid-edge-token",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "edge token must be a positive safe integer",
      });
      continue;
    }
    if (seenEdges.has(edgeUse.edgeToken)) {
      issues.push({
        code: "duplicate-edge-use",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "the same edge token occurs more than once in one loop",
      });
      continue;
    }
    seenEdges.add(edgeUse.edgeToken);

    if (
      (edgeUse.faceSide !== 0 && edgeUse.faceSide !== 1) ||
      (edgeUse.direction !== 1 && edgeUse.direction !== -1)
    ) {
      issues.push({
        code: "invalid-edge-use",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "GEdge use must select face side 0/1 and direction +1/-1",
      });
      continue;
    }
    if (edgeUse.edge.faceReferences[edgeUse.faceSide] !== face.faceToken) {
      issues.push({
        code: "edge-face-mismatch",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "selected GEdge face side does not reference the owning Face",
      });
      continue;
    }

    const uvs = edgeUvs(edgeUse);
    if (uvs.length < 2 || uvs.some((point) => !finitePoint2(point))) {
      issues.push({
        code: "non-finite-uv",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "GEdge has fewer than two finite face-local UV samples",
      });
      continue;
    }
    const points = uvs.map((point) => planePoint(face.surface, point));
    if (points.some((point) => !finitePoint3(point))) {
      issues.push({
        code: "non-finite-uv",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "mapping GEdge UV samples through the Plane is not finite",
      });
      continue;
    }
    if (
      points.some(
        (point, index) =>
          index > 0 && samePoint(points[index - 1]!, point, tolerance),
      )
    ) {
      issues.push({
        code: "degenerate-edge",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "GEdge contains consecutive coincident sampled points",
      });
      continue;
    }
    if (previousPoint && !samePoint(previousPoint, points[0]!, tolerance)) {
      issues.push({
        code: "open-loop",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "adjacent directed GEdges do not share a sampled endpoint",
      });
      continue;
    }
    firstPoint ??= points[0]!;
    previousPoint = points.at(-1)!;
    curves.push(
      points.length === 2
        ? { kind: "line", start: points[0]!, end: points[1]! }
        : { kind: "polyline", points },
    );
  }

  if (
    firstPoint &&
    previousPoint &&
    !samePoint(firstPoint, previousPoint, tolerance)
  ) {
    issues.push({
      code: "open-loop",
      faceToken: face.faceToken,
      loopToken: loop.loopToken,
      message: "the final directed GEdge does not close to the first",
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    loop: {
      id: `revit-2027-loop-${loop.loopToken}`,
      role: loop.role,
      curves,
    },
  };
}

/**
 * Adapt exact persisted Revit 2027 planar UV samples into Reviter's
 * browser-neutral BRep contract.
 *
 * This is intentionally not a general curve evaluator. It uses only the UV
 * endpoints/interior samples already persisted by GEdge and requires the
 * caller to provide the resolved loop order, face side, and direction.
 */
export function adaptRevit2027PlanarSampledBrep(
  input: Revit2027PlanarSampledBrepInput,
): Revit2027PlanarSampledBrepResult {
  const tolerance =
    input.continuityTolerance ?? DEFAULT_CONTINUITY_TOLERANCE;
  if (
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    typeof input.id !== "string" ||
    input.id.length === 0
  ) {
    return {
      ok: false,
      issues: [{
        code: "invalid-options",
        message: "BRep id and positive finite continuity tolerance are required",
      }],
    };
  }

  const issues: Revit2027PlanarSampledBrepIssue[] = [];
  const faces: NeutralBrepFace[] = [];
  for (const face of input.faces) {
    if (!Number.isSafeInteger(face.faceToken) || face.faceToken <= 0) {
      issues.push({
        code: "invalid-face-token",
        faceToken: face.faceToken,
        message: "face token must be a positive safe integer",
      });
      continue;
    }
    const normal = normalized(cross(face.surface.xVector, face.surface.yVector));
    if (
      face.surface.kind !== "plane" ||
      !finitePoint3(face.surface.origin) ||
      !finitePoint3(face.surface.xVector) ||
      !finitePoint3(face.surface.yVector) ||
      !normal
    ) {
      issues.push({
        code: "invalid-plane",
        faceToken: face.faceToken,
        message: "Face does not have a finite non-degenerate Plane frame",
      });
      continue;
    }
    if (face.loops.filter((loop) => loop.role === "outer").length !== 1) {
      issues.push({
        code: "invalid-loop",
        faceToken: face.faceToken,
        message: "a planar neutral face requires exactly one explicit outer loop",
      });
      continue;
    }

    const trims: BrepTrimLoop[] = [];
    for (const loop of face.loops) {
      const adapted = adaptLoop(face, loop, tolerance);
      if (adapted.ok) trims.push(adapted.loop);
      else issues.push(...adapted.issues);
    }
    if (trims.length !== face.loops.length) continue;

    faces.push({
      id: `revit-2027-face-${face.faceToken}`,
      surface: {
        kind: "plane",
        origin: face.surface.origin,
        uAxis: face.surface.xVector,
        vAxis: face.surface.yVector,
        normal,
      },
      trims,
      orientation:
        face.orientation ?? (face.surface.surface.orientFlag ? 1 : -1),
      materialId: face.materialId ?? null,
      objectMarker: face.objectMarker,
      provenance: face.provenance,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    brep: {
      id: input.id,
      faces,
      provenance: input.provenance,
    },
  };
}
