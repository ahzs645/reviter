import type { NeutralFaceMesh } from "./brep-tessellator.ts";
import {
  tessellateRevit2027ConeApexSectors,
  type Revit2027ConeApexSectorEdge,
} from "./revit-2027-cone-apex-sector.ts";
import {
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
  type Revit2027EdgeLoopWithChainEnvelopesStatic,
} from "./revit-2027-edge-loop-static.ts";
import {
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  revit2027GEdgeLoopDirection,
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
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027ConeSurface,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;

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

function spanValue<T>(span: Revit2027GRepReplaySpan): T {
  return span.value as T;
}

function faceMaterialId(
  faceToken: number,
  face: Revit2027FaceStatic,
  options: Revit2027ConeOwnerMeshOptions,
  issues: Revit2027ConeOwnerMeshIssue[],
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
    issues.push({
      code: "material-unresolved",
      faceToken,
      detail: `${binding.renderStyleElementId}: ${binding.reason}`,
    });
  }
  return null;
}

function faceUv(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): readonly [number, number] {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function sameConePoint(
  left: readonly [number, number],
  right: readonly [number, number],
  tolerance: number,
): boolean {
  return (
    Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance ||
    (
      Math.abs(left[1]) <= tolerance &&
      Math.abs(right[1]) <= tolerance
    )
  );
}

function sameUv(
  left: readonly [number, number],
  right: readonly [number, number],
  tolerance: number,
): boolean {
  return Math.hypot(left[0] - right[0], left[1] - right[1]) <= tolerance;
}

function edgeSide(
  edge: Revit2027GEdgeStatic,
  faceToken: number,
): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  return first === second ? null : first ? 0 : 1;
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edges: DirectedEdge[] }
  | { ok: false; issue: Revit2027ConeOwnerMeshIssue } {
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
    ordered.push({
      token: edgeToken,
      edge,
      side,
      direction: revit2027GEdgeLoopDirection(edge, side),
    });
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
    ordered.length < 2 ||
    ordered.at(-1)?.token !== loop.loop.previousEdgeReference ||
    ordered[0]?.edge.previousReferences[ordered[0].side] !== loop.token
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

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[(index + 1) % ordered.length]!;
    const currentEnd: 0 | 1 = current.direction === 1 ? 1 : 0;
    const nextStart: 0 | 1 = next.direction === 1 ? 0 : 1;
    const continuous = sameConePoint(
      faceUv(current.edge.firstAndLastEdgePoints[currentEnd], current.side),
      faceUv(next.edge.firstAndLastEdgePoints[nextStart], next.side),
      tolerance,
    );
    if (!continuous) {
      return {
        ok: false,
        issue: {
          code: "uv-link-unresolved",
          faceToken,
          loopToken: loop.token,
          edgeToken: current.token,
          detail: "native directed cone endpoints do not coincide",
        },
      };
    }
  }
  return { ok: true, edges: ordered };
}

function sampledEdge(edge: DirectedEdge): Revit2027ConeApexSectorEdge {
  const samples = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) =>
      faceUv(point, edge.side)
    ),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return {
    edgeToken: edge.token,
    samples: edge.direction === 1 ? samples : samples.reverse(),
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
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }

  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
  const conesByFace = new Map<number, Revit2027ConeSurface>();
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
    } else if (
      span.propertySourceClassSlot ===
        REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT &&
      span.parentReplayIndex != null
    ) {
      const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
      if (faceToken != null) {
        conesByFace.set(faceToken, spanValue<Revit2027ConeSurface>(span));
      }
    }
  }

  const issues: Revit2027ConeOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027ConeOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-cone-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = conesByFace.get(faceToken);
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
        materialId: faceMaterialId(faceToken, face, options, issues),
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

/** Complete one browser replay and mesh its exact Cone apex-sector subset. */
export function replayAndMeshRevit2027ConeApexSectorOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027ConeOwnerMeshOptions = {},
): Revit2027ConeOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (replayed.ok === false) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027ConeApexSectorReplay(replayed.value, options);
}
