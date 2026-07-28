import {
  decodeCondInt16PropertyDescriptor,
  decodeCondInt16QueueCollection,
  decodeTrf201120260,
  type CondInt16QueueEntry,
  type RevitTransform3d,
} from "./dynamic-geometry-queue.ts";

/**
 * @deprecated Source slot 2215 is now schema-certified as `GInstance`; use
 * `REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT`.
 */
export const REVIT_2027_GARRAY_SOURCE_CLASS_SLOT = 2215;
export const REVIT_2027_GGROUP_SOURCE_CLASS_SLOT = 2248;
export const REVIT_2027_GARRAY_BODY_BYTES = 144;

const GINFO_BYTES = 20;
const GARRAY_INSTANCE_INFO_OFFSET = GINFO_BYTES;
const GARRAY_EMBEDDED_SYMBOL_OFFSET = 26;
const GARRAY_TAG_ID_OFFSET = 30;
const GARRAY_TARGET_OFFSET = 38;
const GARRAY_RESOLVE_SYMBOL_OFFSET = 42;
const GARRAY_HAS_SCALE_OFFSET = 43;
const GARRAY_TRANSFORM_OFFSET = 44;
const GARRAY_NUM_INSTANCES_OFFSET = 140;

export type Revit2027GInfo = {
  gStyleElementId: bigint;
  tag: number;
  controlCommand: number;
  flags: number;
};

export type Revit2027GArray = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  instanceInfo: CondInt16QueueEntry;
  embeddedSymbolGRep: CondInt16QueueEntry;
  tagElementId: bigint;
  forbiddenTarget: number;
  resolveSymbolInView: boolean;
  hasScale: boolean;
  stepTransform: RevitTransform3d;
  /**
   * @deprecated This is the low int32 of the following InstanceInfo symbol ID,
   * not a schema-certified `m_numInstances` field.
   */
  numInstances: number;
};

export type Revit2027GArrayDecodeResult =
  | { ok: true; value: Revit2027GArray }
  | { ok: false; error: string };

export type Revit2027GGroupPrefix = {
  byteOffset: number;
  /**
   * First byte not explained by the certified GNode/GInfo + AllSubNodes
   * prefix. It may begin a derived-class suffix, another queued object, or a
   * nested dynamic body. This decoder intentionally does not consume it.
   */
  firstUnknownSuffixOffset: number;
  enclosingEndOffset: number;
  gInfo: Revit2027GInfo;
  children: readonly CondInt16QueueEntry[];
};

export type Revit2027GGroupPrefixDecodeResult =
  | { ok: true; value: Revit2027GGroupPrefix }
  | { ok: false; error: string };

