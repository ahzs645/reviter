import {
  decodeCondInt16PropertyDescriptor,
  decodeTrf201120260,
  type CondInt16QueueEntry,
  type RevitTransform3d,
} from "./dynamic-geometry-queue.ts";
import {
  REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT,
} from "./revit-2027-gelement.ts";
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";

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
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 GInstance decoding requires release 2027",
    };
  }
  if (
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      REVIT_2027_GINSTANCE_BODY_BYTES,
    ) &&
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      REVIT_2027_GINSTANCE_EMBEDDED_BODY_BYTES,
    )
  ) {
    return {
      ok: false,
      error: "Revit 2027 GInstance body is not exactly 44 or 46 bytes",
    };
  }

  const instanceInfo = decodeCondInt16PropertyDescriptor(
    data,
    byteOffset + GINSTANCE_INSTANCE_INFO_OFFSET,
  );
  if (!instanceInfo.ok) return instanceInfo;
  if (
    instanceInfo.descriptor.endOffset !==
      byteOffset + GINSTANCE_EMBEDDED_SYMBOL_OFFSET ||
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
    byteOffset + GINSTANCE_EMBEDDED_SYMBOL_OFFSET,
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
    scalarSuffixOffset + GINSTANCE_SCALAR_SUFFIX_BYTES !== bodyEndOffset
  ) {
    return {
      ok: false,
      error:
        "Revit 2027 GInstance body length does not match its embedded-symbol descriptor",
    };
  }
  const resolveSymbolInView = readBoolean(
    data,
    scalarSuffixOffset + 12,
  );
  const hasScale = readBoolean(
    data,
    scalarSuffixOffset + 13,
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
      tagElementId: view.getBigInt64(scalarSuffixOffset, true),
      forbiddenTarget: view.getInt32(scalarSuffixOffset + 8, true),
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
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "Revit 2027 InstanceInfo decoding requires release 2027",
    };
  }
  if (
    !hasExactBody(
      data,
      byteOffset,
      bodyEndOffset,
      REVIT_2027_INSTANCE_INFO_BODY_BYTES,
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
      symbolElementId: view.getBigInt64(
        byteOffset + INSTANCE_INFO_SYMBOL_ID_OFFSET,
        true,
      ),
      gRepId: view.getInt32(byteOffset + INSTANCE_INFO_GREP_ID_OFFSET, true),
      cda: view.getInt32(byteOffset + INSTANCE_INFO_CDA_OFFSET, true),
    },
  };
}
