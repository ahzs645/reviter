import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
} from "./revit-2027-grep-replay.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import {
  meshRevit2027PlanarSampledReplay,
  type Revit2027PlanarOwnerMeshIssue,
} from "./revit-2027-planar-owner-mesh.ts";
import {
  meshRevit2027ArcSurfRevReplay,
  type Revit2027ArcSurfRevOwnerMeshIssue,
} from "./revit-2027-arc-surfrev-owner-mesh.ts";
import {
  meshRevit2027CylinderSampledReplay,
  type Revit2027CylinderOwnerMeshIssue,
} from "./revit-2027-cylinder-owner-mesh.ts";
import {
  meshRevit2027ConeApexSectorReplay,
  type Revit2027ConeOwnerMeshIssue,
} from "./revit-2027-cone-owner-mesh.ts";

export type Revit2027CertifiedOwnerFaceMesh =
  | {
      kind: "planar-sampled";
      faceToken: number;
      loopToken: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "arc-surfrev";
      faceToken: number;
      loopToken: number;
      profileToken: number;
      revolutionSegments: number;
      profileSegments: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "cylinder-sampled";
      faceToken: number;
      loopToken: number;
      angularSegments: number;
      axialSegments: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "cone-apex-sector";
      faceToken: number;
      loopToken: number;
      mesh: NeutralFaceMesh;
    };

export type Revit2027CertifiedOwnerMeshIssue =
  | {
      path: "planar-sampled";
      issue: Revit2027PlanarOwnerMeshIssue;
    }
  | {
      path: "arc-surfrev";
      issue: Revit2027ArcSurfRevOwnerMeshIssue;
    }
  | {
      path: "cylinder-sampled";
      issue: Revit2027CylinderOwnerMeshIssue;
    }
  | {
      path: "cone-apex-sector";
      issue: Revit2027ConeOwnerMeshIssue;
    };

export type Revit2027CertifiedOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027CertifiedOwnerFaceMesh[];
  issues: readonly Revit2027CertifiedOwnerMeshIssue[];
};

export type Revit2027CertifiedOwnerMeshResult =
  | { ok: true; value: Revit2027CertifiedOwnerMesh }
  | { ok: false; error: string };

export type Revit2027CertifiedOwnerMeshOptions = {
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
 * Convert every independently certified face subset in one completed Revit
 * 2027 replay. Unsupported faces remain structured issues from their owning
 * path and never produce partial geometry.
 */
export function meshRevit2027CertifiedOwnerReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027CertifiedOwnerMeshOptions = {},
): Revit2027CertifiedOwnerMeshResult {
  const shared = {
    uvTolerance: options.uvTolerance,
    materialDefinitions: options.materialDefinitions,
    materialForFace: options.materialForFace,
  };
  const planar = meshRevit2027PlanarSampledReplay(replay, shared);
  if (planar.ok === false) return planar;
  const surfRev = meshRevit2027ArcSurfRevReplay(replay, shared);
  if (surfRev.ok === false) return surfRev;
  const cylinder = meshRevit2027CylinderSampledReplay(replay, shared);
  if (cylinder.ok === false) return cylinder;
  const cone = meshRevit2027ConeApexSectorReplay(replay, shared);
  if (cone.ok === false) return cone;
  const certifiedCurvedFaceTokens = new Set(
    [
      ...surfRev.value.faceMeshes,
      ...cylinder.value.faceMeshes,
      ...cone.value.faceMeshes,
    ].map((face) => face.faceToken),
  );
  const planarIssues = planar.value.issues.filter(
    (issue) =>
      !(
        issue.code === "unsupported-surface" &&
        issue.faceToken != null &&
        certifiedCurvedFaceTokens.has(issue.faceToken)
      ),
  );
  return {
    ok: true,
    value: {
      ownerElementId: replay.ownerElementId,
      replay,
      faceMeshes: [
        ...planar.value.faceMeshes.map((face) => ({
          kind: "planar-sampled" as const,
          ...face,
        })),
        ...surfRev.value.faceMeshes.map((face) => ({
          kind: "arc-surfrev" as const,
          ...face,
        })),
        ...cylinder.value.faceMeshes.map((face) => ({
          kind: "cylinder-sampled" as const,
          ...face,
        })),
        ...cone.value.faceMeshes.map((face) => ({
          kind: "cone-apex-sector" as const,
          ...face,
        })),
      ],
      issues: [
        ...planarIssues.map((issue) => ({
          path: "planar-sampled" as const,
          issue,
        })),
        ...surfRev.value.issues.map((issue) => ({
          path: "arc-surfrev" as const,
          issue,
        })),
        ...cylinder.value.issues.map((issue) => ({
          path: "cylinder-sampled" as const,
          issue,
        })),
        ...cone.value.issues.map((issue) => ({
          path: "cone-apex-sector" as const,
          issue,
        })),
      ],
    },
  };
}

/** Replay one framed owner once, then run every certified browser mesh path. */
export function replayAndMeshRevit2027CertifiedOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027CertifiedOwnerMeshOptions = {},
): Revit2027CertifiedOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (replayed.ok === false) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027CertifiedOwnerReplay(replayed.value, options);
}
