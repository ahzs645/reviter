/**
 * Resolve Revit 2027 Face/GEdge/EdgeLoop references inside exact direct
 * single-Geometry FIFO scopes. For the certified single-loop planar subset it
 * maps persisted face-local GEdge samples into the neutral browser BRep and
 * triangulates them. It does not infer body widths, regenerate missing curves,
 * assign guessed materials, or fill a blocked queue frontier.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-planar-topology.ts model.rvt
 */
import {
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import { tessellatePlanarBrep } from "../lib/reviter/brep-tessellator.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  instanceCorners,
  readInstancePlacement,
  type InstancePlacement,
} from "../lib/reviter/instanced-geometry.ts";
import {
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  decodeRevit2027AnalyticSurface,
  decodeRevit2027EdgeLoopStatic,
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  decodeRevit2027FaceStatic,
  decodeRevit2027FillGrid,
  decodeRevit2027FillPatternData,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GArc,
  decodeRevit2027GEdgeStatic,
  decodeRevit2027GFilling,
  decodeRevit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027AnalyticSurface,
  Revit2027EdgeLoopStatic,
  Revit2027FaceStatic,
  Revit2027GEdgeStatic,
} from "./lib/revit-2027-decoders.ts";
import {
  adaptRevit2027PlanarSampledBrep,
  type Revit2027PlanarSampledEdgeUse,
} from "../lib/reviter/revit-2027-planar-sampled-brep.ts";
const MAX_OWNER_QUEUE = 1_000_000;
const UV_TOLERANCE = 1e-9;
const SURFACE_SLOTS = new Set([
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
]);

type QueueRole =
  | "geometry-face"
  | "geometry-edge"
  | "geometry-shared-surface"
  | "face-first-loop"
  | "face-region"
  | "face-foreground-filling"
  | "face-background-filling"
  | "face-surface"
  | "loop-next"
  | "filling-data"
  | "fill-grid"
  | "surface-curve";

type QueueItem = {
  entry: CondInt16QueueEntry;
  role: QueueRole;
  faceToken: number | null;
  parentToken: number | null;
};

type FaceRecord = {
  token: number;
  value: Revit2027FaceStatic;
};

type EdgeRecord = {
  token: number;
  value: Revit2027GEdgeStatic;
};

type LoopRecord = {
  token: number;
  sourceClassSlot:
    | typeof REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
    | typeof REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT;
  faceToken: number | null;
  value: Revit2027EdgeLoopStatic;
  chainStartEdgeReferences: readonly number[];
};

type OwnerState = {
  declared: Map<number, number>;
  tokenNamespace: TokenNamespaceState;
  faces: Map<number, FaceRecord>;
  edges: Map<number, EdgeRecord>;
  loops: Map<number, LoopRecord>;
  surfacesByFace: Map<number, Revit2027AnalyticSurface>;
  duplicateTokens: Map<string, number>;
  firstBlocker: string | null;
  readerFailure: string | null;
  tokenFailure: string | null;
  completedQueue: boolean;
};

type Audit = {
  directRoots: number;
  owners: number;
  completedQueues: number;
  declared: Map<number, number>;
  decoded: Map<number, number>;
  blockerClasses: Map<string, number>;
  readerFailures: Map<string, number>;
  tokenFailures: Map<string, number>;
  duplicateTokenFailures: Map<string, number>;
  boundaryFailures: Map<string, number>;
  references: Map<string, number>;
  loopGraphs: Map<string, number>;
  loopEdgeCounts: Map<number, number>;
  uvLinks: Map<string, number>;
  persistedOpen: Map<string, number>;
  faceLoopCounts: Map<number, number>;
  firstLoopDescriptors: Map<string, number>;
  extraLoopWinding: Map<string, number>;
  slot1437ChainCounts: Map<number, number>;
  planarEligibility: Map<string, number>;
  planarSurfaceBodies: number;
  topologicalExtraLoops: number;
  geometricallyCertifiedHoles: number;
  sampledMesh: {
    attemptedFaces: number;
    adaptedFaces: number;
    tessellatedFaces: number;
    positions: number;
    triangles: number;
    groups: number;
    adaptationIssues: Map<string, number>;
    tessellationIssues: Map<string, number>;
    elements: Map<number, {
      faces: number;
      positions: number;
      triangles: number;
      minimum: [number, number, number];
      maximum: [number, number, number];
    }>;
  };
};

type LoopGraph = {
  status: string;
  edgeTokens: number[];
  edgeUses: Revit2027PlanarSampledEdgeUse[];
  uvForwardContinuous: boolean;
  uvWinding: "positive" | "negative" | "zero" | "unavailable";
};

type TokenNamespaceState = {
  nextPositiveToken: number;
  reservedStaticTokens: Set<number>;
  propertySourceSlots: Map<number, number>;
};

