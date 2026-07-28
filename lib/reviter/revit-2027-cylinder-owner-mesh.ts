import {
  tessellateNeutralBrep,
  type NeutralFaceMesh,
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
  replayRevit2027GRepFifo,
  type Revit2027GRepReplay,
  type Revit2027GRepReplayOptions,
  type Revit2027GRepReplayRegistry,
  type Revit2027GRepReplaySpan,
} from "./revit-2027-grep-replay.ts";
import {
  adaptRevit2027CylinderSampledBrep,
  type Revit2027CylinderSampledEdgeUse,
} from "./revit-2027-cylinder-sampled-brep.ts";
import {
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  type Revit2027CylinderSurface,
} from "./revit-2027-surfaces.ts";

const DEFAULT_UV_TOLERANCE = 1e-9;

export type Revit2027CylinderOwnerMeshIssueCode =
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
  | "non-rectangular-trim"
  | "opposite-sampling-mismatch"
  | "wrapping-chart"
  | "multi-segment-axial-policy-not-bound"
  | "material-unresolved"
  | "adapter-rejected"
  | "tessellator-rejected";

export type Revit2027CylinderOwnerMeshIssue = {
  code: Revit2027CylinderOwnerMeshIssueCode;
  faceToken?: number;
  loopToken?: number;
  edgeToken?: number;
  detail?: string;
};

export type Revit2027CylinderOwnerFaceMesh = {
  faceToken: number;
  loopToken: number;
  angularSegments: number;
  axialSegments: number;
  mesh: NeutralFaceMesh;
};

export type Revit2027CylinderOwnerMesh = {
  ownerElementId: bigint;
  replay: Revit2027GRepReplay;
  faceMeshes: readonly Revit2027CylinderOwnerFaceMesh[];
  issues: readonly Revit2027CylinderOwnerMeshIssue[];
};

export type Revit2027CylinderOwnerMeshResult =
  | { ok: true; value: Revit2027CylinderOwnerMesh }
  | { ok: false; error: string };

