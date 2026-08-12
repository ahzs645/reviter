import {
  tessellateNeutralBrep,
  type NeutralFaceMesh,
} from "./brep-tessellator.ts";
import type { Revit2027EdgeLoopStatic } from "./revit-2027-edge-loop-static.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import {
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
  type Revit2027OwnerLoopRecord,
} from "./revit-2027-owner-mesh-index.ts";
import { revit2027OwnerFaceMesh } from "./revit-2027-owner-mesh-grid.ts";
import {
  correctedUvRingRoles,
  createUvRingMatcher,
  linkRevit2027DirectedLoopEndpoints,
  revit2027DirectedEdgeUvs,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  revit2027SampledUvRing,
  uvDistance,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027FaceUv,
  type Revit2027LoopJoin,
  type Revit2027TrimBoundary,
} from "./revit-2027-owner-mesh-trim.ts";
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
import { groupRings, triangulate, type Point2 } from "./polygon.ts";

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

/**
 * Admit one native endpoint join that moves along exactly one parameter.
 *
 * The filler repairs a coedge gap whose model-space distance is inside its
 * own endpoint tolerance. An angular step past half a turn is an ambiguous
 * wrap and is never bridged.
 */
function nativeOrthogonalJoinBridge(
  join: Revit2027LoopJoin,
  surface: Revit2027CylinderSurface,
  tolerance: number,
): Revit2027CylinderSampledJoinBridge | null {
  const start = join.currentUv;
  const end = join.nextUv;
  const changesAngle = Math.abs(start[0] - end[0]) > tolerance;
  const changesAxial = Math.abs(start[1] - end[1]) > tolerance;
  if (
    changesAngle === changesAxial ||
    (changesAngle && Math.abs(start[0] - end[0]) > Math.PI + tolerance)
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
    afterEdgeToken: join.current.token,
    start,
    end,
  };
}

function envelopeMatches(
  loop: Revit2027EdgeLoopStatic["envelope"],
  surface: Revit2027CylinderSurface["surface"]["envelope"],
  tolerance: number,
): boolean {
  return (
    uvDistance(loop.minimum, surface.firstCorner) <= tolerance &&
    uvDistance(loop.maximum, surface.secondCorner) <= tolerance
  );
}

function edgeUsesOf(
  edges: readonly Revit2027DirectedEdge[],
): Revit2027CylinderSampledEdgeUse[] {
  return edges.map((edge) => ({
    edgeToken: edge.token,
    edge: edge.edge,
    faceSide: edge.side,
    direction: edge.direction,
  }));
}

function classifyRectangle(
  edges: readonly Revit2027DirectedEdge[],
  minimum: Revit2027FaceUv,
  maximum: Revit2027FaceUv,
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
  const sideCounts = new Map<Revit2027TrimBoundary, number>();
  for (const edge of edges) {
    const points = revit2027DirectedEdgeUvs(edge);
    const allNear = (axis: 0 | 1, value: number): boolean =>
      points.every((point) => Math.abs(point[axis] - value) <= tolerance);
    const boundary: Revit2027TrimBoundary | null =
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
    edgeUses: edgeUsesOf(edges),
  };
}

function classifyOrthogonalSampledTrim(
  edges: readonly Revit2027DirectedEdge[],
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
    const points = revit2027DirectedEdgeUvs(edge);
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
    edgeUses: edgeUsesOf(edges),
  };
}

function classifySingleDiagonalSampledTrim(
  edges: readonly Revit2027DirectedEdge[],
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
  if (edges.length < 4) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: `edge count: ${edges.length}`,
    };
  }
  let diagonalEdgeCount = 0;
  let maximumAngularSampleStep = 0;
  for (const edge of edges) {
    const points = revit2027DirectedEdgeUvs(edge);
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
  if (diagonalEdgeCount < 1 || maximumAngularSampleStep <= tolerance) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail:
        `${diagonalEdgeCount} sampled diagonal edges; expected at least one`,
    };
  }
  return {
    ok: true,
    maximumAngularSampleStep,
    edgeUses: edgeUsesOf(edges),
  };
}

