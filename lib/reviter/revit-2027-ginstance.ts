import {
  decodeCondInt16PropertyDescriptor,
  decodeTrf201120260,
  type CondInt16QueueEntry,
  type RevitTransform3d,
} from "./dynamic-geometry-queue.ts";
import {
  REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT,
} from "./revit-2027-gelement.ts";
import { narrowElementIds } from "./element-id-width.ts";
import {
  readRevit2027GInfo,
  type Revit2027GInfo,
} from "./revit-2027-grep-prefixes.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";

export const REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT = 2215;
export const REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT = 2513;
/** Static length when `m_oEmbeddedSymbolGRep` is null. */
export const REVIT_2027_GINSTANCE_BODY_BYTES = 44;
/** Static length when `m_oEmbeddedSymbolGRep` queues a GElement. */
export const REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES = 46;
export const REVIT_2027_INSTANCE_INFO_BODY_BYTES = 112;

const GINSTANCE_INSTANCE_INFO_OFFSET = 20;
const GINSTANCE_EMBEDDED_SYMBOL_OFFSET = 26;
const GINSTANCE_SCALAR_SUFFIX_BYTES = 14;

const INSTANCE_INFO_TRANSFORM_OFFSET = 0;
const INSTANCE_INFO_SYMBOL_ID_OFFSET = 96;
const INSTANCE_INFO_GREP_ID_OFFSET = 104;
const INSTANCE_INFO_CDA_OFFSET = 108;

/**
 * The same two bodies where ids are 32-bit (the 2019 to 2023 schemas):
 *
 * - `GInstance` is a 16-byte `GInfo`, the two descriptors, then
 *   `m_forbiddenTarget` before a four-byte `m_tagId` (2024 moved the id
 *   first), and the two booleans: 36 or 38 bytes, a 10-byte scalar suffix.
 * - `InstanceInfo` is the transform, a four-byte `m_symbolId`, `m_GRepId` and
 *   `m_cda`: 108 bytes.
 */
const NARROW_GINSTANCE = {
  instanceInfoOffset: 16,
  embeddedSymbolOffset: 22,
  scalarSuffixBytes: 10,
  bodyBytes: 36,
  embeddedBodyBytes: 38,
} as const;
const WIDE_GINSTANCE = {
  instanceInfoOffset: GINSTANCE_INSTANCE_INFO_OFFSET,
  embeddedSymbolOffset: GINSTANCE_EMBEDDED_SYMBOL_OFFSET,
  scalarSuffixBytes: GINSTANCE_SCALAR_SUFFIX_BYTES,
  bodyBytes: REVIT_2027_GINSTANCE_BODY_BYTES,
  embeddedBodyBytes: REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES,
} as const;
const NARROW_INSTANCE_INFO_BODY_BYTES = 108;

/** Where a `GInstance` body's embedded-symbol descriptor starts, and the suffix after it. */
export function revit2027GInstanceLayout(): {
  embeddedSymbolOffset: number;
  scalarSuffixBytes: number;
} {
  return narrowElementIds() ? NARROW_GINSTANCE : WIDE_GINSTANCE;
}

/** Bytes of an `InstanceInfo` body in the current file. */
export function revit2027InstanceInfoBodyBytes(): number {
  return narrowElementIds() ? NARROW_INSTANCE_INFO_BODY_BYTES : REVIT_2027_INSTANCE_INFO_BODY_BYTES;
}

export type Revit2027GInstance = {
  byteOffset: number;
  endOffset: number;
  gInfo: Revit2027GInfo;
  instanceInfo: CondInt16QueueEntry;
  embeddedSymbolGRep: CondInt16QueueEntry;
  tagElementId: bigint;
  forbiddenTarget: number;
  resolveSymbolInView: boolean;
  hasScale: boolean;
};

export type Revit2027InstanceInfo = {
  byteOffset: number;
  endOffset: number;
  transform: RevitTransform3d;
  symbolElementId: bigint;
  gRepId: number;
  cda: number;
};

export type Revit2027GInstanceDecodeResult =
  | { ok: true; value: Revit2027GInstance }
  | { ok: false; error: string };

export type Revit2027InstanceInfoDecodeResult =
  | { ok: true; value: Revit2027InstanceInfo }
  | { ok: false; error: string };

function hasExactBody(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  byteLength: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    Number.isSafeInteger(bodyEndOffset) &&
    byteOffset >= 0 &&
    bodyEndOffset === byteOffset + byteLength &&
    bodyEndOffset <= data.byteLength
  );
}

function decodeGInfo(view: DataView, byteOffset: number): Revit2027GInfo {
  return readRevit2027GInfo(view, byteOffset);
}

function readBoolean(data: Uint8Array, byteOffset: number): boolean | null {
  const value = data[byteOffset];
  return value === 0 ? false : value === 1 ? true : null;
}

/**
 * Decode the exact 44- or 46-byte static body of release-2027 `GInstance`.
 *
 * The two CondInt16 descriptors append `InstanceInfo` and an optional embedded
 * symbol to the enclosing dynamic-property FIFO. Their bodies are not inline:
 * every older sibling in that FIFO must be replayed first.
 */
