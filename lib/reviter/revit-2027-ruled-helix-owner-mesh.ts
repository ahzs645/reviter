import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import type { Revit2027FaceStatic } from "./revit-2027-face-static.ts";
import type { Revit2027MaterialDefinitions } from "./revit-2027-face-material.ts";
import type { Revit2027GCylindricalHelix } from "./revit-2027-gcylindrical-helix.ts";
import type { Revit2027GLine } from "./revit-2027-gline.ts";
import {
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
} from "./revit-2027-grep-replay.ts";
import {
  revit2027OwnerCurves,
  revit2027OwnerMeshIndex,
  revit2027OwnerSurface,
} from "./revit-2027-owner-mesh-index.ts";
import {
  addPoints,
  mixPoints,
  revit2027TensorGridFaceMesh,
  samePoint3,
  scalePoint,
  subtractPoints,
  type Revit2027Point3,
} from "./revit-2027-owner-mesh-grid.ts";
import {
  linkRevit2027DirectedLoopEndpoints,
  nearlyEqual,
  revit2027DirectedEdgeUvs,
  revit2027OwnerFaceMaterialId,
  revit2027OwnerUvTolerance,
  revit2027TrimBoundaryFor,
  REVIT_2027_DEFAULT_UV_TOLERANCE,
  sameUv,
  walkRevit2027DirectedLoopEdges,
  type Revit2027DirectedEdge,
  type Revit2027FaceUv,
  type Revit2027TrimBoundary,
} from "./revit-2027-owner-mesh-trim.ts";
import {
  REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027RuledSurface,
} from "./revit-2027-surfaces.ts";

type RuledProfile = Revit2027GCylindricalHelix | Revit2027GLine;

export type Revit2027RuledHelixOwnerMeshIssueCode =
  | "surface-unresolved"
  | "profile-unresolved"
  | "profile-mismatch"
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

