import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import { tessellatePlanarBrep } from "./brep-tessellator.ts";
import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
  type Revit2027EdgeLoopWithChainEnvelopesStatic,
} from "./revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  revit2027GEdgeNativeCurveKind,
  revit2027GEdgeLoopDirection,
  revit2027GEdgeLoopNextReference,
  revit2027GEdgeLoopPreviousReference,
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
  adaptRevit2027PlanarSampledBrep,
  type Revit2027PlanarSampledEdgeUse,
} from "./revit-2027-planar-sampled-brep.ts";
import {
  evaluateRevit2027AnalyticSurfacePoint,
} from "./revit-2027-analytic-edge.ts";
import {
  groupRings,
  type Point2,
} from "./polygon.ts";
import {
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027PlaneSurface,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;
/**
 * `checkCoedgeLoop` in the audited native BRep filler evaluates adjacent
 * p-curve endpoints in model space and permits an intersection/retiming repair
 * within this distance. It is deliberately not used as a raw UV tolerance.
 */
const NATIVE_PLANAR_COEDGE_REPAIR_DISTANCE_FEET = 0.01;

export type Revit2027PlanarOwnerMeshIssueCode =
  | "replay-failed"
  | "invalid-options"
  | "missing-face-token"
  | "surface-unresolved"
  | "unsupported-surface"
  | "loop-unresolved"
  | "loop-cycle"
  | "multi-loop"
  | "loop-face-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
  | "material-unresolved"
  | "adapter-rejected"
  | "tessellator-rejected";

export type Revit2027PlanarOwnerMeshIssue = {
  code: Revit2027PlanarOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027PlanarOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  loopTokens: readonly number[];
  /** Connected filled regions emitted for this one persisted Face. */
  regionCount: number;
  /** Native-oriented hole loops across all emitted regions. */
  holeLoopCount: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027PlanarOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027PlanarOwnerFaceMesh[];
  issues: readonly Revit2027PlanarOwnerMeshIssue[];
};

export type Revit2027PlanarOwnerMeshResult =
  | { ok: true; value: Revit2027PlanarOwnerMesh }
  | { ok: false; error: string };

export type Revit2027PlanarOwnerMeshOptions = {
  uvTolerance?: number;
  replayRegistry?: Revit2027GRepReplayRegistry;
  replayOptions?: Revit2027GRepReplayOptions;
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

type LoopRecord = {
  token: number;
  loop: Revit2027EdgeLoopStatic;
};

type UvMatch = {
  currentEndpoint: 0 | 1;
  nextEndpoint: 0 | 1;
};

type OrderedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
};

function value<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027PlanarOwnerMeshOptions,
  issues: Revit2027PlanarOwnerMeshIssue[],
): string | number | null {
  const supplied = options.materialForFace?.(faceToken, face);
  if (supplied !== undefined) return supplied;
  if (!options.materialDefinitions) return null;
  const binding = bindRevit2027FaceMaterial(
    face.renderStyleElementId,
    options.materialDefinitions,
  );
  if (binding.status === "exact-material") {
    return binding.materialElementId;
  }
  if (binding.status === "unresolved-positive-id") {
    issues.push({
      code: "material-unresolved",
      faceToken,
      detail:
        `${binding.renderStyleElementId}: ${binding.reason}`,
    });
  }
  return null;
}

function edgeSide(edge: Revit2027GEdgeStatic, faceToken: number): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  if (first === second) return null;
  return first ? 0 : 1;
}

