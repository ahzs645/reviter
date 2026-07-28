import type {
  BrepParamPoint2,
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
import type { Revit2027CylinderSurface } from "./revit-2027-surfaces.ts";

const DEFAULT_CONTINUITY_TOLERANCE = 1e-9;

export type Revit2027CylinderSampledEdgeUse = {
  edgeToken: number;
  edge: Revit2027GEdgeStatic;
  faceSide: 0 | 1;
  direction: 1 | -1;
};

export type Revit2027CylinderSampledLoop = {
  loopToken: number;
  role: "outer" | "hole";
  edgeUses: readonly Revit2027CylinderSampledEdgeUse[];
};

export type Revit2027CylinderSampledFace = {
  faceToken: number;
  surface: Revit2027CylinderSurface;
  loops: readonly Revit2027CylinderSampledLoop[];
  orientation?: 1 | -1;
  materialId?: string | number | null;
  objectMarker?: number;
  provenance: BrepProvenance;
};

export type Revit2027CylinderSampledBrepInput = {
  id: string;
  faces: readonly Revit2027CylinderSampledFace[];
  provenance: BrepProvenance;
  continuityTolerance?: number;
};

export type Revit2027CylinderSampledBrepIssueCode =
  | "invalid-options"
  | "invalid-face-token"
  | "invalid-cylinder"
  | "invalid-loop"
  | "invalid-edge-token"
  | "invalid-edge-use"
  | "edge-face-mismatch"
  | "duplicate-edge-use"
  | "non-finite-uv"
  | "degenerate-edge"
  | "open-loop";

export type Revit2027CylinderSampledBrepIssue = {
  code: Revit2027CylinderSampledBrepIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  message: string;
};

export type Revit2027CylinderSampledBrepResult =
  | { ok: true; brep: NeutralBrep }
  | {
      ok: false;
      issues: readonly Revit2027CylinderSampledBrepIssue[];
    };

type ParamPoint = readonly [number, number];

function finitePoint3(point: BrepPoint3): boolean {
  return point.length === 3 && point.every(Number.isFinite);
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

function dot(left: BrepPoint3, right: BrepPoint3): number {
  return (
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2]
  );
}

function normalized(vector: BrepPoint3): BrepPoint3 | null {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return [
    vector[0] / magnitude,
    vector[1] / magnitude,
    vector[2] / magnitude,
  ];
}

function samePoint(
  left: ParamPoint,
  right: ParamPoint,
  tolerance: number,
): boolean {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
  ) <= tolerance;
}

