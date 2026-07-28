import type { CondInt16QueueEntry } from "./dynamic-geometry-queue.ts";
import {
  decodeRevit2027EdgeLoopStatic,
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
} from "./revit-2027-edge-loop-static.ts";
import {
  decodeRevit2027GEdgeStatic,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
} from "./revit-2027-edge-1423.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "./revit-2027-face-static.ts";
import {
  decodeRevit2027FillGrid,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
} from "./revit-2027-fill-grid.ts";
import {
  decodeRevit2027FillPatternData,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
} from "./revit-2027-fill-pattern-data.ts";
import {
  decodeRevit2027GFilling,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
} from "./revit-2027-gfilling.ts";
import {
  decodeRevit2027GArc,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
} from "./revit-2027-garc.ts";
import {
  decodeRevit2027GLine,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
} from "./revit-2027-gline.ts";
import {
  decodeRevit2027GArray,
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "./revit-2027-grep-prefixes.ts";
import {
  decodeRevit2027GGroupStatic,
} from "./revit-2027-ggroup-fifo.ts";
import {
  decodeRevit2027GPolyLine,
  REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
} from "./revit-2027-gpolyline.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "./revit-2027-geometry.ts";
import {
  decodeRevit2027AnalyticSurface,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
} from "./revit-2027-surfaces.ts";

export const REVIT_2027_GREP_INITIAL_TOKEN_COUNT = 3;

const DEFAULT_MAX_REPLAY_ENTRIES = 1_000_000;
const DEFAULT_MAX_DESCRIPTORS = 4_000_000;

export type Revit2027GRepReplayPath = readonly number[];

export type Revit2027GRepReplayReaderContext = {
  byteOffset: number;
  replayEndOffset: number;
  revitVersion: 2027;
  ownerElementId: bigint;
  replayIndex: number;
  queueSequence: number;
  path: Revit2027GRepReplayPath;
  parentReplayIndex: number | null;
  propertyToken: number;
  scopedSourceClassSlot: number;
  descriptorOffset: number;
  descriptorEndOffset: number;
};

export type Revit2027GRepReplayReaderResult =
  | {
      ok: true;
      /** Must equal the context's `byteOffset`. */
      startOffset: number;
      endOffset: number;
      /**
       * Conditional properties encountered by this reader in native insertion
       * order. Null token-zero descriptors are retained in the replay log but
       * do not enter the FIFO.
       */
      appendedProperties: readonly CondInt16QueueEntry[];
      /**
       * StaticInteger reads share the native property-token namespace. These
       * two lists preserve whether the reference is read before or after the
       * conditional properties returned above.
       */
      staticReferencesBeforeProperties?: readonly number[];
      staticReferencesAfterProperties?: readonly number[];
      value?: unknown;
    }
  | { ok: false; error: string };

export type Revit2027GRepReplayReader = (
  data: Uint8Array,
  context: Revit2027GRepReplayReaderContext,
) => Revit2027GRepReplayReaderResult;

export type Revit2027GRepReplayReaderRegistration = {
  id: string;
  read: Revit2027GRepReplayReader;
};

export type Revit2027GRepReplayRegistry = ReadonlyMap<
  number,
  Revit2027GRepReplayReaderRegistration
>;

export type Revit2027GRepReplayDescriptor = {
  descriptorIndex: number;
  ownerElementId: bigint;
  path: Revit2027GRepReplayPath;
  parentPath: Revit2027GRepReplayPath | null;
  parentReplayIndex: number | null;
  token: number;
  sourceClassSlot: number | null;
  descriptorOffset: number;
  descriptorEndOffset: number;
  state: "queued" | "null" | "reused";
  /** Monotonic insertion order for a real FIFO entry; null for token zero. */
  queueSequence: number | null;
};

export type Revit2027GRepReplaySpan = {
  replayIndex: number;
  queueSequence: number;
  ownerElementId: bigint;
  path: Revit2027GRepReplayPath;
  parentPath: Revit2027GRepReplayPath | null;
  parentReplayIndex: number | null;
  propertyToken: number;
  propertySourceClassSlot: number;
  descriptorOffset: number;
  descriptorEndOffset: number;
  startOffset: number;
  endOffset: number;
  readerId: string;
  value?: unknown;
};

export type Revit2027GRepReplay = {
  ownerElementId: bigint;
  startOffset: number;
  endOffset: number;
  initialTokenCount: number;
  finalTokenCount: number;
  descriptors: readonly Revit2027GRepReplayDescriptor[];
  spans: readonly Revit2027GRepReplaySpan[];
};

export type Revit2027GRepReplayResult =
  | { ok: true; value: Revit2027GRepReplay }
  | { ok: false; error: string };

export type Revit2027GRepReplayOptions = {
  maxReplayEntries?: number;
  maxDescriptors?: number;
};

type PendingEntry = {
  queueSequence: number;
  ownerElementId: bigint;
  path: Revit2027GRepReplayPath;
  parentPath: Revit2027GRepReplayPath | null;
  parentReplayIndex: number | null;
  descriptor: CondInt16QueueEntry;
};

function fixedBodyReader(
  byteLength: number,
  decode: (
    data: Uint8Array,
    byteOffset: number,
    bodyEndOffset: number,
    revitVersion: number,
  ) =>
    | { ok: true; value: { endOffset: number } }
    | { ok: false; error: string },
  appendedProperties: (
    value: { endOffset: number } & Record<string, unknown>,
  ) => readonly CondInt16QueueEntry[],
): Revit2027GRepReplayReader {
  return (data, context) => {
    const bodyEndOffset = context.byteOffset + byteLength;
    if (
      !Number.isSafeInteger(bodyEndOffset) ||
      bodyEndOffset > context.replayEndOffset
    ) {
      return {
        ok: false,
        error:
          `source slot ${context.scopedSourceClassSlot} body exceeds the ` +
          "GRep replay boundary",
      };
    }
    const decoded = decode(
      data,
      context.byteOffset,
      bodyEndOffset,
      context.revitVersion,
    );
    if (!decoded.ok) return decoded;
    return {
      ok: true,
      startOffset: context.byteOffset,
      endOffset: decoded.value.endOffset,
      appendedProperties: appendedProperties(
        decoded.value as { endOffset: number } & Record<string, unknown>,
      ),
      value: decoded.value,
    };
  };
}

const BUILTIN_READERS: readonly [
  number,
  Revit2027GRepReplayReaderRegistration,
][] = [
  [
    REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GArray",
      read: fixedBodyReader(
        REVIT_2027_GARRAY_BODY_BYTES,
        decodeRevit2027GArray,
        (value) => [
          value.instanceInfo as CondInt16QueueEntry,
          value.embeddedSymbolGRep as CondInt16QueueEntry,
        ],
      ),
    },
  ],
  [
    REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GGroup",
      read: (data, context) => {
        const decoded = decodeRevit2027GGroupStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.children,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GLine",
      read: fixedBodyReader(
        REVIT_2027_GLINE_BODY_BYTES,
        decodeRevit2027GLine,
        () => [],
      ),
    },
  ],
  [
    REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GPolyLine",
      read: (data, context) => {
        const decoded = decodeRevit2027GPolyLine(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: [],
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027Geometry",
      read: (data, context) => {
        const decoded = decodeRevit2027GeometryStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027Face",
      read: (data, context) => {
        const decoded = decodeRevit2027FaceStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GEdge",
      read: (data, context) => {
        const decoded = decodeRevit2027GEdgeStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: [],
          staticReferencesAfterProperties: [
            ...decoded.value.faceReferences,
            ...decoded.value.nextReferences,
            ...decoded.value.previousReferences,
          ],
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027EdgeLoop",
      read: (data, context) => {
        const decoded = decodeRevit2027EdgeLoopStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          staticReferencesAfterProperties: decoded.value.staticReferences,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027EdgeLoopWithChainEnvelopes",
      read: (data, context) => {
        const decoded = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          staticReferencesAfterProperties: decoded.value.staticReferences,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GFilling",
      read: (data, context) => {
        const decoded = decodeRevit2027GFilling(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          staticReferencesBeforeProperties: [
            decoded.value.faceIdReference,
          ],
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027FillPatternData",
      read: (data, context) => {
        const decoded = decodeRevit2027FillPatternData(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: decoded.value.queuedProperties,
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027FillGrid",
      read: (data, context) => {
        const decoded = decodeRevit2027FillGrid(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: [],
          value: decoded.value,
        };
      },
    },
  ],
  [
    REVIT_2027_GARC_SOURCE_CLASS_SLOT,
    {
      id: "Revit2027GArc",
      read: (data, context) => {
        const decoded = decodeRevit2027GArc(
          data,
          context.byteOffset,
          context.replayEndOffset,
          context.revitVersion,
        );
        if (!decoded.ok) return decoded;
        return {
          ok: true,
          startOffset: context.byteOffset,
          endOffset: decoded.value.endOffset,
          appendedProperties: [],
          value: decoded.value,
        };
      },
    },
  ],
  ...[
    REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
    REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
    REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  ].map(
    (sourceClassSlot): [
      number,
      Revit2027GRepReplayReaderRegistration,
    ] => [
      sourceClassSlot,
      {
        id: `Revit2027AnalyticSurface:${sourceClassSlot}`,
        read: (data, context) => {
          const decoded = decodeRevit2027AnalyticSurface(
            data,
            context.byteOffset,
            context.replayEndOffset,
            context.revitVersion,
            sourceClassSlot,
          );
          if (!decoded.ok) return decoded;
          return {
            ok: true,
            startOffset: context.byteOffset,
            endOffset: decoded.value.endOffset,
            appendedProperties: decoded.value.queuedProperties,
            value: decoded.value,
          };
        },
      },
    ],
  ),
];

/**
 * Return a mutable registry preloaded with the release-certified readers.
 *
 * A caller may add a later certified Face, Edge, curve, or surface reader by
 * source slot without changing this replay engine. Unknown slots fail closed.
 */
export function createRevit2027GRepReplayRegistry(): Map<
  number,
  Revit2027GRepReplayReaderRegistration
> {
  return new Map(BUILTIN_READERS);
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Replay one independently framed Revit 2027 GRep dynamic-property queue.
 *
 * The queue is a true FIFO: properties appended by the active reader are
 * placed behind every pending older sibling. Positive property tokens and
 * StaticInteger references share the native pointer-index namespace. A
 * property may advance the namespace or materialize an earlier static
 * reservation exactly once; every forward gap must already be reserved.
 * Token -1 is a real queued property but does not advance that namespace.
 * Token zero is a retained null descriptor and other negative tokens fail.
 */
export function replayRevit2027GRepFifo(
  data: Uint8Array,
  root: Revit2027FramedGRepRoot,
  registry: Revit2027GRepReplayRegistry =
    createRevit2027GRepReplayRegistry(),
  options: Revit2027GRepReplayOptions = {},
): Revit2027GRepReplayResult {
  const maxReplayEntries =
    options.maxReplayEntries ?? DEFAULT_MAX_REPLAY_ENTRIES;
  const maxDescriptors = options.maxDescriptors ?? DEFAULT_MAX_DESCRIPTORS;
  if (!validLimit(maxReplayEntries) || !validLimit(maxDescriptors)) {
    return {
      ok: false,
      error: "Revit 2027 GRep replay limits must be non-negative safe integers",
    };
  }
  if (
    typeof root.ownerElementId !== "bigint" ||
    !Number.isSafeInteger(root.dynamicPayloadOffset) ||
    !Number.isSafeInteger(root.dynamicPayloadEndOffset) ||
    root.dynamicPayloadOffset < 0 ||
    root.dynamicPayloadEndOffset < root.dynamicPayloadOffset ||
    root.dynamicPayloadEndOffset > data.byteLength
  ) {
    return { ok: false, error: "Revit 2027 GRep replay boundary is invalid" };
  }

  const descriptors: Revit2027GRepReplayDescriptor[] = [];
  const queue: PendingEntry[] = [];
  let queueHead = 0;
  let nextPositiveToken = REVIT_2027_GREP_INITIAL_TOKEN_COUNT;
  let nextQueueSequence = 0;
  const reservedStaticTokens = new Set<number>();
  const propertySourceSlots = new Map<number, number>();

  const reserveStaticReferences = (
    references: readonly number[] | undefined,
  ): string | null => {
    if (references == null) return null;
    if (!Array.isArray(references)) {
      return "Revit 2027 GRep reader returned an invalid static-reference list";
    }
    for (const reference of references) {
      if (!Number.isSafeInteger(reference)) {
        return "Revit 2027 GRep static reference is not a safe integer";
      }
      if (reference > 0) reservedStaticTokens.add(reference);
    }
    return null;
  };

  const appendDescriptors = (
    entries: readonly CondInt16QueueEntry[],
    parentPath: Revit2027GRepReplayPath | null,
    parentReplayIndex: number | null,
    parentBodyStart: number | null,
    parentBodyEnd: number | null,
  ): string | null => {
    for (let siblingIndex = 0; siblingIndex < entries.length; siblingIndex += 1) {
      if (descriptors.length >= maxDescriptors) {
        return "Revit 2027 GRep descriptor count exceeds the safety bound";
      }
      const entry = entries[siblingIndex]!;
      const path = parentPath == null
        ? [siblingIndex]
        : [...parentPath, siblingIndex];
      if (
        !Number.isSafeInteger(entry.byteOffset) ||
        !Number.isSafeInteger(entry.endOffset) ||
        entry.byteOffset < 0 ||
        entry.endOffset > data.byteLength ||
        entry.endOffset <= entry.byteOffset
      ) {
        return "Revit 2027 GRep property descriptor span is invalid";
      }
      if (
        parentBodyStart != null &&
        parentBodyEnd != null &&
        (
          entry.byteOffset < parentBodyStart ||
          entry.endOffset > parentBodyEnd
        )
      ) {
        return "Revit 2027 GRep nested descriptor lies outside its parent body";
      }
      if (
        parentBodyStart == null &&
        parentBodyEnd == null &&
        entry.endOffset > root.dynamicPayloadOffset
      ) {
        return "Revit 2027 GRep root descriptor overlaps the dynamic payload";
      }

      if (entry.token === 0) {
        if (
          entry.sourceClassSlot !== null ||
          entry.endOffset - entry.byteOffset !== 4
        ) {
          return "Revit 2027 GRep null descriptor is inconsistent";
        }
        descriptors.push({
          descriptorIndex: descriptors.length,
          ownerElementId: root.ownerElementId,
          path,
          parentPath,
          parentReplayIndex,
          token: entry.token,
          sourceClassSlot: entry.sourceClassSlot,
          descriptorOffset: entry.byteOffset,
          descriptorEndOffset: entry.endOffset,
          state: "null",
          queueSequence: null,
        });
        continue;
      }

      if (
        !Number.isSafeInteger(entry.sourceClassSlot) ||
        entry.sourceClassSlot == null ||
        entry.sourceClassSlot <= 0 ||
        entry.endOffset - entry.byteOffset !== 6
      ) {
        return "Revit 2027 GRep queued descriptor is inconsistent";
      }
      if (entry.token === -1) {
        // A proven real queued property which does not touch object tokens.
      } else if (entry.token < 0) {
        return `unsupported negative Revit 2027 GRep token ${entry.token}`;
      } else {
        const existingSlot = propertySourceSlots.get(entry.token);
        if (existingSlot != null) {
          if (existingSlot !== entry.sourceClassSlot) {
            return (
              `Revit 2027 GRep token ${entry.token} changed source slot from ` +
              `${existingSlot} to ${entry.sourceClassSlot}`
            );
          }
          descriptors.push({
            descriptorIndex: descriptors.length,
            ownerElementId: root.ownerElementId,
            path,
            parentPath,
            parentReplayIndex,
            token: entry.token,
            sourceClassSlot: entry.sourceClassSlot,
            descriptorOffset: entry.byteOffset,
            descriptorEndOffset: entry.endOffset,
            state: "reused",
            queueSequence: null,
          });
          continue;
        }
        if (entry.token < nextPositiveToken) {
          if (!reservedStaticTokens.has(entry.token)) {
            return (
              `Revit 2027 GRep token ${entry.token} is below index ` +
              `${nextPositiveToken} without an earlier StaticInteger reservation`
            );
          }
        } else {
          for (
            let skipped = nextPositiveToken;
            skipped < entry.token;
            skipped += 1
          ) {
            if (!reservedStaticTokens.has(skipped)) {
              return (
                `Revit 2027 GRep token gap before ${entry.token} is not ` +
                `reserved at index ${skipped}`
              );
            }
          }
          nextPositiveToken = entry.token + 1;
        }
        propertySourceSlots.set(entry.token, entry.sourceClassSlot);
      }

      if (nextQueueSequence >= maxReplayEntries) {
        return "Revit 2027 GRep replay entry count exceeds the safety bound";
      }
      const queueSequence = nextQueueSequence;
      nextQueueSequence += 1;
      descriptors.push({
        descriptorIndex: descriptors.length,
        ownerElementId: root.ownerElementId,
        path,
        parentPath,
        parentReplayIndex,
        token: entry.token,
        sourceClassSlot: entry.sourceClassSlot,
        descriptorOffset: entry.byteOffset,
        descriptorEndOffset: entry.endOffset,
        state: "queued",
        queueSequence,
      });
      queue.push({
        queueSequence,
        ownerElementId: root.ownerElementId,
        path,
        parentPath,
        parentReplayIndex,
        descriptor: entry,
      });
    }
    return null;
  };

  const initialError = appendDescriptors(
    root.children,
    null,
    null,
    null,
    null,
  );
  if (initialError) return { ok: false, error: initialError };

  let offset = root.dynamicPayloadOffset;
  const spans: Revit2027GRepReplaySpan[] = [];
  while (queueHead < queue.length) {
    const pending = queue[queueHead]!;
    queueHead += 1;
    const sourceClassSlot = pending.descriptor.sourceClassSlot!;
    const registration = registry.get(sourceClassSlot);
    if (!registration) {
      return {
        ok: false,
        error:
          `no certified Revit 2027 GRep reader for source slot ` +
          `${sourceClassSlot}`,
      };
    }
    if (
      typeof registration.id !== "string" ||
      registration.id.length === 0 ||
      typeof registration.read !== "function"
    ) {
      return {
        ok: false,
        error: `invalid Revit 2027 GRep reader registration for slot ${sourceClassSlot}`,
      };
    }

    const replayIndex = spans.length;
    let read: Revit2027GRepReplayReaderResult;
    try {
      read = registration.read(data, {
        byteOffset: offset,
        replayEndOffset: root.dynamicPayloadEndOffset,
        revitVersion: 2027,
        ownerElementId: pending.ownerElementId,
        replayIndex,
        queueSequence: pending.queueSequence,
        path: pending.path,
        parentReplayIndex: pending.parentReplayIndex,
        propertyToken: pending.descriptor.token,
        scopedSourceClassSlot: sourceClassSlot,
        descriptorOffset: pending.descriptor.byteOffset,
        descriptorEndOffset: pending.descriptor.endOffset,
      });
    } catch {
      return {
        ok: false,
        error: `Revit 2027 GRep reader ${registration.id} threw during replay`,
      };
    }
    if (!read.ok) return read;
    if (
      read.startOffset !== offset ||
      !Number.isSafeInteger(read.endOffset) ||
      read.endOffset <= offset ||
      read.endOffset > root.dynamicPayloadEndOffset
    ) {
      return {
        ok: false,
        error:
          `Revit 2027 GRep reader ${registration.id} returned an invalid ` +
          "or non-contiguous body span",
      };
    }
    if (!Array.isArray(read.appendedProperties)) {
      return {
        ok: false,
        error:
          `Revit 2027 GRep reader ${registration.id} did not return an ` +
          "ordered property list",
      };
    }

    const span: Revit2027GRepReplaySpan = {
      replayIndex,
      queueSequence: pending.queueSequence,
      ownerElementId: pending.ownerElementId,
      path: pending.path,
      parentPath: pending.parentPath,
      parentReplayIndex: pending.parentReplayIndex,
      propertyToken: pending.descriptor.token,
      propertySourceClassSlot: sourceClassSlot,
      descriptorOffset: pending.descriptor.byteOffset,
      descriptorEndOffset: pending.descriptor.endOffset,
      startOffset: read.startOffset,
      endOffset: read.endOffset,
      readerId: registration.id,
      value: read.value,
    };
    spans.push(span);

    const beforeReferencesError = reserveStaticReferences(
      read.staticReferencesBeforeProperties,
    );
    if (beforeReferencesError) {
      return { ok: false, error: beforeReferencesError };
    }
    const nestedError = appendDescriptors(
      read.appendedProperties,
      pending.path,
      replayIndex,
      read.startOffset,
      read.endOffset,
    );
    if (nestedError) return { ok: false, error: nestedError };
    const afterReferencesError = reserveStaticReferences(
      read.staticReferencesAfterProperties,
    );
    if (afterReferencesError) {
      return { ok: false, error: afterReferencesError };
    }
    offset = read.endOffset;
  }

  if (offset !== root.dynamicPayloadEndOffset) {
    return {
      ok: false,
      error:
        `Revit 2027 GRep replay ended at ${offset} with a boundary gap before ` +
        `${root.dynamicPayloadEndOffset}`,
    };
  }

  return {
    ok: true,
    value: {
      ownerElementId: root.ownerElementId,
      startOffset: root.dynamicPayloadOffset,
      endOffset: offset,
      initialTokenCount: REVIT_2027_GREP_INITIAL_TOKEN_COUNT,
      finalTokenCount: nextPositiveToken,
      descriptors,
      spans,
    },
  };
}
