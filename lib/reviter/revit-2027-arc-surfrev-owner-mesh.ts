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
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  tessellateRevit2027ArcSurfRev,
} from "./revit-2027-arc-surfrev.ts";
import {
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027SurfaceOfRevolution,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

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

type LoopRecord = {
  token: number;
  loop: Revit2027EdgeLoopStatic;
};

type DirectedEdge = {
  token: number;
  edge: Revit2027GEdgeStatic;
  side: 0 | 1;
  direction: 1 | -1;
};

type Boundary = "u-min" | "u-max" | "v-min" | "v-max";

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027ArcSurfRevOwnerMeshOptions,
  issues: Revit2027ArcSurfRevOwnerMeshIssue[],
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
      detail: `${binding.renderStyleElementId}: ${binding.reason}`,
    });
  }
  return null;
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function sameUv(
  left: readonly [number, number],
  right: readonly [number, number],
  tolerance: number,
): boolean {
  return near(left[0], right[0], tolerance) &&
    near(left[1], right[1], tolerance);
}

function faceUv(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): readonly [number, number] {
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

function endpointMatches(
  current: DirectedEdge,
  next: DirectedEdge,
  tolerance: number,
): Array<readonly [0 | 1, 0 | 1]> {
  const result: Array<readonly [0 | 1, 0 | 1]> = [];
  for (const currentEndpoint of [0, 1] as const) {
    for (const nextEndpoint of [0, 1] as const) {
      if (
        sameUv(
          faceUv(
            current.edge.firstAndLastEdgePoints[currentEndpoint],
            current.side,
          ),
          faceUv(
            next.edge.firstAndLastEdgePoints[nextEndpoint],
            next.side,
          ),
          tolerance,
        )
      ) {
        result.push([currentEndpoint, nextEndpoint]);
      }
    }
  }
  return result;
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edges: DirectedEdge[] }
  | { ok: false; issue: Revit2027ArcSurfRevOwnerMeshIssue } {
  const ordered: DirectedEdge[] = [];
  const visited = new Set<number>();
  let edgeToken = loop.loop.nextEdgeReference;
  while (edgeToken !== loop.token) {
    if (edgeToken <= 0 || visited.has(edgeToken)) {
      return {
        ok: false,
        issue: {
          code: "edge-cycle",
          faceToken,
          loopToken: loop.token,
          edgeToken,
        },
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
    ordered.push({ token: edgeToken, edge, side, direction: 1 });
    edgeToken = edge.nextReferences[side];
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
    ordered.length !== 4 ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    ordered[0]?.edge.previousReferences[ordered[0].side] !== loop.token
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

  const links: Array<readonly [0 | 1, 0 | 1]> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const matches = endpointMatches(
      ordered[index]!,
      ordered[(index + 1) % ordered.length]!,
      tolerance,
    );
    if (matches.length !== 1) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: ordered[index]!.token,
          detail: `candidate endpoint matches: ${matches.length}`,
        },
      };
    }
    links.push(matches[0]!);
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const incoming = links[(index + links.length - 1) % links.length]!;
    const outgoing = links[index]!;
    if (incoming[1] === outgoing[0]) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: ordered[index]!.token,
          detail: "one endpoint is both incoming and outgoing",
        },
      };
    }
    ordered[index]!.direction =
      incoming[1] === 0 && outgoing[0] === 1 ? 1 : -1;
  }
  return { ok: true, edges: ordered };
}

function directedUvs(edge: DirectedEdge): readonly (readonly [number, number])[] {
  const points = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) => faceUv(point, edge.side)),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

function boundaryFor(
  points: readonly (readonly [number, number])[],
  minimum: readonly [number, number],
  maximum: readonly [number, number],
  tolerance: number,
): Boundary | null {
  if (points.length < 2) return null;
  const candidates: Array<{
    boundary: Boundary;
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
          !near(point[candidate.fixedAxis], candidate.fixedValue, tolerance) ||
          point[candidate.varyingAxis] < minimum[candidate.varyingAxis] - tolerance ||
          point[candidate.varyingAxis] > maximum[candidate.varyingAxis] + tolerance,
      )
    ) {
      return false;
    }
    const values = points.map((point) => point[candidate.varyingAxis]);
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
    return near(Math.min(...values), minimum[candidate.varyingAxis], tolerance) &&
      near(Math.max(...values), maximum[candidate.varyingAxis], tolerance);
  });
  return matches.length === 1 ? matches[0]!.boundary : null;
}

