/**
 * Audit every exact UNBC Revit 2027 cylinder/cone face against the
 * browser-neutral analytic BRep contract.
 *
 * The RVT queue, topology, UV charts, and surfaces are decoded first. IFC is
 * not read here and cannot influence eligibility.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-cylinder-cone-trims.ts model.rvt
 */
import {
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
} from "./lib/rvt-harness.ts";

import { tessellateNeutralBrep } from "../lib/reviter/brep-tessellator.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  adaptRevit2027CylinderSampledBrep,
  type Revit2027CylinderSampledEdgeUse,
} from "../lib/reviter/revit-2027-cylinder-sampled-brep.ts";
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
  Revit2027EdgePoint,
  Revit2027FaceStatic,
  Revit2027GEdgeStatic,
} from "./lib/revit-2027-decoders.ts";
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

type TokenNamespace = {
  nextPositiveToken: number;
  reservedStaticTokens: Set<number>;
  propertySourceSlots: Map<number, number>;
};

type LoopRecord = {
  token: number;
  faceToken: number | null;
  value: Revit2027EdgeLoopStatic;
};

type Owner = {
  faces: Map<number, Revit2027FaceStatic>;
  edges: Map<number, Revit2027GEdgeStatic>;
  loops: Map<number, LoopRecord>;
  surfacesByFace: Map<number, Revit2027AnalyticSurface>;
  endOffset: number;
  ownerEndOffset: number;
};

type LoopGraph = {
  status: string;
  edgeUses: Revit2027CylinderSampledEdgeUse[];
};

type FaceAudit = {
  elementId: number;
  faceToken: number;
  surfaceKind: "cylinder" | "cone";
  sourceClassSlot: number;
  surfaceEnvelope: {
    firstCorner: readonly [number, number];
    secondCorner: readonly [number, number];
  };
  loopCount: number;
  edgeCount: number;
  classification: string;
  angularSegments: number | null;
  axialSegments: number | null;
  persistedGridTriangles: number | null;
  neutralMeshTriangles: number | null;
};

