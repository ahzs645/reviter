import {
  decodeCondInt16PropertyDescriptor,
  type CondInt16QueueEntry,
} from "./dynamic-geometry-queue.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

/** Exact Revit 2027 source-class slot for persisted `EdgeLoop`. */
export const REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT = 1434;
/** Exact Revit 2027 source-class slot for `EdgeLoopWithChainEnvelopes`. */
export const REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT =
  1437;
/** @deprecated Use the correctly identified chain-envelope slot constant. */
export const REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT =
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT;

const GINFO_BYTES = 20;
const OBJECT_REFERENCE_BYTES = 4;
const EXTENTS_2D_BYTES = 4 * 8;
const BOOL_BYTES = 1;
const DEFAULT_MAX_CHAINS = 1_000_000;

export type Revit2027EdgeLoopStatic = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  /** `GEdgeLoop.m_nextLoop`; a non-null body is appended to the FIFO. */
  nextLoop: CondInt16QueueEntry;
  /** Weak/static references are preserved as signed on-disk tokens. */
  faceReference: number;
  nextEdgeReference: number;
  previousEdgeReference: number;
  /** StaticInteger fields in native read order. */
  staticReferences: readonly [number, number, number];
  envelope: {
    minimum: readonly [number, number];
    maximum: readonly [number, number];
  };
  open: boolean;
  /** Non-null queued descriptors, in native append order. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027EdgeChainWithEnvelope = {
  startEdgeReference: number;
  envelope: {
    minimum: readonly [number, number];
    maximum: readonly [number, number];
  };
};

export type Revit2027EdgeLoopWithChainEnvelopesStatic = {
  byteOffset: number;
  endOffset: number;
  loop: Revit2027EdgeLoopStatic;
  chains: readonly Revit2027EdgeChainWithEnvelope[];
  /** Inherited loop references, then each chain start edge. */
  staticReferences: readonly number[];
  /** Includes only the inherited non-null `m_nextLoop` descriptor. */
  queuedProperties: readonly CondInt16QueueEntry[];
};

export type Revit2027EdgeLoopStaticDecodeResult =
  | { ok: true; value: Revit2027EdgeLoopStatic }
  | { ok: false; error: string };

export type Revit2027EdgeLoopWithChainEnvelopesStaticDecodeResult =
  | { ok: true; value: Revit2027EdgeLoopWithChainEnvelopesStatic }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    Number.isSafeInteger(enclosingEndOffset) &&
    enclosingEndOffset >= byteOffset &&
    enclosingEndOffset <= data.byteLength &&
    byteOffset <= enclosingEndOffset - byteLength
  );
}

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return {
    gStyleElementId: view.getBigInt64(byteOffset, true),
    tag: view.getInt32(byteOffset + 8, true),
    controlCommand: view.getInt32(byteOffset + 12, true),
    flags: view.getUint32(byteOffset + 16, true),
  };
}

/**
 * Decode the selector-free static body of Revit 2027 source slot 1,434
 * (`EdgeLoop`, inheriting `GEdgeLoop` and `GEdgeBase`).
 *
 * The one conditional property is returned for later FIFO replay. Token zero
 * is null, token -1 is the observed queued sentinel, and positive tokens are
 * the numbered namespace. Other negative tokens fail closed.
 */
