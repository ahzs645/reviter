import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import {
  tessellateRevit2027ConeApexSectors,
  type Revit2027ConeApexSectorEdge,
} from "./revit-2027-cone-apex-sector.ts";
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
} from "./revit-2027-owner-mesh-index.ts";
import {
  linkRevit2027DirectedLoopEndpoints,
  revit2027DirectedEdgeUvs,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  uvDistance,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027FaceUv,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027ConeSurface,
} from "./revit-2027-surfaces.ts";

export type Revit2027ConeOwnerMeshIssueCode =
  | "invalid-options"
  | "surface-unresolved"
  | "loop-unresolved"
  | "multi-loop"
  | "loop-face-mismatch"
  | "loop-envelope-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
  | "material-unresolved"
  | "tessellator-rejected";

export type Revit2027ConeOwnerMeshIssue = {
  code: Revit2027ConeOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027ConeOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027ConeOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027ConeOwnerFaceMesh[];
  issues: readonly Revit2027ConeOwnerMeshIssue[];
};

export type Revit2027ConeOwnerMeshResult =
  | { ok: true; value: Revit2027ConeOwnerMesh }
  | { ok: false; error: string };

export type Revit2027ConeOwnerMeshOptions = {
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
 * Two apex-sector endpoints coincide when they share a UV point or when both
 * sit on the apex row, where every angle names the same physical point.
 */
function sameConePoint(
  left: Revit2027FaceUv,
  right: Revit2027FaceUv,
  tolerance: number,
): boolean {
  return (
    uvDistance(left, right) <= tolerance ||
    (Math.abs(left[1]) <= tolerance && Math.abs(right[1]) <= tolerance)
  );
}

function sampledEdge(edge: Revit2027DirectedEdge): Revit2027ConeApexSectorEdge {
  return {
    edgeToken: edge.token,
    samples: revit2027DirectedEdgeUvs(edge),
  };
}

/**
 * Convert the exact three-edge Cone apex-sector subset in one completed
 * browser replay. Distinct `(u, 0)` edge endpoints are linked by their
 * native-proven common physical apex.
 */
export function meshRevit2027ConeApexSectorReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027ConeOwnerMeshOptions = {},
): Revit2027ConeOwnerMeshResult {
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027ConeOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027ConeOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-cone-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of index.faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = revit2027OwnerSurface<Revit2027ConeSurface>(
      index,
      REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
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
      uvDistance(
        loop.loop.envelope.minimum,
        surface.surface.envelope.firstCorner,
      ) > tolerance ||
      uvDistance(
        loop.loop.envelope.maximum,
        surface.surface.envelope.secondCorner,
      ) > tolerance
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
      loopArity: "open",
    });
    if (directed.ok === false) {
      issues.push(directed.issue);
      continue;
    }
    const linked = linkRevit2027DirectedLoopEndpoints(
      directed.edges,
      tolerance,
      { continuous: sameConePoint },
    );
    if (linked.ok === false) {
      issues.push({
        code: "uv-link-unresolved",
        faceToken,
        loopToken: loop.token,
        edgeToken: linked.join.current.token,
        detail: "native directed cone endpoints do not coincide",
      });
      continue;
    }
    const tessellated = tessellateRevit2027ConeApexSectors({
      id: `revit-2027-owner-${replay.ownerElementId}-face-${faceToken}`,
      provenance,
      tolerance,
      faces: [{
        faceToken,
        surface,
        loops: [{
          loopToken: loop.token,
          role: "outer",
          edges: directed.edges.map(sampledEdge),
        }],
        materialId: revit2027OwnerFaceMaterialId(
          faceToken,
          face,
          options,
          (detail) =>
            issues.push({ code: "material-unresolved", faceToken, detail }),
        ),
        provenance,
      }],
    });
    if (tessellated.ok === false) {
      issues.push(...tessellated.issues.map((issue) => ({
        code: "tessellator-rejected" as const,
        faceToken,
        loopToken: issue.loopToken ?? loop.token,
        edgeToken: issue.edgeToken,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken: loop.token,
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
