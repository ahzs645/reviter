import {
  tessellateNeutralBrep,
  type NeutralFaceMesh,
} from "./brep-tessellator.ts";
import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
  type Revit2027EdgeLoopWithChainEnvelopesStatic,
} from "./revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  revit2027GEdgeLoopDirection,
  revit2027GEdgeLoopNextReference,
  revit2027GEdgeLoopPreviousReference,
  type Revit2027EdgePoint,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
import {
  bindRevit2027FaceMaterial,
  type Revit2027MaterialDefinitions,
} from "./revit-2027-face-material.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  adaptRevit2027CylinderSampledBrep,
  type Revit2027CylinderSampledEdgeUse,
  type Revit2027CylinderSampledJoinBridge,
} from "./revit-2027-cylinder-sampled-brep.ts";
import {
  evaluateRevit2027AnalyticSurfacePoint,
} from "./revit-2027-analytic-edge.ts";
import {
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027CylinderSurface,
} from "./revit-2027-surfaces.ts";
import { groupRings, type Point2 } from "./polygon.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;
/**
 * `OdBrepBuilderFillerHelper::checkCoedgeLoop` evaluates adjacent p-curve
 * endpoints in 3D. `PointsDists::areEndsIntersecting` admits the closest pair
 * below this filler-wide distance before trying a 2D curve intersection.
 */
const NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET = 0.01;

export type Revit2027CylinderOwnerMeshIssueCode =
  | "invalid-options"
  | "surface-unresolved"
  | "loop-unresolved"
  | "loop-cycle"
  | "multi-loop"
  | "loop-face-mismatch"
  | "loop-envelope-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
  | "non-rectangular-trim"
  | "opposite-sampling-mismatch"
  | "wrapping-chart"
  | "multi-segment-axial-policy-not-bound"
  | "material-unresolved"
  | "adapter-rejected"
  | "tessellator-rejected";

export type Revit2027CylinderOwnerMeshIssue = {
  code: Revit2027CylinderOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027CylinderOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  angularSegments: number;
  axialSegments: number;
  bridgedJoinCount: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027CylinderOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027CylinderOwnerFaceMesh[];
  issues: readonly Revit2027CylinderOwnerMeshIssue[];
};

export type Revit2027CylinderOwnerMeshResult =
  | { ok: true; value: Revit2027CylinderOwnerMesh }
  | { ok: false; error: string };

export type Revit2027CylinderOwnerMeshOptions = {
  uvTolerance?: number;
  replayRegistry?: Revit2027GRepReplayRegistry;
  replayOptions?: Revit2027GRepReplayOptions;
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
};

type LoopRecord = {
  token: number;
  loop: Revit2027EdgeLoopStatic;
};

type DirectedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
  direction: 1 | -1;
};

type Boundary = "u-min" | "u-max" | "v-min" | "v-max";

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027CylinderOwnerMeshOptions,
  issues: Revit2027CylinderOwnerMeshIssue[],
): string | number | null {
  const supplied = options.materialForFace?.(faceToken, face);
  if (supplied !== undefined) return supplied;
  if (!options.materialDefinitions) return null;
  const binding = bindRevit2027FaceMaterial(
    face.renderStyleElementId,
    options.materialDefinitions,
  );
  if (binding.status === "exact-material") return binding.materialElementId;
  if (binding.status === "unresolved-positive-id") {
    issues.push({
      code: "material-unresolved",
      faceToken,
      detail: `${binding.renderStyleElementId}: ${binding.reason}`,
    });
  }
  return null;
}