function increment<K>(map: Map<K, number>, key: K, count = 1): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  state: TokenNamespaceState,
): { ok: true; appended: readonly CondInt16QueueEntry[] } | {
  ok: false;
  error: string;
} {
  const appended: CondInt16QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.token === 0 || entry.sourceClassSlot == null) {
      return {
        ok: false,
        error: "queued append list contains a null descriptor",
      };
    }
    if (entry.token === -1) {
      appended.push(entry);
      continue;
    }
    if (entry.token < -1) {
      return {
        ok: false,
        error: `unproven negative queue token ${entry.token}`,
      };
    }
    const existingSlot = state.propertySourceSlots.get(entry.token);
    if (existingSlot != null) {
      if (existingSlot !== entry.sourceClassSlot) {
        return {
          ok: false,
          error:
            `token ${entry.token} changed source slot from ${existingSlot} ` +
            `to ${entry.sourceClassSlot}`,
        };
      }
      continue;
    }
    if (entry.token < state.nextPositiveToken) {
      if (!state.reservedStaticTokens.has(entry.token)) {
        return {
          ok: false,
          error:
            `token ${entry.token} is below ${state.nextPositiveToken} and ` +
            "has no earlier StaticInteger reservation",
        };
      }
      state.propertySourceSlots.set(entry.token, entry.sourceClassSlot);
      appended.push(entry);
      continue;
    }
    for (
      let skipped = state.nextPositiveToken;
      skipped < entry.token;
      skipped += 1
    ) {
      if (!state.reservedStaticTokens.has(skipped)) {
        return {
          ok: false,
          error:
            `token gap before ${entry.token} is not reserved at ${skipped}`,
        };
      }
    }
    state.propertySourceSlots.set(entry.token, entry.sourceClassSlot);
    state.nextPositiveToken = entry.token + 1;
    appended.push(entry);
  }
  return { ok: true, appended };
}

function reserveStaticTokens(
  state: TokenNamespaceState,
  tokens: readonly number[],
): void {
  for (const token of tokens) {
    if (token > 0) state.reservedStaticTokens.add(token);
  }
}

function entries<K extends string | number>(
  map: Map<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map].sort(
      (left, right) =>
        right[1] - left[1] ||
        String(left[0]).localeCompare(String(right[0]), "en", {
          numeric: true,
        }),
    ),
  );
}

function descriptorItemsForFace(
  face: Revit2027FaceStatic,
  faceToken: number,
): QueueItem[] {
  const items: QueueItem[] = [];
  const append = (
    entry: CondInt16QueueEntry,
    role: QueueRole,
  ): void => {
    if (entry.token !== 0) {
      items.push({ entry, role, faceToken, parentToken: faceToken });
    }
  };
  append(face.firstLoop, "face-first-loop");
  for (const region of face.faceRegions.entries) {
    append(region, "face-region");
  }
  append(face.foregroundFilling, "face-foreground-filling");
  append(face.backgroundFilling, "face-background-filling");
  append(face.surface, "face-surface");
  return items;
}

function declareItems(owner: OwnerState, items: readonly QueueItem[]): void {
  for (const item of items) {
    const { token, sourceClassSlot } = item.entry;
    if (token <= 0 || sourceClassSlot == null) continue;
    const previous = owner.declared.get(token);
    if (previous != null) {
      increment(
        owner.duplicateTokens,
        `${token}:${previous}->${sourceClassSlot}`,
      );
    } else {
      owner.declared.set(token, sourceClassSlot);
    }
  }
}

function decodedSlot(owner: OwnerState, token: number): number | null {
  if (owner.faces.has(token)) return REVIT_2027_FACE_SOURCE_CLASS_SLOT;
  if (owner.edges.has(token)) return REVIT_2027_GEDGE_SOURCE_CLASS_SLOT;
  const loop = owner.loops.get(token);
  if (loop) return loop.sourceClassSlot;
  return null;
}

function recordResolution(
  audit: Audit,
  owner: OwnerState,
  label: string,
  token: number,
  expectedSlot: number,
): void {
  if (token === 0) {
    increment(audit.references, `${label}:zero`);
    return;
  }
  if (token < 0) {
    increment(audit.references, `${label}:negative`);
    return;
  }
  const actualDecodedSlot = decodedSlot(owner, token);
  if (actualDecodedSlot === expectedSlot) {
    increment(audit.references, `${label}:resolved-decoded`);
    return;
  }
  if (actualDecodedSlot != null) {
    increment(
      audit.references,
      `${label}:decoded-wrong-slot-${actualDecodedSlot}`,
    );
    return;
  }
  const declaredSlot = owner.declared.get(token);
  if (declaredSlot === expectedSlot) {
    increment(audit.references, `${label}:declared-body-unreached`);
  } else if (declaredSlot != null) {
    increment(
      audit.references,
      `${label}:declared-wrong-slot-${declaredSlot}`,
    );
  } else {
    increment(audit.references, `${label}:missing-positive-token`);
  }
}