export function decodeRevit2027GInstanceStatic(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027GInstanceDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return {
      ok: false,
      error: "Revit 2027 GInstance decoding requires release 2027",
    };
  }
  const narrow = narrowElementIds();
  const layout = narrow ? NARROW_GINSTANCE : WIDE_GINSTANCE;
  if (
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      layout.bodyBytes,
    ) &&
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      layout.embeddedBodyBytes,
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 GInstance body is not exactly 44 or 46 bytes",
    };
  }

  const instanceInfo = decodeCondInt16PropertyDescriptor(
    data,
    byteOffset + layout.instanceInfoOffset,
  );
  if (!instanceInfo.ok) return instanceInfo;
  if (
    instanceInfo.descriptor.endOffset !==
      byteOffset + layout.embeddedSymbolOffset ||
    instanceInfo.descriptor.token !== -1 ||
    instanceInfo.descriptor.sourceClassSlot !==
      REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT
  ) {
    return {
      ok: false,
      error:
        "Revit 2027 GInstance instanceInfo descriptor is not the certified token -1/source-slot 2513 form",
    };
  }

  const embeddedSymbolGRep = decodeCondInt16PropertyDescriptor(
    data,
    byteOffset + layout.embeddedSymbolOffset,
  );
  if (!embeddedSymbolGRep.ok) return embeddedSymbolGRep;
  const embeddedIsNull =
    embeddedSymbolGRep.descriptor.token === 0 &&
    embeddedSymbolGRep.descriptor.sourceClassSlot === null;
  const embeddedIsGElement =
    embeddedSymbolGRep.descriptor.token > 0 &&
    embeddedSymbolGRep.descriptor.sourceClassSlot ===
      REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT;
  if (!embeddedIsNull && !embeddedIsGElement) {
    return {
      ok: false,
      error:
        "Revit 2027 GInstance embedded-symbol descriptor is neither null nor a positive source-slot 2246 GElement",
    };
  }

  const scalarSuffixOffset = embeddedSymbolGRep.descriptor.endOffset;
  if (
    scalarSuffixOffset + layout.scalarSuffixBytes !== bodyEndOffset
  ) {
    return {
      ok: false,
      error:
        "Revit 2027 GInstance body length does not match its embedded-symbol descriptor",
    };
  }
  // `[i64 m_tagId][i32 m_forbiddenTarget]`, or `[i32 m_forbiddenTarget][i32 m_tagId]`.
  const flagsOffset = scalarSuffixOffset + layout.scalarSuffixBytes - 2;
  const resolveSymbolInView = readBoolean(
    data,
    flagsOffset,
  );
  const hasScale = readBoolean(
    data,
    flagsOffset + 1,
  );
  if (resolveSymbolInView == null || hasScale == null) {
    return {
      ok: false,
      error: "Revit 2027 GInstance contains an invalid boolean",
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
      tagElementId: narrow
        ? BigInt(view.getInt32(scalarSuffixOffset + 4, true))
        : view.getBigInt64(scalarSuffixOffset, true),
      forbiddenTarget: view.getInt32(scalarSuffixOffset + (narrow ? 0 : 8), true),
      resolveSymbolInView,
      hasScale,
    },
  };
}

/**
 * Decode the exact release-2027 `InstanceInfo` body:
 * `InstInfoBase::{m_Trf, m_symbolId, m_GRepId}` followed by `m_cda`.
 */
export function decodeRevit2027InstanceInfo(
  data: Uint8Array,
  byteOffset: number,
  bodyEndOffset: number,
  revitVersion: number,
): Revit2027InstanceInfoDecodeResult {
  if (!usesRevit2027RecordLayout(revitVersion)) {
    return {
      ok: false,
      error: "Revit 2027 InstanceInfo decoding requires release 2027",
    };
  }
  const narrow = narrowElementIds();
  if (
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      revit2027InstanceInfoBodyBytes(),
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 InstanceInfo body is not exactly 112 bytes",
    };
  }

  const decodedTransform = decodeTrf201120260(
    data,
    byteOffset + INSTANCE_INFO_TRANSFORM_OFFSET,
  );
  if (!decodedTransform.ok) return decodedTransform;
  if (
    decodedTransform.transform.endOffset !==
    byteOffset + INSTANCE_INFO_SYMBOL_ID_OFFSET
  ) {
    return {
      ok: false,
      error: "Revit 2027 InstanceInfo transform boundary is invalid",
    };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    ok: true,
    value: {
      byteOffset,
      endOffset: bodyEndOffset,
      transform: decodedTransform.transform,
      symbolElementId: narrow
        ? BigInt(view.getInt32(byteOffset + INSTANCE_INFO_SYMBOL_ID_OFFSET, true))
        : view.getBigInt64(byteOffset + INSTANCE_INFO_SYMBOL_ID_OFFSET, true),
      gRepId: view.getInt32(byteOffset + INSTANCE_INFO_GREP_ID_OFFSET - (narrow ? 4 : 0), true),
      cda: view.getInt32(byteOffset + INSTANCE_INFO_CDA_OFFSET - (narrow ? 4 : 0), true),
    },
  };
}