function distance(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function faceUv(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): readonly [number, number] {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function edgeSide(
  edge: Revit2027GEdgeStatic,
  faceToken: number,
): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  return first === second ? null : first ? 0 : 1;
}

function nativeOrthogonalJoinBridge(
  current: DirectedEdge,
  next: DirectedEdge,
  surface: Revit2027CylinderSurface,
  tolerance: number,
): Revit2027CylinderSampledJoinBridge | null {
  const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
  const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
  const start = faceUv(
    current.edge.firstAndLastEdgePoints[currentEnd],
    current.side,
  );
  const end = faceUv(
    next.edge.firstAndLastEdgePoints[nextStart],
    next.side,
  );
  const changesAngle = Math.abs(start[0] - end[0]) > tolerance;
  const changesAxial = Math.abs(start[1] - end[1]) > tolerance;
  if (
    changesAngle === changesAxial ||
    (changesAngle &&
      Math.abs(start[0] - end[0]) > Math.PI + tolerance)
  ) {
    return null;
  }
  const first = evaluateRevit2027AnalyticSurfacePoint(surface, start);
  const second = evaluateRevit2027AnalyticSurfacePoint(surface, end);
  if (!first.ok || !second.ok) return null;
  const modelDistance = Math.hypot(
    first.point[0] - second.point[0],
    first.point[1] - second.point[1],
    first.point[2] - second.point[2],
  );
  if (
    !Number.isFinite(modelDistance) ||
    modelDistance > NATIVE_COEDGE_ENDPOINT_DISTANCE_FEET
  ) {
    return null;
  }
  return {
    afterEdgeToken: current.token,
    start,
    end,
  };
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  surface: Revit2027CylinderSurface,
  tolerance: number,
):
  | {
      ok: true;
      edges: DirectedEdge[];
      joinBridges: Revit2027CylinderSampledJoinBridge[];
    }
  | { ok: false; issue: Revit2027CylinderOwnerMeshIssue } {
  const ordered: DirectedEdge[] = [];
  const visited = new Set<number>();
  let edgeToken = loop.loop.nextEdgeReference;
  while (edgeToken !== loop.token) {
    if (edgeToken <= 0 || visited.has(edgeToken)) {
      return {
        ok: false,
        issue: {
          code: "edge-cycle",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
      };
    }
    const edge = edges.get(edgeToken);
    if (!edge) {
      return {
        ok: false,
        issue: {
          code: "edge-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
      };
    }
    const side = edgeSide(edge, faceToken);
    if (side == null) {
      return {
        ok: false,
        issue: {
          code: "edge-face-mismatch",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
      };
    }
    visited.add(edgeToken);
    ordered.push({
      token: edgeToken,
      edge,
      side,
      direction: revit2027GEdgeLoopDirection(edge, side),
    });
    edgeToken = revit2027GEdgeLoopNextReference(edge, side);
    if (ordered.length > edges.size) {
      return {
        ok: false,
        issue: {
          code: "edge-cycle",
          faceToken,
          loopToken: loop.token,
        },
      };
    }
  }
  if (
    ordered.length < 2 ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    ordered[0] &&
      revit2027GEdgeLoopPreviousReference(
        ordered[0].edge,
        ordered[0].side,
      ) !== loop.token
  ) {
    return {
      ok: false,
      issue: {
        code: "edge-link-mismatch",
        faceToken,
        loopToken: loop.token,
      },
    };
  }

  const joinBridges: Revit2027CylinderSampledJoinBridge[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
    const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
    const joinDistance = distance(
      faceUv(current.edge.firstAndLastEdgePoints[currentEnd], current.side),
      faceUv(next.edge.firstAndLastEdgePoints[nextStart], next.side),
    );
    if (joinDistance > tolerance) {
      const bridge = nativeOrthogonalJoinBridge(
        current,
        next,
        surface,
        tolerance,
      );
      if (bridge) {
        joinBridges.push(bridge);
        continue;
      }
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: current.token,
          detail: `native directed join distance: ${joinDistance}`,
        },
      };
    }
  }
  return { ok: true, edges: ordered, joinBridges };
}

function directedUvs(
  edge: DirectedEdge,
): readonly (readonly [number, number])[] {
  const points = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) =>
      faceUv(point, edge.side)
    ),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

function envelopeMatches(
  loop: Revit2027EdgeLoopStatic["envelope"],
  surface: Revit2027CylinderSurface["surface"]["envelope"],
  tolerance: number,
): boolean {
  return (
    distance(loop.minimum, surface.firstCorner) <= tolerance &&
    distance(loop.maximum, surface.secondCorner) <= tolerance
  );
}

function classifyRectangle(
  edges: readonly DirectedEdge[],
  minimum: readonly [number, number],
  maximum: readonly [number, number],
  tolerance: number,
):
  | {
      ok: true;
      angularSegments: number;
      axialSegments: number;
      edgeUses: Revit2027CylinderSampledEdgeUse[];
    }
  | {
      ok: false;
      code: "non-rectangular-trim" | "opposite-sampling-mismatch";
      edgeToken?: number;
      detail?: string;
    } {
  if (edges.length !== 4) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: `edge count: ${edges.length}`,
    };
  }
  const sideCounts = new Map<Boundary, number>();
  for (const edge of edges) {
    const points = directedUvs(edge);
    const allNear = (axis: 0 | 1, value: number): boolean =>
      points.every((point) => Math.abs(point[axis] - value) <= tolerance);
    const boundary: Boundary | null =
      allNear(0, minimum[0])
        ? "u-min"
        : allNear(0, maximum[0])
          ? "u-max"
          : allNear(1, minimum[1])
            ? "v-min"
            : allNear(1, maximum[1])
              ? "v-max"
              : null;
    if (boundary == null || sideCounts.has(boundary)) {
      return {
        ok: false,
        code: "non-rectangular-trim",
        edgeToken: edge.token,
      };
    }
    sideCounts.set(boundary, points.length - 1);
  }
  if (sideCounts.size !== 4) {
    return { ok: false, code: "non-rectangular-trim" };
  }
  if (
    sideCounts.get("u-min") !== sideCounts.get("u-max") ||
    sideCounts.get("v-min") !== sideCounts.get("v-max")
  ) {
    return { ok: false, code: "opposite-sampling-mismatch" };
  }
  return {
    ok: true,
    angularSegments: sideCounts.get("v-min")!,
    axialSegments: sideCounts.get("u-min")!,
    edgeUses: edges.map((edge) => ({
      edgeToken: edge.token,
      edge: edge.edge,
      faceSide: edge.side,
      direction: edge.direction,
    })),
  };
}