function uvForSide(
  point: Revit2027EdgePoint,
  faceSide: 0 | 1,
): ParamPoint {
  return faceSide === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function edgeUvs(
  edgeUse: Revit2027CylinderSampledEdgeUse,
): ParamPoint[] {
  const points = [
    edgeUse.edge.firstAndLastEdgePoints[0],
    ...edgeUse.edge.interiorEdgePoints,
    edgeUse.edge.firstAndLastEdgePoints[1],
  ].map((point) => uvForSide(point, edgeUse.faceSide));
  return edgeUse.direction === 1 ? points : points.reverse();
}

function cylinderFrame(
  surface: Revit2027CylinderSurface,
  tolerance: number,
): {
  ok: true;
  xAxis: BrepPoint3;
  yAxis: BrepPoint3;
  axis: BrepPoint3;
  handedness: 1 | -1;
} | {
  ok: false;
  error: string;
} {
  if (
    surface.kind !== "cylinder" ||
    !finitePoint3(surface.center) ||
    !finitePoint3(surface.xVector) ||
    !finitePoint3(surface.yVector) ||
    !finitePoint3(surface.zVector) ||
    !Number.isFinite(surface.radius) ||
    surface.radius <= tolerance
  ) {
    return {
      ok: false,
      error: "Face does not have a finite positive-radius Cylinder frame",
    };
  }
  const xAxis = normalized(surface.xVector);
  const persistedYAxis = normalized(surface.yVector);
  const axis = normalized(surface.zVector);
  const yAxis = xAxis && axis ? normalized(cross(axis, xAxis)) : null;
  if (!xAxis || !persistedYAxis || !axis || !yAxis) {
    return { ok: false, error: "Cylinder basis contains a degenerate vector" };
  }
  if (
    Math.abs(dot(xAxis, axis)) > tolerance ||
    Math.abs(dot(persistedYAxis, axis)) > tolerance ||
    Math.abs(dot(xAxis, persistedYAxis)) > tolerance
  ) {
    return { ok: false, error: "Cylinder basis is not orthogonal" };
  }
  const handednessDot = dot(yAxis, persistedYAxis);
  if (Math.abs(Math.abs(handednessDot) - 1) > tolerance) {
    return {
      ok: false,
      error: "Cylinder persisted Y does not agree with either signed Z×X",
    };
  }
  return {
    ok: true,
    xAxis,
    yAxis,
    axis,
    handedness: handednessDot >= 0 ? 1 : -1,
  };
}

function mapUv(
  uv: ParamPoint,
  radius: number,
  handedness: 1 | -1,
): BrepParamPoint2 {
  // Revit: (angle, axial distance). Neutral: (axial/radius, angle).
  const axial = uv[1] / radius;
  const angular = handedness * uv[0];
  return [
    Object.is(axial, -0) ? 0 : axial,
    Object.is(angular, -0) ? 0 : angular,
  ];
}

function adaptLoop(
  face: Revit2027CylinderSampledFace,
  loop: Revit2027CylinderSampledLoop,
  handedness: 1 | -1,
  tolerance: number,
): {
  ok: true;
  loop: BrepTrimLoop;
} | {
  ok: false;
  issues: Revit2027CylinderSampledBrepIssue[];
} {
  const issues: Revit2027CylinderSampledBrepIssue[] = [];
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
      message: "a persisted cylinder loop must contain at least two edge uses",
    });
  }

  const seenEdges = new Set<number>();
  const curves: BrepTrimCurve[] = [];
  let firstPoint: BrepParamPoint2 | null = null;
  let previousPoint: BrepParamPoint2 | null = null;
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

    const sourceUvs = edgeUvs(edgeUse);
    if (
      sourceUvs.length < 2 ||
      sourceUvs.some((point) => !point.every(Number.isFinite))
    ) {
      issues.push({
        code: "non-finite-uv",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "GEdge has fewer than two finite face-local UV samples",
      });
      continue;
    }
    const points = sourceUvs.map((uv) =>
      mapUv(uv, face.surface.radius, handedness)
    );
    if (
      points.some(
        (point, index) =>
          index > 0 &&
          samePoint(points[index - 1]!, point, tolerance),
      )
    ) {
      issues.push({
        code: "degenerate-edge",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "GEdge contains consecutive coincident sampled UV points",
      });
      continue;
    }
    if (
      previousPoint &&
      !samePoint(previousPoint, points[0]!, tolerance)
    ) {
      issues.push({
        code: "open-loop",
        faceToken: face.faceToken,
        loopToken: loop.loopToken,
        edgeToken: edgeUse.edgeToken,
        message: "adjacent directed GEdges do not share a sampled UV endpoint",
      });
      continue;
    }
    firstPoint ??= points[0]!;
    previousPoint = points.at(-1)!;

    const constantFirst = points.every(
      (point) => Math.abs(point[0] - points[0]![0]) <= tolerance,
    );
    const constantSecond = points.every(
      (point) => Math.abs(point[1] - points[0]![1]) <= tolerance,
    );
    curves.push(
      constantFirst !== constantSecond
        ? {
            kind: "pcurve-line",
            start: points[0]!,
            end: points.at(-1)!,
          }
        : { kind: "pcurve-polyline", points },
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
 * Adapt persisted Revit 2027 cylinder GEdge samples into the browser-neutral
 * cylinder chart.
 *
 * The adapter performs the native-proven parameter bridge:
 *
 * - Revit `uv = (angle, axialDistance)`;
 * - neutral `uv = (axialDistance / radius, signedAngle)`.
 *
 * A left-handed persisted X/Y/Z basis is represented with the neutral
 * right-handed `Y = Z×X`, a negated angular parameter, and a corresponding
 * face-orientation sign. No coordinates are inferred from the IFC.
 */
export function adaptRevit2027CylinderSampledBrep(
  input: Revit2027CylinderSampledBrepInput,
): Revit2027CylinderSampledBrepResult {
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
        message:
          "BRep id and positive finite continuity tolerance are required",
      }],
    };
  }

  const issues: Revit2027CylinderSampledBrepIssue[] = [];
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
    const frame = cylinderFrame(face.surface, tolerance);
    if (!frame.ok) {
      issues.push({
        code: "invalid-cylinder",
        faceToken: face.faceToken,
        message: frame.error,
      });
      continue;
    }
    const trims: BrepTrimLoop[] = [];
    for (const loop of face.loops) {
      const adapted = adaptLoop(
        face,
        loop,
        frame.handedness,
        tolerance,
      );
      if (!adapted.ok) {
        issues.push(...adapted.issues);
      } else {
        trims.push(adapted.loop);
      }
    }
    if (issues.some((issue) => issue.faceToken === face.faceToken)) continue;

    const geometricOrientation: 1 | -1 =
      face.surface.surface.orientFlag === (frame.handedness === 1)
        ? 1
        : -1;
    faces.push({
      id: `revit-2027-face-${face.faceToken}`,
      surface: {
        kind: "cylinder",
        origin: face.surface.center,
        axis: frame.axis,
        xAxis: frame.xAxis,
        yAxis: frame.yAxis,
        radius: face.surface.radius,
      },
      trims,
      orientation: face.orientation ?? geometricOrientation,
      materialId: face.materialId ?? null,
      objectMarker: face.objectMarker,
      provenance: { ...face.provenance },
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    brep: {
      id: input.id,
      faces,
      provenance: { ...input.provenance },
    },
  };
}