function envelopeMatches(
  left: Revit2027EdgeLoopStatic["envelope"],
  right: Revit2027SurfaceOfRevolution["surface"]["envelope"],
  tolerance: number,
): boolean {
  return sameUv(left.minimum, right.firstCorner, tolerance) &&
    sameUv(left.maximum, right.secondCorner, tolerance);
}

function neutralMesh(
  ownerElementId: bigint,
  faceToken: number,
  materialId: string | number | null,
  source: ReturnType<typeof tessellateRevit2027ArcSurfRev> & { ok: true },
): NeutralFaceMesh {
  const elementId = Number(ownerElementId);
  const provenance: BrepProvenance = {
    decoderId: "revit-2027-arc-surfrev-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  const faceId = `revit-2027-owner-${ownerElementId}-face-${faceToken}`;
  const group: NeutralMeshFaceGroup = {
    faceId,
    indexOffset: 0,
    indexCount: source.mesh.indices.length,
    vertexOffset: 0,
    vertexCount: source.mesh.positions.length / 3,
    materialId,
    sourceTransform: IDENTITY,
    brepProvenance: provenance,
    faceProvenance: provenance,
  };
  return {
    brepId: `revit-2027-owner-${ownerElementId}-surfrev`,
    positions: source.mesh.positions,
    normals: Float32Array.from(source.mesh.normals),
    indices: source.mesh.indices,
    groups: [group],
  };
}

/**
 * Mesh every independently certified circular-profile, rectangular-trimmed
 * SurfRev face in one already completed browser replay.
 */
export function meshRevit2027ArcSurfRevReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027ArcSurfRevOwnerMeshOptions = {},
): Revit2027ArcSurfRevOwnerMeshResult {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }

  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
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
    }
  }

  const surfaces = new Map<number, {
    replayIndex: number;
    value: Revit2027SurfaceOfRevolution;
  }>();
  const faceTokenBySurfaceReplayIndex = new Map<number, number>();
  for (const span of replay.spans) {
    if (
      span.propertySourceClassSlot !==
        REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT ||
      span.parentReplayIndex == null
    ) {
      continue;
    }
    const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
    if (faceToken == null) continue;
    surfaces.set(faceToken, {
      replayIndex: span.replayIndex,
      value: spanValue<Revit2027SurfaceOfRevolution>(span),
    });
    faceTokenBySurfaceReplayIndex.set(span.replayIndex, faceToken);
  }

  const profiles = new Map<number, {
    token: number;
    value: Revit2027GArc;
  }>();
  for (const span of replay.spans) {
    if (
      span.propertySourceClassSlot !== REVIT_2027_GARC_SOURCE_CLASS_SLOT ||
      span.parentReplayIndex == null
    ) {
      continue;
    }
    const faceToken = faceTokenBySurfaceReplayIndex.get(span.parentReplayIndex);
    if (faceToken != null) {
      profiles.set(faceToken, {
        token: span.propertyToken,
        value: spanValue<Revit2027GArc>(span),
      });
    }
  }

  const issues: Revit2027ArcSurfRevOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027ArcSurfRevOwnerFaceMesh[] = [];
  for (const [faceToken, face] of faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = surfaces.get(faceToken)?.value;
    if (!surface) {
      issues.push({ code: "surface-unresolved", faceToken });
      continue;
    }
    const profile = profiles.get(faceToken);
    if (!profile) {
      issues.push({ code: "profile-unresolved", faceToken });
      continue;
    }
    if (face.firstLoop.token <= 0) {
      issues.push({ code: "loop-unresolved", faceToken });
      continue;
    }
    const loop = loops.get(face.firstLoop.token);
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
    if (!envelopeMatches(loop.loop.envelope, surface.surface.envelope, tolerance)) {
      issues.push({
        code: "loop-envelope-mismatch",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    const directed = directedLoopEdges(faceToken, loop, edges, tolerance);
    if (directed.ok === false) {
      issues.push(directed.issue);
      continue;
    }
    const byBoundary = new Map<Boundary, DirectedEdge>();
    const segmentCounts = new Map<Boundary, number>();
    let boundaryFailure: DirectedEdge | null = null;
    for (const edge of directed.edges) {
      const points = directedUvs(edge);
      const boundary = boundaryFor(
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
      profile: profile.value,
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
      mesh: neutralMesh(
        replay.ownerElementId,
        faceToken,
        faceMaterialId(faceToken, face, options, issues),
        tessellated,
      ),
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