export type Revit2027CylinderOwnerMeshOptions = {
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
  options: Revit2027CylinderOwnerMeshOptions,
  issues: Revit2027CylinderOwnerMeshIssue[],
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

function distance(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
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
  const matches: Array<readonly [0 | 1, 0 | 1]> = [];
  for (const currentEndpoint of [0, 1] as const) {
    for (const nextEndpoint of [0, 1] as const) {
      if (
        distance(
          faceUv(
            current.edge.firstAndLastEdgePoints[currentEndpoint],
            current.side,
          ),
          faceUv(
            next.edge.firstAndLastEdgePoints[nextEndpoint],
            next.side,
          ),
        ) <= tolerance
      ) {
        matches.push([currentEndpoint, nextEndpoint]);
      }
    }
  }
  return matches;
}

function directedLoopEdges(
  faceToken: number,
  loop: LoopRecord,
  edges: ReadonlyMap<number, Revit2027GEdgeStatic>,
  tolerance: number,
):
  | { ok: true; edges: DirectedEdge[] }
  | { ok: false; issue: Revit2027CylinderOwnerMeshIssue } {
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

function directedUvs(
  edge: DirectedEdge,
): readonly (readonly [number, number])[] {
  const points = [
    faceUv(edge.edge.firstAndLastEdgePoints[0], edge.side),
    ...edge.edge.interiorEdgePoints.map((point) =>
      faceUv(point, edge.side)
    ),
    faceUv(edge.edge.firstAndLastEdgePoints[1], edge.side),
  ];
  return edge.direction === 1 ? points : points.reverse();
}

function envelopeMatches(
  loop: Revit2027EdgeLoopStatic["envelope"],
  surface: Revit2027CylinderSurface["surface"]["envelope"],
  tolerance: number,
): boolean {
  return (
    distance(loop.minimum, surface.firstCorner) <= tolerance &&
    distance(loop.maximum, surface.secondCorner) <= tolerance
  );
}

function classifyRectangle(
  edges: readonly DirectedEdge[],
  minimum: readonly [number, number],
  maximum: readonly [number, number],
  tolerance: number,
):
  | {
      ok: true;
      angularSegments: number;
      axialSegments: number;
      edgeUses: Revit2027CylinderSampledEdgeUse[];
    }
  | {
      ok: false;
      code: "non-rectangular-trim" | "opposite-sampling-mismatch";
      edgeToken?: number;
      detail?: string;
    } {
  if (edges.length !== 4) {
    return {
      ok: false,
      code: "non-rectangular-trim",
      detail: `edge count: ${edges.length}`,
    };
  }
  const sideCounts = new Map<Boundary, number>();
  for (const edge of edges) {
    const points = directedUvs(edge);
    const allNear = (axis: 0 | 1, value: number): boolean =>
      points.every((point) => Math.abs(point[axis] - value) <= tolerance);
    const boundary: Boundary | null =
      allNear(0, minimum[0])
        ? "u-min"
        : allNear(0, maximum[0])
          ? "u-max"
          : allNear(1, minimum[1])
            ? "v-min"
            : allNear(1, maximum[1])
              ? "v-max"
              : null;
    if (boundary == null || sideCounts.has(boundary)) {
      return {
        ok: false,
        code: "non-rectangular-trim",
        edgeToken: edge.token,
      };
    }
    sideCounts.set(boundary, points.length - 1);
  }
  if (sideCounts.size !== 4) {
    return { ok: false, code: "non-rectangular-trim" };
  }
  if (
    sideCounts.get("u-min") !== sideCounts.get("u-max") ||
    sideCounts.get("v-min") !== sideCounts.get("v-max")
  ) {
    return { ok: false, code: "opposite-sampling-mismatch" };
  }
  return {
    ok: true,
    angularSegments: sideCounts.get("v-min")!,
    axialSegments: sideCounts.get("u-min")!,
    edgeUses: edges.map((edge) => ({
      edgeToken: edge.token,
      edge: edge.edge,
      faceSide: edge.side,
      direction: edge.direction,
    })),
  };
}

/**
 * Convert the independently certified rectangular Cylinder subset in one
 * already completed browser replay. The persisted GEdge sampling selects the
 * angular grid; unsupported seams and axial subdivision fail closed.
 */
export function meshRevit2027CylinderSampledReplay(
  replay: Revit2027GRepReplay,
  options: Revit2027CylinderOwnerMeshOptions = {},
): Revit2027CylinderOwnerMeshResult {
  const tolerance = options.uvTolerance ?? DEFAULT_UV_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, error: "uvTolerance must be positive and finite" };
  }

  const faces = new Map<number, Revit2027FaceStatic>();
  const faceTokenByReplayIndex = new Map<number, number>();
  const edges = new Map<number, Revit2027GEdgeStatic>();
  const loops = new Map<number, LoopRecord>();
  const cylindersByFace = new Map<number, Revit2027CylinderSurface>();
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
        REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT &&
      span.parentReplayIndex != null
    ) {
      const faceToken = faceTokenByReplayIndex.get(span.parentReplayIndex);
      if (faceToken != null) {
        cylindersByFace.set(
          faceToken,
          spanValue<Revit2027CylinderSurface>(span),
        );
      }
    }
  }

  const issues: Revit2027CylinderOwnerMeshIssue[] = [];
  const faceMeshes: Revit2027CylinderOwnerFaceMesh[] = [];
  const elementId = Number(replay.ownerElementId);
  const provenance = {
    decoderId: "revit-2027-cylinder-owner-mesh",
    elementId: Number.isSafeInteger(elementId) ? elementId : undefined,
  };
  for (const [faceToken, face] of faces) {
    if (
      face.surface.sourceClassSlot !==
      REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    const surface = cylindersByFace.get(faceToken);
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
    const rectangle = classifyRectangle(
      directed.edges,
      loop.loop.envelope.minimum,
      loop.loop.envelope.maximum,
      tolerance,
    );
    if (rectangle.ok === false) {
      issues.push({
        code: rectangle.code,
        faceToken,
        loopToken: loop.token,
        edgeToken: rectangle.edgeToken,
        detail: rectangle.detail,
      });
      continue;
    }
    const angularSpan = Math.abs(
      surface.surface.envelope.secondCorner[0] -
      surface.surface.envelope.firstCorner[0],
    );
    if (angularSpan >= Math.PI * 2 - tolerance) {
      issues.push({
        code: "wrapping-chart",
        faceToken,
        loopToken: loop.token,
      });
      continue;
    }
    if (rectangle.axialSegments !== 1) {
      issues.push({
        code: "multi-segment-axial-policy-not-bound",
        faceToken,
        loopToken: loop.token,
        detail: `axial segments: ${rectangle.axialSegments}`,
      });
      continue;
    }
    const adapted = adaptRevit2027CylinderSampledBrep({
      id: `revit-2027-owner-${replay.ownerElementId}-face-${faceToken}`,
      provenance,
      continuityTolerance: tolerance,
      faces: [{
        faceToken,
        surface,
        loops: [{
          loopToken: loop.token,
          role: "outer",
          edgeUses: rectangle.edgeUses,
        }],
        materialId: faceMaterialId(faceToken, face, options, issues),
        provenance,
      }],
    });
    if (adapted.ok === false) {
      issues.push(...adapted.issues.map((issue) => ({
        code: "adapter-rejected" as const,
        faceToken,
        loopToken: issue.loopToken,
        edgeToken: issue.edgeToken,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }

    // The persisted side samples bind the grid used by this certified path.
    // This is not a claim that the native renderer's global LOD was persisted.
    const maximumAngleDegrees =
      (angularSpan / rectangle.angularSegments) *
      (180 / Math.PI) *
      (1 + 1e-12);
    const tessellated = tessellateNeutralBrep(adapted.brep, {
      distanceTolerance: 1e-10,
      angularTolerance: tolerance,
      nativePolicy: {
        maximumEdgeLength: 0,
        maximumAngleDegrees,
        surfaceDeviation: 0,
      },
    });
    if (tessellated.ok === false) {
      issues.push(...tessellated.issues.map((issue) => ({
        code: (
          issue.code === "wrapping-cylinder-chart"
            ? "wrapping-chart"
            : "tessellator-rejected"
        ) as Revit2027CylinderOwnerMeshIssueCode,
        faceToken,
        loopToken: loop.token,
        detail: `${issue.code}: ${issue.message}`,
      })));
      continue;
    }
    faceMeshes.push({
      faceToken,
      loopToken: loop.token,
      angularSegments: rectangle.angularSegments,
      axialSegments: rectangle.axialSegments,
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

/** Complete one browser replay and mesh its certified Cylinder subset. */
export function replayAndMeshRevit2027CylinderSampledOwner(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  options: Revit2027CylinderOwnerMeshOptions = {},
): Revit2027CylinderOwnerMeshResult {
  const replayed = replayRevit2027GRepFifo(
    data,
    root,
    options.replayRegistry,
    options.replayOptions,
  );
  if (replayed.ok === false) {
    return { ok: false, error: `Revit 2027 replay failed: ${replayed.error}` };
  }
  return meshRevit2027CylinderSampledReplay(replayed.value, options);
}
