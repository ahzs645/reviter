/**
 * Replay the exact safe Revit 2027 single-Geometry roots through every
 * Geometry Face, GEdge, and initial Face child. Certified descendants are
 * appended to the same FIFO; each owner stops at its first unknown descendant.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-face-child-replay.ts model.rvt
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  decodeRevit2027EdgeLoopStatic,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  type Revit2027EdgeLoopStatic,
} from "../lib/reviter/revit-2027-edge-loop-static.ts";
import {
  decodeRevit2027GEdgeStatic,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-edge-1423.ts";
import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-face-static.ts";
import {
  decodeRevit2027FillPatternData,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-pattern-data.ts";
import {
  decodeRevit2027FillGrid,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-fill-grid.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GFilling,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
  type Revit2027GFilling,
} from "../lib/reviter/revit-2027-gfilling.ts";
import {
  decodeRevit2027GArc,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-garc.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";
import { decodeRevit2027GGroupStatic } from "../lib/reviter/revit-2027-ggroup-fifo.ts";
import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-grep-prefixes.ts";
import {
  decodeRevit2027AnalyticSurface,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  type Revit2027AnalyticSurface,
} from "../lib/reviter/revit-2027-surfaces.ts";

const MAX_OWNER_QUEUE = 1_000_000;
const INITIAL_CHILD_SLOTS = new Set([
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
]);
const SURFACE_SLOTS = new Set([
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
]);

type QueueOrigin =
  | "geometry-face"
  | "geometry-edge"
  | "initial-face-child"
  | "descendant";

type QueueItem = {
  entry: CondInt16QueueEntry;
  origin: QueueOrigin;
  parentSourceClassSlot: number | null;
  generation: number;
};

type NumberStats = {
  count: number;
  finite: number;
  nonFinite: number;
  min: number;
  max: number;
};

type TokenNamespaceState = {
  nextPositiveToken: number;
  reservedStaticTokens: Set<number>;
  propertySourceSlots: Map<number, number>;
};

type SourceStats = {
  decoded: number;
  initialFaceChildren: number;
  descendants: number;
  bodyBytes: Map<number, number>;
  childSlots: Map<number, number>;
  childTokenKinds: Map<string, number>;
};

type ReplayContext = {
  partitionPath: string;
  chunkIndex: number;
  frameOffset: number;
  elementId: number;
};

type BodyHistory = {
  sourceClassSlot: number;
  origin: QueueOrigin;
  generation: number;
  token: number;
  parentSourceClassSlot: number | null;
  startOffset: number;
  endOffset: number;
};

type FailureSample = {
  error: string;
  context: ReplayContext;
  dynamicPayloadOffset: number;
  dynamicPayloadEndOffset: number;
  queueIndex: number;
  queueLength: number;
  nextExpectedToken: number;
  item: Omit<BodyHistory, "startOffset" | "endOffset"> & {
    bodyOffset: number;
  };
  int32AtBody: number | null;
  int32AtBodyPlus20: number | null;
  bytesFromBodyMinus32: string;
  previousBodies: readonly BodyHistory[];
  previousBodyBytes: readonly {
    sourceClassSlot: number;
    startOffset: number;
    endOffset: number;
    bytes: string;
  }[];
};

type ReplayStats = {
  directGeometryRoots: number;
  singleGroupGeometryRoots: number;
  owners: number;
  completedOwners: number;
  blockedOwners: number;
  faces: number;
  edges: number;
  expectedInitialFaceChildren: number;
  decodedInitialFaceChildren: number;
  decodedDescendants: number;
  source: Map<number, SourceStats>;
  firstBlockerSlots: Map<number, number>;
  firstBlockerParents: Map<string, number>;
  firstBlockerTokens: Map<string, number>;
  bytesBeforeFirstBlocker: Map<number, number>;
  readerFailures: Map<string, number>;
  routeFailures: Map<string, number>;
  boundaryFailures: Map<string, number>;
  failureSamples: FailureSample[];
  loopEnvelopeScalars: NumberStats;
  loopReferences: NumberStats;
  loopOpen: Map<string, number>;
  loopWithChainCounts: Map<number, number>;
  loopChainStartReferences: NumberStats;
  loopChainEnvelopeScalars: NumberStats;
  fillingScalars: NumberStats;
  fillingFaceReferences: NumberStats;
  fillingPatternIds: Map<string, number>;
  fillingColors: Map<number, number>;
  fillingFlags: Map<number, number>;
  fillingBooleanPairs: Map<string, number>;
  surfaceScalars: Map<number, NumberStats>;
  surfaceOrient: Map<string, number>;
  staticReferenceTokens: NumberStats;
  acceptedSparseTokenGaps: number;
  acceptedSparseTokenGapWidths: Map<number, number>;
  acceptedSparseTokenIndices: number;
  reusedPropertyReferences: number;
  reusedPropertySlots: Map<number, number>;
  materializedReservedTokens: number;
};

function increment<K>(map: Map<K, number>, key: K, count = 1): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function numberStats(): NumberStats {
  return {
    count: 0,
    finite: 0,
    nonFinite: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
}

function recordNumber(stats: NumberStats, value: number): void {
  stats.count += 1;
  if (!Number.isFinite(value)) {
    stats.nonFinite += 1;
    return;
  }
  stats.finite += 1;
  stats.min = Math.min(stats.min, value);
  stats.max = Math.max(stats.max, value);
}

function sourceStats(replay: ReplayStats, sourceClassSlot: number): SourceStats {
  let stats = replay.source.get(sourceClassSlot);
  if (!stats) {
    stats = {
      decoded: 0,
      initialFaceChildren: 0,
      descendants: 0,
      bodyBytes: new Map(),
      childSlots: new Map(),
      childTokenKinds: new Map(),
    };
    replay.source.set(sourceClassSlot, stats);
  }
  return stats;
}

function recordBody(
  replay: ReplayStats,
  item: QueueItem,
  startOffset: number,
  endOffset: number,
  children: readonly CondInt16QueueEntry[],
): void {
  const stats = sourceStats(replay, item.entry.sourceClassSlot!);
  stats.decoded += 1;
  if (item.origin === "initial-face-child") {
    stats.initialFaceChildren += 1;
    replay.decodedInitialFaceChildren += 1;
  } else if (item.origin === "descendant") {
    stats.descendants += 1;
    replay.decodedDescendants += 1;
  }
  increment(stats.bodyBytes, endOffset - startOffset);
  for (const child of children) {
    increment(stats.childSlots, child.sourceClassSlot!);
    increment(
      stats.childTokenKinds,
      `${child.sourceClassSlot}:${
        child.token === -1 ? "sentinel" : "numbered"
      }`,
    );
  }
}

function registerStaticReferences(
  replay: ReplayStats,
  state: TokenNamespaceState,
  references: readonly number[],
): void {
  for (const reference of references) {
    recordNumber(replay.staticReferenceTokens, reference);
    if (reference > 0) state.reservedStaticTokens.add(reference);
  }
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  state: TokenNamespaceState,
  replay: ReplayStats,
):
  | { ok: true; appended: readonly CondInt16QueueEntry[] }
  | { ok: false; error: string } {
  const appended: CondInt16QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.sourceClassSlot == null || entry.token === 0) {
      return {
        ok: false,
        error: "FIFO append list contains a null property",
      };
    }
    if (entry.token === -1) {
      appended.push(entry);
      continue;
    }
    if (entry.token < -1) {
      return {
        ok: false,
        error: `FIFO append list contains unproven sentinel ${entry.token}`,
      };
    }
    const existingSlot = state.propertySourceSlots.get(entry.token);
    if (existingSlot != null) {
      if (existingSlot !== entry.sourceClassSlot) {
        return {
          ok: false,
          error:
            `FIFO token ${entry.token} changed source slot from ` +
            `${existingSlot} to ${entry.sourceClassSlot}`,
        };
      }
      replay.reusedPropertyReferences += 1;
      increment(replay.reusedPropertySlots, entry.sourceClassSlot);
      continue;
    }
    if (entry.token < state.nextPositiveToken) {
      if (!state.reservedStaticTokens.has(entry.token)) {
        return {
          ok: false,
          error:
            `FIFO token ${entry.token} is below the next token ` +
            `${state.nextPositiveToken} and has no earlier StaticInteger ` +
            `reservation`,
        };
      }
      replay.materializedReservedTokens += 1;
      state.propertySourceSlots.set(
        entry.token,
        entry.sourceClassSlot,
      );
      appended.push(entry);
      continue;
    }
    const gapWidth = entry.token - state.nextPositiveToken;
    if (gapWidth > 0) {
      for (
        let skipped = state.nextPositiveToken;
        skipped < entry.token;
        skipped += 1
      ) {
        if (!state.reservedStaticTokens.has(skipped)) {
          return {
            ok: false,
            error:
              `FIFO token gap is not reserved by an earlier StaticInteger ` +
              `reference: missing ${skipped} before token ${entry.token} ` +
              `for source slot ${entry.sourceClassSlot}`,
          };
        }
      }
      replay.acceptedSparseTokenGaps += 1;
      replay.acceptedSparseTokenIndices += gapWidth;
      increment(replay.acceptedSparseTokenGapWidths, gapWidth);
    }
    state.propertySourceSlots.set(entry.token, entry.sourceClassSlot);
    appended.push(entry);
    state.nextPositiveToken = entry.token + 1;
  }
  return { ok: true, appended };
}

function recordLoopValues(
  replay: ReplayStats,
  loop: Revit2027EdgeLoopStatic,
): void {
  for (const value of [
    ...loop.envelope.minimum,
    ...loop.envelope.maximum,
  ]) {
    recordNumber(replay.loopEnvelopeScalars, value);
  }
  for (const value of [
    loop.faceReference,
    loop.nextEdgeReference,
    loop.previousEdgeReference,
  ]) {
    recordNumber(replay.loopReferences, value);
  }
  increment(replay.loopOpen, String(loop.open));
}

function recordFillingValues(
  replay: ReplayStats,
  filling: Revit2027GFilling,
): void {
  for (const value of [
    filling.placer.scale,
    ...filling.placer.origin,
    ...filling.placer.direction,
    ...filling.placer.uvScale,
  ]) {
    recordNumber(replay.fillingScalars, value);
  }
  recordNumber(replay.fillingFaceReferences, filling.faceIdReference);
  increment(replay.fillingPatternIds, filling.patternElementId.toString());
  increment(replay.fillingColors, filling.fillColor);
  increment(replay.fillingFlags, filling.flags);
  increment(
    replay.fillingBooleanPairs,
    `${Number(filling.placer.mirrored)},${Number(
      filling.placer.placedDraft,
    )}`,
  );
}

function surfaceNumbers(surface: Revit2027AnalyticSurface): number[] {
  const values = [
    ...surface.surface.envelope.firstCorner,
    ...surface.surface.envelope.secondCorner,
  ];
  if (surface.kind === "plane") {
    values.push(...surface.origin, ...surface.xVector, ...surface.yVector);
  } else if (surface.kind === "cone") {
    values.push(
      ...surface.center,
      ...surface.xVector,
      ...surface.yVector,
      ...surface.zVector,
      surface.halfAngle,
    );
  } else if (surface.kind === "cylinder") {
    values.push(
      ...surface.center,
      ...surface.xVector,
      ...surface.yVector,
      ...surface.zVector,
      surface.radius,
    );
  } else if (surface.kind === "surface-of-revolution") {
    values.push(
      ...surface.center,
      ...surface.xVector,
      ...surface.yVector,
      ...surface.zVector,
    );
  }
  return values;
}

function recordSurfaceValues(
  replay: ReplayStats,
  surface: Revit2027AnalyticSurface,
): void {
  let stats = replay.surfaceScalars.get(surface.sourceClassSlot);
  if (!stats) {
    stats = numberStats();
    replay.surfaceScalars.set(surface.sourceClassSlot, stats);
  }
  for (const value of surfaceNumbers(surface)) recordNumber(stats, value);
  increment(
    replay.surfaceOrient,
    `${surface.sourceClassSlot}:${String(surface.surface.orientFlag)}`,
  );
}

function appendChildren(
  queue: QueueItem[],
  children: readonly CondInt16QueueEntry[],
  parent: QueueItem,
): void {
  const generation =
    parent.origin === "geometry-face" ? 0 : parent.generation + 1;
  const origin: QueueOrigin =
    parent.origin === "geometry-face"
      ? "initial-face-child"
      : "descendant";
  for (const entry of children) {
    queue.push({
      entry,
      origin,
      parentSourceClassSlot: parent.entry.sourceClassSlot,
      generation,
    });
  }
}

function hexWindow(
  data: Uint8Array,
  byteOffset: number,
  before = 32,
  after = 160,
): string {
  const start = Math.max(0, byteOffset - before);
  const end = Math.min(data.byteLength, byteOffset + after);
  return [...data.subarray(start, end)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

function int32IfBounded(
  data: Uint8Array,
  byteOffset: number,
): number | null {
  if (byteOffset < 0 || byteOffset > data.byteLength - 4) return null;
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getInt32(byteOffset, true);
}

function replaySingleGeometryRoot(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  release: number,
  replay: ReplayStats,
  context: ReplayContext,
): void {
  let geometryOffset: number | null = null;
  const tokenState: TokenNamespaceState = {
    nextPositiveToken: 3,
    reservedStaticTokens: new Set(),
    propertySourceSlots: new Map(),
  };
  if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    replay.directGeometryRoots += 1;
    const result = requireTokens(root.children, tokenState, replay);
    if (!result.ok || result.appended.length !== 1) {
      increment(
        replay.routeFailures,
        `direct root: ${
          result.ok ? "Geometry property was reused" : result.error
        }`,
      );
      return;
    }
    geometryOffset = root.dynamicPayloadOffset;
  } else if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
  ) {
    const rootResult = requireTokens(root.children, tokenState, replay);
    if (!rootResult.ok || rootResult.appended.length !== 1) {
      increment(
        replay.routeFailures,
        `single group root: ${
          rootResult.ok ? "GGroup property was reused" : rootResult.error
        }`,
      );
      return;
    }
    const group = decodeRevit2027GGroupStatic(
      data,
      root.dynamicPayloadOffset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (
      !group.ok ||
      group.value.children.length !== 1 ||
      group.value.children[0]?.sourceClassSlot !==
        REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      return;
    }
    replay.singleGroupGeometryRoots += 1;
    const groupResult = requireTokens(
      group.value.children,
      tokenState,
      replay,
    );
    if (!groupResult.ok || groupResult.appended.length !== 1) {
      increment(
        replay.routeFailures,
        `single group child: ${
          groupResult.ok
            ? "Geometry property was reused"
            : groupResult.error
        }`,
      );
      return;
    }
    geometryOffset = group.value.endOffset;
  }
  if (geometryOffset == null) return;

  const geometry = decodeRevit2027GeometryStatic(
    data,
    geometryOffset,
    root.dynamicPayloadEndOffset,
    release,
  );
  if (!geometry.ok) {
    increment(replay.routeFailures, geometry.error);
    return;
  }
  const geometryResult = requireTokens(
    geometry.value.queuedProperties,
    tokenState,
    replay,
  );
  if (!geometryResult.ok) {
    increment(replay.routeFailures, geometryResult.error);
    return;
  }
  if (
    geometryResult.appended.length !==
    geometry.value.queuedProperties.length
  ) {
    increment(
      replay.routeFailures,
      "Geometry contains a reused Face, GEdge, or shared-surface property",
    );
    return;
  }
  if (
    geometry.value.faces.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    ) ||
    geometry.value.edges.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    )
  ) {
    increment(
      replay.routeFailures,
      "Geometry Face or GEdge source slot changed",
    );
    return;
  }
  replay.owners += 1;

  const queue: QueueItem[] = [
    ...geometry.value.faces.entries.map((entry) => ({
      entry,
      origin: "geometry-face" as const,
      parentSourceClassSlot: REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
      generation: -1,
    })),
    ...geometry.value.edges.entries.map((entry) => ({
      entry,
      origin: "geometry-edge" as const,
      parentSourceClassSlot: REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
      generation: -1,
    })),
  ];
  let cursor = geometry.value.endOffset;
  let queueIndex = 0;
  let ownerInitialChildren = 0;
  let ownerDecodedInitialChildren = 0;
  let firstBlocker: QueueItem | null = null;
  let readerFailure: string | null = null;
  let failedItem: QueueItem | null = null;
  const history: BodyHistory[] = [];

  while (queueIndex < queue.length) {
    if (queue.length > MAX_OWNER_QUEUE) {
      readerFailure = "owner queue exceeds the safety bound";
      break;
    }
    const item = queue[queueIndex]!;
    const sourceClassSlot = item.entry.sourceClassSlot!;
    const bodyOffset = cursor;
    let endOffset = cursor;
    let children: readonly CondInt16QueueEntry[] = [];
    let staticReferencesAfterProperties: readonly number[] = [];

    if (sourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT) {
      const face = decodeRevit2027FaceStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!face.ok) {
        readerFailure = `${sourceClassSlot}: ${face.error}`;
        failedItem = item;
        break;
      }
      endOffset = face.value.endOffset;
      children = face.value.queuedProperties;
      replay.faces += 1;
      ownerInitialChildren += children.length;
      replay.expectedInitialFaceChildren += children.length;
    } else if (sourceClassSlot === REVIT_2027_GEDGE_SOURCE_CLASS_SLOT) {
      const edge = decodeRevit2027GEdgeStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!edge.ok) {
        readerFailure = `${sourceClassSlot}: ${edge.error}`;
        failedItem = item;
        break;
      }
      endOffset = edge.value.endOffset;
      staticReferencesAfterProperties = [
        ...edge.value.faceReferences,
        ...edge.value.nextReferences,
        ...edge.value.previousReferences,
      ];
      replay.edges += 1;
    } else if (
      sourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
    ) {
      const loop = decodeRevit2027EdgeLoopStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!loop.ok) {
        readerFailure = `${sourceClassSlot}: ${loop.error}`;
        failedItem = item;
        break;
      }
      endOffset = loop.value.endOffset;
      children = loop.value.queuedProperties;
      staticReferencesAfterProperties = loop.value.staticReferences;
      recordLoopValues(replay, loop.value);
    } else if (
      sourceClassSlot ===
      REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT
    ) {
      const loop = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!loop.ok) {
        readerFailure = `${sourceClassSlot}: ${loop.error}`;
        failedItem = item;
        break;
      }
      endOffset = loop.value.endOffset;
      children = loop.value.loop.queuedProperties;
      staticReferencesAfterProperties = loop.value.staticReferences;
      recordLoopValues(replay, loop.value.loop);
      increment(replay.loopWithChainCounts, loop.value.chains.length);
      for (const chain of loop.value.chains) {
        recordNumber(
          replay.loopChainStartReferences,
          chain.startEdgeReference,
        );
        for (const scalar of [
          ...chain.envelope.minimum,
          ...chain.envelope.maximum,
        ]) {
          recordNumber(replay.loopChainEnvelopeScalars, scalar);
        }
      }
    } else if (sourceClassSlot === REVIT_2027_GFILLING_SOURCE_CLASS_SLOT) {
      const filling = decodeRevit2027GFilling(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!filling.ok) {
        readerFailure = `${sourceClassSlot}: ${filling.error}`;
        failedItem = item;
        break;
      }
      endOffset = filling.value.endOffset;
      children = filling.value.queuedProperties;
      registerStaticReferences(
        replay,
        tokenState,
        [filling.value.faceIdReference],
      );
      recordFillingValues(replay, filling.value);
    } else if (
      sourceClassSlot === REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT
    ) {
      const pattern = decodeRevit2027FillPatternData(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!pattern.ok) {
        readerFailure = `${sourceClassSlot}: ${pattern.error}`;
        failedItem = item;
        break;
      }
      endOffset = pattern.value.endOffset;
      children = pattern.value.queuedProperties;
    } else if (sourceClassSlot === REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT) {
      const grid = decodeRevit2027FillGrid(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!grid.ok) {
        readerFailure = `${sourceClassSlot}: ${grid.error}`;
        failedItem = item;
        break;
      }
      endOffset = grid.value.endOffset;
    } else if (sourceClassSlot === REVIT_2027_GARC_SOURCE_CLASS_SLOT) {
      const arc = decodeRevit2027GArc(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!arc.ok) {
        readerFailure = `${sourceClassSlot}: ${arc.error}`;
        failedItem = item;
        break;
      }
      endOffset = arc.value.endOffset;
    } else if (SURFACE_SLOTS.has(sourceClassSlot)) {
      const surface = decodeRevit2027AnalyticSurface(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        release,
        sourceClassSlot,
      );
      if (!surface.ok) {
        readerFailure = `${sourceClassSlot}: ${surface.error}`;
        failedItem = item;
        break;
      }
      endOffset = surface.value.endOffset;
      children = surface.value.queuedProperties;
      recordSurfaceValues(replay, surface.value);
    } else {
      firstBlocker = item;
      break;
    }

    const tokenResult = requireTokens(children, tokenState, replay);
    if (!tokenResult.ok) {
      readerFailure = `${sourceClassSlot}: ${tokenResult.error}`;
      failedItem = item;
      break;
    }
    children = tokenResult.appended;
    registerStaticReferences(
      replay,
      tokenState,
      staticReferencesAfterProperties,
    );
    if (
      item.origin === "initial-face-child" &&
      !INITIAL_CHILD_SLOTS.has(sourceClassSlot)
    ) {
      readerFailure =
        `uncertified initial Face child source slot ${sourceClassSlot}`;
      failedItem = item;
      break;
    }
    recordBody(replay, item, bodyOffset, endOffset, children);
    if (item.origin === "initial-face-child") {
      ownerDecodedInitialChildren += 1;
    }
    appendChildren(queue, children, item);
    history.push({
      sourceClassSlot,
      origin: item.origin,
      generation: item.generation,
      token: item.entry.token,
      parentSourceClassSlot: item.parentSourceClassSlot,
      startOffset: bodyOffset,
      endOffset,
    });
    if (history.length > 8) history.shift();
    cursor = endOffset;
    queueIndex += 1;
  }

  if (readerFailure) {
    increment(replay.readerFailures, readerFailure);
    if (failedItem && replay.failureSamples.length < 64) {
      replay.failureSamples.push({
        error: readerFailure,
        context,
        dynamicPayloadOffset: root.dynamicPayloadOffset,
        dynamicPayloadEndOffset: root.dynamicPayloadEndOffset,
        queueIndex,
        queueLength: queue.length,
        nextExpectedToken: tokenState.nextPositiveToken,
        item: {
          sourceClassSlot: failedItem.entry.sourceClassSlot!,
          origin: failedItem.origin,
          generation: failedItem.generation,
          token: failedItem.entry.token,
          parentSourceClassSlot: failedItem.parentSourceClassSlot,
          bodyOffset: cursor,
        },
        int32AtBody: int32IfBounded(data, cursor),
        int32AtBodyPlus20: int32IfBounded(data, cursor + 20),
        bytesFromBodyMinus32: hexWindow(data, cursor),
        previousBodies: [...history],
        previousBodyBytes: history.map((body) => ({
          sourceClassSlot: body.sourceClassSlot,
          startOffset: body.startOffset,
          endOffset: body.endOffset,
          bytes: [...data.subarray(body.startOffset, body.endOffset)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(" "),
        })),
      });
    }
    return;
  }
  if (ownerDecodedInitialChildren !== ownerInitialChildren) {
    increment(
      replay.boundaryFailures,
      `initial Face child coverage ${ownerDecodedInitialChildren}/${ownerInitialChildren}`,
    );
    return;
  }
  if (firstBlocker) {
    replay.blockedOwners += 1;
    increment(
      replay.firstBlockerSlots,
      firstBlocker.entry.sourceClassSlot!,
    );
    increment(
      replay.firstBlockerParents,
      `${
        firstBlocker.parentSourceClassSlot ?? "root"
      }->${firstBlocker.entry.sourceClassSlot}`,
    );
    increment(
      replay.firstBlockerTokens,
      `${
        firstBlocker.entry.sourceClassSlot
      }:${firstBlocker.entry.token === -1 ? "sentinel" : "numbered"}`,
    );
    increment(
      replay.bytesBeforeFirstBlocker,
      cursor - geometry.value.endOffset,
    );
    return;
  }

  if (cursor !== root.dynamicPayloadEndOffset) {
    increment(
      replay.boundaryFailures,
      `completed queue leaves ${
        root.dynamicPayloadEndOffset - cursor
      } payload bytes`,
    );
    return;
  }
  replay.completedOwners += 1;
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

function numberSummary(stats: NumberStats) {
  return {
    count: stats.count,
    finite: stats.finite,
    nonFinite: stats.nonFinite,
    range:
      stats.finite === 0
        ? null
        : { min: stats.min, max: stats.max },
  };
}

function sourceSummary(source: Map<number, SourceStats>) {
  return Object.fromEntries(
    [...source]
      .sort((left, right) => left[0] - right[0])
      .map(([slot, stats]) => [
        slot,
        {
          decoded: stats.decoded,
          initialFaceChildren: stats.initialFaceChildren,
          descendants: stats.descendants,
          bodyBytes: entries(stats.bodyBytes),
          appendedChildSlots: entries(stats.childSlots),
          appendedChildTokenKinds: entries(stats.childTokenKinds),
        },
      ]),
  );
}

const replay: ReplayStats = {
  directGeometryRoots: 0,
  singleGroupGeometryRoots: 0,
  owners: 0,
  completedOwners: 0,
  blockedOwners: 0,
  faces: 0,
  edges: 0,
  expectedInitialFaceChildren: 0,
  decodedInitialFaceChildren: 0,
  decodedDescendants: 0,
  source: new Map(),
  firstBlockerSlots: new Map(),
  firstBlockerParents: new Map(),
  firstBlockerTokens: new Map(),
  bytesBeforeFirstBlocker: new Map(),
  readerFailures: new Map(),
  routeFailures: new Map(),
  boundaryFailures: new Map(),
  failureSamples: [],
  loopEnvelopeScalars: numberStats(),
  loopReferences: numberStats(),
  loopOpen: new Map(),
  loopWithChainCounts: new Map(),
  loopChainStartReferences: numberStats(),
  loopChainEnvelopeScalars: numberStats(),
  fillingScalars: numberStats(),
  fillingFaceReferences: numberStats(),
  fillingPatternIds: new Map(),
  fillingColors: new Map(),
  fillingFlags: new Map(),
  fillingBooleanPairs: new Map(),
  surfaceScalars: new Map(),
  surfaceOrient: new Map(),
  staticReferenceTokens: numberStats(),
  acceptedSparseTokenGaps: 0,
  acceptedSparseTokenGapWidths: new Map(),
  acceptedSparseTokenIndices: 0,
  reusedPropertyReferences: 0,
  reusedPropertySlots: new Map(),
  materializedReservedTokens: 0,
};

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2027-face-child-replay.ts model.rvt",
  );
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(
    `audit requires a Revit 2027 file, received ${release ?? "unknown"}`,
  );
}

const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );
let chunks = 0;
let failedChunks = 0;

for (const partition of partitions) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;

    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const decodedRoot = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        release,
      );
      if (!decodedRoot.ok) continue;
      replaySingleGeometryRoot(
        inflated,
        decodedRoot.value,
        release,
        replay,
        {
          partitionPath: partition.path,
          chunkIndex,
          frameOffset: frame.offset,
          elementId: frame.elementId,
        },
      );
    }
  }
}

const readerCorpusValid =
  replay.owners === 5_996 &&
  replay.faces === 40_961 &&
  replay.edges === 84_499 &&
  replay.expectedInitialFaceChildren === 116_844 &&
  replay.decodedInitialFaceChildren ===
    replay.expectedInitialFaceChildren &&
  replay.readerFailures.size === 0 &&
  replay.routeFailures.size === 0 &&
  replay.boundaryFailures.size === 0;

console.log(
  JSON.stringify(
    {
      modelPath,
      release,
      partitions: partitions.length,
      chunks,
      failedChunks,
      ownerScopes: {
        directGeometryRoots: replay.directGeometryRoots,
        singleGroupGeometryRoots: replay.singleGroupGeometryRoots,
        total: replay.owners,
        completed: replay.completedOwners,
        stoppedAtFirstUncertifiedDescendant: replay.blockedOwners,
      },
      initialReplay: {
        faces: replay.faces,
        edges: replay.edges,
        expectedFaceChildren: replay.expectedInitialFaceChildren,
        decodedFaceChildren: replay.decodedInitialFaceChildren,
        complete:
          replay.decodedInitialFaceChildren ===
          replay.expectedInitialFaceChildren,
      },
      certifiedDescendantsDecoded: replay.decodedDescendants,
      tokenNamespace: {
        rule:
          "new positive property tokens either advance the namespace or materialize one earlier StaticInteger reservation exactly once; every forward gap index must already be reserved",
        staticReferenceTokens: numberSummary(
          replay.staticReferenceTokens,
        ),
        acceptedSparseGaps: replay.acceptedSparseTokenGaps,
        acceptedSparseIndices: replay.acceptedSparseTokenIndices,
        gapWidths: entries(replay.acceptedSparseTokenGapWidths),
        reusedPropertyReferences: replay.reusedPropertyReferences,
        reusedPropertySourceSlots: entries(replay.reusedPropertySlots),
        materializedReservedTokens: replay.materializedReservedTokens,
      },
      sourceSlots: sourceSummary(replay.source),
      valueValidity: {
        edgeLoop: {
          envelopeScalars: numberSummary(replay.loopEnvelopeScalars),
          referenceTokens: numberSummary(replay.loopReferences),
          open: entries(replay.loopOpen),
        },
        edgeLoopWithChainEnvelopes: {
          chainCounts: entries(replay.loopWithChainCounts),
          startEdgeReferences: numberSummary(
            replay.loopChainStartReferences,
          ),
          envelopeScalars: numberSummary(
            replay.loopChainEnvelopeScalars,
          ),
        },
        gFilling: {
          placerScalars: numberSummary(replay.fillingScalars),
          faceIdReferences: numberSummary(replay.fillingFaceReferences),
          distinctPatternElementIds: replay.fillingPatternIds.size,
          patternElementIds: entries(replay.fillingPatternIds),
          fillColors: entries(replay.fillingColors),
          flags: entries(replay.fillingFlags),
          placerBooleanPairs: entries(replay.fillingBooleanPairs),
        },
        surfaces: Object.fromEntries(
          [...replay.surfaceScalars]
            .sort((left, right) => left[0] - right[0])
            .map(([slot, stats]) => [slot, numberSummary(stats)]),
        ),
        surfaceOrientation: entries(replay.surfaceOrient),
      },
      firstUncertifiedDescendants: {
        sourceSlots: entries(replay.firstBlockerSlots),
        parentToChild: entries(replay.firstBlockerParents),
        tokenKinds: entries(replay.firstBlockerTokens),
        bytesDecodedAfterGeometryBeforeBlocker:
          entries(replay.bytesBeforeFirstBlocker),
      },
      failures: {
        readers: entries(replay.readerFailures),
        routes: entries(replay.routeFailures),
        boundaries: entries(replay.boundaryFailures),
        samples: replay.failureSamples,
      },
      readerCorpusValid,
      stopBoundary:
        "each owner stops at its first unknown FIFO descendant; no unknown body is scanned, skipped, or assigned an inferred width",
    },
    null,
    2,
  ),
);

if (!readerCorpusValid) process.exitCode = 1;