function recordEdgeLinkResolution(
  audit: Audit,
  owner: OwnerState,
  label: string,
  token: number,
): void {
  if (token === 0) {
    increment(audit.references, `${label}:zero`);
    return;
  }
  if (token < 0) {
    increment(audit.references, `${label}:negative`);
    return;
  }
  const actualDecodedSlot = decodedSlot(owner, token);
  if (actualDecodedSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
    increment(audit.references, `${label}:resolved-gedge`);
    return;
  }
  if (actualDecodedSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
    increment(audit.references, `${label}:resolved-edgeloop-sentinel`);
    return;
  }
  if (actualDecodedSlot === REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT) {
    increment(
      audit.references,
      `${label}:resolved-edgeloop-with-chains-sentinel`,
    );
    return;
  }
  if (actualDecodedSlot != null) {
    increment(
      audit.references,
      `${label}:decoded-unexpected-slot-${actualDecodedSlot}`,
    );
    return;
  }
  const declaredSlot = owner.declared.get(token);
  if (declaredSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
    increment(audit.references, `${label}:declared-gedge-body-unreached`);
  } else if (declaredSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
    increment(audit.references, `${label}:declared-edgeloop-sentinel-unreached`);
  } else if (
    declaredSlot === REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
  ) {
    increment(audit.references, `${label}:declared-edgeloopref-sentinel`);
  } else if (declaredSlot != null) {
    increment(
      audit.references,
      `${label}:declared-unexpected-slot-${declaredSlot}`,
    );
  } else {
    increment(audit.references, `${label}:missing-positive-token`);
  }
}

function edgeSide(edge: Revit2027GEdgeStatic, faceToken: number): number {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  if (first === second) return first ? -2 : -1;
  return first ? 0 : 1;
}

