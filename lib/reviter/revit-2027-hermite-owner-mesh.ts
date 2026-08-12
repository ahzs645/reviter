import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import {
  REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027HermiteSurface,
  type Revit2027SplineSurfaceNode,
} from "./revit-2027-hermite-surface.ts";
import { type Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  revit2027TensorGridFaceMesh,
  type Revit2027SurfaceSample,
} from "./revit-2027-owner-mesh-grid.ts";
import {
  linkRevit2027DirectedLoopEndpoints,
  monotonicSpan,
  nearlyEqual,
  revit2027DirectedEdgeUvs,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  sameUv,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027FaceUv,
  type Revit2027TrimBoundary,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  mergeRevit2027OppositeBoundarySamples,
} from "./revit-2027-ruled-helix-owner-mesh.ts";

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

export type Revit2027HermiteSurfaceEvaluation = Revit2027SurfaceSample;

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

/**
 * Sort one four-edge HermiteSurf trim into its two constant-u boundaries and
 * the two transverse boundaries that carry the v extent.
 *
 * The transverse pair is not required to hold v constant: Revit persists a
 * sloped trim on a warped patch, so they are ranked by mean v and each must
 * still reach the envelope corner it claims.
 */
function classifyBoundaries(
  edges: readonly Revit2027DirectedEdge[],
  minimum: Revit2027FaceUv,
  maximum: Revit2027FaceUv,
  tolerance: number,
): Map<Revit2027TrimBoundary, readonly Revit2027FaceUv[]> | null {
  const output = new Map<Revit2027TrimBoundary, readonly Revit2027FaceUv[]>();
  const transverse: Revit2027FaceUv[][] = [];
  for (const edge of edges) {
    const points = revit2027DirectedEdgeUvs(edge);
    const us = points.map((point) => point[0]);
    const vs = points.map((point) => point[1]);
    if (points.every((point) => nearlyEqual(point[0], minimum[0], tolerance))) {
      if (output.has("u-min")) return null;
      output.set("u-min", points);
    } else if (
      points.every((point) => nearlyEqual(point[0], maximum[0], tolerance))
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
    !ranked[0]!.some((point) => nearlyEqual(point[1], minimum[1], tolerance)) ||
    !ranked[1]!.some((point) => nearlyEqual(point[1], maximum[1], tolerance))
  ) {
    return null;
  }
  output.set("v-min", ranked[0]!);
  output.set("v-max", ranked[1]!);
  return output;
}

function normalizedFractions(
  points: readonly Revit2027FaceUv[],
): number[] | null {
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

/** Interpolate a transverse boundary's v at one grid u. */
function transverseVAtU(
  points: readonly Revit2027FaceUv[],
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
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027HermiteOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027HermiteOwnerFaceMesh[] = [];
  for (const [faceToken, face] of index.faces) {
    if (
      face.surface.sourceClassSlot !==
        REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = revit2027OwnerSurface<Revit2027HermiteSurface>(
      index,
      REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
      faceToken,
    );
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
    const loop = index.loops.get(loopToken);
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
      !sameUv(
        loop.loop.envelope.minimum,
        surface.envelope.firstCorner,
        tolerance,
      ) ||
      !sameUv(
        loop.loop.envelope.maximum,
        surface.envelope.secondCorner,
        tolerance,
      )
    ) {
      issues.push({ code: "loop-envelope-mismatch", faceToken, loopToken });
      continue;
    }
    const directed = walkRevit2027DirectedLoopEdges({
      faceToken,
      loop,
      edges: index.edges,
      loopArity: "rectangular-4",
    });
    if (!directed.ok) {
      issues.push(directed.issue);
      continue;
    }
    const linked = linkRevit2027DirectedLoopEndpoints(
      directed.edges,
      tolerance,
      { continuous: sameUv },
    );
    if (!linked.ok) {
      issues.push({
        code: "uv-link-unresolved",
        faceToken,
        loopToken,
        edgeToken: linked.join.current.token,
      });
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
    const bottomBoundary = samples.get("v-min")!;
    const topBoundary = samples.get("v-max")!;
    const materialId = revit2027OwnerFaceMaterialId(
      faceToken,
      face,
      options,
      (detail) => issues.push({ code: "material-unresolved", faceToken, detail }),
    );
    const mesh = revit2027TensorGridFaceMesh({
      ownerElementId: replay.ownerElementId,
      faceToken,
      decoderId: "revit-2027-hermite-owner-mesh",
      brepSuffix: "hermite",
      materialId,
      orientFlag: surface.orientFlag,
      uSegments: uParameters.length - 1,
      vSegments: vFractions.length - 1,
      row: (uIndex) => {
        const u = uParameters[uIndex]!;
        // The trim's own transverse boundaries carry the v extent at this u,
        // so the grid follows a sloped trim instead of a fixed v rectangle.
        const bottomV = transverseVAtU(bottomBoundary, u);
        const topV = transverseVAtU(topBoundary, u);
        if (bottomV == null || topV == null || topV <= bottomV) return null;
        return (vIndex) =>
          evaluateRevit2027HermiteSurface(
            surface,
            u,
            bottomV + (topV - bottomV) * vFractions[vIndex]!,
          );
      },
    });
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