function directSampledCylinderMesh(
  ownerElementId: bigint,
  faceToken: number,
  ring: readonly Point2[],
  surface: Revit2027CylinderSurface,
  materialId: string | number | null,
): NeutralFaceMesh | null {
  const triangleIndexes = triangulate(ring);
  if (triangleIndexes.length === 0) return null;
  const positions = new Float64Array(ring.length * 3);
  const normals = new Float32Array(ring.length * 3);
  const cross3 = (
    left: readonly [number, number, number],
    right: readonly [number, number, number],
  ): [number, number, number] => [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const dot3 = (
    left: readonly [number, number, number],
    right: readonly [number, number, number],
  ): number =>
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  for (let index = 0; index < ring.length; index += 1) {
    const uv = ring[index]!;
    const evaluated = evaluateRevit2027AnalyticSurfacePoint(surface, uv);
    if (!evaluated.ok) return null;
    positions.set(evaluated.point, index * 3);
    const du = [
      surface.radius *
        (-Math.sin(uv[0]) * surface.xVector[0] +
          Math.cos(uv[0]) * surface.yVector[0]),
      surface.radius *
        (-Math.sin(uv[0]) * surface.xVector[1] +
          Math.cos(uv[0]) * surface.yVector[1]),
      surface.radius *
        (-Math.sin(uv[0]) * surface.xVector[2] +
          Math.cos(uv[0]) * surface.yVector[2]),
    ] as const;
    let normal: [number, number, number] = cross3(du, surface.zVector);
    const length = Math.hypot(...normal);
    if (!Number.isFinite(length) || length <= Number.EPSILON) return null;
    normal = [
      normal[0] / length,
      normal[1] / length,
      normal[2] / length,
    ];
    if (!surface.surface.orientFlag) {
      normal = [-normal[0], -normal[1], -normal[2]];
    }
    normals.set(normal, index * 3);
  }
  const indices = Uint32Array.from(triangleIndexes);
  const a = indices[0]!;
  const b = indices[1]!;
  const c = indices[2]!;
  const point = (index: number): [number, number, number] => [
    positions[index * 3]!,
    positions[index * 3 + 1]!,
    positions[index * 3 + 2]!,
  ];
  const subtract3 = (
    left: readonly [number, number, number],
    right: readonly [number, number, number],
  ): [number, number, number] => [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
  const triangleNormal = cross3(
    subtract3(point(b), point(a)),
    subtract3(point(c), point(a)),
  );
  const expectedNormal = [
    normals[a * 3]!,
    normals[a * 3 + 1]!,
    normals[a * 3 + 2]!,
  ] as const;
  if (dot3(triangleNormal, expectedNormal) < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1]!;
      indices[index + 1] = indices[index + 2]!;
      indices[index + 2] = swap;
    }
  }
  return revit2027OwnerFaceMesh({
    ownerElementId,
    faceToken,
    decoderId: "revit-2027-cylinder-owner-mesh",
    brepSuffix: "sampled-cylinder",
    materialId,
    positions,
    normals,
    indices,
  });
}

