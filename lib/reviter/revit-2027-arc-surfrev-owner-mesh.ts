import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027EdgeLoopStatic } from "./revit-2027-edge-loop-static.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "./revit-2027-garc.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerCurves,
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import { revit2027OwnerFaceMesh } from "./revit-2027-owner-mesh-grid.ts";
import {
  linkRevit2027DirectedLoopEndpoints,
  revit2027DirectedEdgeUvs,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  revit2027TrimBoundaryFor,
  sameUv,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027TrimBoundary,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  tessellateRevit2027ArcSurfRev,
} from "./revit-2027-arc-surfrev.ts";
import {
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027SurfaceOfRevolution,
} from "./revit-2027-surfaces.ts";

export type Revit2027ArcSurfRevOwnerMeshIssueCode =
  | "invalid-options"
  | "surface-unresolved"
  | "profile-unresolved"
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

export type Revit2027ArcSurfRevOwnerMeshIssue = {
  code: Revit2027ArcSurfRevOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027ArcSurfRevOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  profileToken: number;
  revolutionSegments: number;
  profileSegments: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027ArcSurfRevOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027ArcSurfRevOwnerFaceMesh[];
  issues: readonly Revit2027ArcSurfRevOwnerMeshIssue[];
};

export type Revit2027ArcSurfRevOwnerMeshResult =
  | { ok: true; value: Revit2027ArcSurfRevOwnerMesh }
  | { ok: false; error: string };

export type Revit2027ArcSurfRevOwnerMeshOptions = {
  uvTolerance?: number;
  replayRegistry?: Revit2027GRepReplayRegistry;
  replayOptions?: Revit2027GRepReplayOptions;
  materialDefinitions?: Revit2027MaterialDefinitions;
  materialForFace?: (
    faceToken: number,
    face: Revit2027FaceStatic,
  ) => string | number | null | undefined;
};

function envelopeMatches(
  left: Revit2027EdgeLoopStatic["envelope"],
  right: Revit2027SurfaceOfRevolution["surface"]["envelope"],
  tolerance: number,
): boolean {
  return sameUv(left.minimum, right.firstCorner, tolerance) &&
    sameUv(left.maximum, right.secondCorner, tolerance);
}

/**
 * Mesh every independently certified circular-profile, rectangular-trimmed
 * SurfRev face in one already completed browser replay.
 */
export function meshRevit2027ArcSurfRevReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027ArcSurfRevOwnerMeshOptions = {},
): Revit2027ArcSurfRevOwnerMeshResult {
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027ArcSurfRevOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027ArcSurfRevOwnerFaceMesh[] = [];
  for (const [faceToken, face] of index.faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = revit2027OwnerSurface<Revit2027SurfaceOfRevolution>(
      index,
      REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
      faceToken,
    );
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    const profile = revit2027OwnerCurves(index, faceToken).findLast(
      (curve) => curve.sourceClassSlot === REVIT_2027_GARC_SOURCE_CLASS_SLOT,
    );
    if (!profile) {
      issues.push({ code: "profile-unresolved", faceToken });
      continue;
    }
    if (face.firstLoop.token <= 0) {
      issues.push({ code: "loop-unresolved", faceToken });
      continue;
    }
    const loop = index.loops.get(face.firstLoop.token);
    if (!loop) {
      issues.push({
        code: "loop-unresolved",
        faceToken,
        loopToken: face.firstLoop.token,
      });
      continue;
    }
    if (loop.loop.nextLoop.token !== 0) {
      issues.push({
        code: "multi-loop",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    if (loop.loop.faceReference !== faceToken) {
      issues.push({
        code: "loop-face-mismatch",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    if (
      !envelopeMatches(loop.loop.envelope, surface.surface.envelope, tolerance)
    ) {
      issues.push({
        code: "loop-envelope-mismatch",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    const directed = walkRevit2027DirectedLoopEdges({
      faceToken,
      loop,
      edges: index.edges,
      loopArity: "rectangular-4",
    });
    if (directed.ok === false) {
      issues.push(directed.issue);
      continue;
    }
    const linked = linkRevit2027DirectedLoopEndpoints(
      directed.edges,
      tolerance,
      { continuous: sameUv },
    );
    if (linked.ok === false) {
      issues.push({
        code: "uv-link-unresolved",
        faceToken,
        loopToken: loop.token,
        edgeToken: linked.join.current.token,
        detail: "native directed SurfRev endpoints do not coincide",
      });
      continue;
    }
    const byBoundary = new Map<Revit2027TrimBoundary, Revit2027DirectedEdge>();
    const segmentCounts = new Map<Revit2027TrimBoundary, number>();
    let boundaryFailure: Revit2027DirectedEdge | null = null;
    for (const edge of directed.edges) {
      const points = revit2027DirectedEdgeUvs(edge);
      const boundary = revit2027TrimBoundaryFor(
        points,
        surface.surface.envelope.firstCorner,
        surface.surface.envelope.secondCorner,
        tolerance,
      );
      if (!boundary || byBoundary.has(boundary)) {
        boundaryFailure = edge;
        break;
      }
      byBoundary.set(boundary, edge);
      segmentCounts.set(boundary, points.length - 1);
    }
    if (boundaryFailure || byBoundary.size !== 4) {
      issues.push({
        code: "non-rectangular-trim",
        faceToken,
        loopToken: loop.token,
        edgeToken: boundaryFailure?.token,
      });
      continue;
    }
    const revolutionSegments = segmentCounts.get("v-min")!;
    const profileSegments = segmentCounts.get("u-min")!;
    if (
      revolutionSegments !== segmentCounts.get("v-max") ||
      profileSegments !== segmentCounts.get("u-max")
    ) {
      issues.push({
        code: "opposite-sampling-mismatch",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    const tessellated = tessellateRevit2027ArcSurfRev({
      surface,
      profile: profile.value as Revit2027GArc,
      minimumUv: surface.surface.envelope.firstCorner,
      maximumUv: surface.surface.envelope.secondCorner,
      revolutionSegments,
      profileSegments,
      tolerance,
    });
    if (tessellated.ok === false) {
      issues.push({
        code: "tessellator-rejected",
        faceToken,
        loopToken: loop.token,
        detail: tessellated.error,
      });
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken: loop.token,
      profileToken: profile.token,
      revolutionSegments,
      profileSegments,
      mesh: revit2027OwnerFaceMesh({
        ownerElementId: replay.ownerElementId,
        faceToken,
        decoderId: "revit-2027-arc-surfrev-owner-mesh",
        brepSuffix: "surfrev",
        materialId: revit2027OwnerFaceMaterialId(
          faceToken,
          face,
          options,
          (detail) =>
            issues.push({ code: "material-unresolved", faceToken, detail }),
        ),
        positions: tessellated.mesh.positions,
        normals: Float32Array.from(tessellated.mesh.normals),
        indices: tessellated.mesh.indices,
      }),
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

/** Complete one browser replay and mesh its certified Arc/SurfRev subset. */
export function replayAndMeshRevit2027ArcSurfRevOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027ArcSurfRevOwnerMeshOptions = {},
): Revit2027ArcSurfRevOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (replayed.ok === false) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027ArcSurfRevReplay(replayed.value, options);
}
