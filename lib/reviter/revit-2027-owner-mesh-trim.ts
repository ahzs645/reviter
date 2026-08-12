import {
  revit2027GEdgeLoopDirection,
  revit2027GEdgeLoopNextReference,
  revit2027GEdgeLoopPreviousReference,
  type Revit2027EdgePoint,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import {
  bindRevit2027FaceMaterial,
  type Revit2027MaterialDefinitions,
} from "./revit-2027-face-material.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027OwnerLoopRecord } from "./revit-2027-owner-mesh-index.ts";
import type { Point2 } from "./polygon.ts";

/** Every certified owner path admits an exact UV match by default. */
export const REVIT_2027_DEFAULT_UV_TOLERANCE = 1e-9;

/** One persisted face-local UV sample. */
export type Revit2027FaceUv = readonly [number, number];

export type Revit2027DirectedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
  direction: 1 | -1;
};

export type Revit2027TrimBoundary = "u-min" | "u-max" | "v-min" | "v-max";

export function nearlyEqual(
  left: number,
  right: number,
  tolerance: number,
): boolean {
  return Math.abs(left - right) <= tolerance;
}

/** Component-wise UV equality, as the rectangular trim paths compare. */
export function sameUv(
  left: Revit2027FaceUv,
  right: Revit2027FaceUv,
  tolerance: number,
): boolean {
  return nearlyEqual(left[0], right[0], tolerance) &&
    nearlyEqual(left[1], right[1], tolerance);
}