function classifyNativeLoopRoles(
  directedByLoop: readonly (readonly Revit2027DirectedEdge[])[],
  normalFlipped: boolean,
  surfaceOrientFlag: boolean,
  tolerance: number,
): readonly ("outer" | "hole")[] | null {
  if (directedByLoop.length === 1) return ["outer"];
  const rings: Point2[][] = [];
  for (const directed of directedByLoop) {
    const ring = revit2027SampledUvRing(
      directed.map(revit2027DirectedEdgeUvs),
      tolerance,
    );
    if (!ring) return null;
    rings.push(ring);
  }

  // TB_Geometry's OdBmEdgeLoopImpl::isCCW corrects directed UV winding when
  // the persisted Face normal-flip bit equals Surface.orientFlag. Its
  // containment result must independently agree before roles are admitted.
  const roles = correctedUvRingRoles(
    rings,
    normalFlipped,
    surfaceOrientFlag,
    tolerance,
  );
  if (!roles) return null;
  const groups = groupRings(rings);
  if (
    groups.length !== 1 ||
    groups[0]!.holes.length !== rings.length - 1
  ) {
    return null;
  }
  const matcher = createUvRingMatcher(rings);
  const outerIndex = matcher.match(groups[0]!.outer);
  if (outerIndex == null || roles[outerIndex] !== "outer") return null;
  for (const hole of groups[0]!.holes) {
    const holeIndex = matcher.match(hole);
    if (holeIndex == null || roles[holeIndex] !== "hole") return null;
  }
  return matcher.used.size === rings.length ? roles : null;
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
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027CylinderOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027CylinderOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-cylinder-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of index.faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = revit2027OwnerSurface<Revit2027CylinderSurface>(
      index,
      REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
      faceToken,
    );
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    if (face.firstLoop.token <= 0) {
      issues.push({ code: "loop-unresolved", faceToken });
      continue;
    }
    const loopChain: Revit2027OwnerLoopRecord[] = [];
    const seenLoopTokens = new Set<number>();
    let loopToken = face.firstLoop.token;
    let loopFailure = false;
    while (loopToken !== 0) {
      if (loopToken <= 0 || seenLoopTokens.has(loopToken)) {
        issues.push({ code: "loop-cycle", faceToken, loopToken });
        loopFailure = true;
        break;
      }
      const loop = index.loops.get(loopToken);
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
      if (loopChain.length > index.loops.size) {
        issues.push({ code: "loop-cycle", faceToken, loopToken });
        loopFailure = true;
        break;
      }
    }
    if (loopFailure) continue;

    const directedByLoop: Revit2027DirectedEdge[][] = [];
    const joinBridgesByLoop: Revit2027CylinderSampledJoinBridge[][] = [];
    for (const loop of loopChain) {
      const directed = walkRevit2027DirectedLoopEdges({
        faceToken,
        loop,
        edges: index.edges,
        loopArity: "open",
      });
      if (directed.ok === false) {
        issues.push(directed.issue);
        loopFailure = true;
        break;
      }
      const linked = linkRevit2027DirectedLoopEndpoints(
        directed.edges,
        tolerance,
        {
          continuous: (current, next) => uvDistance(current, next) <= tolerance,
          repairJoin: (join) =>
            nativeOrthogonalJoinBridge(join, surface, tolerance),
        },
      );
      if (linked.ok === false) {
        issues.push({
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: linked.join.current.token,
          detail: `native directed join distance: ${
            uvDistance(linked.join.currentUv, linked.join.nextUv)
          }`,
        });
        loopFailure = true;
        break;
      }
      directedByLoop.push(directed.edges);
      joinBridgesByLoop.push(linked.repairs);
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
    let directSampledContour = false;
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
          directSampledContour = true;
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
    const materialId = revit2027OwnerFaceMaterialId(
      faceToken,
      face,
      options,
      (detail) => issues.push({ code: "material-unresolved", faceToken, detail }),
    );
    if (loopChain.length === 1 && directSampledContour) {
      const ring = revit2027SampledUvRing(
        directedByLoop[0]!.map(revit2027DirectedEdgeUvs),
        tolerance,
      );
      const mesh = ring
        ? directSampledCylinderMesh(
            replay.ownerElementId,
            faceToken,
            ring,
            surface,
            materialId,
          )
        : null;
      if (!mesh) {
        issues.push({
          code: "tessellator-rejected",
          faceToken,
          loopToken: outerLoop.token,
          detail: "sampled cylinder contour could not be triangulated",
        });
        continue;
      }
      faceMeshes.push({
        faceToken,
        loopToken: outerLoop.token,
        angularSegments,
        axialSegments,
        bridgedJoinCount: 0,
        mesh,
      });
      continue;
    }
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
        materialId,
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
