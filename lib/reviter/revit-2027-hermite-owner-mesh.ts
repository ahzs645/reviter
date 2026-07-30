import type {
  BrepProvenance,
  NeutralFaceMesh,
  NeutralMeshFaceGroup,
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
import {
  REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027HermiteSurface,
  type Revit2027SplineSurfaceNode,
} from "./revit-2027-hermite-surface.ts";
import {
  type Revit2027GRepReplay,
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  mergeRevit2027OppositeBoundarySamples,
} from "./revit-2027-ruled-helix-owner-mesh.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];
type Boundary = "u-min" | "u-max" | "v-min" | "v-max";
type LoopRecord = { token: number; loop: Revit2027EdgeLoopStatic };
type DirectedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
  direction: 1 | -1;
};

export type Revit2027HermiteOwnerMeshIssue = {
  code:
    | "surface-unresolved"
    | "invalid-surface-grid"
    | "loop-unresolved"
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
    | "material-unresolved"
    | "tessellator-rejected";
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027HermiteOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  uSegments: number;
  vSegments: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027HermiteOwnerMeshOptions = {
  uvTolerance?: number;
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
};

export type Revit2027HermiteSurfaceEvaluation = {
  point: Point3;
  tangentU: Point3;
  tangentV: Point3;
};

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function same2(left: Point2, right: Point2, tolerance: number): boolean {
  return near(left[0], right[0], tolerance) &&
    near(left[1], right[1], tolerance);
}

function scale(point: Point3, scalar: number): Point3 {
  return [point[0] * scalar, point[1] * scalar, point[2] * scalar];
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(point: Point3): Point3 | null {
  const length = Math.hypot(...point);
  return Number.isFinite(length) && length > Number.EPSILON
    ? scale(point, 1 / length)
    : null;
}

function intervalFor(
  parameters: readonly number[],
  value: number,
): number | null {
  if (
    parameters.length < 2 ||
    parameters.some((parameter, index) =>
      !Number.isFinite(parameter) ||
      (index > 0 && parameter <= parameters[index - 1]!)
    )
  ) {
    return null;
  }
  if (value <= parameters[0]!) return 0;
  if (value >= parameters.at(-1)!) return parameters.length - 2;
  let low = 0;
  let high = parameters.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (parameters[middle]! <= value) low = middle;
    else high = middle;
  }
  return low;
}

function hermiteBasis(value: number): {
  position: readonly [number, number];
  derivative: readonly [number, number];
  positionSlope: readonly [number, number];
  derivativeSlope: readonly [number, number];
} {
  const squared = value * value;
  const cubed = squared * value;
  return {
    position: [
      2 * cubed - 3 * squared + 1,
      -2 * cubed + 3 * squared,
    ],
    derivative: [
      cubed - 2 * squared + value,
      cubed - squared,
    ],
    positionSlope: [
      6 * squared - 6 * value,
      -6 * squared + 6 * value,
    ],
    derivativeSlope: [
      3 * squared - 4 * value + 1,
      3 * squared - 2 * value,
    ],
  };
}

/**
 * Evaluate the exact tensor-product bicubic patch persisted by HermiteSurf.
 *
 * Revit stores U fastest inside each V row. Tangents are derivatives in the
 * native parameter domains, so the Hermite derivative terms are scaled by
 * the selected knot spans before applying the unit-interval basis.
 */
export function evaluateRevit2027HermiteSurface(
  surface: Revit2027HermiteSurface,
  u: number,
  v: number,
): Revit2027HermiteSurfaceEvaluation | null {
  if (
    !surface.constructedOk ||
    surface.periodic[0] ||
    surface.periodic[1] ||
    !Number.isFinite(u) ||
    !Number.isFinite(v)
  ) {
    return null;
  }
  const ui = intervalFor(surface.uParameters, u);
  const vi = intervalFor(surface.vParameters, v);
  const uCount = surface.uParameters.length;
  const vCount = surface.vParameters.length;
  if (
    ui == null ||
    vi == null ||
    surface.nodes.length !== uCount * vCount
  ) {
    return null;
  }
  const u0 = surface.uParameters[ui]!;
  const u1 = surface.uParameters[ui + 1]!;
  const v0 = surface.vParameters[vi]!;
  const v1 = surface.vParameters[vi + 1]!;
  const du = u1 - u0;
  const dv = v1 - v0;
  const ub = hermiteBasis((u - u0) / du);
  const vb = hermiteBasis((v - v0) / dv);
  const point = [0, 0, 0] as [number, number, number];
  const tangentU = [0, 0, 0] as [number, number, number];
  const tangentV = [0, 0, 0] as [number, number, number];
  const nodeAt = (uSide: 0 | 1, vSide: 0 | 1):
    Revit2027SplineSurfaceNode =>
      surface.nodes[(vi + vSide) * uCount + ui + uSide]!;
  for (const uSide of [0, 1] as const) {
    for (const vSide of [0, 1] as const) {
      const node = nodeAt(uSide, vSide);
      for (let axis = 0; axis < 3; axis += 1) {
        const p = node.point[axis]!;
        const tu = node.tangents[0][axis]! * du;
        const tv = node.tangents[1][axis]! * dv;
        const mixed = node.mixedDerivative[axis]! * du * dv;
        point[axis] +=
          p * ub.position[uSide] * vb.position[vSide] +
          tu * ub.derivative[uSide] * vb.position[vSide] +
          tv * ub.position[uSide] * vb.derivative[vSide] +
          mixed * ub.derivative[uSide] * vb.derivative[vSide];
        tangentU[axis] +=
          (
            p * ub.positionSlope[uSide] * vb.position[vSide] +
            tu * ub.derivativeSlope[uSide] * vb.position[vSide] +
            tv * ub.positionSlope[uSide] * vb.derivative[vSide] +
            mixed * ub.derivativeSlope[uSide] * vb.derivative[vSide]
          ) / du;
        tangentV[axis] +=
          (
            p * ub.position[uSide] * vb.positionSlope[vSide] +
            tu * ub.derivative[uSide] * vb.positionSlope[vSide] +
            tv * ub.position[uSide] * vb.derivativeSlope[vSide] +
            mixed * ub.derivative[uSide] * vb.derivativeSlope[vSide]
          ) / dv;
      }
    }
  }
  return { point, tangentU, tangentV };
}

function faceUv(point: Revit2027EdgePoint, side: 0 | 1): Point2 {
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

function directedUvs(edge: DirectedEdge): Point2[] {
  const points = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) => faceUv(point, edge.side)),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edges: DirectedEdge[] }
  | { ok: false; issue: Revit2027HermiteOwnerMeshIssue } {
  const ordered: DirectedEdge[] = [];
  const visited = new Set<number>();
  let edgeToken = loop.loop.nextEdgeReference;
  while (edgeToken !== loop.token) {
    if (edgeToken <= 0 || visited.has(edgeToken)) {
      return {
        ok: false,
        issue: { code: "edge-cycle", faceToken, loopToken: loop.token, edgeToken },
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
        issue: { code: "edge-cycle", faceToken, loopToken: loop.token },
      };
    }
  }
  if (
    ordered.length !== 4 ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    (ordered[0] &&
      revit2027GEdgeLoopPreviousReference(ordered[0].edge, ordered[0].side) !==
        loop.token)
  ) {
    return {
      ok: false,
      issue: {
        code: ordered.length === 4
          ? "edge-link-mismatch"
          : "non-rectangular-trim",
        faceToken,
        loopToken: loop.token,
        detail: `edge count: ${ordered.length}`,
      },
    };
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
    const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
    if (
      !same2(
        faceUv(current.edge.firstAndLastEdgePoints[currentEnd], current.side),
        faceUv(next.edge.firstAndLastEdgePoints[nextStart], next.side),
        tolerance,
      )
    ) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: current.token,
        },
      };
    }
  }
  return { ok: true, edges: ordered };
}