function classifyOrthogonalSampledTrim(
  edges: readonly DirectedEdge[],
  tolerance: number,
):
  | {
      ok: true;
      maximumAngularSampleStep: number;
      edgeUses: Revit2027CylinderSampledEdgeUse[];
    }
  | {
      ok: false;
      code:
        | "non-rectangular-trim"
        | "multi-segment-axial-policy-not-bound";
      edgeToken?: number;
      detail?: string;
    } {
  if (edges.length < 6) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: `edge count: ${edges.length}`,
    };
  }
  let maximumAngularSampleStep = 0;
  for (const edge of edges) {
    const points = directedUvs(edge);
    const constantAngle = points.every(
      (point) => Math.abs(point[0] - points[0]![0]) <= tolerance,
    );
    const constantAxial = points.every(
      (point) => Math.abs(point[1] - points[0]![1]) <= tolerance,
    );
    if (constantAngle === constantAxial) {
      return {
        ok: false,
        code: "non-rectangular-trim",
        edgeToken: edge.token,
        detail: "sampled p-curve edge is degenerate or not parameter-aligned",
      };
    }
    if (constantAngle) {
      if (points.length !== 2) {
        return {
          ok: false,
          code: "multi-segment-axial-policy-not-bound",
          edgeToken: edge.token,
          detail: `axial segments: ${points.length - 1}`,
        };
      }
      continue;
    }
    for (let index = 0; index + 1 < points.length; index += 1) {
      const step = Math.abs(points[index + 1]![0] - points[index]![0]);
      if (!Number.isFinite(step) || step <= tolerance) {
        return {
          ok: false,
          code: "non-rectangular-trim",
          edgeToken: edge.token,
          detail: "angular sample interval is not positive and finite",
        };
      }
      maximumAngularSampleStep = Math.max(
        maximumAngularSampleStep,
        step,
      );
    }
  }
  if (maximumAngularSampleStep <= tolerance) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: "sampled p-curve has no angular interval",
    };
  }
  return {
    ok: true,
    maximumAngularSampleStep,
    edgeUses: edges.map((edge) => ({
      edgeToken: edge.token,
      edge: edge.edge,
      faceSide: edge.side,
      direction: edge.direction,
    })),
  };
}

