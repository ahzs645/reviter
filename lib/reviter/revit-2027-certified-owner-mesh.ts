import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import {
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
import {
  meshRevit2027RuledHelixReplay,
  type Revit2027RuledHelixOwnerMeshIssue,
} from "./revit-2027-ruled-helix-owner-mesh.ts";
import {
  meshRevit2027HermiteReplay,
  type Revit2027HermiteOwnerMeshIssue,
} from "./revit-2027-hermite-owner-mesh.ts";

export type Revit2027CertifiedOwnerFaceMesh =
  | {
      kind: "planar-sampled";
      faceToken: number;
      loopToken: number;
      loopTokens: readonly number[];
      regionCount: number;
      holeLoopCount: number;
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
      bridgedJoinCount: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "cone-apex-sector";
      faceToken: number;
      loopToken: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "ruled-helix";
      faceToken: number;
      loopToken: number;
      profileTokens: readonly [number, number];
      uSegments: number;
      vSegments: number;
      mesh: NeutralFaceMesh;
    }
  | {
      kind: "hermite-sampled";
      faceToken: number;
      loopToken: number;
      uSegments: number;
      vSegments: number;
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
    }
  | {
      path: "ruled-helix";
      issue: Revit2027RuledHelixOwnerMeshIssue;
    }
  | {
      path: "hermite-sampled";
      issue: Revit2027HermiteOwnerMeshIssue;
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

/** Tag one path's face meshes with the certified kind that produced them. */
function tagged<Kind extends string, Face>(
  kind: Kind,
  faces: readonly Face[],
): ({ kind: Kind } & Face)[] {
  return faces.map((face) => ({ kind, ...face }));
}

/** Tag one path's issues with the certified path that reported them. */
function pathed<Path extends string, Issue>(
  path: Path,
  issues: readonly Issue[],
): { path: Path; issue: Issue }[] {
  return issues.map((issue) => ({ path, issue }));
}

/**
 * Convert every independently certified face subset in one completed Revit
 * 2027 replay. Unsupported faces remain structured issues from their owning
 * path and never produce partial geometry.
 *
 * Each path indexes the replay through the shared owner mesh index, which is
 * memoized per replay, so running all six here walks `replay.spans` once.
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
  const ruledHelix = meshRevit2027RuledHelixReplay(replay, shared);
  if (ruledHelix.ok === false) return ruledHelix;
  const hermite = meshRevit2027HermiteReplay(replay, shared);
  if (hermite.ok === false) return hermite;
  // A curved face is not a planar failure. Each path reports independently,
  // so the planar path cannot know a curved path already claimed the face and
  // its `unsupported-surface` note is dropped only for the faces that were.
  const certifiedCurvedFaceTokens = new Set(
    [
      ...surfRev.value.faceMeshes,
      ...cylinder.value.faceMeshes,
      ...cone.value.faceMeshes,
      ...ruledHelix.value.faceMeshes,
      ...hermite.value.faceMeshes,
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
        ...tagged("planar-sampled", planar.value.faceMeshes),
        ...tagged("arc-surfrev", surfRev.value.faceMeshes),
        ...tagged("cylinder-sampled", cylinder.value.faceMeshes),
        ...tagged("cone-apex-sector", cone.value.faceMeshes),
        ...tagged("ruled-helix", ruledHelix.value.faceMeshes),
        ...tagged("hermite-sampled", hermite.value.faceMeshes),
      ],
      issues: [
        ...pathed("planar-sampled", planarIssues),
        ...pathed("arc-surfrev", surfRev.value.issues),
        ...pathed("cylinder-sampled", cylinder.value.issues),
        ...pathed("cone-apex-sector", cone.value.issues),
        ...pathed("ruled-helix", ruledHelix.value.issues),
        ...pathed("hermite-sampled", hermite.value.issues),
      ],
    },
  };
}