function monotonicSpan(
  values: readonly number[],
  minimum: number,
  maximum: number,
  tolerance: number,
): boolean {
  if (values.length < 2) return false;
  const forward = values.at(-1)! >= values[0]!;
  for (let index = 1; index < values.length; index += 1) {
    if (
      forward
        ? values[index]! < values[index - 1]! - tolerance
        : values[index]! > values[index - 1]! + tolerance
    ) {
      return false;
    }
  }
  return near(Math.min(...values), minimum, tolerance) &&
    near(Math.max(...values), maximum, tolerance);
}

function classifyBoundaries(
  edges: readonly DirectedEdge[],
  minimum: Point2,
  maximum: Point2,
  tolerance: number,
): Map<Boundary, readonly Point2[]> | null {
  const output = new Map<Boundary, readonly Point2[]>();
  const transverse: Point2[][] = [];
  for (const edge of edges) {
    const points = directedUvs(edge);
    const us = points.map((point) => point[0]);
    const vs = points.map((point) => point[1]);
    if (points.every((point) => near(point[0], minimum[0], tolerance))) {
      if (output.has("u-min")) return null;
      output.set("u-min", points);
    } else if (
      points.every((point) => near(point[0], maximum[0], tolerance))
    ) {
      if (output.has("u-max")) return null;
      output.set("u-max", points);
    } else if (
      monotonicSpan(us, minimum[0], maximum[0], tolerance) &&
      vs.every(
        (value) =>
          value >= minimum[1] - tolerance &&
          value <= maximum[1] + tolerance,
      )
    ) {
      transverse.push(points);
    } else {
      return null;
    }
  }
  if (
    !output.has("u-min") ||
    !output.has("u-max") ||
    transverse.length !== 2
  ) {
    return null;
  }
  const ranked = [...transverse].sort(
    (left, right) =>
      left.reduce((sum, point) => sum + point[1], 0) / left.length -
      right.reduce((sum, point) => sum + point[1], 0) / right.length,
  );
  if (
    !ranked[0]!.some((point) => near(point[1], minimum[1], tolerance)) ||
    !ranked[1]!.some((point) => near(point[1], maximum[1], tolerance))
  ) {
    return null;
  }
  output.set("v-min", ranked[0]!);
  output.set("v-max", ranked[1]!);
  return output;
}