function uv(
  edge: Revit2027GEdgeStatic,
  endpoint: 0 | 1,
  side: number,
): readonly [number, number] {
  const point = edge.firstAndLastEdgePoints[endpoint];
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function samePoint(
  left: readonly [number, number],
  right: readonly [number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function pointDistance(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

type UvMatch = {
  currentEndpoint: 0 | 1;
  nextEndpoint: 0 | 1;
  exact: boolean;
};

function matchUvLink(
  current: Revit2027GEdgeStatic,
  currentSide: number,
  next: Revit2027GEdgeStatic,
  nextSide: number,
): UvMatch[] {
  const matches: UvMatch[] = [];
  for (const currentEndpoint of [0, 1] as const) {
    for (const nextEndpoint of [0, 1] as const) {
      const currentUv = uv(current, currentEndpoint, currentSide);
      const nextUv = uv(next, nextEndpoint, nextSide);
      const exact = samePoint(currentUv, nextUv);
      if (exact || pointDistance(currentUv, nextUv) <= UV_TOLERANCE) {
        matches.push({ currentEndpoint, nextEndpoint, exact });
      }
    }
  }
  return matches;
}

function uvCycle(
  audit: Audit,
  edges: readonly EdgeRecord[],
  sides: readonly number[],
): {
  continuous: boolean;
  winding: LoopGraph["uvWinding"];
  edgeUses: Revit2027PlanarSampledEdgeUse[];
} {
  const links: UvMatch[] = [];
  let allExact = true;
  for (let index = 0; index < edges.length; index += 1) {
    const nextIndex = (index + 1) % edges.length;
    const matches = matchUvLink(
      edges[index]!.value,
      sides[index]!,
      edges[nextIndex]!.value,
      sides[nextIndex]!,
    );
    if (matches.length !== 1) {
      increment(
        audit.uvLinks,
        matches.length === 0 ? "no-endpoint-match" : "ambiguous-endpoint-match",
      );
      return {
        continuous: false,
        winding: "unavailable",
        edgeUses: [],
      };
    }
    const match = matches[0]!;
    links.push(match);
    allExact = allExact && match.exact;
    increment(
      audit.uvLinks,
      `${match.exact ? "exact" : "tolerance"}:${
        match.currentEndpoint
      }->${match.nextEndpoint}`,
    );
  }

  const vertices: (readonly [number, number])[] = [];
  const edgeUses: Revit2027PlanarSampledEdgeUse[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const previousLink =
      links[(index + links.length - 1) % links.length]!;
    const outgoingLink = links[index]!;
    if (previousLink.nextEndpoint === outgoingLink.currentEndpoint) {
      increment(audit.uvLinks, "edge-reuses-one-endpoint");
      return {
        continuous: false,
        winding: "unavailable",
        edgeUses: [],
      };
    }
    const direction =
      previousLink.nextEndpoint === 0 &&
      outgoingLink.currentEndpoint === 1
        ? 1
        : -1;
    vertices.push(
      uv(
        edges[index]!.value,
        previousLink.nextEndpoint,
        sides[index]!,
      ),
    );
    edgeUses.push({
      edgeToken: edges[index]!.token,
      edge: edges[index]!.value,
      faceSide: sides[index] as 0 | 1,
      direction,
    });
  }
  increment(
    audit.uvLinks,
    allExact ? "oriented-cycle-exact" : "oriented-cycle-tolerance",
  );
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return {
    continuous: true,
    winding: area > 0 ? "positive" : area < 0 ? "negative" : "zero",
    edgeUses,
  };
}

function analyzeLoopGraph(
  audit: Audit,
  owner: OwnerState,
  loop: LoopRecord,
): LoopGraph {
  const faceToken = loop.value.faceReference;
  const startToken = loop.value.nextEdgeReference;
  const expectedLastToken = loop.value.previousEdgeReference;
  if (startToken <= 0) {
    return {
      status: startToken === 0 ? "zero-start-edge" : "negative-start-edge",
      edgeTokens: [],
      edgeUses: [],
      uvForwardContinuous: false,
      uvWinding: "unavailable",
    };
  }

  const visited = new Set<number>();
  const edgeTokens: number[] = [];
  const edges: EdgeRecord[] = [];
  const sides: number[] = [];
  let token = startToken;
  for (let step = 0; step <= owner.edges.size; step += 1) {
    if (token === loop.token) {
      let status =
        edgeTokens.at(-1) === expectedLastToken
          ? "closed"
          : "closed-loop-last-edge-mismatch";
      const first = edges[0];
      const firstSide = sides[0];
      if (
        first &&
        firstSide != null &&
        first.value.previousReferences[firstSide] !== loop.token
      ) {
        status = "closed-loop-first-sentinel-mismatch";
      }
      const uvResult =
        status === "closed"
          ? uvCycle(audit, edges, sides)
          : {
              continuous: false,
              winding: "unavailable" as const,
              edgeUses: [],
            };
      return {
        status,
        edgeTokens,
        edgeUses: uvResult.edgeUses,
        uvForwardContinuous: uvResult.continuous,
        uvWinding: uvResult.winding,
      };
    }
    if (visited.has(token)) {
      return {
        status: "cycle-before-loop-sentinel",
        edgeTokens,
        edgeUses: [],
        uvForwardContinuous: false,
        uvWinding: "unavailable",
      };
    }
    const edge = owner.edges.get(token);
    if (!edge) {
      return {
        status:
          owner.declared.get(token) === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT
            ? "edge-body-unreached"
            : "edge-token-unresolved",
        edgeTokens,
        edgeUses: [],
        uvForwardContinuous: false,
        uvWinding: "unavailable",
      };
    }
    const side = edgeSide(edge.value, faceToken);
    if (side === -1) {
      return {
        status: "edge-does-not-reference-loop-face",
        edgeTokens,
        edgeUses: [],
        uvForwardContinuous: false,
        uvWinding: "unavailable",
      };
    }
    if (side === -2) {
      return {
        status: "edge-references-loop-face-twice",
        edgeTokens,
        edgeUses: [],
        uvForwardContinuous: false,
        uvWinding: "unavailable",
      };
    }
    visited.add(token);
    edgeTokens.push(token);
    edges.push(edge);
    sides.push(side);
    const nextToken = edge.value.nextReferences[side];
    if (nextToken === 0) {
      return {
        status:
          loop.value.open && token === expectedLastToken
            ? "open-chain"
            : "unexpected-zero-next-edge",
        edgeTokens,
        edgeUses: [],
        uvForwardContinuous: false,
        uvWinding: "unavailable",
      };
    }
    const next = owner.edges.get(nextToken);
    if (next) {
      const nextSide = edgeSide(next.value, faceToken);
      if (nextSide >= 0) {
        if (next.value.previousReferences[nextSide] !== token) {
          increment(audit.loopGraphs, "non-reciprocal-next-previous-link");
        }
      }
    }
    token = nextToken;
  }
  return {
    status: "edge-walk-safety-bound",
    edgeTokens,
    edgeUses: [],
    uvForwardContinuous: false,
    uvWinding: "unavailable",
  };
}

function analyzeOwner(
  audit: Audit,
  owner: OwnerState,
  elementId: number,
): void {
  for (const edge of owner.edges.values()) {
    for (const token of edge.value.faceReferences) {
      recordResolution(
        audit,
        owner,
        "gedge-face",
        token,
        REVIT_2027_FACE_SOURCE_CLASS_SLOT,
      );
    }
    for (const token of edge.value.nextReferences) {
      recordEdgeLinkResolution(
        audit,
        owner,
        "gedge-next",
        token,
      );
    }
    for (const token of edge.value.previousReferences) {
      recordEdgeLinkResolution(
        audit,
        owner,
        "gedge-previous",
        token,
      );
    }
  }

  const loopGraphs = new Map<number, LoopGraph>();
  for (const loop of owner.loops.values()) {
    increment(audit.persistedOpen, String(loop.value.open));
    recordResolution(
      audit,
      owner,
      "edgeloop-face",
      loop.value.faceReference,
      REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    );
    recordResolution(
      audit,
      owner,
      "edgeloop-next",
      loop.value.nextEdgeReference,
      REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    );
    for (const token of loop.chainStartEdgeReferences) {
      recordResolution(
        audit,
        owner,
        "edgeloop-chain-start",
        token,
        REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
      );
    }
    recordResolution(
      audit,
      owner,
      "edgeloop-previous",
      loop.value.previousEdgeReference,
      REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    );
    const graph = analyzeLoopGraph(audit, owner, loop);
    loopGraphs.set(loop.token, graph);
    increment(audit.loopGraphs, graph.status);
    increment(audit.loopGraphs, `uv-winding-${graph.uvWinding}`);
    increment(audit.loopEdgeCounts, graph.edgeTokens.length);
  }

  for (const face of owner.faces.values()) {
    const surfaceSlot = face.value.surface.sourceClassSlot;
    const surface = owner.surfacesByFace.get(face.token);
    if (surface?.kind === "plane") audit.planarSurfaceBodies += 1;

    const firstLoop = face.value.firstLoop;
    increment(
      audit.firstLoopDescriptors,
      firstLoop.token === 0
        ? "null"
        : firstLoop.sourceClassSlot ===
            REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
          ? "slot-1434-edgeloop"
          : firstLoop.sourceClassSlot ===
              REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
            ? "slot-1437-edgeloop-with-chain-envelopes"
            : `slot-${firstLoop.sourceClassSlot ?? "null"}-unexpected`,
    );
    if (surfaceSlot !== REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT) {
      increment(audit.planarEligibility, "non-planar-surface-descriptor");
      continue;
    }
    if (surface?.kind !== "plane") {
      increment(audit.planarEligibility, "plane-body-unreached");
      continue;
    }
    if (firstLoop.token === 0) {
      increment(audit.planarEligibility, "no-first-loop");
      continue;
    }
    if (
      firstLoop.sourceClassSlot !==
        REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT &&
      firstLoop.sourceClassSlot !==
        REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
    ) {
      increment(audit.planarEligibility, "unexpected-first-loop-slot");
      continue;
    }
    if (firstLoop.token <= 0) {
      increment(audit.planarEligibility, "first-loop-has-no-positive-token");
      continue;
    }

    const seen = new Set<number>();
    const chain: LoopRecord[] = [];
    let loopToken = firstLoop.token;
    let chainFailure: string | null = null;
    while (!seen.has(loopToken)) {
      seen.add(loopToken);
      const loop = owner.loops.get(loopToken);
      if (!loop) {
        chainFailure =
          owner.declared.get(loopToken) ===
          REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
            ? "loop-chain-body-unreached"
            : "loop-chain-token-unresolved";
        break;
      }
      chain.push(loop);
      if (loop.value.nextLoop.token === 0) break;
      if (
        loop.value.nextLoop.token <= 0 ||
        (
          loop.value.nextLoop.sourceClassSlot !==
            REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT &&
          loop.value.nextLoop.sourceClassSlot !==
            REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
        )
      ) {
        chainFailure = "loop-chain-next-not-positive-edgeloop";
        break;
      }
      loopToken = loop.value.nextLoop.token;
    }
    if (!chainFailure && seen.has(loopToken) && chain.at(-1)?.value.nextLoop.token !== 0) {
      chainFailure = "loop-chain-cycles";
    }
    if (chainFailure) {
      increment(audit.planarEligibility, chainFailure);
      continue;
    }
    increment(audit.faceLoopCounts, chain.length);
    audit.topologicalExtraLoops += Math.max(0, chain.length - 1);
    if (
      chain.some(
        (loop) =>
          loop.value.faceReference !== face.token ||
          loop.faceToken !== face.token,
      )
    ) {
      increment(audit.planarEligibility, "loop-face-owner-mismatch");
      continue;
    }
    const graphs = chain.map((loop) => loopGraphs.get(loop.token)!);
    const outerWinding = graphs[0]?.uvWinding;
    for (const graph of graphs.slice(1)) {
      increment(
        audit.extraLoopWinding,
        outerWinding === "unavailable" ||
          graph.uvWinding === "unavailable" ||
          outerWinding === "zero" ||
          graph.uvWinding === "zero"
          ? "unavailable"
          : outerWinding === graph.uvWinding
            ? "same-as-first-loop"
            : "opposite-first-loop",
      );
    }
    if (
      graphs.some(
        (graph, index) =>
          graph.status !==
          (chain[index]!.value.open ? "open-chain" : "closed"),
      )
    ) {
      increment(audit.planarEligibility, "loop-edge-graph-not-closed");
      continue;
    }
    if (graphs.some((graph) => !graph.uvForwardContinuous)) {
      increment(audit.planarEligibility, "uv-chain-not-forward-continuous");
      continue;
    }
    increment(audit.planarEligibility, "eligible-for-curve-evaluation");
    if (chain.length !== 1) {
      increment(
        audit.sampledMesh.adaptationIssues,
        "multi-loop-role-not-certified",
      );
      continue;
    }
    const graph = graphs[0]!;
    audit.sampledMesh.attemptedFaces += 1;
    const provenance = {
      decoderId: "revit-2027-planar-topology-audit",
    };
    const adapted = adaptRevit2027PlanarSampledBrep({
      id: `revit-2027-owner-face-${face.token}`,
      provenance,
      continuityTolerance: UV_TOLERANCE,
      faces: [{
        faceToken: face.token,
        surface,
        loops: [{
          loopToken: chain[0]!.token,
          role: "outer",
          edgeUses: graph.edgeUses,
        }],
        materialId: null,
        provenance,
      }],
    });
    if (!adapted.ok) {
      for (const issue of adapted.issues) {
        increment(audit.sampledMesh.adaptationIssues, issue.code);
      }
      continue;
    }
    audit.sampledMesh.adaptedFaces += 1;
    const tessellated = tessellatePlanarBrep(adapted.brep);
    if (!tessellated.ok) {
      for (const issue of tessellated.issues) {
        increment(audit.sampledMesh.tessellationIssues, issue.code);
      }
      continue;
    }
    audit.sampledMesh.tessellatedFaces += 1;
    audit.sampledMesh.positions += tessellated.mesh.positions.length / 3;
    audit.sampledMesh.triangles += tessellated.mesh.indices.length / 3;
    audit.sampledMesh.groups += tessellated.mesh.groups.length;
    let element = audit.sampledMesh.elements.get(elementId);
    if (!element) {
      element = {
        faces: 0,
        positions: 0,
        triangles: 0,
        minimum: [Infinity, Infinity, Infinity],
        maximum: [-Infinity, -Infinity, -Infinity],
      };
      audit.sampledMesh.elements.set(elementId, element);
    }
    element.faces += 1;
    element.positions += tessellated.mesh.positions.length / 3;
    element.triangles += tessellated.mesh.indices.length / 3;
    for (
      let index = 0;
      index < tessellated.mesh.positions.length;
      index += 3
    ) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = tessellated.mesh.positions[index + axis]!;
        element.minimum[axis] = Math.min(element.minimum[axis]!, value);
        element.maximum[axis] = Math.max(element.maximum[axis]!, value);
      }
    }
  }
}

function replayOwner(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  release: number,
  audit: Audit,
  elementId: number,
): void {
  if (
    root.children.length !== 1 ||
    root.children[0]?.sourceClassSlot !==
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return;
  }
  audit.directRoots += 1;
  const tokenNamespace: TokenNamespaceState = {
    nextPositiveToken: 3,
    reservedStaticTokens: new Set(),
    propertySourceSlots: new Map(),
  };
  const rootTokens = requireTokens(root.children, tokenNamespace);
  if (!rootTokens.ok || rootTokens.appended.length !== 1) {
    increment(
      audit.tokenFailures,
      `root: ${
        rootTokens.ok ? "Geometry property was reused" : rootTokens.error
      }`,
    );
    return;
  }
  const geometry = decodeRevit2027GeometryStatic(
    data,
    root.dynamicPayloadOffset,
    root.dynamicPayloadEndOffset,
    release,
  );
  if (!geometry.ok) {
    increment(audit.readerFailures, geometry.error);
    return;
  }
  const geometryTokens = requireTokens(
    geometry.value.queuedProperties,
    tokenNamespace,
  );
  if (!geometryTokens.ok) {
    increment(audit.tokenFailures, `Geometry: ${geometryTokens.error}`);
    return;
  }
  audit.owners += 1;

  const owner: OwnerState = {
    declared: new Map(),
    tokenNamespace,
    faces: new Map(),
    edges: new Map(),
    loops: new Map(),
    surfacesByFace: new Map(),
    duplicateTokens: new Map(),
    firstBlocker: null,
    readerFailure: null,
    tokenFailure: null,
    completedQueue: false,
  };
  const queue: QueueItem[] = [
    ...geometry.value.faces.entries.map((entry) => ({
      entry,
      role: "geometry-face" as const,
      faceToken: entry.token > 0 ? entry.token : null,
      parentToken: 3,
    })),
    ...geometry.value.edges.entries.map((entry) => ({
      entry,
      role: "geometry-edge" as const,
      faceToken: null,
      parentToken: 3,
    })),
    ...geometry.value.sharedSurfaceInfo.entries.map((entry) => ({
      entry,
      role: "geometry-shared-surface" as const,
      faceToken: null,
      parentToken: 3,
    })),
  ];
  declareItems(owner, queue);
  let cursor = geometry.value.endOffset;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (queue.length > MAX_OWNER_QUEUE) {
      owner.readerFailure = "owner queue exceeds safety bound";
      break;
    }
    const item = queue[queueIndex]!;
    const slot = item.entry.sourceClassSlot!;
    const token = item.entry.token;
    let endOffset = cursor;
    let children: QueueItem[] = [];
    let staticReferencesAfterChildren: readonly number[] = [];

    if (slot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FaceStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      if (token <= 0) {
        owner.readerFailure = "Geometry-owned Face lacks positive token";
        break;
      }
      owner.faces.set(token, { token, value: decoded.value });
      endOffset = decoded.value.endOffset;
      children = descriptorItemsForFace(decoded.value, token);
    } else if (slot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GEdgeStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      if (token <= 0) {
        owner.readerFailure = "Geometry-owned GEdge lacks positive token";
        break;
      }
      owner.edges.set(token, { token, value: decoded.value });
      endOffset = decoded.value.endOffset;
      staticReferencesAfterChildren = [
        ...decoded.value.faceReferences,
        ...decoded.value.nextReferences,
        ...decoded.value.previousReferences,
      ];
    } else if (slot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027EdgeLoopStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      if (token <= 0) {
        owner.readerFailure = "EdgeLoop lacks positive token identity";
        break;
      }
      owner.loops.set(token, {
        token,
        sourceClassSlot: REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
        faceToken: item.faceToken,
        value: decoded.value,
        chainStartEdgeReferences: [],
      });
      endOffset = decoded.value.endOffset;
      staticReferencesAfterChildren = decoded.value.staticReferences;
      if (decoded.value.nextLoop.token !== 0) {
        children = [{
          entry: decoded.value.nextLoop,
          role: "loop-next",
          faceToken: item.faceToken,
          parentToken: token,
        }];
      }
    } else if (slot === REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      if (token <= 0) {
        owner.readerFailure =
          "EdgeLoopWithChainEnvelopes lacks positive token identity";
        break;
      }
      owner.loops.set(token, {
        token,
        sourceClassSlot: REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
        faceToken: item.faceToken,
        value: decoded.value.loop,
        chainStartEdgeReferences: decoded.value.chains.map(
          (chain) => chain.startEdgeReference,
        ),
      });
      increment(audit.slot1437ChainCounts, decoded.value.chains.length);
      endOffset = decoded.value.endOffset;
      staticReferencesAfterChildren = decoded.value.staticReferences;
      if (decoded.value.loop.nextLoop.token !== 0) {
        children = [{
          entry: decoded.value.loop.nextLoop,
          role: "loop-next",
          faceToken: item.faceToken,
          parentToken: token,
        }];
      }
    } else if (slot === REVIT_2027_GFILLING_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GFilling(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      endOffset = decoded.value.endOffset;
      reserveStaticTokens(
        owner.tokenNamespace,
        [decoded.value.faceIdReference],
      );
      if (decoded.value.data.token !== 0) {
        children = [{
          entry: decoded.value.data,
          role: "filling-data",
          faceToken: item.faceToken,
          parentToken: token > 0 ? token : null,
        }];
      }
    } else if (slot === REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FillPatternData(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      endOffset = decoded.value.endOffset;
      children = decoded.value.queuedProperties.map((entry) => ({
        entry,
        role: "fill-grid" as const,
        faceToken: item.faceToken,
        parentToken: token > 0 ? token : null,
      }));
    } else if (slot === REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FillGrid(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      endOffset = decoded.value.endOffset;
    } else if (slot === REVIT_2027_GARC_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GArc(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      endOffset = decoded.value.endOffset;
    } else if (SURFACE_SLOTS.has(slot)) {
      const decoded = decodeRevit2027AnalyticSurface(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
        slot,
      );
      if (!decoded.ok) {
        owner.readerFailure = `${slot}: ${decoded.error}`;
        break;
      }
      endOffset = decoded.value.endOffset;
      if (item.faceToken != null && item.role === "face-surface") {
        owner.surfacesByFace.set(item.faceToken, decoded.value);
      }
      children = decoded.value.queuedProperties.map((entry) => ({
        entry,
        role: "surface-curve" as const,
        faceToken: item.faceToken,
        parentToken: token > 0 ? token : null,
      }));
    } else {
      owner.firstBlocker = `${item.role}:${slot}:${
        token === -1 ? "sentinel" : "numbered"
      }`;
      break;
    }

    const tokenResult = requireTokens(
      children.map(({ entry }) => entry),
      owner.tokenNamespace,
    );
    if (!tokenResult.ok) {
      owner.tokenFailure = `${slot}: ${tokenResult.error}`;
      break;
    }
    const appendedEntries = new Set(tokenResult.appended);
    const appendedChildren = children.filter(
      ({ entry }) => appendedEntries.has(entry),
    );
    reserveStaticTokens(
      owner.tokenNamespace,
      staticReferencesAfterChildren,
    );
    declareItems(owner, appendedChildren);
    queue.push(...appendedChildren);
    cursor = endOffset;
  }

  if (
    !owner.firstBlocker &&
    !owner.readerFailure &&
    !owner.tokenFailure
  ) {
    if (cursor === root.dynamicPayloadEndOffset) {
      owner.completedQueue = true;
      audit.completedQueues += 1;
    } else {
      increment(
        audit.boundaryFailures,
        `queue leaves ${root.dynamicPayloadEndOffset - cursor} bytes`,
      );
    }
  }
  if (owner.firstBlocker) increment(audit.blockerClasses, owner.firstBlocker);
  if (owner.readerFailure) increment(audit.readerFailures, owner.readerFailure);
  if (owner.tokenFailure) increment(audit.tokenFailures, owner.tokenFailure);
  for (const [failure, count] of owner.duplicateTokens) {
    increment(audit.duplicateTokenFailures, failure, count);
  }
  for (const slot of owner.declared.values()) increment(audit.declared, slot);
  for (const face of owner.faces.values()) {
    increment(audit.decoded, REVIT_2027_FACE_SOURCE_CLASS_SLOT);
    void face;
  }
  for (const edge of owner.edges.values()) {
    increment(audit.decoded, REVIT_2027_GEDGE_SOURCE_CLASS_SLOT);
    void edge;
  }
  for (const loop of owner.loops.values()) {
    increment(audit.decoded, loop.sourceClassSlot);
  }
  analyzeOwner(audit, owner, elementId);
}

const modelPath = requireModelPath(
  "audit-revit-2027-planar-topology.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);

const audit: Audit = {
  directRoots: 0,
  owners: 0,
  completedQueues: 0,
  declared: new Map(),
  decoded: new Map(),
  blockerClasses: new Map(),
  readerFailures: new Map(),
  tokenFailures: new Map(),
  duplicateTokenFailures: new Map(),
  boundaryFailures: new Map(),
  references: new Map(),
  loopGraphs: new Map(),
  loopEdgeCounts: new Map(),
  uvLinks: new Map(),
  persistedOpen: new Map(),
  faceLoopCounts: new Map(),
  firstLoopDescriptors: new Map(),
  extraLoopWinding: new Map(),
  slot1437ChainCounts: new Map(),
  planarEligibility: new Map(),
  planarSurfaceBodies: 0,
  topologicalExtraLoops: 0,
  geometricallyCertifiedHoles: 0,
  sampledMesh: {
    attemptedFaces: 0,
    adaptedFaces: 0,
    tessellatedFaces: 0,
    positions: 0,
    triangles: 0,
    groups: 0,
    adaptationIssues: new Map(),
    tessellationIssues: new Map(),
    elements: new Map(),
  },
};

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);
let chunks = 0;
let failedChunks = 0;
const instancePlacements = new Map<number, InstancePlacement>();
for (const { data: inflated } of iterateInflatedChunks(model, {
  onFailure: () => {
    failedChunks += 1;
  },
})) {
  chunks += 1;
  for (const frame of scanFramedElementObjects(inflated)) {
    const placement = readInstancePlacement(inflated, frame);
    if (placement && !instancePlacements.has(placement.elementId)) {
      instancePlacements.set(placement.elementId, placement);
    }
    if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
    const root = decodeRevit2027FramedGRepRoot(
      inflated,
      frame,
      release,
    );
    if (!root.ok) continue;
    replayOwner(inflated, root.value, release, audit, frame.elementId);
  }

}
const sampledInstances = [...instancePlacements.values()]
  .map((placement) => {
    const geometry = audit.sampledMesh.elements.get(placement.geometryId);
    if (!geometry) return null;
    const corners = instanceCorners(placement, {
      elementId: placement.geometryId,
      min: geometry.minimum,
      max: geometry.maximum,
    });
    const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
    const maximum: [number, number, number] = [
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (const corner of corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis]!, corner[axis]!);
        maximum[axis] = Math.max(maximum[axis]!, corner[axis]!);
      }
    }
    return {
      elementId: placement.elementId,
      geometryOwnerId: placement.geometryId,
      faces: geometry.faces,
      positions: geometry.positions,
      triangles: geometry.triangles,
      minimum,
      maximum,
    };
  })
  .filter((value) => value != null)
  .sort((left, right) => left.elementId - right.elementId);

console.log(JSON.stringify({
  modelPath,
  release,
  partitions: partitions.length,
  chunks,
  failedChunks,
  scope: {
    directSingleGeometryRoots: audit.directRoots,
    replayedOwners: audit.owners,
    completedQueues: audit.completedQueues,
  },
  tokenRegistry: {
    declaredPositiveObjectsBySlot: entries(audit.declared),
    decodedPositiveObjectsBySlot: entries(audit.decoded),
    duplicateTokenFailures: entries(audit.duplicateTokenFailures),
  },
  referenceResolution: entries(audit.references),
  loopTopology: {
    firstLoopDescriptors: entries(audit.firstLoopDescriptors),
    slot1437ChainCounts: entries(audit.slot1437ChainCounts),
    persistedOpenFlag: entries(audit.persistedOpen),
    graphResults: entries(audit.loopGraphs),
    reciprocityFailures:
      audit.loopGraphs.get("non-reciprocal-next-previous-link") ?? 0,
    edgeCounts: entries(audit.loopEdgeCounts),
    uvLinkOrientation: entries(audit.uvLinks),
    uvTolerance: UV_TOLERANCE,
  },
  planarFaces: {
    decodedPlaneSurfaceBodies: audit.planarSurfaceBodies,
    eligibility: entries(audit.planarEligibility),
    resolvedLoopCounts: entries(audit.faceLoopCounts),
    topologicalExtraLoopCandidates: audit.topologicalExtraLoops,
    extraLoopWindingRelativeToFirst:
      entries(audit.extraLoopWinding),
    geometricallyCertifiedHoles: audit.geometricallyCertifiedHoles,
    holeBoundary:
      "extra linked loops are counted, but holes require decoded curve geometry and containment; none are asserted",
  },
  sampledPlanarMesh: {
    attemptedSingleLoopFaces: audit.sampledMesh.attemptedFaces,
    adaptedFaces: audit.sampledMesh.adaptedFaces,
    tessellatedFaces: audit.sampledMesh.tessellatedFaces,
    positions: audit.sampledMesh.positions,
    triangles: audit.sampledMesh.triangles,
    groups: audit.sampledMesh.groups,
    decodedInstancePlacements: instancePlacements.size,
    placedInstancesUsingSampledOwners: sampledInstances.length,
    placedInstanceTriangles: sampledInstances.reduce(
      (total, instance) => total + instance.triangles,
      0,
    ),
    adaptationIssues: entries(audit.sampledMesh.adaptationIssues),
    tessellationIssues: entries(audit.sampledMesh.tessellationIssues),
    elements: [...audit.sampledMesh.elements]
      .sort((left, right) => left[0] - right[0])
      .map(([elementId, value]) => ({
        elementId,
        ...value,
      })),
    instances: sampledInstances,
    materialPolicy:
      "materialId stays null because no exact native face-material relation is bound in this audit",
    parityBoundary:
      "this is RVT-side sampled planar output; element-level IFC joins and triangle/bounds parity are reported separately",
  },
  replayFrontier: {
    blockers: entries(audit.blockerClasses),
    readerFailures: entries(audit.readerFailures),
    tokenFailures: entries(audit.tokenFailures),
    boundaryFailures: entries(audit.boundaryFailures),
  },
  stopBoundary:
    "unknown FIFO descendants and failed certified readers stop their owner; no body is skipped, scanned, or assigned an inferred width",
}, null, 2));