export function decodeRevit2027EdgeLoopStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
): Revit2027EdgeLoopStaticDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoop decoding requires release 2027",
    };
  }
  if (!bounded(data, byteOffset, GINFO_BYTES + 4, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoop/GEdgeLoop prefix is truncated",
    };
  }

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const nextLoop = decodeCondInt16PropertyDescriptor(
    boundedData,
    byteOffset + GINFO_BYTES,
  );
  if (!nextLoop.ok) {
    return {
      ok: false,
      error: `EdgeLoop next loop: ${nextLoop.error}`,
    };
  }
  if (nextLoop.descriptor.token < -1) {
    return {
      ok: false,
      error: "EdgeLoop next-loop token is an unproven negative sentinel",
    };
  }

  const scalarBytes =
    3 * OBJECT_REFERENCE_BYTES + EXTENTS_2D_BYTES + BOOL_BYTES;
  const scalarOffset = nextLoop.descriptor.endOffset;
  if (!bounded(data, scalarOffset, scalarBytes, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoop references, envelope, or open flag are truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const envelopeOffset = scalarOffset + 3 * OBJECT_REFERENCE_BYTES;
  const endOffset = scalarOffset + scalarBytes;
  const envelopeScalars = [
    view.getFloat64(envelopeOffset, true),
    view.getFloat64(envelopeOffset + 8, true),
    view.getFloat64(envelopeOffset + 16, true),
    view.getFloat64(envelopeOffset + 24, true),
  ] as const;
  if (!envelopeScalars.every(Number.isFinite)) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoop envelope is not finite",
    };
  }
  const openByte = data[endOffset - 1];
  if (openByte !== 0 && openByte !== 1) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoop open flag is not boolean",
    };
  }
  const staticReferences = [
    view.getInt32(scalarOffset, true),
    view.getInt32(scalarOffset + OBJECT_REFERENCE_BYTES, true),
    view.getInt32(scalarOffset + 2 * OBJECT_REFERENCE_BYTES, true),
  ] as const;
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset,
      gInfo: decodeGInfo(view, byteOffset),
      nextLoop: nextLoop.descriptor,
      faceReference: staticReferences[0],
      nextEdgeReference: staticReferences[1],
      previousEdgeReference: staticReferences[2],
      staticReferences,
      envelope: {
        minimum: [envelopeScalars[0], envelopeScalars[1]],
        maximum: [envelopeScalars[2], envelopeScalars[3]],
      },
      open: openByte === 1,
      queuedProperties:
        nextLoop.descriptor.token === 0 ? [] : [nextLoop.descriptor],
    },
  };
}

/**
 * Decode the complete selector-free body of Revit 2027 source slot 1,437
 * (`EdgeLoopWithChainEnvelopes`): an inherited `EdgeLoop`, followed by a
 * counted array of `{ StaticInteger start edge, Extents2d envelope }`.
 */
export function decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxChains?: number } = {},
): Revit2027EdgeLoopWithChainEnvelopesStaticDecodeResult {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error:
        "Revit 2027 EdgeLoopWithChainEnvelopes decoding requires release 2027",
    };
  }
  const maxChains = options.maxChains ?? DEFAULT_MAX_CHAINS;
  if (!Number.isSafeInteger(maxChains) || maxChains < 0) {
    return {
      ok: false,
      error: "maxChains must be a non-negative safe integer",
    };
  }
  const loop = decodeRevit2027EdgeLoopStatic(
    data,
    byteOffset,
    enclosingEndOffset,
    revitVersion,
  );
  if (!loop.ok) return loop;
  if (!bounded(data, loop.value.endOffset, 4, enclosingEndOffset)) {
    return {
      ok: false,
      error: "Revit 2027 EdgeLoopWithChainEnvelopes count is truncated",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getInt32(loop.value.endOffset, true);
  if (count < 0 || count > maxChains) {
    return {
      ok: false,
      error:
        "Revit 2027 EdgeLoopWithChainEnvelopes count is outside the safety bound",
    };
  }
  const chainsOffset = loop.value.endOffset + 4;
  const chainsBytes = count * 36;
  if (
    !Number.isSafeInteger(chainsBytes) ||
    !bounded(data, chainsOffset, chainsBytes, enclosingEndOffset)
  ) {
    return {
      ok: false,
      error:
        "Revit 2027 EdgeLoopWithChainEnvelopes array is truncated",
    };
  }

  const chains: Revit2027EdgeChainWithEnvelope[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = chainsOffset + index * 36;
    const values = [
      view.getFloat64(offset + 4, true),
      view.getFloat64(offset + 12, true),
      view.getFloat64(offset + 20, true),
      view.getFloat64(offset + 28, true),
    ] as const;
    if (!values.every(Number.isFinite)) {
      return {
        ok: false,
        error:
          "Revit 2027 EdgeLoopWithChainEnvelopes envelope is not finite",
      };
    }
    chains.push({
      startEdgeReference: view.getInt32(offset, true),
      envelope: {
        minimum: [values[0], values[1]],
        maximum: [values[2], values[3]],
      },
    });
  }
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: chainsOffset + chainsBytes,
      loop: loop.value,
      chains,
      staticReferences: [
        ...loop.value.staticReferences,
        ...chains.map((chain) => chain.startEdgeReference),
      ],
      queuedProperties: loop.value.queuedProperties,
    },
  };
}