function classifySingleDiagonalSampledTrim(
  edges: readonly DirectedEdge[],
  tolerance: number,
):
  | {
      ok: true;
      maximumAngularSampleStep: number;
      edgeUses: Revit2027CylinderSampledEdgeUse[];
    }
  | {
      ok: false;
      code: "non-rectangular-trim";
      edgeToken?: number;
      detail?: string;
    } {
  if (edges.length !== 4) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: `edge count: ${edges.length}`,
    };
  }
  let diagonalEdgeCount = 0;
  let maximumAngularSampleStep = 0;
  for (const edge of edges) {
    const points = directedUvs(edge);
    const constantAngle = points.every(
      (point) => Math.abs(point[0] - points[0]![0]) <= tolerance,
    );
    const constantAxial = points.every(
      (point) => Math.abs(point[1] - points[0]![1]) <= tolerance,
    );
    if (constantAngle && constantAxial) {
      return {
        ok: false,
        code: "non-rectangular-trim",
        edgeToken: edge.token,
        detail: "sampled p-curve edge is degenerate",
      };
    }
    if (!constantAngle && !constantAxial) {
      if (points.length < 3) {
        return {
          ok: false,
          code: "non-rectangular-trim",
          edgeToken: edge.token,
          detail:
            "diagonal cylinder p-curve is not bound by persisted interior samples",
        };
      }
      diagonalEdgeCount += 1;
    }
    for (let index = 0; index + 1 < points.length; index += 1) {
      const angularStep = Math.abs(
        points[index + 1]![0] - points[index]![0],
      );
      const axialStep = Math.abs(
        points[index + 1]![1] - points[index]![1],
      );
      if (
        !Number.isFinite(angularStep) ||
        !Number.isFinite(axialStep) ||
        (angularStep <= tolerance && axialStep <= tolerance) ||
        angularStep > Math.PI + tolerance
      ) {
        return {
          ok: false,
          code: "non-rectangular-trim",
          edgeToken: edge.token,
          detail:
            "sampled cylinder p-curve interval is degenerate or crosses an ambiguous wrap",
        };
      }
      maximumAngularSampleStep = Math.max(
        maximumAngularSampleStep,
        angularStep,
      );
    }
  }
  if (
    diagonalEdgeCount !== 1 ||
    maximumAngularSampleStep <= tolerance
  ) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail:
        `${diagonalEdgeCount} sampled diagonal edges; expected exactly one`,
    };
  }
  return {
    ok: true,
    maximumAngularSampleStep,
    edgeUses: edges.map((edge) => ({
      edgeToken: edge.token,
      edge: edge.edge,
      faceSide: edge.side,
      direction: edge.direction,
    })),
  };
}

function sampledUvRing(
  edges: readonly DirectedEdge[],
  tolerance: number,
): Point2[] | null {
  const ring: Point2[] = [];
  for (const edge of edges) {
    const points = directedUvs(edge);
    for (let index = 0; index < points.length; index += 1) {
      if (ring.length > 0 && index === 0) continue;
      ring.push([points[index]![0], points[index]![1]]);
    }
  }
  if (
    ring.length > 1 &&
    distance(ring[0]!, ring.at(-1)!) <= tolerance
  ) {
    ring.pop();
  }
  return (
      ring.length >= 3 &&
      ring.every((point) => point.every(Number.isFinite))
    )
    ? ring
    : null;
}

function signedUvRingArea(ring: readonly Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twiceArea += point[0] * next[1] - next[0] * point[1];
  }
  return twiceArea / 2;
}

function sameUvRing(
  left: readonly Point2[],
  right: readonly Point2[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point[0] === right[index]![0] &&
        point[1] === right[index]![1],
    )
  );
}