/** Planar UV distance, as the sampled trim paths compare. */
export function uvDistance(
  left: Revit2027FaceUv,
  right: Revit2027FaceUv,
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

export function revit2027FaceUv(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): Revit2027FaceUv {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

/** The side of one GEdge that faces this Face, or null when it is not exact. */
export function revit2027EdgeSide(
  edge: Revit2027GEdgeStatic,
  faceToken: number,
): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  return first === second ? null : first ? 0 : 1;
}

/** Persisted p-curve samples of one edge use, ordered along the loop. */
export function revit2027DirectedEdgeUvs(
  edge: Revit2027DirectedEdge,
): Revit2027FaceUv[] {
  const points = [
    revit2027FaceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) =>
      revit2027FaceUv(point, edge.side)
    ),
    revit2027FaceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

export type Revit2027LoopWalkFailureCode =
  | "edge-cycle"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-link-mismatch";

export type Revit2027RectangularLoopWalkFailureCode =
  | Revit2027LoopWalkFailureCode
  | "non-rectangular-trim";

export type Revit2027LoopWalkIssue<Code extends string> = {
  code: Code;
  faceToken: number;
  loopToken: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027LoopWalkResult<Code extends string> =
  | { ok: true; edges: Revit2027DirectedEdge[] }
  | { ok: false; issue: Revit2027LoopWalkIssue<Code> };

export type Revit2027LoopWalkRequest = {
  faceToken: number;
  loop: Revit2027OwnerLoopRecord;
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>;
  /**
   * `rectangular-4` admits only the exact four-edge trim the tensor-product
   * paths require and reports a short count as `non-rectangular-trim`.
   * `open` admits any closed chain of two or more edge uses.
   */
  loopArity: "rectangular-4" | "open";
};

export function walkRevit2027DirectedLoopEdges(
  request: Revit2027LoopWalkRequest & { loopArity: "open" },
): Revit2027LoopWalkResult<Revit2027LoopWalkFailureCode>;
export function walkRevit2027DirectedLoopEdges(
  request: Revit2027LoopWalkRequest & { loopArity: "rectangular-4" },
): Revit2027LoopWalkResult<Revit2027RectangularLoopWalkFailureCode>;
/**
 * Order one persisted EdgeLoop into directed edge uses.
 *
 * The walk follows each GEdge's face-side next reference back to the loop
 * token, so a chain that leaves the loop, repeats an edge, names an edge this
 * Face does not bound, or fails to close against the loop's own previous
 * reference is rejected before any geometry is read.
 */
export function walkRevit2027DirectedLoopEdges(
  request: Revit2027LoopWalkRequest,
): Revit2027LoopWalkResult<Revit2027RectangularLoopWalkFailureCode> {
  const { faceToken, loop, edges, loopArity } = request;
  const loopToken = loop.token;
  const ordered: Revit2027DirectedEdge[] = [];
  const visited = new Set<number>();
  let edgeToken = loop.loop.nextEdgeReference;
  while (edgeToken !== loopToken) {
    if (edgeToken <= 0 || visited.has(edgeToken)) {
      return {
        ok: false,
        issue: { code: "edge-cycle", faceToken, loopToken, edgeToken },
      };
    }
    const edge = edges.get(edgeToken);
    if (!edge) {
      return {
        ok: false,
        issue: { code: "edge-unresolved", faceToken, loopToken, edgeToken },
      };
    }
    const side = revit2027EdgeSide(edge, faceToken);
    if (side == null) {
      return {
        ok: false,
        issue: { code: "edge-face-mismatch", faceToken, loopToken, edgeToken },
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
        issue: { code: "edge-cycle", faceToken, loopToken },
      };
    }
  }
  const arityFailed = loopArity === "rectangular-4"
    ? ordered.length !== 4
    : ordered.length < 2;
  if (
    arityFailed ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    (ordered[0] &&
      revit2027GEdgeLoopPreviousReference(ordered[0].edge, ordered[0].side) !==
        loopToken)
  ) {
    return {
      ok: false,
      issue: loopArity === "rectangular-4"
        ? {
            code: ordered.length === 4
              ? "edge-link-mismatch"
              : "non-rectangular-trim",
            faceToken,
            loopToken,
            detail: `edge count: ${ordered.length}`,
          }
        : { code: "edge-link-mismatch", faceToken, loopToken },
    };
  }
  return { ok: true, edges: ordered };
}

/** One adjacent pair of directed edge uses and their facing endpoints. */
export type Revit2027LoopJoin = {
  index: number;
  nextIndex: number;
  current: Revit2027DirectedEdge;
  next: Revit2027DirectedEdge;
  currentUv: Revit2027FaceUv;
  nextUv: Revit2027FaceUv;
};

export type Revit2027LoopContinuityPolicy<Repair> = {
  /** Whether two facing endpoints are one persisted point on this surface. */
  continuous: (
    current: Revit2027FaceUv,
    next: Revit2027FaceUv,
    tolerance: number,
  ) => boolean;
  /**
   * Optional native repair for a join the surface still proves continuous,
   * attempted only once the continuity predicate has already declined.
   */
  repairJoin?: (join: Revit2027LoopJoin) => Repair | null;
};

/**
 * Prove every directed loop join is continuous in this Face's UV chart.
 *
 * A directed edge use starts at the endpoint its loop direction implies, so
 * the trailing endpoint of each edge must meet the leading endpoint of the
 * next one. Repairs a strategy admits are returned in loop order.
 */
export function linkRevit2027DirectedLoopEndpoints<Repair>(
  edges: readonly Revit2027DirectedEdge[],
  tolerance: number,
  policy: Revit2027LoopContinuityPolicy<Repair>,
): { ok: true; repairs: Repair[] } | { ok: false; join: Revit2027LoopJoin } {
  const repairs: Repair[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const nextIndex = (index + 1) % edges.length;
    const current = edges[index]!;
    const next = edges[nextIndex]!;
    const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
    const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
    const join: Revit2027LoopJoin = {
      index,
      nextIndex,
      current,
      next,
      currentUv: revit2027FaceUv(
        current.edge.firstAndLastEdgePoints[currentEnd],
        current.side,
      ),
      nextUv: revit2027FaceUv(
        next.edge.firstAndLastEdgePoints[nextStart],
        next.side,
      ),
    };
    if (policy.continuous(join.currentUv, join.nextUv, tolerance)) continue;
    const repair = policy.repairJoin?.(join);
    if (repair != null) {
      repairs.push(repair);
      continue;
    }
    return { ok: false, join };
  }
  return { ok: true, repairs };
}

export type Revit2027OwnerFaceMaterialOptions = {
  /**
   * Exact framed MaterialElem identities used to bind a positive persisted
   * Face.renderStyleElementId. Negative and unassigned values remain null.
   */
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
};

/**
 * Bind one persisted Face to a material identity.
 *
 * A caller-supplied binding wins outright, including a deliberate null. A
 * positive render style that names no framed MaterialElem is reported through
 * `reportUnresolved` and leaves the face unmaterialed rather than guessing.
 */
export function revit2027OwnerFaceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027OwnerFaceMaterialOptions,
  reportUnresolved: (detail: string) => void,
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
    reportUnresolved(`${binding.renderStyleElementId}: ${binding.reason}`);
  }
  return null;
}

/** Resolve the shared UV tolerance option every certified owner path takes. */
export function revit2027OwnerUvTolerance(
  uvTolerance: number | undefined,
):
  | { ok: true; tolerance: number }
  | { ok: false; error: string } {
  const tolerance = uvTolerance ?? REVIT_2027_DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }
  return { ok: true, tolerance };
}

/** Whether persisted samples sweep one interval end to end without reversing. */
export function monotonicSpan(
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
  return nearlyEqual(Math.min(...values), minimum, tolerance) &&
    nearlyEqual(Math.max(...values), maximum, tolerance);
}

/**
 * Name the rectangular trim boundary one directed edge use lies on.
 *
 * A boundary edge holds one parameter at a corner value and sweeps the other
 * across the full envelope. An edge matching two candidates is ambiguous and
 * is declined, which is what keeps a degenerate envelope out.
 */