function uv(
  edge: Revit2027GEdgeStatic,
  endpoint: 0 | 1,
  side: 0 | 1,
): readonly [number, number] {
  const point = edge.firstAndLastEdgePoints[endpoint];
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function distance(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function matches(
  current: Revit2027GEdgeStatic,
  currentSide: 0 | 1,
  next: Revit2027GEdgeStatic,
  nextSide: 0 | 1,
  tolerance: number,
): UvMatch[] {
  const result: UvMatch[] = [];
  for (const currentEndpoint of [0, 1] as const) {
    for (const nextEndpoint of [0, 1] as const) {
      if (
        distance(
          uv(current, currentEndpoint, currentSide),
          uv(next, nextEndpoint, nextSide),
        ) <= tolerance
      ) {
        result.push({ currentEndpoint, nextEndpoint });
      }
    }
  }
  return result;
}

function lineIntersection(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): Point2 | null {
  const firstDirection = [
    firstEnd[0] - firstStart[0],
    firstEnd[1] - firstStart[1],
  ] as const;
  const secondDirection = [
    secondEnd[0] - secondStart[0],
    secondEnd[1] - secondStart[1],
  ] as const;
  const denominator =
    firstDirection[0] * secondDirection[1] -
    firstDirection[1] * secondDirection[0];
  const scale =
    Math.hypot(...firstDirection) * Math.hypot(...secondDirection);
  if (
    !Number.isFinite(scale) ||
    scale === 0 ||
    Math.abs(denominator) <= Number.EPSILON * 64 * scale
  ) {
    return null;
  }
  const delta = [
    secondStart[0] - firstStart[0],
    secondStart[1] - firstStart[1],
  ] as const;
  const parameter =
    (delta[0] * secondDirection[1] -
      delta[1] * secondDirection[0]) /
    denominator;
  const intersection = [
    firstStart[0] + parameter * firstDirection[0],
    firstStart[1] + parameter * firstDirection[1],
  ] as const;
  return intersection.every(Number.isFinite) ? intersection : null;
}

function modelDistance(
  surface: Revit2027PlaneSurface,
  first: Point2,
  second: Point2,
): number | null {
  const firstPoint = evaluateRevit2027AnalyticSurfacePoint(surface, first);
  const secondPoint = evaluateRevit2027AnalyticSurfacePoint(surface, second);
  if (!firstPoint.ok || !secondPoint.ok) return null;
  return Math.hypot(
    firstPoint.point[0] - secondPoint.point[0],
    firstPoint.point[1] - secondPoint.point[1],
    firstPoint.point[2] - secondPoint.point[2],
  );
}

function repairedPlanarLineJoin(
  current: Revit2027PlanarSampledEdgeUse,
  currentUvs: Point2[],
  next: Revit2027PlanarSampledEdgeUse,
  nextUvs: Point2[],
  surface: Revit2027PlaneSurface,
): Point2 | null {
  if (
    revit2027GEdgeNativeCurveKind(current.edge) !== "line-segment" ||
    revit2027GEdgeNativeCurveKind(next.edge) !== "line-segment" ||
    currentUvs.length !== 2 ||
    nextUvs.length !== 2
  ) {
    return null;
  }
  const intersection = lineIntersection(
    currentUvs[0]!,
    currentUvs[1]!,
    nextUvs[0]!,
    nextUvs[1]!,
  );
  if (!intersection) return null;
  const currentCorrection = modelDistance(
    surface,
    currentUvs[1]!,
    intersection,
  );
  const nextCorrection = modelDistance(
    surface,
    nextUvs[0]!,
    intersection,
  );
  if (
    currentCorrection == null ||
    nextCorrection == null ||
    currentCorrection > NATIVE_PLANAR_COEDGE_REPAIR_DISTANCE_FEET ||
    nextCorrection > NATIVE_PLANAR_COEDGE_REPAIR_DISTANCE_FEET
  ) {
    return null;
  }
  const currentLength = modelDistance(surface, currentUvs[0]!, intersection);
  const nextLength = modelDistance(surface, intersection, nextUvs[1]!);
  return (
      currentLength != null &&
      nextLength != null &&
      currentLength > 0 &&
      nextLength > 0
    )
    ? intersection
    : null;
}

function directedEdgeUses(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  surface: Revit2027PlaneSurface,
  tolerance: number,
):
  | { ok: true; edgeUses: Revit2027PlanarSampledEdgeUse[] }
  | {
      ok: false;
      issue: Revit2027PlanarOwnerMeshIssue;
    } {
  const ordered: OrderedEdge[] = [];
  const visited = new Set<number>();
  let token = loop.loop.nextEdgeReference;
  while (token !== loop.token) {
    if (token <= 0 || visited.has(token)) {
      return {
        ok: false,
        issue: {
          code: "edge-cycle",
          faceToken,
          loopToken: loop.token,
          edgeToken: token,
        },
      };
    }
    const edge = edges.get(token);
    if (!edge) {
      return {
        ok: false,
        issue: {
          code: "edge-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: token,
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
          edgeToken: token,
        },
      };
    }
    visited.add(token);
    ordered.push({ token, edge, side });
    token = revit2027GEdgeLoopNextReference(edge, side);
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
    revit2027GEdgeLoopPreviousReference(
      ordered[0]!.edge,
      ordered[0]!.side,
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

  const edgeUses: Revit2027PlanarSampledEdgeUse[] = ordered.map((record) => ({
    edgeToken: record.token,
    edge: record.edge,
    faceSide: record.side,
    direction: revit2027GEdgeLoopDirection(record.edge, record.side),
  }));
  const directedUvs = edgeUses.map((edgeUse) => edgeUseUvs(edgeUse));
  const repaired = new Set<number>();
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const currentUvs = directedUvs[index]!;
    const nextIndex = (index + 1) % edgeUses.length;
    const nextUvs = directedUvs[nextIndex]!;
    const nativeJoinDistance = distance(
      currentUvs.at(-1)!,
      nextUvs[0]!,
    );
    if (nativeJoinDistance <= tolerance) continue;
    const intersection = repairedPlanarLineJoin(
      edgeUses[index]!,
      currentUvs,
      edgeUses[nextIndex]!,
      nextUvs,
      surface,
    );
    if (intersection) {
      currentUvs[currentUvs.length - 1] = intersection;
      nextUvs[0] = intersection;
      repaired.add(index);
      repaired.add(nextIndex);
      continue;
    }
    const candidates = matches(
      current.edge,
      current.side,
      next.edge,
      next.side,
      tolerance,
    );
    const endpointDistances = ([0, 1] as const).flatMap(
      (currentEndpoint) =>
        ([0, 1] as const).map((nextEndpoint) =>
          distance(
            uv(current.edge, currentEndpoint, current.side),
            uv(next.edge, nextEndpoint, next.side),
          )
        ),
    );
    return {
      ok: false,
      issue: {
        code: "uv-link-unresolved",
        faceToken,
        loopToken: loop.token,
        edgeToken: current.token,
        detail:
          `native directed join distance: ${
            nativeJoinDistance.toPrecision(8)
          }; candidate endpoint matches: ${candidates.length}; ` +
          `loop edges: ${ordered.length}; ` +
          `next edge: ${next.token}; distances: ${
            endpointDistances.map((value) => value.toPrecision(8)).join(",")
          }; interior points: ${
            current.edge.interiorEdgePoints.length
          },${next.edge.interiorEdgePoints.length}; flags: ${
            current.edge.flags
          },${next.edge.flags}`,
      },
    };
  }
  for (const index of repaired) {
    edgeUses[index] = {
      ...edgeUses[index]!,
      trimUvs: directedUvs[index],
    };
  }
  return { ok: true, edgeUses };
}

function edgeUseUvs(
  edgeUse: Revit2027PlanarSampledEdgeUse,
): Point2[] {
  if (edgeUse.trimUvs) {
    return edgeUse.trimUvs.map((point) => [point[0], point[1]]);
  }
  const points = [
    edgeUse.edge.firstAndLastEdgePoints[0],
    ...edgeUse.edge.interiorEdgePoints,
    edgeUse.edge.firstAndLastEdgePoints[1],
  ].map((point) => {
    const uv = edgeUse.faceSide === 0
      ? point.firstFaceUv
      : point.secondFaceUv;
    return [uv[0], uv[1]] as Point2;
  });
  return edgeUse.direction === 1 ? points : points.reverse();
}

function sampledUvRing(
  edgeUses: readonly Revit2027PlanarSampledEdgeUse[],
  tolerance: number,
): Point2[] | null {
  const ring: Point2[] = [];
  for (const edgeUse of edgeUses) {
    const points = edgeUseUvs(edgeUse);
    for (let index = 0; index < points.length; index += 1) {
      if (ring.length > 0 && index === 0) continue;
      ring.push(points[index]!);
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

type ClassifiedPlanarLoopRegions = {
  roles: readonly ("outer" | "hole")[];
  /** Each region starts with its outer loop followed by its direct holes. */
  regions: readonly (readonly number[])[];
};

function classifyPlanarLoopRegions(
  edgeUsesByLoop: readonly (readonly Revit2027PlanarSampledEdgeUse[])[],
  normalFlipped: boolean,
  surfaceOrientFlag: boolean,
  tolerance: number,
): ClassifiedPlanarLoopRegions | null {
  // A lone closed boundary is the face's only filled region. The native
  // winding classifier matters when multiple contours compete for roles.
  if (edgeUsesByLoop.length === 1) {
    return { roles: ["outer"], regions: [[0]] };
  }
  const rings: Point2[][] = [];
  for (const edgeUses of edgeUsesByLoop) {
    const ring = sampledUvRing(edgeUses, tolerance);
    if (!ring) return null;
    rings.push(ring);
  }

  // Native OdBrepBuilder::addLoop takes no outer/hole argument. TB_Geometry's
  // OdBmEdgeLoopImpl::isCCW corrects the directed UV shoelace sign when the
  // persisted Face normal-flip bit equals Surface.orientFlag. Its containment
  // audit then requires corrected-positive loops at even (filled) depth and
  // corrected-negative loops at odd (hole) depth. Preserve that exact rule
  // before the independent strict geometric validation below.
  const areaTolerance = Math.max(tolerance * tolerance, Number.EPSILON);
  const roles: ("outer" | "hole")[] = [];
  for (const ring of rings) {
    const rawArea = signedUvRingArea(ring);
    const correctedArea =
      normalFlipped === surfaceOrientFlag ? -rawArea : rawArea;
    if (Math.abs(correctedArea) <= areaTolerance) return null;
    roles.push(correctedArea > 0 ? "outer" : "hole");
  }
  const outerIndexes = roles
    .map((role, index) => role === "outer" ? index : -1)
    .filter((index) => index >= 0);
  if (outerIndexes.length === 0) return null;

  const groups = groupRings(rings);
  if (groups.length !== outerIndexes.length) return null;
  const used = new Set<number>();
  const matchingRingIndex = (target: readonly Point2[]): number | null => {
    const candidates = rings
      .map((ring, index) => ({ ring, index }))
      .filter(({ ring, index }) => !used.has(index) && sameUvRing(ring, target));
    if (candidates.length !== 1) return null;
    const index = candidates[0]!.index;
    used.add(index);
    return index;
  };
  const regions: number[][] = [];
  for (const group of groups) {
    const outerIndex = matchingRingIndex(group.outer);
    if (outerIndex == null || roles[outerIndex] !== "outer") return null;
    const region = [outerIndex];
    for (const hole of group.holes) {
      const holeIndex = matchingRingIndex(hole);
      if (holeIndex == null || roles[holeIndex] !== "hole") return null;
      region.push(holeIndex);
    }
    regions.push(region);
  }
  if (used.size !== rings.length) return null;
  return { roles, regions };
}

/**
 * Convert independently safe planar Faces in one completed Revit 2027 replay
 * into browser mesh objects. Multi-loop faces enter only when face-local
 * containment proves one outer contour and direct, disjoint holes.
 */
export function meshRevit2027PlanarSampledReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027PlanarOwnerMeshOptions = {},
): Revit2027PlanarOwnerMeshResult {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }

  const faces = new Map<number, Revit2027FaceStatic>();
  const faceSpanIndexes = new Map<number, number>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
  const planesByFace = new Map<number, Revit2027PlaneSurface>();
  for (const span of replay.spans) {
    if (span.propertyToken <= 0) continue;
    if (span.propertySourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      faces.set(span.propertyToken, value<Revit2027FaceStatic>(span));
      faceSpanIndexes.set(span.replayIndex, span.propertyToken);
    } else if (
      span.propertySourceClassSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT
    ) {
      edges.set(span.propertyToken, value<Revit2027GEdgeStatic>(span));
    } else if (
      span.propertySourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: value<Revit2027EdgeLoopStatic>(span),
      });
    } else if (
      span.propertySourceClassSlot ===
      REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT
    ) {
      loops.set(span.propertyToken, {
        token: span.propertyToken,
        loop: value<Revit2027EdgeLoopWithChainEnvelopesStatic>(span).loop,
      });
    } else if (
      span.propertySourceClassSlot ===
        REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT &&
      span.parentReplayIndex != null
    ) {
      const faceToken = faceSpanIndexes.get(span.parentReplayIndex);
      if (faceToken != null) {
        planesByFace.set(faceToken, value<Revit2027PlaneSurface>(span));
      }
    }
  }

  const issues: Revit2027PlanarOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027PlanarOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-planar-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of faces) {
    if (face.surface.token === 0) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT
    ) {
      issues.push({ code: "unsupported-surface", faceToken });
      continue;
    }
    const surface = planesByFace.get(faceToken);
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
      if (loopToken < 0 || seenLoopTokens.has(loopToken)) {
        issues.push({
          code: "loop-cycle",
          faceToken,
          loopToken,
        });
        loopFailure = true;
        break;
      }
      const loop = loops.get(loopToken);
      if (!loop) {
        issues.push({
          code: "loop-unresolved",
          faceToken,
          loopToken,
        });
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
        issues.push({
          code: "loop-cycle",
          faceToken,
          loopToken,
        });
        loopFailure = true;
        break;
      }
    }
    if (loopFailure) continue;

    const edgeUsesByLoop: Revit2027PlanarSampledEdgeUse[][] = [];
    for (const loop of loopChain) {
      const directed = directedEdgeUses(
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
      edgeUsesByLoop.push(directed.edgeUses);
    }
    if (loopFailure) continue;
    const classified = classifyPlanarLoopRegions(
      edgeUsesByLoop,
      (face.faceFlags & 0x2) !== 0,
      surface.surface.orientFlag,
      tolerance,
    );
    if (!classified) {
      issues.push({
        code: "multi-loop",
        faceToken,
        loopToken: loopChain[0]?.token,
        detail:
          `${loopChain.length} contours do not prove native-oriented filled regions with direct holes`,
      });
      continue;
    }
    const outerLoop = loopChain[classified.regions[0]![0]!]!;
    const materialId = faceMaterialId(faceToken, face, options, issues);
    const adapted = adaptRevit2027PlanarSampledBrep({
      id: `revit-2027-owner-${replay.ownerElementId}-face-${faceToken}`,
      provenance,
      continuityTolerance: tolerance,
      faces: classified.regions.map((region, regionIndex) => ({
        faceToken,
        regionIndex: classified.regions.length > 1 ? regionIndex : undefined,
        surface,
        loops: region.map((loopIndex) => ({
          loopToken: loopChain[loopIndex]!.token,
          role: classified.roles[loopIndex]!,
          edgeUses: edgeUsesByLoop[loopIndex]!,
        })),
        materialId,
        provenance,
      })),
    });
    if (!adapted.ok) {
      issues.push(...adapted.issues.map((issue) => ({
        code: "adapter-rejected" as const,
        faceToken,
        loopToken: issue.loopToken,
        edgeToken: issue.edgeToken,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }
    const tessellated = tessellatePlanarBrep(adapted.brep);
    if (!tessellated.ok) {
      issues.push(...tessellated.issues.map((issue) => ({
        code: "tessellator-rejected" as const,
        faceToken,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken: outerLoop.token,
      loopTokens: loopChain.map((loop) => loop.token),
      regionCount: classified.regions.length,
      holeLoopCount: classified.roles.filter((role) => role === "hole").length,
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

/**
 * Complete the certified browser replay and mesh its safe planar subset.
 */
export function replayAndMeshRevit2027PlanarSampledOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027PlanarOwnerMeshOptions = {},
): Revit2027PlanarOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (!replayed.ok) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027PlanarSampledReplay(replayed.value, options);
}