function classifyNativeLoopRoles(
  directedByLoop: readonly (readonly DirectedEdge[])[],
  normalFlipped: boolean,
  surfaceOrientFlag: boolean,
  tolerance: number,
): readonly ("outer" | "hole")[] | null {
  if (directedByLoop.length === 1) return ["outer"];
  const rings: Point2[][] = [];
  for (const directed of directedByLoop) {
    const ring = sampledUvRing(directed, tolerance);
    if (!ring) return null;
    rings.push(ring);
  }

  // TB_Geometry's OdBmEdgeLoopImpl::isCCW corrects directed UV winding when
  // the persisted Face normal-flip bit equals Surface.orientFlag. Its
  // containment result must independently agree before roles are admitted.
  const areaTolerance = Math.max(tolerance * tolerance, Number.EPSILON);
  const roles: ("outer" | "hole")[] = [];
  for (const ring of rings) {
    const rawArea = signedUvRingArea(ring);
    const correctedArea =
      normalFlipped === surfaceOrientFlag ? -rawArea : rawArea;
    if (Math.abs(correctedArea) <= areaTolerance) return null;
    roles.push(correctedArea > 0 ? "outer" : "hole");
  }
  const groups = groupRings(rings);
  if (
    groups.length !== 1 ||
    groups[0]!.holes.length !== rings.length - 1
  ) {
    return null;
  }
  const used = new Set<number>();
  const matchingRingIndex = (target: readonly Point2[]): number | null => {
    const matches = rings
      .map((ring, index) => ({ ring, index }))
      .filter(
        ({ ring, index }) =>
          !used.has(index) && sameUvRing(ring, target),
      );
    if (matches.length !== 1) return null;
    used.add(matches[0]!.index);
    return matches[0]!.index;
  };
  const outerIndex = matchingRingIndex(groups[0]!.outer);
  if (outerIndex == null || roles[outerIndex] !== "outer") return null;
  for (const hole of groups[0]!.holes) {
    const holeIndex = matchingRingIndex(hole);
    if (holeIndex == null || roles[holeIndex] !== "hole") return null;
  }
  return used.size === rings.length ? roles : null;
}

/**
 * Convert independently certified non-wrapping Cylinder charts in one already
 * completed browser replay. Rectangles retain their original path. A
 * non-rectangular loop enters only when every persisted GEdge is aligned to one
 * surface parameter and its angular samples bind the browser grid. Linked
 * loops enter only when TB_Geometry's corrected UV winding and sampled
 * containment prove one outer contour with direct holes. Unsupported seams,
 * ambiguous loop roles, and axial subdivision fail closed.
 */