function normalizedFractions(points: readonly Point2[]): number[] | null {
  const values = points.map((point) => point[1]).sort((a, b) => a - b);
  const minimum = values[0];
  const maximum = values.at(-1);
  if (
    minimum == null ||
    maximum == null ||
    maximum - minimum <= Number.EPSILON
  ) {
    return null;
  }
  return values.map((value) => (value - minimum) / (maximum - minimum));
}

function transverseVAtU(
  points: readonly Point2[],
  u: number,
): number | null {
  const ordered = [...points].sort((left, right) => left[0] - right[0]);
  if (ordered.length < 2) return null;
  if (u <= ordered[0]![0]) return ordered[0]![1];
  if (u >= ordered.at(-1)![0]) return ordered.at(-1)![1];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const first = ordered[index]!;
    const second = ordered[index + 1]!;
    if (u > second[0]) continue;
    const span = second[0] - first[0];
    if (span <= Number.EPSILON) return null;
    const fraction = (u - first[0]) / span;
    return first[1] + (second[1] - first[1]) * fraction;
  }
  return null;
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027HermiteOwnerMeshOptions,
  issues: Revit2027HermiteOwnerMeshIssue[],
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

function tessellate(
  ownerElementId: bigint,
  faceToken: number,
  surface: Revit2027HermiteSurface,
  uParameters: readonly number[],
  vFractions: readonly number[],
  bottomBoundary: readonly Point2[],
  topBoundary: readonly Point2[],
  materialId: string | number | null,
): NeutralFaceMesh | null {
  const uSegments = uParameters.length - 1;
  const vSegments = vFractions.length - 1;
  if (uSegments < 1 || vSegments < 1) return null;
  const uCount = uSegments + 1;
  const vCount = vSegments + 1;
  const positions = new Float64Array(uCount * vCount * 3);
  const normals = new Float32Array(uCount * vCount * 3);
  for (let ui = 0; ui < uCount; ui += 1) {
    const u = uParameters[ui]!;
    const bottomV = transverseVAtU(bottomBoundary, u);
    const topV = transverseVAtU(topBoundary, u);
    if (bottomV == null || topV == null || topV <= bottomV) return null;
    for (let vi = 0; vi < vCount; vi += 1) {
      const v = bottomV + (topV - bottomV) * vFractions[vi]!;
      const evaluated = evaluateRevit2027HermiteSurface(
        surface,
        u,
        v,
      );
      if (!evaluated) return null;
      let normal = normalized(cross(evaluated.tangentU, evaluated.tangentV));
      if (!normal) return null;
      if (!surface.orientFlag) normal = scale(normal, -1);
      const vertex = ui * vCount + vi;
      positions.set(evaluated.point, vertex * 3);
      normals.set(normal, vertex * 3);
    }
  }
  const indices = new Uint32Array(uSegments * vSegments * 6);
  let cursor = 0;
  for (let ui = 0; ui < uSegments; ui += 1) {
    for (let vi = 0; vi < vSegments; vi += 1) {
      const a = ui * vCount + vi;
      const b = (ui + 1) * vCount + vi;
      const c = b + 1;
      const d = a + 1;
      indices.set(
        surface.orientFlag
          ? [a, b, d, b, c, d]
          : [a, d, b, b, d, c],
        cursor,
      );
      cursor += 6;
    }
  }
  const elementId = Number(ownerElementId);
  const provenance: BrepProvenance = {
    decoderId: "revit-2027-hermite-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  const faceId = `revit-2027-owner-${ownerElementId}-face-${faceToken}`;
  const group: NeutralMeshFaceGroup = {
    faceId,
    indexOffset: 0,
    indexCount: indices.length,
    vertexOffset: 0,
    vertexCount: positions.length / 3,
    materialId,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  return {
    brepId: `revit-2027-owner-${ownerElementId}-hermite`,
    positions,
    normals,
    indices,
    groups: [group],
  };
}

/**
 * Tessellate only complete, non-periodic HermiteSurf faces with one exact
 * four-edge rectangular UV trim. Persisted edge samples choose the display
 * grid; the bicubic surface itself comes directly from the native node data.
 */
export function meshRevit2027HermiteReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027HermiteOwnerMeshOptions = {},
): {
  ok: true;
  value: {
    ownerElementId: bigint;
    replay: Revit2027GRepReplay;
    faceMeshes: readonly Revit2027HermiteOwnerFaceMesh[];
    issues: readonly Revit2027HermiteOwnerMeshIssue[];
  };
} | { ok: false; error: string } {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }
  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
  const surfaces = new Map<number, Revit2027HermiteSurface>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
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
        REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT &&
      span.parentReplayIndex != null
    ) {
      const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
      if (faceToken != null) {
        surfaces.set(faceToken, spanValue<Revit2027HermiteSurface>(span));
      }
    }
  }

  const issues: Revit2027HermiteOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027HermiteOwnerFaceMesh[] = [];
  for (const [faceToken, face] of faces) {
    if (
      face.surface.sourceClassSlot !==
        REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = surfaces.get(faceToken);
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    if (
      !surface.constructedOk ||
      surface.periodic[0] ||
      surface.periodic[1] ||
      surface.nodes.length !==
        surface.uParameters.length * surface.vParameters.length
    ) {
      issues.push({ code: "invalid-surface-grid", faceToken });
      continue;
    }
    const loopToken = face.firstLoop.token;
    const loop = loops.get(loopToken);
    if (loopToken <= 0 || !loop) {
      issues.push({ code: "loop-unresolved", faceToken, loopToken });
      continue;
    }
    if (loop.loop.nextLoop.token !== 0) {
      issues.push({ code: "multi-loop", faceToken, loopToken });
      continue;
    }
    if (loop.loop.faceReference !== faceToken) {
      issues.push({ code: "loop-face-mismatch", faceToken, loopToken });
      continue;
    }
    if (
      !same2(
        loop.loop.envelope.minimum,
        surface.envelope.firstCorner,
        tolerance,
      ) ||
      !same2(
        loop.loop.envelope.maximum,
        surface.envelope.secondCorner,
        tolerance,
      )
    ) {
      issues.push({ code: "loop-envelope-mismatch", faceToken, loopToken });
      continue;
    }
    const directed = directedLoopEdges(faceToken, loop, edges, tolerance);
    if (!directed.ok) {
      issues.push(directed.issue);
      continue;
    }
    const samples = classifyBoundaries(
      directed.edges,
      surface.envelope.firstCorner,
      surface.envelope.secondCorner,
      tolerance,
    );
    if (!samples) {
      issues.push({
        code: "non-rectangular-trim",
        faceToken,
        loopToken,
      });
      continue;
    }
    const [minimum, maximum] = [
      surface.envelope.firstCorner,
      surface.envelope.secondCorner,
    ];
    const uParameters = mergeRevit2027OppositeBoundarySamples(
      samples.get("v-min")!.map((point) => point[0]),
      samples.get("v-max")!.map((point) => point[0]),
      minimum[0],
      maximum[0],
      tolerance,
    );
    const firstFractions = normalizedFractions(samples.get("u-min")!);
    const secondFractions = normalizedFractions(samples.get("u-max")!);
    const vFractions = firstFractions && secondFractions
      ? mergeRevit2027OppositeBoundarySamples(
          firstFractions,
          secondFractions,
          0,
          1,
          tolerance,
        )
      : null;
    if (!uParameters || !vFractions) {
      issues.push({
        code: "opposite-sampling-mismatch",
        faceToken,
        loopToken,
      });
      continue;
    }
    const mesh = tessellate(
      replay.ownerElementId,
      faceToken,
      surface,
      uParameters,
      vFractions,
      samples.get("v-min")!,
      samples.get("v-max")!,
      faceMaterialId(faceToken, face, options, issues),
    );
    if (!mesh) {
      issues.push({
        code: "tessellator-rejected",
        faceToken,
        loopToken,
      });
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken,
      uSegments: uParameters.length - 1,
      vSegments: vFractions.length - 1,
      mesh,
    });
  }
  return {
    ok: true,
    value: { ownerElementId: replay.ownerElementId, replay, faceMeshes, issues },
  };
}