type ConeAuditDetail = {
  elementId: number;
  faceToken: number;
  faceFlags: number;
  surface: {
    center: readonly [number, number, number];
    xVector: readonly [number, number, number];
    yVector: readonly [number, number, number];
    zVector: readonly [number, number, number];
    halfAngle: number;
    orientFlag: boolean;
    envelope: {
      firstCorner: readonly [number, number];
      secondCorner: readonly [number, number];
    };
  };
  loopEnvelope: {
    minimum: readonly [number, number];
    maximum: readonly [number, number];
  } | null;
  graphStatus: string;
  edges: {
    token: number;
    faceSide: 0 | 1;
    direction: 1 | -1;
    samples: readonly (readonly [number, number])[];
  }[];
};

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedEntries(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map].sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  state: TokenNamespace,
): {
  ok: true;
  appended: readonly CondInt16QueueEntry[];
} | {
  ok: false;
  error: string;
} {
  const appended: CondInt16QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.token === 0 || entry.sourceClassSlot == null) {
      return { ok: false, error: "queued append list contains null" };
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
    const existing = state.propertySourceSlots.get(entry.token);
    if (existing != null) {
      if (existing !== entry.sourceClassSlot) {
        return {
          ok: false,
          error:
            `token ${entry.token} changed source slot from ${existing} ` +
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
            `token ${entry.token} is below ${state.nextPositiveToken} ` +
            "without a prior StaticInteger reservation",
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
          error: `token gap before ${entry.token} is not reserved at ${skipped}`,
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
  state: TokenNamespace,
  tokens: readonly number[],
): void {
  for (const token of tokens) {
    if (token > 0) state.reservedStaticTokens.add(token);
  }
}

function faceChildren(
  face: Revit2027FaceStatic,
  faceToken: number,
): QueueItem[] {
  const result: QueueItem[] = [];
  const append = (
    entry: CondInt16QueueEntry,
    role: QueueRole,
  ): void => {
    if (entry.token !== 0) {
      result.push({
        entry,
        role,
        faceToken,
        parentToken: faceToken,
      });
    }
  };
  append(face.firstLoop, "face-first-loop");
  for (const region of face.faceRegions.entries) {
    append(region, "face-region");
  }
  append(face.foregroundFilling, "face-foreground-filling");
  append(face.backgroundFilling, "face-background-filling");
  append(face.surface, "face-surface");
  return result;
}

function replayOwner(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  release: number,
): Owner | null {
  if (
    root.children.length !== 1 ||
    root.children[0]?.sourceClassSlot !== REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return null;
  }
  const tokenNamespace: TokenNamespace = {
    nextPositiveToken: 3,
    reservedStaticTokens: new Set(),
    propertySourceSlots: new Map(),
  };
  const rootTokens = requireTokens(root.children, tokenNamespace);
  if (!rootTokens.ok || rootTokens.appended.length !== 1) {
    throw new Error(
      `root token registration failed: ${
        rootTokens.ok ? "Geometry token was reused" : rootTokens.error
      }`,
    );
  }
  const geometry = decodeRevit2027GeometryStatic(
    data,
    root.dynamicPayloadOffset,
    root.dynamicPayloadEndOffset,
    release,
  );
  if (!geometry.ok) throw new Error(geometry.error);
  const geometryTokens = requireTokens(
    geometry.value.queuedProperties,
    tokenNamespace,
  );
  if (!geometryTokens.ok) {
    throw new Error(`Geometry tokens: ${geometryTokens.error}`);
  }
  const owner: Owner = {
    faces: new Map(),
    edges: new Map(),
    loops: new Map(),
    surfacesByFace: new Map(),
    endOffset: geometry.value.endOffset,
    ownerEndOffset: root.dynamicPayloadEndOffset,
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
  let cursor = geometry.value.endOffset;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (queue.length > MAX_OWNER_QUEUE) {
      throw new Error("owner queue exceeds safety bound");
    }
    const item = queue[queueIndex]!;
    const token = item.entry.token;
    const slot = item.entry.sourceClassSlot!;
    let endOffset = cursor;
    let children: QueueItem[] = [];
    let staticReferences: readonly number[] = [];

    if (slot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027FaceStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("Face lacks positive token identity");
      owner.faces.set(token, decoded.value);
      endOffset = decoded.value.endOffset;
      children = faceChildren(decoded.value, token);
    } else if (slot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GEdgeStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("GEdge lacks positive token identity");
      owner.edges.set(token, decoded.value);
      endOffset = decoded.value.endOffset;
      staticReferences = [
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
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) throw new Error("EdgeLoop lacks positive token identity");
      owner.loops.set(token, {
        token,
        faceToken: item.faceToken,
        value: decoded.value,
      });
      endOffset = decoded.value.endOffset;
      staticReferences = decoded.value.staticReferences;
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
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      if (token <= 0) {
        throw new Error(
          "EdgeLoopWithChainEnvelopes lacks positive token identity",
        );
      }
      owner.loops.set(token, {
        token,
        faceToken: item.faceToken,
        value: decoded.value.loop,
      });
      endOffset = decoded.value.endOffset;
      staticReferences = decoded.value.staticReferences;
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
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
      reserveStaticTokens(tokenNamespace, [decoded.value.faceIdReference]);
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
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
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
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
    } else if (slot === REVIT_2027_GARC_SOURCE_CLASS_SLOT) {
      const decoded = decodeRevit2027GArc(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
      endOffset = decoded.value.endOffset;
    } else if (SURFACE_SLOTS.has(slot)) {
      const decoded = decodeRevit2027AnalyticSurface(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
        slot,
      );
      if (!decoded.ok) throw new Error(`${slot}: ${decoded.error}`);
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
      throw new Error(
        `blocked at ${item.role}:${slot}:${
          token === -1 ? "sentinel" : "numbered"
        }`,
      );
    }

    const tokenResult = requireTokens(
      children.map(({ entry }) => entry),
      tokenNamespace,
    );
    if (!tokenResult.ok) {
      throw new Error(`${slot} child tokens: ${tokenResult.error}`);
    }
    const appended = new Set(tokenResult.appended);
    reserveStaticTokens(tokenNamespace, staticReferences);
    queue.push(...children.filter(({ entry }) => appended.has(entry)));
    cursor = endOffset;
  }
  owner.endOffset = cursor;
  if (cursor !== root.dynamicPayloadEndOffset) {
    throw new Error(
      `owner queue leaves ${root.dynamicPayloadEndOffset - cursor} bytes`,
    );
  }
  return owner;
}

function edgeSide(edge: Revit2027GEdgeStatic, faceToken: number): 0 | 1 | null {
  const first = edge.faceReferences[0] === faceToken;
  const second = edge.faceReferences[1] === faceToken;
  return first === second ? null : first ? 0 : 1;
}

function uv(
  edge: Revit2027GEdgeStatic,
  endpoint: 0 | 1,
  side: 0 | 1,
): readonly [number, number] {
  const point = edge.firstAndLastEdgePoints[endpoint];
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function uvForSide(
  point: Revit2027EdgePoint,
  side: 0 | 1,
): readonly [number, number] {
  return side === 0 ? point.firstFaceUv : point.secondFaceUv;
}

function distance2(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function sameSurfacePoint(
  surface: Revit2027AnalyticSurface,
  left: readonly [number, number],
  right: readonly [number, number],
): boolean {
  if (distance2(left, right) <= UV_TOLERANCE) return true;
  // The native cone evaluator multiplies the complete angular generator by V.
  // Consequently every finite (U, 0) parameter pair is the same 3D apex even
  // though its U coordinates differ. This equivalence is topology, not a
  // tolerance-based geometric approximation.
  return (
    surface.kind === "cone" &&
    Math.abs(left[1]) <= UV_TOLERANCE &&
    Math.abs(right[1]) <= UV_TOLERANCE
  );
}

function walkLoop(
  owner: Owner,
  loop: LoopRecord,
  surface: Revit2027AnalyticSurface,
): LoopGraph {
  const visited = new Set<number>();
  const tokens: number[] = [];
  const edges: Revit2027GEdgeStatic[] = [];
  const sides: (0 | 1)[] = [];
  let token = loop.value.nextEdgeReference;
  while (token !== loop.token) {
    if (visited.has(token)) {
      return { status: "cycle-before-loop-sentinel", edgeUses: [] };
    }
    visited.add(token);
    const edge = owner.edges.get(token);
    if (!edge) return { status: "unresolved-edge", edgeUses: [] };
    const side = edgeSide(edge, loop.value.faceReference);
    if (side == null) {
      return { status: "edge-face-reference-mismatch", edgeUses: [] };
    }
    tokens.push(token);
    edges.push(edge);
    sides.push(side);
    token = edge.nextReferences[side];
    if (tokens.length > owner.edges.size) {
      return { status: "safety-bound", edgeUses: [] };
    }
  }
  if (tokens.at(-1) !== loop.value.previousEdgeReference) {
    return { status: "last-edge-mismatch", edgeUses: [] };
  }

  const links: {
    currentEndpoint: 0 | 1;
    nextEndpoint: 0 | 1;
  }[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const nextIndex = (index + 1) % edges.length;
    const matches = [];
    for (const currentEndpoint of [0, 1] as const) {
      for (const nextEndpoint of [0, 1] as const) {
        if (
          sameSurfacePoint(
            surface,
            uv(edges[index]!, currentEndpoint, sides[index]!),
            uv(edges[nextIndex]!, nextEndpoint, sides[nextIndex]!),
          )
        ) {
          matches.push({ currentEndpoint, nextEndpoint });
        }
      }
    }
    if (matches.length !== 1) {
      return {
        status:
          matches.length === 0
            ? "uv-endpoint-gap"
            : "uv-endpoint-ambiguous",
        edgeUses: [],
      };
    }
    links.push(matches[0]!);
  }
  const edgeUses: Revit2027CylinderSampledEdgeUse[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const incoming = links[(index + links.length - 1) % links.length]!;
    const outgoing = links[index]!;
    if (incoming.nextEndpoint === outgoing.currentEndpoint) {
      return { status: "edge-reuses-one-endpoint", edgeUses: [] };
    }
    edgeUses.push({
      edgeToken: tokens[index]!,
      edge: edges[index]!,
      faceSide: sides[index]!,
      direction:
        incoming.nextEndpoint === 0 && outgoing.currentEndpoint === 1
          ? 1
          : -1,
    });
  }
  return { status: "closed", edgeUses };
}

function loopChain(
  owner: Owner,
  face: Revit2027FaceStatic,
): {
  ok: true;
  loops: LoopRecord[];
} | {
  ok: false;
  error: string;
} {
  if (face.firstLoop.token <= 0) {
    return { ok: false, error: "missing-positive-first-loop" };
  }
  const result: LoopRecord[] = [];
  const seen = new Set<number>();
  let token = face.firstLoop.token;
  while (token > 0 && !seen.has(token)) {
    seen.add(token);
    const loop = owner.loops.get(token);
    if (!loop) return { ok: false, error: "unresolved-loop" };
    result.push(loop);
    token = loop.value.nextLoop.token;
  }
  if (token !== 0) return { ok: false, error: "invalid-loop-chain" };
  return { ok: true, loops: result };
}

function rectangleSampling(
  surface: Revit2027AnalyticSurface,
  loop: LoopRecord,
  graph: LoopGraph,
): {
  ok: true;
  angularSegments: number;
  axialSegments: number;
} | {
  ok: false;
  error: string;
} {
  if (graph.edgeUses.length !== 4) {
    return { ok: false, error: "not-four-edge-rectangle" };
  }
  const minimum = loop.value.envelope.minimum;
  const maximum = loop.value.envelope.maximum;
  const envelope = surface.surface.envelope;
  if (
    distance2(minimum, envelope.firstCorner) > UV_TOLERANCE ||
    distance2(maximum, envelope.secondCorner) > UV_TOLERANCE
  ) {
    return { ok: false, error: "loop-surface-envelope-mismatch" };
  }
  const sides = new Map<string, number>();
  for (const edgeUse of graph.edgeUses) {
    const raw = [
      edgeUse.edge.firstAndLastEdgePoints[0],
      ...edgeUse.edge.interiorEdgePoints,
      edgeUse.edge.firstAndLastEdgePoints[1],
    ].map((point) => uvForSide(point, edgeUse.faceSide));
    const points = edgeUse.direction === 1 ? raw : raw.reverse();
    const allNear = (axis: 0 | 1, value: number): boolean =>
      points.every((point) => Math.abs(point[axis] - value) <= UV_TOLERANCE);
    const side =
      allNear(0, minimum[0])
        ? "u-min"
        : allNear(0, maximum[0])
          ? "u-max"
          : allNear(1, minimum[1])
            ? "v-min"
            : allNear(1, maximum[1])
              ? "v-max"
              : null;
    if (!side) return { ok: false, error: "non-axis-aligned-edge" };
    if (sides.has(side)) {
      return { ok: false, error: "duplicate-rectangle-side" };
    }
    sides.set(side, points.length - 1);
  }
  for (const side of ["u-min", "u-max", "v-min", "v-max"]) {
    if (!sides.has(side)) {
      return { ok: false, error: "missing-rectangle-side" };
    }
  }
  if (
    sides.get("u-min") !== sides.get("u-max") ||
    sides.get("v-min") !== sides.get("v-max")
  ) {
    return { ok: false, error: "opposite-side-sampling-mismatch" };
  }
  return {
    ok: true,
    // Revit U is angle; Revit V is axial/slant distance.
    angularSegments: sides.get("v-min")!,
    axialSegments: sides.get("u-min")!,
  };
}

function coneDetail(
  elementId: number,
  owner: Owner,
  faceToken: number,
  face: Revit2027FaceStatic,
  surface: Extract<Revit2027AnalyticSurface, { kind: "cone" }>,
): ConeAuditDetail {
  const chain = loopChain(owner, face);
  const loop = chain.ok && chain.loops.length === 1 ? chain.loops[0]! : null;
  const graph = loop
    ? walkLoop(owner, loop, surface)
    : { status: chain.ok ? "multi-loop-trim" : chain.error, edgeUses: [] };
  return {
    elementId,
    faceToken,
    faceFlags: face.faceFlags,
    surface: {
      center: surface.center,
      xVector: surface.xVector,
      yVector: surface.yVector,
      zVector: surface.zVector,
      halfAngle: surface.halfAngle,
      orientFlag: surface.surface.orientFlag,
      envelope: surface.surface.envelope,
    },
    loopEnvelope: loop
      ? {
          minimum: loop.value.envelope.minimum,
          maximum: loop.value.envelope.maximum,
        }
      : null,
    graphStatus: graph.status,
    edges: graph.edgeUses.map((edgeUse) => {
      const raw = [
        edgeUse.edge.firstAndLastEdgePoints[0],
        ...edgeUse.edge.interiorEdgePoints,
        edgeUse.edge.firstAndLastEdgePoints[1],
      ].map((point) => uvForSide(point, edgeUse.faceSide));
      return {
        token: edgeUse.edgeToken,
        faceSide: edgeUse.faceSide,
        direction: edgeUse.direction,
        samples: edgeUse.direction === 1 ? raw : raw.reverse(),
      };
    }),
  };
}

function auditFace(
  elementId: number,
  owner: Owner,
  faceToken: number,
  face: Revit2027FaceStatic,
  surface: Revit2027AnalyticSurface,
): FaceAudit {
  const base = {
    elementId,
    faceToken,
    surfaceKind: surface.kind as "cylinder" | "cone",
    sourceClassSlot: surface.sourceClassSlot,
    surfaceEnvelope: surface.surface.envelope,
  };
  const chain = loopChain(owner, face);
  if (!chain.ok) {
    return {
      ...base,
      loopCount: 0,
      edgeCount: 0,
      classification: chain.error,
      angularSegments: null,
      axialSegments: null,
      persistedGridTriangles: null,
      neutralMeshTriangles: null,
    };
  }
  if (chain.loops.length !== 1) {
    return {
      ...base,
      loopCount: chain.loops.length,
      edgeCount: 0,
      classification: "multi-loop-trim",
      angularSegments: null,
      axialSegments: null,
      persistedGridTriangles: null,
      neutralMeshTriangles: null,
    };
  }
  const loop = chain.loops[0]!;
  const graph = walkLoop(owner, loop, surface);
  if (graph.status !== "closed") {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification: graph.status,
      angularSegments: null,
      axialSegments: null,
      persistedGridTriangles: null,
      neutralMeshTriangles: null,
    };
  }
  const rectangle = rectangleSampling(surface, loop, graph);
  if (!rectangle.ok) {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification: rectangle.error,
      angularSegments: null,
      axialSegments: null,
      persistedGridTriangles: null,
      neutralMeshTriangles: null,
    };
  }
  const persistedGridTriangles =
    rectangle.angularSegments * rectangle.axialSegments * 2;
  if (surface.kind === "cone") {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification: "cone-neutral-tessellator-missing",
      ...rectangle,
      persistedGridTriangles,
      neutralMeshTriangles: null,
    };
  }
  if (surface.kind !== "cylinder") {
    throw new Error(`unexpected surface kind ${surface.kind}`);
  }

  const provenance = {
    decoderId: "revit-2027-cylinder-cone-trim-audit",
    elementId,
  };
  const adapted = adaptRevit2027CylinderSampledBrep({
    id: `revit-2027-owner-${elementId}-face-${faceToken}`,
    provenance,
    continuityTolerance: UV_TOLERANCE,
    faces: [{
      faceToken,
      surface,
      loops: [{
        loopToken: loop.token,
        role: "outer",
        edgeUses: graph.edgeUses,
      }],
      materialId: null,
      provenance,
    }],
  });
  if (!adapted.ok) {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification: `adapter-${adapted.issues[0]?.code ?? "failure"}`,
      ...rectangle,
      persistedGridTriangles,
      neutralMeshTriangles: null,
    };
  }
  const angularSpan = Math.abs(
    surface.surface.envelope.secondCorner[0] -
      surface.surface.envelope.firstCorner[0],
  );
  if (
    angularSpan >= Math.PI * 2 - UV_TOLERANCE ||
    rectangle.axialSegments !== 1
  ) {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification:
        angularSpan >= Math.PI * 2 - UV_TOLERANCE
          ? "full-period-cylinder-chart"
          : "multi-segment-axial-policy-not-bound",
      ...rectangle,
      persistedGridTriangles,
      neutralMeshTriangles: null,
    };
  }

  // Diagnostic only: preserve the exact persisted angular interval count.
  // The RVT does not persist the renderer's LOD policy, so this is explicitly
  // not claimed as the original native policy.
  const sampleMatchedPolicy = {
    maximumEdgeLength: 0,
    maximumAngleDegrees:
      (angularSpan / rectangle.angularSegments) *
      (180 / Math.PI) *
      (1 + 1e-12),
    surfaceDeviation: 0,
  };
  const tessellated = tessellateNeutralBrep(adapted.brep, {
    distanceTolerance: 1e-10,
    angularTolerance: UV_TOLERANCE,
    nativePolicy: sampleMatchedPolicy,
  });
  if (!tessellated.ok) {
    return {
      ...base,
      loopCount: 1,
      edgeCount: graph.edgeUses.length,
      classification:
        `neutral-${tessellated.issues[0]?.code ?? "failure"}`,
      ...rectangle,
      persistedGridTriangles,
      neutralMeshTriangles: null,
    };
  }
  return {
    ...base,
    loopCount: 1,
    edgeCount: graph.edgeUses.length,
    classification: "neutral-cylinder-tessellated",
    ...rectangle,
    persistedGridTriangles,
    neutralMeshTriangles: tessellated.mesh.indices.length / 3,
  };
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/audit-revit-2027-cylinder-cone-trims.ts model.rvt",
  );
}
const model = openRvt(modelPath);
const release = model.requireRelease(2027);

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);
let chunks = 0;
let failedChunks = 0;
let directOwners = 0;
let completedOwners = 0;
const faceAudits: FaceAudit[] = [];
const coneDetails: ConeAuditDetail[] = [];
const ownerIds = new Set<number>();
for (const { data: inflated } of iterateInflatedChunks(model, {
  onFailure: () => {
    failedChunks += 1;
  },
})) {
  chunks += 1;
  for (const frame of scanFramedElementObjects(inflated)) {
    if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
    const root = decodeRevit2027FramedGRepRoot(inflated, frame, release);
    if (!root.ok) continue;
    if (
      root.value.children.length !== 1 ||
      root.value.children[0]?.sourceClassSlot !==
        REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    directOwners += 1;
    const owner = replayOwner(inflated, root.value, release);
    if (!owner) continue;
    completedOwners += 1;
    for (const [faceToken, surface] of owner.surfacesByFace) {
      if (surface.kind !== "cylinder" && surface.kind !== "cone") continue;
      const face = owner.faces.get(faceToken);
      if (!face) throw new Error(`owner lacks Face token ${faceToken}`);
      ownerIds.add(frame.elementId);
      if (surface.kind === "cone") {
        coneDetails.push(
          coneDetail(frame.elementId, owner, faceToken, face, surface),
        );
      }
      faceAudits.push(
        auditFace(frame.elementId, owner, faceToken, face, surface),
      );
    }
  }

}
const classifications = new Map<string, number>();
for (const face of faceAudits) increment(classifications, face.classification);
const cylinderFaces = faceAudits.filter(
  (face) => face.surfaceKind === "cylinder",
);
const coneFaces = faceAudits.filter((face) => face.surfaceKind === "cone");
const cylinderClassifications = new Map<string, number>();
for (const face of cylinderFaces) {
  increment(cylinderClassifications, face.classification);
}
const coneClassifications = new Map<string, number>();
for (const face of coneFaces) {
  increment(coneClassifications, face.classification);
}
const tessellated = faceAudits.filter(
  (face) => face.classification === "neutral-cylinder-tessellated",
);
const tessellatedOwnerIds = new Set(
  tessellated.map((face) => face.elementId),
);
const sum = (
  rows: readonly FaceAudit[],
  field: "persistedGridTriangles" | "neutralMeshTriangles",
): number =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0);