export function meshRevit2027CylinderSampledReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027CylinderOwnerMeshOptions = {},
): Revit2027CylinderOwnerMeshResult {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }

  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
  const cylindersByFace = new Map<number, Revit2027CylinderSurface>();
  for (const span of replay.spans) {
    if (
      span.propertySourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      faces.set(span.propertyToken, spanValue<Revit2027FaceStatic>(span));
      faceTokenByReplayIndex.set(span.replayIndex, span.propertyToken);
    } else if (
      span.propertySourceClassSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      edges.set(span.propertyToken, spanValue<Revit2027GEdgeStatic>(span));
    } else if (
      span.propertySourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopStatic>(span),
      });
    } else if (
      span.propertySourceClassSlot ===
        REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT &&
      span.propertyToken > 0
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: spanValue<Revit2027EdgeLoopWithChainEnvelopesStatic>(span).loop,
      });
    } else if (
      span.propertySourceClassSlot ===
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT &&
      span.parentReplayIndex != null
    ) {
      const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
      if (faceToken != null) {
        cylindersByFace.set(
          faceToken,
          spanValue<Revit2027CylinderSurface>(span),
        );
      }
    }
  }

  const issues: Revit2027CylinderOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027CylinderOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-cylinder-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = cylindersByFace.get(faceToken);
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    if (face.firstLoop.token <= 0) {
      issues.push({ code: "loop-unresolved", faceToken });
      continue;
    }
    const loopChain: LoopRecord[] = [];
    const seenLoopTokens = new Set<number>();
    let loopToken = face.firstLoop.token;
    let loopFailure = false;
    while (loopToken !== 0) {
      if (loopToken <= 0 || seenLoopTokens.has(loopToken)) {
        issues.push({ code: "loop-cycle", faceToken, loopToken });
        loopFailure = true;
        break;
      }
      const loop = loops.get(loopToken);
      if (!loop) {
        issues.push({ code: "loop-unresolved", faceToken, loopToken });
        loopFailure = true;
        break;
      }
      if (loop.loop.faceReference !== faceToken) {
        issues.push({
          code: "loop-face-mismatch",
          faceToken,
          loopToken,
        });
        loopFailure = true;
        break;
      }
      seenLoopTokens.add(loopToken);
      loopChain.push(loop);
      loopToken = loop.loop.nextLoop.token;
      if (loopChain.length > loops.size) {
        issues.push({ code: "loop-cycle", faceToken, loopToken });
        loopFailure = true;
        break;
      }
    }
    if (loopFailure) continue;

    const directedByLoop: DirectedEdge[][] = [];
    const joinBridgesByLoop: Revit2027CylinderSampledJoinBridge[][] = [];
    for (const loop of loopChain) {
      const directed = directedLoopEdges(
        faceToken,
        loop,
        edges,
        surface,
        tolerance,
      );
      if (directed.ok === false) {
        issues.push(directed.issue);
        loopFailure = true;
        break;
      }
      directedByLoop.push(directed.edges);
      joinBridgesByLoop.push(directed.joinBridges);
    }
    if (loopFailure) continue;
    if (
      loopChain.length > 1 &&
      joinBridgesByLoop.some((bridges) => bridges.length > 0)
    ) {
      const bridge = joinBridgesByLoop
        .flat()
        .at(0);
      issues.push({
        code: "uv-link-unresolved",
        faceToken,
        loopToken: loopChain[0]?.token,
        edgeToken: bridge?.afterEdgeToken,
        detail:
          "native endpoint bridge is not admitted while classifying linked loop roles",
      });
      continue;
    }
    const roles = classifyNativeLoopRoles(
      directedByLoop,
      (face.faceFlags & 0x2) !== 0,
      surface.surface.orientFlag,
      tolerance,
    );
    if (!roles) {
      issues.push({
        code: "multi-loop",
        faceToken,
        loopToken: loopChain[0]?.token,
        detail:
          `${loopChain.length} contours do not prove one native-oriented outer loop with direct holes`,
      });
      continue;
    }
    const outerIndex = roles.indexOf("outer");
    const outerLoop = loopChain[outerIndex]!;
    if (
      !envelopeMatches(
        outerLoop.loop.envelope,
        surface.surface.envelope,
        tolerance,
      )
    ) {
      issues.push({
        code: "loop-envelope-mismatch",
        faceToken,
        loopToken: outerLoop.token,
      });
      continue;
    }

    const edgeUsesByLoop: Revit2027CylinderSampledEdgeUse[][] = [];
    const maximumAngularSteps: number[] = [];
    let outerRectangle:
      | Extract<ReturnType<typeof classifyRectangle>, { ok: true }>
      | null = null;
    for (let loopIndex = 0; loopIndex < loopChain.length; loopIndex += 1) {
      const loop = loopChain[loopIndex]!;
      const directed = directedByLoop[loopIndex]!;
      const rectangle = classifyRectangle(
        directed,
        loop.loop.envelope.minimum,
        loop.loop.envelope.maximum,
        tolerance,
      );
      if (rectangle.ok) {
        if (rectangle.axialSegments !== 1) {
          issues.push({
            code: "multi-segment-axial-policy-not-bound",
            faceToken,
            loopToken: loop.token,
            detail: `axial segments: ${rectangle.axialSegments}`,
          });
          loopFailure = true;
          break;
        }
        const angularSpan = Math.abs(
          loop.loop.envelope.maximum[0] -
          loop.loop.envelope.minimum[0],
        );
        maximumAngularSteps.push(
          angularSpan / rectangle.angularSegments,
        );
        edgeUsesByLoop.push(rectangle.edgeUses);
        if (loopIndex === outerIndex) outerRectangle = rectangle;
        continue;
      }
      if (
        loopChain.length === 1 &&
        joinBridgesByLoop[loopIndex]!.length === 0
      ) {
        const sampled = classifySingleDiagonalSampledTrim(
          directed,
          tolerance,
        );
        if (sampled.ok) {
          maximumAngularSteps.push(
            sampled.maximumAngularSampleStep,
          );
          edgeUsesByLoop.push(sampled.edgeUses);
          continue;
        }
      }
      if (directed.length === 4) {
        issues.push({
          code: rectangle.code,
          faceToken,
          loopToken: loop.token,
          edgeToken: rectangle.edgeToken,
          detail: rectangle.detail,
        });
        loopFailure = true;
        break;
      }
      const orthogonal = classifyOrthogonalSampledTrim(
        directed,
        tolerance,
      );
      if (!orthogonal.ok) {
        issues.push({
          code: orthogonal.code,
          faceToken,
          loopToken: loop.token,
          edgeToken: orthogonal.edgeToken,
          detail: orthogonal.detail,
        });
        loopFailure = true;
        break;
      }
      maximumAngularSteps.push(
        orthogonal.maximumAngularSampleStep,
      );
      edgeUsesByLoop.push(orthogonal.edgeUses);
    }
    if (loopFailure) continue;
    const angularSpan = Math.abs(
      surface.surface.envelope.secondCorner[0] -
      surface.surface.envelope.firstCorner[0],
    );
    if (angularSpan >= Math.PI * 2 - tolerance) {
      issues.push({
        code: "wrapping-chart",
        faceToken,
        loopToken: outerLoop.token,
      });
      continue;
    }
    const maximumAngularStep = Math.min(...maximumAngularSteps);
    const angularSegments = loopChain.length === 1 && outerRectangle
      ? outerRectangle.angularSegments
      : Math.max(
          1,
          Math.ceil(
            angularSpan / maximumAngularStep,
          ),
        );
    const axialSegments = 1;
    const adapted = adaptRevit2027CylinderSampledBrep({
      id: `revit-2027-owner-${replay.ownerElementId}-face-${faceToken}`,
      provenance,
      continuityTolerance: tolerance,
      faces: [{
        faceToken,
        surface,
        loops: loopChain.map((loop, loopIndex) => ({
          loopToken: loop.token,
          role: roles[loopIndex]!,
          edgeUses: edgeUsesByLoop[loopIndex]!,
          joinBridges: joinBridgesByLoop[loopIndex]!,
        })),
        materialId: faceMaterialId(faceToken, face, options, issues),
        provenance,
      }],
    });
    if (adapted.ok === false) {
      issues.push(...adapted.issues.map((issue) => ({
        code: "adapter-rejected" as const,
        faceToken,
        loopToken: issue.loopToken,
        edgeToken: issue.edgeToken,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }

    // The persisted side samples bind the grid used by this certified path.
    // This is not a claim that the native renderer's global LOD was persisted.
    const maximumAngleDegrees =
      maximumAngularStep * (180 / Math.PI) * (1 + 1e-12);
    const tessellated = tessellateNeutralBrep(adapted.brep, {
      distanceTolerance: 1e-10,
      angularTolerance: tolerance,
      nativePolicy: {
        maximumEdgeLength: 0,
        maximumAngleDegrees,
        surfaceDeviation: 0,
      },
    });
    if (tessellated.ok === false) {
      issues.push(...tessellated.issues.map((issue) => ({
        code: (
          issue.code === "wrapping-cylinder-chart"
            ? "wrapping-chart"
            : "tessellator-rejected"
        ) as Revit2027CylinderOwnerMeshIssueCode,
        faceToken,
        loopToken: outerLoop.token,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken: outerLoop.token,
      angularSegments,
      axialSegments,
      bridgedJoinCount: joinBridgesByLoop.reduce(
        (count, bridges) => count + bridges.length,
        0,
      ),
      mesh: tessellated.mesh,
    });
  }

  return {
    ok: true,
    value: {
      ownerElementId: replay.ownerElementId,
      replay,
      faceMeshes,
      issues,
    },
  };
}

/** Complete one browser replay and mesh its certified Cylinder subset. */
export function replayAndMeshRevit2027CylinderSampledOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027CylinderOwnerMeshOptions = {},
): Revit2027CylinderOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (replayed.ok === false) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027CylinderSampledReplay(replayed.value, options);
}