function bounded(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  enclosingEndOffset: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    Number.isSafeInteger(byteLength) &&
    Number.isSafeInteger(enclosingEndOffset) &&
    byteOffset >= 0 &&
    byteLength >= 0 &&
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

function readBoolean(data: Uint8Array, byteOffset: number): boolean | null {
  const value = data[byteOffset];
  return value === 0 ? false : value === 1 ? true : null;
}

/**
 * Decode the legacy 144-byte slot-2215 observational window.
 *
 * @deprecated Persisted-schema and FIFO evidence now prove that this window
 * crosses object boundaries: a 44-byte `GInstance`, followed later by the
 * first 100 bytes of its queued 112-byte `InstanceInfo`. It remains only so
 * older audit scripts stay reproducible. Certified replay must use
 * `decodeRevit2027GInstanceStatic` and `decodeRevit2027InstanceInfo`.
 */
export function decodeRevit2027GArray(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GArrayDecodeResult {
  if (revitVersion !== 2027) {
    return { ok: false, error: "Revit 2027 GArray decoding requires release 2027" };
  }
  if (
    !bounded(
      data,
      byteOffset,
      REVIT_2027_GARRAY_BODY_BYTES,
      bodyEndOffset,
    ) ||
    bodyEndOffset - byteOffset !== REVIT_2027_GARRAY_BODY_BYTES
  ) {
    return { ok: false, error: "Revit 2027 GArray body is not exactly 144 bytes" };
  }

  const instanceInfo = decodeCondInt16PropertyDescriptor(
    data,
    byteOffset + GARRAY_INSTANCE_INFO_OFFSET,
  );
  if (!instanceInfo.ok) return instanceInfo;
  if (
    instanceInfo.descriptor.endOffset !==
      byteOffset + GARRAY_EMBEDDED_SYMBOL_OFFSET ||
    instanceInfo.descriptor.token !== -1 ||
    instanceInfo.descriptor.sourceClassSlot == null
  ) {
    return {
      ok: false,
      error: "Revit 2027 GArray instanceInfo descriptor is not the certified six-byte form",
    };
  }

  const embeddedSymbolGRep = decodeCondInt16PropertyDescriptor(
    data,
    byteOffset + GARRAY_EMBEDDED_SYMBOL_OFFSET,
  );
  if (!embeddedSymbolGRep.ok) return embeddedSymbolGRep;
  if (
    embeddedSymbolGRep.descriptor.endOffset !==
      byteOffset + GARRAY_TAG_ID_OFFSET ||
    embeddedSymbolGRep.descriptor.token !== 0 ||
    embeddedSymbolGRep.descriptor.sourceClassSlot !== null
  ) {
    return {
      ok: false,
      error: "Revit 2027 GArray embedded-symbol descriptor is not null",
    };
  }

  const resolveSymbolInView = readBoolean(
    data,
    byteOffset + GARRAY_RESOLVE_SYMBOL_OFFSET,
  );
  const hasScale = readBoolean(data, byteOffset + GARRAY_HAS_SCALE_OFFSET);
  if (resolveSymbolInView == null || hasScale == null) {
    return { ok: false, error: "Revit 2027 GArray contains an invalid boolean" };
  }

  const transform = decodeTrf201120260(
    data,
    byteOffset + GARRAY_TRANSFORM_OFFSET,
  );
  if (!transform.ok) return transform;
  if (
    transform.transform.endOffset !==
    byteOffset + GARRAY_NUM_INSTANCES_OFFSET
  ) {
    return {
      ok: false,
      error:
        "Revit 2027 GArray transform does not end at the numInstances field",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      gInfo: decodeGInfo(view, byteOffset),
      instanceInfo: instanceInfo.descriptor,
      embeddedSymbolGRep: embeddedSymbolGRep.descriptor,
      tagElementId: view.getBigInt64(byteOffset + GARRAY_TAG_ID_OFFSET, true),
      forbiddenTarget: view.getInt32(byteOffset + GARRAY_TARGET_OFFSET, true),
      resolveSymbolInView,
      hasScale,
      stepTransform: transform.transform,
      numInstances: view.getInt32(
        byteOffset + GARRAY_NUM_INSTANCES_OFFSET,
        true,
      ),
    },
  };
}

/**
 * Decode only the release-verified Revit 2027 `GGroup` static prefix.
 *
 * No derived fields and no dynamic child bodies are consumed. Callers must
 * treat `firstUnknownSuffixOffset` as an opaque boundary until the owning
 * release-specific reader has been reconstructed.
 */
export function decodeRevit2027GGroupPrefix(
  data: Uint8Array,
  byteOffset: number,
  enclosingEndOffset: number,
  revitVersion: number,
  options: { maxChildren?: number } = {},
): Revit2027GGroupPrefixDecodeResult {
  if (revitVersion !== 2027) {
    return { ok: false, error: "Revit 2027 GGroup decoding requires release 2027" };
  }
  if (!bounded(data, byteOffset, GINFO_BYTES + 4, enclosingEndOffset)) {
    return { ok: false, error: "Revit 2027 GGroup prefix is truncated" };
  }

  const boundedData =
    enclosingEndOffset === data.byteLength
      ? data
      : data.subarray(0, enclosingEndOffset);
  const queue = decodeCondInt16QueueCollection(
    boundedData,
    byteOffset + GINFO_BYTES,
    {
      maxEntries: options.maxChildren,
    },
  );
  if (!queue.ok) return queue;
  if (queue.collection.endOffset > enclosingEndOffset) {
    return {
      ok: false,
      error: "Revit 2027 GGroup children exceed the enclosing boundary",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      firstUnknownSuffixOffset: queue.collection.endOffset,
      enclosingEndOffset,
      gInfo: decodeGInfo(view, byteOffset),
      children: queue.collection.entries,
    },
  };
}