export type Revit2027RuledHelixOwnerMeshIssue = {
  code: Revit2027RuledHelixOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027RuledHelixOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  profileTokens: readonly [number, number];
  profileKinds: readonly ["helix" | "line", "helix" | "line"];
  uSegments: number;
  vSegments: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027RuledHelixOwnerMeshResult =
  | {
      ok: true;
      value: {
        ownerElementId: bigint;
        replay: Revit2027GRepReplay;
        faceMeshes: readonly Revit2027RuledHelixOwnerFaceMesh[];
        issues: readonly Revit2027RuledHelixOwnerMeshIssue[];
      };
    }
  | { ok: false; error: string };

export type Revit2027RuledHelixOwnerMeshOptions = {
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
 * Merge two independently persisted samplings of opposite trim edges.
 *
 * Revit may write only the endpoints on a straight/coarse side and a dense
 * parameter sequence on the opposite curved side. The rectangular surface is
 * still exact: the ordered union preserves every persisted sample on both
 * boundaries and supplies a shared tensor-product grid without inventing a
 * sampling density.
 */
export function mergeRevit2027OppositeBoundarySamples(
  first: readonly number[],
  second: readonly number[],
  minimum: number,
  maximum: number,
  tolerance = REVIT_2027_DEFAULT_UV_TOLERANCE,
): number[] | null {
  if (
    first.length < 2 ||
    second.length < 2 ||
    ![...first, ...second, minimum, maximum, tolerance].every(Number.isFinite) ||
    !(maximum > minimum) ||
    tolerance < 0
  ) {
    return null;
  }
  const values = [...first, ...second].sort((left, right) => left - right);
  if (
    values[0]! < minimum - tolerance ||
    values.at(-1)! > maximum + tolerance ||
    !nearlyEqual(values[0]!, minimum, tolerance) ||
    !nearlyEqual(values.at(-1)!, maximum, tolerance)
  ) {
    return null;
  }
  const merged: number[] = [];
  for (const value of values) {
    const clamped = nearlyEqual(value, minimum, tolerance)
      ? minimum
      : nearlyEqual(value, maximum, tolerance)
      ? maximum
      : value;
    if (
      merged.length === 0 ||
      !nearlyEqual(clamped, merged.at(-1)!, tolerance)
    ) {
      merged.push(clamped);
    }
  }
  return merged.length >= 2 && merged.length <= 513 ? merged : null;
}

function compatibleProfiles(
  first: RuledProfile,
  second: RuledProfile,
  tolerance: number,
): boolean {
  if ("pitchOver2Pi" in first && "pitchOver2Pi" in second) {
    return sameUv(first.endParameters, second.endParameters, tolerance) &&
      nearlyEqual(first.pitchOver2Pi, second.pitchOver2Pi, tolerance) &&
      samePoint3(first.xVector, second.xVector, tolerance) &&
      samePoint3(first.yVector, second.yVector, tolerance) &&
      samePoint3(first.zVector, second.zVector, tolerance);
  }
  if ("direction" in first && "direction" in second) {
    const firstSpan = first.endParameters[1] - first.endParameters[0];
    const secondSpan = second.endParameters[1] - second.endParameters[0];
    return Math.abs(firstSpan) > tolerance &&
      Math.abs(secondSpan) > tolerance;
  }
  return false;
}

function evaluateHelix(
  helix: Revit2027GCylindricalHelix,
  parameter: number,
): Revit2027Point3 {
  return addPoints(
    helix.basePoint,
    addPoints(
      scalePoint(
        addPoints(
          scalePoint(helix.xVector, Math.cos(parameter)),
          scalePoint(helix.yVector, Math.sin(parameter)),
        ),
        helix.radius,
      ),
      scalePoint(helix.zVector, helix.pitchOver2Pi * parameter),
    ),
  );
}

function helixDerivative(
  helix: Revit2027GCylindricalHelix,
  parameter: number,
): Revit2027Point3 {
  return addPoints(
    scalePoint(
      addPoints(
        scalePoint(helix.xVector, -Math.sin(parameter)),
        scalePoint(helix.yVector, Math.cos(parameter)),
      ),
      helix.radius,
    ),
    scalePoint(helix.zVector, helix.pitchOver2Pi),
  );
}

function evaluateProfile(
  profile: RuledProfile,
  fraction: number,
): Revit2027Point3 {
  const [minimum, maximum] = profile.endParameters;
  const parameter = minimum + (maximum - minimum) * fraction;
  return "pitchOver2Pi" in profile
    ? evaluateHelix(profile, parameter)
    : addPoints(profile.origin, scalePoint(profile.direction, parameter));
}

function profileFractionDerivative(
  profile: RuledProfile,
  fraction: number,
): Revit2027Point3 {
  const [minimum, maximum] = profile.endParameters;
  const parameter = minimum + (maximum - minimum) * fraction;
  const derivative = "pitchOver2Pi" in profile
    ? helixDerivative(profile, parameter)
    : profile.direction;
  return scalePoint(derivative, maximum - minimum);
}

function profileKind(profile: RuledProfile): "helix" | "line" {
  return "pitchOver2Pi" in profile ? "helix" : "line";
}

/**
 * Mesh the exact rectangular RuledSurf subset whose two persisted profiles
 * are a compatible pair of GCylindricalHelix or GLine curves. Persisted edge
 * samples select the grid, so this path does not invent a display LOD.
 */
export function meshRevit2027RuledHelixReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027RuledHelixOwnerMeshOptions = {},
): Revit2027RuledHelixOwnerMeshResult {
  const resolved = revit2027OwnerUvTolerance(options.uvTolerance);
  if (!resolved.ok) return resolved;
  const tolerance = resolved.tolerance;

  const index = revit2027OwnerMeshIndex(replay);
  const issues: Revit2027RuledHelixOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027RuledHelixOwnerFaceMesh[] = [];
  for (const [faceToken, face] of index.faces) {
    if (
      face.surface.sourceClassSlot !== REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = revit2027OwnerSurface<Revit2027RuledSurface>(
      index,
      REVIT_2027_RULED_SURFACE_SOURCE_CLASS_SLOT,
      faceToken,
    );
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    const profiles = revit2027OwnerCurves(index, faceToken);
    const profileFor = (token: number): RuledProfile | undefined =>
      profiles.findLast((curve) => curve.token === token)?.value as
        | RuledProfile
        | undefined;
    const first = profileFor(surface.profileCurve1.token);
    const second = profileFor(surface.profileCurve2.token);
    if (!first || !second) {
      issues.push({ code: "profile-unresolved", faceToken });
      continue;
    }
    if (!compatibleProfiles(first, second, tolerance)) {
      issues.push({ code: "profile-mismatch", faceToken });
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
        surface.surface.envelope.firstCorner,
        tolerance,
      ) ||
      !sameUv(
        loop.loop.envelope.maximum,
        surface.surface.envelope.secondCorner,
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
    const samples = new Map<Revit2027TrimBoundary, readonly Revit2027FaceUv[]>();
    let invalidEdge: Revit2027DirectedEdge | undefined;
    for (const edge of directed.edges) {
      const uvs = revit2027DirectedEdgeUvs(edge);
      const boundary = revit2027TrimBoundaryFor(
        uvs,
        surface.surface.envelope.firstCorner,
        surface.surface.envelope.secondCorner,
        tolerance,
      );
      if (!boundary || samples.has(boundary)) {
        invalidEdge = edge;
        break;
      }
      samples.set(boundary, uvs);
    }
    if (invalidEdge || samples.size !== 4) {
      issues.push({
        code: "non-rectangular-trim",
        faceToken,
        loopToken,
        edgeToken: invalidEdge?.token,
      });
      continue;
    }
    const [minimum, maximum] = [
      surface.surface.envelope.firstCorner,
      surface.surface.envelope.secondCorner,
    ];
    const uParameters = mergeRevit2027OppositeBoundarySamples(
      samples.get("v-min")!.map((point) => point[0]),
      samples.get("v-max")!.map((point) => point[0]),
      minimum[0],
      maximum[0],
      tolerance,
    );
    const vParameters = mergeRevit2027OppositeBoundarySamples(
      samples.get("u-min")!.map((point) => point[1]),
      samples.get("u-max")!.map((point) => point[1]),
      minimum[1],
      maximum[1],
      tolerance,
    );
    if (!uParameters || !vParameters) {
      issues.push({ code: "opposite-sampling-mismatch", faceToken, loopToken });
      continue;
    }
    const materialId = revit2027OwnerFaceMaterialId(
      faceToken,
      face,
      options,
      (detail) => issues.push({ code: "material-unresolved", faceToken, detail }),
    );
    const mesh = revit2027TensorGridFaceMesh({
      ownerElementId: replay.ownerElementId,
      faceToken,
      decoderId: "revit-2027-ruled-profile-owner-mesh",
      brepSuffix: "ruled-profile",
      materialId,
      orientFlag: surface.surface.orientFlag,
      uSegments: uParameters.length - 1,
      vSegments: vParameters.length - 1,
      row: (uIndex) => {
        const u = uParameters[uIndex]!;
        const firstPoint = evaluateProfile(first, u);
        const secondPoint = evaluateProfile(second, u);
        const firstDerivative = profileFractionDerivative(first, u);
        const secondDerivative = profileFractionDerivative(second, u);
        // The ruling is straight, so its own direction is constant along v.
        const tangentV = subtractPoints(secondPoint, firstPoint);
        return (vIndex) => {
          const v = vParameters[vIndex]!;
          return {
            point: mixPoints(firstPoint, secondPoint, v),
            tangentU: mixPoints(firstDerivative, secondDerivative, v),
            tangentV,
          };
        };
      },
    });
    if (!mesh) {
      issues.push({
        code: "tessellator-rejected",
        faceToken,
        loopToken,
        detail: "Ruled helix derivative normal is degenerate",
      });
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken,
      profileTokens: [surface.profileCurve1.token, surface.profileCurve2.token],
      profileKinds: [profileKind(first), profileKind(second)],
      uSegments: uParameters.length - 1,
      vSegments: vParameters.length - 1,
      mesh,
    });
  }
  return {
    ok: true,
    value: { ownerElementId: replay.ownerElementId, replay, faceMeshes, issues },
  };
}
