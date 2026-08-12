import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import { tessellatePlanarBrep } from "./brep-tessellator.ts";
import {
  revit2027GEdgeNativeCurveKind,
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
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
import {
  correctedUvRingRoles,
  createUvRingMatcher,
  linkRevit2027DirectedLoopEndpoints,
  revit2027FaceUv,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  revit2027SampledUvRing,
  uvDistance,
  walkRevit2027DirectedLoopEdges,
  type Revit2027FaceUv,
} from "./revit-2027-owner-mesh-trim.ts";
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

type UvMatch = {
  currentEndpoint: 0 | 1;
  nextEndpoint: 0 | 1;
};

function endpointUv(
  edge: Revit2027GEdgeStatic,
  endpoint: 0 | 1,
  side: 0 | 1,
): Revit2027FaceUv {
  return revit2027FaceUv(edge.firstAndLastEdgePoints[endpoint], side);
}

/** Every endpoint pairing this join could have been meant to close. */
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
        uvDistance(
          endpointUv(current, currentEndpoint, currentSide),
          endpointUv(next, nextEndpoint, nextSide),
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
  const intersection: Point2 = [
    firstStart[0] + parameter * firstDirection[0],
    firstStart[1] + parameter * firstDirection[1],
  ];
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
    const uv = revit2027FaceUv(point, edgeUse.faceSide);
    return [uv[0], uv[1]] as Point2;
  });
  return edgeUse.direction === 1 ? points : points.reverse();
}

function directedEdgeUses(
  faceToken: number,
  loop: Revit2027OwnerLoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  surface: Revit2027PlaneSurface,
  tolerance: number,
):
  | { ok: true; edgeUses: Revit2027PlanarSampledEdgeUse[] }
  | {
      ok: false;
      issue: Revit2027PlanarOwnerMeshIssue;
    } {
  const walked = walkRevit2027DirectedLoopEdges({
    faceToken,
    loop,
    edges,
    loopArity: "open",
  });
  if (walked.ok === false) return { ok: false, issue: walked.issue };
  const ordered = walked.edges;

  const edgeUses: Revit2027PlanarSampledEdgeUse[] = ordered.map((record) => ({
    edgeToken: record.token,
    edge: record.edge,
    faceSide: record.side,
    direction: record.direction,
  }));
  const directedUvs = edgeUses.map((edgeUse) => edgeUseUvs(edgeUse));
  const repaired = new Set<number>();
  const linked = linkRevit2027DirectedLoopEndpoints(ordered, tolerance, {
    continuous: (current, next) => uvDistance(current, next) <= tolerance,
    // A native line/line join is retimed onto its exact intersection, which
    // rewrites the two facing samples in place. Only the pair being joined is
    // read or written, so an earlier repair never disturbs a later join.
    repairJoin: (join) => {
      const currentUvs = directedUvs[join.index]!;
      const nextUvs = directedUvs[join.nextIndex]!;
      const intersection = repairedPlanarLineJoin(
        edgeUses[join.index]!,
        currentUvs,
        edgeUses[join.nextIndex]!,
        nextUvs,
        surface,
      );
      if (!intersection) return null;
      currentUvs[currentUvs.length - 1] = intersection;
      nextUvs[0] = intersection;
      repaired.add(join.index);
      repaired.add(join.nextIndex);
      return intersection;
    },
  });
  if (linked.ok === false) {
    const current = linked.join.current;
    const next = linked.join.next;
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
          uvDistance(
            endpointUv(current.edge, currentEndpoint, current.side),
            endpointUv(next.edge, nextEndpoint, next.side),
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
            uvDistance(linked.join.currentUv, linked.join.nextUv)
              .toPrecision(8)
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
    const ring = revit2027SampledUvRing(edgeUses.map(edgeUseUvs), tolerance);
    if (!ring) return null;
    rings.push(ring);
  }

  // Native OdBrepBuilder::addLoop takes no outer/hole argument. TB_Geometry's
  // OdBmEdgeLoopImpl::isCCW corrects the directed UV shoelace sign when the
  // persisted Face normal-flip bit equals Surface.orientFlag. Its containment
  // audit then requires corrected-positive loops at even (filled) depth and
  // corrected-negative loops at odd (hole) depth. Preserve that exact rule
  // before the independent strict geometric validation below.
  const roles = correctedUvRingRoles(
    rings,
    normalFlipped,
    surfaceOrientFlag,
    tolerance,
  );
  if (!roles) return null;
  const outerIndexes = roles
    .map((role, index) => role === "outer" ? index : -1)
    .filter((index) => index >= 0);
  if (outerIndexes.length === 0) return null;

  const groups = groupRings(rings);
  if (groups.length !== outerIndexes.length) return null;
  const matcher = createUvRingMatcher(rings);
  const regions: number[][] = [];
  for (const group of groups) {
    const outerIndex = matcher.match(group.outer);
    if (outerIndex == null || roles[outerIndex] !== "outer") return null;
    const region = [outerIndex];
    for (const hole of group.holes) {
      const holeIndex = matcher.match(hole);
      if (holeIndex == null || roles[holeIndex] !== "hole") return null;
      region.push(holeIndex);
    }
    regions.push(region);
  }
  if (matcher.used.size !== rings.length) return null;
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
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027PlanarOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027PlanarOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-planar-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of index.faces) {
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
    const surface = revit2027OwnerSurface<Revit2027PlaneSurface>(
      index,
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
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
      if (loopToken < 0 || seenLoopTokens.has(loopToken)) {
        issues.push({
          code: "loop-cycle",
          faceToken,
          loopToken,
        });
        loopFailure = true;
        break;
      }
      const loop = index.loops.get(loopToken);
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
      if (loopChain.length > index.loops.size) {
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
        index.edges,
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
    const materialId = revit2027OwnerFaceMaterialId(
      faceToken,
      face,
      options,
      (detail) => issues.push({ code: "material-unresolved", faceToken, detail }),
    );
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
    const tessellated = tessellatePlanarBrep(adapted.brep, {
      // Four exact native line edges can occasionally form one persisted
      // bow-tie trim (the UNBC stringer end caps). The format-specific gate
      // below lets the generic tessellator split only that one-crossing case
      // into its two even-odd lobes.
      allowSingleCrossingTrim:
        loopChain.length === 1 &&
        edgeUsesByLoop[0]?.length === 4 &&
        edgeUsesByLoop[0].every(
          (edgeUse) =>
            revit2027GEdgeNativeCurveKind(edgeUse.edge) === "line-segment",
        ),
    });
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