export function revit2027TrimBoundaryFor(
  points: readonly Revit2027FaceUv[],
  minimum: Revit2027FaceUv,
  maximum: Revit2027FaceUv,
  tolerance: number,
): Revit2027TrimBoundary | null {
  if (points.length < 2) return null;
  const candidates: Array<{
    boundary: Revit2027TrimBoundary;
    fixedAxis: 0 | 1;
    fixedValue: number;
    varyingAxis: 0 | 1;
  }> = [
    { boundary: "u-min", fixedAxis: 0, fixedValue: minimum[0], varyingAxis: 1 },
    { boundary: "u-max", fixedAxis: 0, fixedValue: maximum[0], varyingAxis: 1 },
    { boundary: "v-min", fixedAxis: 1, fixedValue: minimum[1], varyingAxis: 0 },
    { boundary: "v-max", fixedAxis: 1, fixedValue: maximum[1], varyingAxis: 0 },
  ];
  const matches = candidates.filter((candidate) => {
    if (
      points.some(
        (point) =>
          !nearlyEqual(
            point[candidate.fixedAxis],
            candidate.fixedValue,
            tolerance,
          ) ||
          point[candidate.varyingAxis] <
            minimum[candidate.varyingAxis] - tolerance ||
          point[candidate.varyingAxis] >
            maximum[candidate.varyingAxis] + tolerance,
      )
    ) {
      return false;
    }
    return monotonicSpan(
      points.map((point) => point[candidate.varyingAxis]),
      minimum[candidate.varyingAxis],
      maximum[candidate.varyingAxis],
      tolerance,
    );
  });
  return matches.length === 1 ? matches[0]!.boundary : null;
}

/**
 * Join every directed edge use of one loop into a closed UV contour.
 *
 * Shared endpoints are written once and a closing duplicate is dropped, so
 * the ring is exactly the persisted sampling of that contour.
 */
export function revit2027SampledUvRing(
  uvsByEdge: readonly (readonly Revit2027FaceUv[])[],
  tolerance: number,
): Point2[] | null {
  const ring: Point2[] = [];
  for (const points of uvsByEdge) {
    for (let index = 0; index < points.length; index += 1) {
      if (ring.length > 0 && index === 0) continue;
      ring.push([points[index]![0], points[index]![1]]);
    }
  }
  if (ring.length > 1 && uvDistance(ring[0]!, ring.at(-1)!) <= tolerance) {
    ring.pop();
  }
  return (
      ring.length >= 3 &&
      ring.every((point) => point.every(Number.isFinite))
    )
    ? ring
    : null;
}

export function signedUvRingArea(ring: readonly Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twiceArea += point[0] * next[1] - next[0] * point[1];
  }
  return twiceArea / 2;
}

/**
 * Give each sampled contour its native filled or hole role.
 *
 * Native OdBrepBuilder::addLoop takes no outer/hole argument. TB_Geometry's
 * OdBmEdgeLoopImpl::isCCW corrects the directed UV shoelace sign when the
 * persisted Face normal-flip bit equals Surface.orientFlag, and a corrected
 * positive area is then a filled contour. A contour with no corrected area at
 * all proves nothing and fails closed.
 */
export function correctedUvRingRoles(
  rings: readonly (readonly Point2[])[],
  normalFlipped: boolean,
  surfaceOrientFlag: boolean,
  tolerance: number,
): ("outer" | "hole")[] | null {
  const areaTolerance = Math.max(tolerance * tolerance, Number.EPSILON);
  const roles: ("outer" | "hole")[] = [];
  for (const ring of rings) {
    const rawArea = signedUvRingArea(ring);
    const correctedArea = normalFlipped === surfaceOrientFlag
      ? -rawArea
      : rawArea;
    if (Math.abs(correctedArea) <= areaTolerance) return null;
    roles.push(correctedArea > 0 ? "outer" : "hole");
  }
  return roles;
}

/**
 * Match contours returned by the containment classifier back to loop order.
 *
 * A contour that matches more than one unclaimed loop, or none, leaves the
 * face's loop roles unproven.
 */
export function createUvRingMatcher(
  rings: readonly (readonly Point2[])[],
): {
  match: (target: readonly Point2[]) => number | null;
  used: ReadonlySet<number>;
} {
  const used = new Set<number>();
  const sameRing = (
    left: readonly Point2[],
    right: readonly Point2[],
  ): boolean =>
    left.length === right.length &&
    left.every(
      (point, index) =>
        point[0] === right[index]![0] && point[1] === right[index]![1],
    );
  return {
    used,
    match: (target) => {
      const candidates = rings
        .map((ring, index) => ({ ring, index }))
        .filter(({ ring, index }) => !used.has(index) && sameRing(ring, target));
      if (candidates.length !== 1) return null;
      const index = candidates[0]!.index;
      used.add(index);
      return index;
    },
  };
}