console.log(JSON.stringify({
  modelPath,
  release,
  scope: {
    partitions: partitions.length,
    chunks,
    failedChunks,
    directSingleGeometryOwners: directOwners,
    completedOwnerQueues: completedOwners,
    analyticCylinderConeOwners: ownerIds.size,
    cylinderFaces: cylinderFaces.length,
    coneFaces: coneFaces.length,
  },
  classification: sortedEntries(classifications),
  classificationBySurface: {
    cylinder: sortedEntries(cylinderClassifications),
    cone: sortedEntries(coneClassifications),
  },
  coverage: {
    neutralCylinderFaces: tessellated.length,
    neutralCylinderOwners: tessellatedOwnerIds.size,
    neutralCylinderFaceRatio:
      cylinderFaces.length === 0
        ? null
        : tessellated.length / cylinderFaces.length,
    persistedGridTrianglesAllRectangles: sum(
      faceAudits,
      "persistedGridTriangles",
    ),
    persistedGridTrianglesNeutralCylinders: sum(
      tessellated,
      "persistedGridTriangles",
    ),
    sampleMatchedNeutralTriangles: sum(
      tessellated,
      "neutralMeshTriangles",
    ),
    trianglePolicy:
      "diagnostic only: exact persisted boundary interval counts; neutral " +
      "cylinder policy matches the angular count when axialSegments=1",
  },
  coneDetails: coneDetails.sort(
    (left, right) =>
      left.elementId - right.elementId || left.faceToken - right.faceToken,
  ),
  faces: faceAudits.sort(
    (left, right) =>
      left.elementId - right.elementId ||
      left.faceToken - right.faceToken,
  ),
}, null, 2));
