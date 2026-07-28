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
  type Revit2027GEdgeStatic,
} from "./revit-2027-edge-1423.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  type Revit2027FaceStatic,
} from "./revit-2027-face-static.ts";
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
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027PlaneSurface,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;

export type Revit2027PlanarOwnerMeshIssueCode =
  | "replay-failed"
  | "invalid-options"
  | "missing-face-token"
  | "surface-unresolved"
  | "unsupported-surface"
  | "loop-unresolved"
  | "multi-loop"
  | "loop-face-mismatch"
  | "edge-unresolved"
  | "edge-face-mismatch"
  | "edge-cycle"
  | "edge-link-mismatch"
  | "uv-link-unresolved"
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

function value<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
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

function directedEdgeUses(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edgeUses: Revit2027PlanarSampledEdgeUse[] }
  | {
      ok: false;
      issue: Revit2027PlanarOwnerMeshIssue;
    } {
  const ordered: Array<{
    token: number;
    edge: Revit2027GEdgeStatic;
    side: 0 | 1;
  }> = [];
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
    token = edge.nextReferences[side];
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
    ordered[0]!.edge.previousReferences[ordered[0]!.side] !== loop.token
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

  const links: UvMatch[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const candidates = matches(
      current.edge,
      current.side,
      next.edge,
      next.side,
      tolerance,
    );
    if (candidates.length !== 1) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: current.token,
          detail: `candidate endpoint matches: ${candidates.length}`,
        },
      };
    }
    links.push(candidates[0]!);
  }

  const edgeUses: Revit2027PlanarSampledEdgeUse[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const incoming = links[(index + links.length - 1) % links.length]!;
    const outgoing = links[index]!;
    if (incoming.nextEndpoint === outgoing.currentEndpoint) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: ordered[index]!.token,
          detail: "one persisted endpoint would be both incoming and outgoing",
        },
      };
    }
    edgeUses.push({
      edgeToken: ordered[index]!.token,
      edge: ordered[index]!.edge,
      faceSide: ordered[index]!.side,
      direction: incoming.nextEndpoint === 0 ? 1 : -1,
    });
  }
  return { ok: true, edgeUses };
}

/**
 * Convert all independently safe single-loop planar Faces in one completed
 * Revit 2027 replay into browser mesh objects.
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
    const directed = directedEdgeUses(
      faceToken,
      loop,
      edges,
      tolerance,
    );
    if (!directed.ok) {
      issues.push(directed.issue);
      continue;
    }
    const adapted = adaptRevit2027PlanarSampledBrep({
      id: `revit-2027-owner-${replay.ownerElementId}-face-${faceToken}`,
      provenance,
      continuityTolerance: tolerance,
      faces: [{
        faceToken,
        surface,
        loops: [{
          loopToken: loop.token,
          role: "outer",
          edgeUses: directed.edgeUses,
        }],
        materialId: options.materialForFace?.(faceToken, face) ?? null,
        provenance,
      }],
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
