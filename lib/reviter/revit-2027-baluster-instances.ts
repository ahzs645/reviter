import type { ElementObject } from "./element-objects.ts";
import {
  decodeCondInt16PropertyDescriptor,
  decodeCondInt16QueueCollection,
} from "./dynamic-geometry-queue.ts";
import {
  decodeRevit2027GInstanceStatic,
  decodeRevit2027InstanceInfo,
  REVIT_2027_GINSTANCE_BODY_BYTES,
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
  REVIT_2027_INSTANCE_INFO_BODY_BYTES,
  type Revit2027GInstance,
  type Revit2027InstanceInfo,
} from "./revit-2027-ginstance.ts";
import type { Revit2027NestedInstance } from "./revit-2027-nested-instance.ts";
import {
  decodeRevit2027GLine,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  type Revit2027GLine,
} from "./revit-2027-gline.ts";
import {
  decodeRevit2027GArc,
  REVIT_2027_GARC_BODY_BYTES,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "./revit-2027-garc.ts";
import {
  decodeRevit2027GHermiteSpline,
  REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
  type Revit2027GHermiteSpline,
} from "./revit-2027-ghermite-spline.ts";

/** `BaseRailingSym`, measured from the release-2027 framed class table. */
export const REVIT_2027_BASE_RAILING_SYMBOL_MARKER = 605;
/** `TopRailType` class id 969 is persisted with this framed marker. */
export const REVIT_2027_TOP_RAIL_TYPE_MARKER = 967;
/** Formats/Latest source slot for `RailingCurveLoopData`. */
export const REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT = 3444;
/** Formats/Latest source slot for the `CurveLoop` property. */
export const REVIT_2027_CURVE_LOOP_SOURCE_CLASS_SLOT = 1087;

const FRAME_HEADER_BYTES = 18;
const FRAME_ECHO_OFFSET = 16;
const FRAME_TRAILER_BYTES = 20;
const BASE_RAILING_SYMBOL_DERIVED_OFFSET = 149;
const PARAMS_AND_ID_BYTES = 57;
const BASE_RAILING_SYMBOL_DERIVED_SUFFIX_BYTES = 35;
const TOP_RAIL_TYPE_DERIVED_OFFSET = 149;
const MIN_TOP_RAIL_TYPE_CURVE_LOOPS = 2;
const DEFAULT_MAX_INSTANCES = 100_000;
const DEFAULT_MAX_FRAME_BYTES = 320 * 1024 * 1024;

export type Revit2027BalusterParamAndId = {
  botAngle: number;
  familySymbolElementId: number;
  height: number;
  instanceElementId: number;
  slopeAngle: number;
  symbolElementId: number;
  topAngle: number;
  deleted: boolean;
  byteOffset: number;
};

export type Revit2027BalusterInstanceDefinition = {
  ownerElementId: number;
  baseRailingElementId: number;
  nestedInstances: readonly Revit2027NestedInstance[];
  paramsAndIds: readonly Revit2027BalusterParamAndId[];
  familySymbolElementIds: ReadonlySet<number>;
  frameOffset: number;
  frameEndOffset: number;
  objectLength: number;
  estimatedBytes: number;
  source: "BaseRailingSym.m_balusterInstances";
};

export type Revit2027BalusterInstanceDecodeResult =
  | { ok: true; value: Revit2027BalusterInstanceDefinition }
  | { ok: false; error: string };

export type Revit2027TopRailTypeEvidence = {
  ownerElementId: number;
  owningTopRailElementId: number;
  curveLoopCount: number;
  curveLoopSourceClassSlot: 3444;
  frameOffset: number;
  frameEndOffset: number;
  objectLength: number;
  source: "TopRailType.m_curveLoopData";
};

export type Revit2027TopRailTypeEvidenceResult =
  | { ok: true; value: Revit2027TopRailTypeEvidence }
  | { ok: false; error: string };

export type Revit2027TopRailCurveSegment = {
  curve: Revit2027GLine | Revit2027GArc | Revit2027GHermiteSpline;
  kind: "GLine" | "GArc" | "GHermiteSpline";
  start: readonly [number, number, number];
  end: readonly [number, number, number];
};

export type Revit2027TopRailCurveLoop = {
  curveLoopDescriptorOffset: number;
  heightsOffset: number;
  curveLoopBodyOffset: number;
  persistedBoolean: boolean;
  segments: readonly Revit2027TopRailCurveSegment[];
};

export type Revit2027TopRailTypeCurves =
  Omit<Revit2027TopRailTypeEvidence, "source"> & {
    /** Consecutive outer/inner edge-loop pairs for each disconnected rail run. */
    loops: readonly Revit2027TopRailCurveLoop[];
    curveCount: number;
    source: "TopRailType.m_curveLoopData.curves";
  };

export type Revit2027TopRailTypeCurvesResult =
  | { ok: true; value: Revit2027TopRailTypeCurves }
  | { ok: false; error: string };

export type Revit2027BalusterDecoderLimits = {
  maxInstances?: number;
  maxFrameBytes?: number;
};

function safeLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback;
}

function fits(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    byteOffset <= data.byteLength - byteLength
  );
}

function positiveObjectId(value: bigint): number | null {
  return (
      value > 0n &&
      value <= 0xffff_ffffn
    )
    ? Number(value)
    : null;
}

function validateFrame(
  data: Uint8Array,
  frame: ElementObject,
  marker: number,
  revitVersion: number,
  maxFrameBytes: number,
): { ok: true; view: DataView; frameEndOffset: number; echoOffset: number } |
  { ok: false; error: string } {
  if (revitVersion !== 2027) {
    return { ok: false, error: "railing symbol decoding requires Revit 2027" };
  }
  if (
    !Number.isSafeInteger(frame.offset) ||
    !Number.isSafeInteger(frame.objectLength) ||
    frame.offset < 0 ||
    frame.objectLength < FRAME_HEADER_BYTES ||
    frame.objectLength > maxFrameBytes ||
    !fits(data, frame.offset, frame.objectLength + FRAME_TRAILER_BYTES)
  ) {
    return { ok: false, error: "railing symbol framed object is truncated or exceeds its byte cap" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frameEndOffset = frame.offset + frame.objectLength;
  const echoOffset = frameEndOffset + FRAME_ECHO_OFFSET;
  if (
    view.getUint32(frame.offset + 12, true) !== frame.objectLength ||
    view.getUint32(echoOffset, true) !== frame.objectLength
  ) {
    return { ok: false, error: "railing symbol frame length echo does not match" };
  }
  if (
    frame.marker !== marker ||
    view.getUint16(frame.offset + 16, true) !== marker
  ) {
    return { ok: false, error: "railing symbol frame marker does not match" };
  }
  if (
    frame.elementId <= 0 ||
    view.getUint32(frame.offset, true) !== frame.elementId ||
    view.getUint32(frame.offset + 4, true) !== 0
  ) {
    return { ok: false, error: "railing symbol frame owner id is invalid or inconsistent" };
  }
  return { ok: true, view, frameEndOffset, echoOffset };
}

function readPositiveObjectId(
  view: DataView,
  byteOffset: number,
): number | null {
  return positiveObjectId(view.getBigInt64(byteOffset, true));
}

function finiteAt(view: DataView, byteOffset: number): number | null {
  const value = view.getFloat64(byteOffset, true);
  return Number.isFinite(value) ? value : null;
}

function readBoolean(data: Uint8Array, byteOffset: number): boolean | null {
  const value = data[byteOffset];
  return value === 0 ? false : value === 1 ? true : null;
}

function locateUniqueGInstanceBlock(
  data: Uint8Array,
  startOffset: number,
  endOffset: number,
  count: number,
): { ok: true; values: Revit2027GInstance[] } |
  { ok: false; error: string } {
  const byteLength = count * REVIT_2027_GINSTANCE_BODY_BYTES;
  const matches: Revit2027GInstance[][] = [];
  for (
    let offset = startOffset;
    offset <= endOffset - byteLength;
    offset += 1
  ) {
    const values: Revit2027GInstance[] = [];
    let cursor = offset;
    for (let index = 0; index < count; index += 1) {
      const decoded = decodeRevit2027GInstanceStatic(
        data,
        cursor,
        cursor + REVIT_2027_GINSTANCE_BODY_BYTES,
        2027,
      );
      if (!decoded.ok) break;
      values.push(decoded.value);
      cursor = decoded.value.endOffset;
    }
    if (values.length === count) {
      matches.push(values);
      offset += Math.max(0, byteLength - 1);
    }
  }
  if (matches.length !== 1) {
    return {
      ok: false,
      error:
        `BaseRailingSym requires one exact ${count}-entry GInstance body block; ` +
        `found ${matches.length}`,
    };
  }
  return { ok: true, values: matches[0]! };
}

function locateUniqueInstanceInfoBlock(
  data: Uint8Array,
  startOffset: number,
  endOffset: number,
  count: number,
  paramsAndIds: readonly Revit2027BalusterParamAndId[],
): { ok: true; values: Array<
  Revit2027InstanceInfo
> } | { ok: false; error: string } {
  const allowedSymbolElementIds = new Set(
    paramsAndIds.map(({ symbolElementId }) => symbolElementId),
  );
  const byteLength = count * REVIT_2027_INSTANCE_INFO_BODY_BYTES;
  const matches: Revit2027InstanceInfo[][] = [];
  for (
    let offset = startOffset;
    offset <= endOffset - byteLength;
    offset += 1
  ) {
    const values: Revit2027InstanceInfo[] = [];
    let cursor = offset;
    for (let index = 0; index < count; index += 1) {
      const decoded = decodeRevit2027InstanceInfo(
        data,
        cursor,
        cursor + REVIT_2027_INSTANCE_INFO_BODY_BYTES,
        2027,
      );
      if (
        !decoded.ok ||
        !allowedSymbolElementIds.has(
          positiveObjectId(decoded.value.symbolElementId) ?? -1,
        )
      ) {
        break;
      }
      values.push(decoded.value);
      cursor = decoded.value.endOffset;
    }
    if (values.length === count) {
      matches.push(values);
      offset += Math.max(0, byteLength - 1);
    }
  }
  if (matches.length !== 1) {
    return {
      ok: false,
      error:
        `BaseRailingSym requires one exact ${count}-entry InstanceInfo body block ` +
        `whose symbol ids belong to m_paramsAndIds; found ${matches.length}`,
    };
  }
  return { ok: true, values: matches[0]! };
}

/**
 * Decode only the release-2027 `BaseRailingSym` fields whose byte grammar is
 * independently named by Formats/Latest and bounded by the enclosing frame.
 *
 * The parent symbol payload between the derived suffix and the queued bodies
 * remains opaque. It is never searched for ids or transforms. The two dynamic
 * blocks are accepted only when their exact fixed-body decoders produce one
 * unique, instance-count-sized run. `m_paramsAndIds` is not an occurrence
 * array: the supplied model has 9,045 placed GInstances and 2,675 parameter
 * rows. Its independently decoded InstanceInfo block proves the join instead:
 * the set of its symbol ids equals the set of persisted `m_symId` values,
 * while duplicate parameter rows are permitted because the corpus contains
 * 63 of them.
 */
export function decodeRevit2027BalusterInstanceDefinition(
  data: Uint8Array,
  frame: ElementObject,
  revitVersion: number,
  limits: Revit2027BalusterDecoderLimits = {},
): Revit2027BalusterInstanceDecodeResult {
  const maxInstances = safeLimit(limits.maxInstances, DEFAULT_MAX_INSTANCES);
  const maxFrameBytes = safeLimit(limits.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES);
  const framed = validateFrame(
    data,
    frame,
    REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
    revitVersion,
    maxFrameBytes,
  );
  if (!framed.ok) return framed;
  if (frame.typeCode !== 0) {
    return { ok: false, error: "BaseRailingSym type code does not match" };
  }

  let cursor = frame.offset + BASE_RAILING_SYMBOL_DERIVED_OFFSET;
  if (cursor > framed.frameEndOffset - 4) {
    return { ok: false, error: "BaseRailingSym derived body is truncated" };
  }
  const gRepLoops = decodeCondInt16QueueCollection(data, cursor);
  if (!gRepLoops.ok) {
    return { ok: false, error: `BaseRailingSym m_GRepLoops: ${gRepLoops.error}` };
  }
  if (gRepLoops.collection.endOffset > framed.frameEndOffset) {
    return { ok: false, error: "BaseRailingSym m_GRepLoops exceeds its frame" };
  }
  if (gRepLoops.collection.count !== 0) {
    return {
      ok: false,
      error: "BaseRailingSym m_GRepLoops is non-empty and has no bounded reader",
    };
  }
  cursor = gRepLoops.collection.endOffset;

  const balusters = decodeCondInt16QueueCollection(data, cursor);
  if (!balusters.ok) {
    return {
      ok: false,
      error: `BaseRailingSym m_balusterInstances: ${balusters.error}`,
    };
  }
  if (
    balusters.collection.count <= 0 ||
    balusters.collection.count > maxInstances ||
    balusters.collection.endOffset > framed.frameEndOffset
  ) {
    return {
      ok: false,
      error: "BaseRailingSym baluster count is empty, truncated, or exceeds the link cap",
    };
  }
  for (let index = 0; index < balusters.collection.entries.length; index += 1) {
    const entry = balusters.collection.entries[index]!;
    if (
      entry.token <= 0 ||
      entry.sourceClassSlot !== REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT ||
      (index > 0 &&
        entry.token !== balusters.collection.entries[index - 1]!.token + 1)
    ) {
      return {
        ok: false,
        error:
          "BaseRailingSym m_balusterInstances is not one consecutive GInstance descriptor array",
      };
    }
  }
  cursor = balusters.collection.endOffset;

  if (!fits(data, cursor, 4)) {
    return { ok: false, error: "BaseRailingSym m_paramsAndIds count is truncated" };
  }
  const paramsCount = framed.view.getInt32(cursor, true);
  cursor += 4;
  if (paramsCount <= 0 || paramsCount > maxInstances) {
    return {
      ok: false,
      error:
        "BaseRailingSym m_paramsAndIds count is empty or exceeds the link cap",
    };
  }
  if (
    !Number.isSafeInteger(paramsCount * PARAMS_AND_ID_BYTES) ||
    cursor > framed.frameEndOffset - paramsCount * PARAMS_AND_ID_BYTES
  ) {
    return { ok: false, error: "BaseRailingSym m_paramsAndIds body is truncated" };
  }

  const paramsAndIds: Revit2027BalusterParamAndId[] = [];
  for (let index = 0; index < paramsCount; index += 1) {
    const byteOffset = cursor;
    const botAngle = finiteAt(framed.view, cursor);
    const familySymbolElementId = readPositiveObjectId(
      framed.view,
      cursor + 8,
    );
    const height = finiteAt(framed.view, cursor + 16);
    const instanceElementId = readPositiveObjectId(framed.view, cursor + 24);
    const slopeAngle = finiteAt(framed.view, cursor + 32);
    const symbolElementId = readPositiveObjectId(framed.view, cursor + 40);
    const topAngle = finiteAt(framed.view, cursor + 48);
    const deleted = readBoolean(data, cursor + 56);
    if (
      botAngle == null ||
      familySymbolElementId == null ||
      height == null ||
      instanceElementId == null ||
      slopeAngle == null ||
      symbolElementId == null ||
      topAngle == null ||
      deleted == null
    ) {
      return {
        ok: false,
        error: "BaseRailingSym paramsAndId contains a non-finite scalar, invalid id, or invalid boolean",
      };
    }
    if (deleted) {
      return {
        ok: false,
        error: "BaseRailingSym paramsAndId marks a counted baluster deleted",
      };
    }
    paramsAndIds.push({
      botAngle,
      familySymbolElementId,
      height,
      instanceElementId,
      slopeAngle,
      symbolElementId,
      topAngle,
      deleted,
      byteOffset,
    });
    cursor += PARAMS_AND_ID_BYTES;
  }

  const sweepPath = decodeCondInt16PropertyDescriptor(data, cursor);
  if (!sweepPath.ok || sweepPath.descriptor.endOffset > framed.frameEndOffset) {
    return {
      ok: false,
      error:
        `BaseRailingSym m_oRailingSweepPath: ` +
        `${sweepPath.ok ? "descriptor exceeds its frame" : sweepPath.error}`,
    };
  }
  cursor = sweepPath.descriptor.endOffset;
  if (!fits(data, cursor, 4)) {
    return { ok: false, error: "BaseRailingSym m_usedBalusterSymIds is truncated" };
  }
  const usedSymbolCount = framed.view.getInt32(cursor, true);
  cursor += 4;
  if (
    usedSymbolCount < 0 ||
    usedSymbolCount > maxInstances ||
    cursor > framed.frameEndOffset - usedSymbolCount * 8
  ) {
    return { ok: false, error: "BaseRailingSym used-symbol array is invalid" };
  }
  for (let index = 0; index < usedSymbolCount; index += 1) {
    if (readPositiveObjectId(framed.view, cursor) == null) {
      return { ok: false, error: "BaseRailingSym used-symbol array contains an invalid id" };
    }
    cursor += 8;
  }
  const approximateLength = finiteAt(framed.view, cursor);
  const baseRailingElementId = readPositiveObjectId(framed.view, cursor + 8);
  if (approximateLength == null || approximateLength < 0) {
    return { ok: false, error: "BaseRailingSym approximate length is non-finite or negative" };
  }
  if (baseRailingElementId == null) {
    return { ok: false, error: "BaseRailingSym m_baseRailingId is invalid" };
  }
  cursor += 16;
  const maxOffset = finiteAt(framed.view, cursor);
  const railYDirection = [
    finiteAt(framed.view, cursor + 8),
    finiteAt(framed.view, cursor + 16),
    finiteAt(framed.view, cursor + 24),
  ];
  const displayBalusters = readBoolean(data, cursor + 32);
  const flipped = readBoolean(data, cursor + 33);
  const useIndexForTangent = readBoolean(data, cursor + 34);
  if (
    maxOffset == null ||
    railYDirection.some((value) => value == null) ||
    displayBalusters == null ||
    flipped == null ||
    useIndexForTangent == null
  ) {
    return { ok: false, error: "BaseRailingSym derived suffix is non-finite or invalid" };
  }
  cursor += BASE_RAILING_SYMBOL_DERIVED_SUFFIX_BYTES;

  const gInstances = locateUniqueGInstanceBlock(
    data,
    cursor,
    framed.echoOffset,
    balusters.collection.count,
  );
  if (!gInstances.ok) return gInstances;
  const instanceInfos = locateUniqueInstanceInfoBlock(
    data,
    cursor,
    framed.echoOffset,
    balusters.collection.count,
    paramsAndIds,
  );
  if (!instanceInfos.ok) return instanceInfos;

  const paramsSymbolElementIds = new Set(
    paramsAndIds.map(({ symbolElementId }) => symbolElementId),
  );
  const instanceSymbolElementIds = new Set(
    instanceInfos.values.flatMap((info) => {
      const id = positiveObjectId(info.symbolElementId);
      return id == null ? [] : [id];
    }),
  );
  if (
    paramsSymbolElementIds.size !== instanceSymbolElementIds.size ||
    [...paramsSymbolElementIds].some(
      (symbolElementId) => !instanceSymbolElementIds.has(symbolElementId),
    )
  ) {
    return {
      ok: false,
      error:
        "BaseRailingSym m_paramsAndIds m_symId set does not match the " +
        "InstanceInfo symbol-id set",
    };
  }

  const nestedInstances: Revit2027NestedInstance[] = [];
  for (let index = 0; index < balusters.collection.count; index += 1) {
    const instance = gInstances.values[index]!;
    const info = instanceInfos.values[index]!;
    const symbolElementId = positiveObjectId(info.symbolElementId);
    if (symbolElementId == null) {
      return { ok: false, error: "BaseRailingSym InstanceInfo symbol id is invalid" };
    }
    nestedInstances.push({
      ownerElementId: BigInt(frame.elementId),
      instanceReplayIndex: index,
      instanceInfoReplayIndex: balusters.collection.count + index,
      path: [index],
      symbolElementId: BigInt(symbolElementId),
      gRepId: info.gRepId,
      cda: info.cda,
      transform: info.transform,
      tagElementId: instance.tagElementId,
      forbiddenTarget: instance.forbiddenTarget,
      resolveSymbolInView: instance.resolveSymbolInView,
      hasScale: instance.hasScale,
    });
  }

  return {
    ok: true,
    value: {
      ownerElementId: frame.elementId,
      baseRailingElementId,
      nestedInstances,
      paramsAndIds,
      familySymbolElementIds: new Set(
        paramsAndIds.map(({ familySymbolElementId }) => familySymbolElementId),
      ),
      frameOffset: frame.offset,
      frameEndOffset: framed.echoOffset + 4,
      objectLength: frame.objectLength,
      estimatedBytes:
        frame.objectLength +
        nestedInstances.length *
          (REVIT_2027_GINSTANCE_BODY_BYTES +
            REVIT_2027_INSTANCE_INFO_BODY_BYTES),
      source: "BaseRailingSym.m_balusterInstances",
    },
  };
}

/**
 * Identify the marker-967 representation without promoting its curve records
 * to faces. Formats/Latest names class id 969 as `TopRailType` and source slot
 * 3444 as `RailingCurveLoopData`; the target frame carries an even collection
 * of such descriptors followed by the owning TopRail id. Each consecutive pair
 * describes the two persisted edges of one disconnected rail run. No certified
 * sweep/profile body is implied by this evidence reader.
 */
export function decodeRevit2027TopRailTypeEvidence(
  data: Uint8Array,
  frame: ElementObject,
  revitVersion: number,
): Revit2027TopRailTypeEvidenceResult {
  const framed = validateFrame(
    data,
    frame,
    REVIT_2027_TOP_RAIL_TYPE_MARKER,
    revitVersion,
    DEFAULT_MAX_FRAME_BYTES,
  );
  if (!framed.ok) return framed;
  if (frame.typeCode !== 0) {
    return { ok: false, error: "TopRailType type code does not match" };
  }
  const loops = decodeCondInt16QueueCollection(
    data,
    frame.offset + TOP_RAIL_TYPE_DERIVED_OFFSET,
  );
  if (!loops.ok) {
    return { ok: false, error: `TopRailType curve-loop array: ${loops.error}` };
  }
  if (
    loops.collection.count < MIN_TOP_RAIL_TYPE_CURVE_LOOPS ||
    loops.collection.count % 2 !== 0 ||
    loops.collection.entries.some(
      (entry) =>
        entry.token !== -1 ||
        entry.sourceClassSlot !==
          REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
    )
  ) {
    return {
      ok: false,
      error:
        "TopRailType does not contain a certified even " +
        "RailingCurveLoopData descriptor collection",
    };
  }
  const owningTopRailElementId = readPositiveObjectId(
    framed.view,
    loops.collection.endOffset,
  );
  if (owningTopRailElementId == null) {
    return { ok: false, error: "TopRailType owning TopRail id is invalid" };
  }
  return {
    ok: true,
    value: {
      ownerElementId: frame.elementId,
      owningTopRailElementId,
      curveLoopCount: loops.collection.count,
      curveLoopSourceClassSlot:
        REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
      frameOffset: frame.offset,
      frameEndOffset: framed.echoOffset + 4,
      objectLength: frame.objectLength,
      source: "TopRailType.m_curveLoopData",
    },
  };
}

type LocatedRailingCurveLoopData = {
  descriptorOffset: number;
  heightsOffset: number;
  endOffset: number;
  heights: number[];
};

function locateRailingCurveLoopData(
  data: Uint8Array,
  startOffset: number,
  endOffset: number,
  maxInstances: number,
  loopCount: number,
): { ok: true; value: readonly LocatedRailingCurveLoopData[] } |
  { ok: false; error: string } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const matches: LocatedRailingCurveLoopData[][] = [];
  const readOne = (
    descriptorOffset: number,
  ): LocatedRailingCurveLoopData | null => {
    const descriptor = decodeCondInt16PropertyDescriptor(
      data,
      descriptorOffset,
    );
    if (
      !descriptor.ok ||
      descriptor.descriptor.token !== -1 ||
      descriptor.descriptor.sourceClassSlot !==
        REVIT_2027_CURVE_LOOP_SOURCE_CLASS_SLOT ||
      descriptor.descriptor.endOffset > endOffset - 4
    ) {
      return null;
    }
    const count = view.getInt32(descriptor.descriptor.endOffset, true);
    const heightsOffset = descriptor.descriptor.endOffset + 4;
    if (
      count < 0 ||
      count % 2 !== 0 ||
      count / 2 > maxInstances ||
      heightsOffset > endOffset - count * 8
    ) {
      return null;
    }
    const heights: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = view.getFloat64(heightsOffset + index * 8, true);
      if (!Number.isFinite(value)) return null;
      heights.push(value);
    }
    return {
      descriptorOffset,
      heightsOffset,
      endOffset: heightsOffset + count * 8,
      heights,
    };
  };
  for (let offset = startOffset; offset <= endOffset - 20; offset += 1) {
    const items: LocatedRailingCurveLoopData[] = [];
    let cursor = offset;
    let persistedCurveCount = 0;
    for (let index = 0; index < loopCount; index += 1) {
      const item = readOne(cursor);
      if (!item) break;
      persistedCurveCount += item.heights.length / 2;
      if (persistedCurveCount > maxInstances) break;
      items.push(item);
      cursor = item.endOffset;
    }
    if (items.length !== loopCount) continue;
    matches.push(items);
    offset = cursor - 1;
  }
  if (matches.length !== 1) {
    return {
      ok: false,
      error:
        `TopRailType requires one exact adjacent ${loopCount}-item sequence of ` +
        `RailingCurveLoopData bodies; found ${matches.length}`,
    };
  }
  return { ok: true, value: matches[0]! };
}

/**
 * Decode the complete curve evidence in a release-2027 `TopRailType` frame.
 *
 * The parent type payload remains opaque. The derived bodies are located only
 * by a single schema-complete sequence that accounts for the frame tail:
 * adjacent `RailingCurveLoopData` records each contribute one CurveLoop
 * descriptor and two heights per curve; two strict-boolean CurveLoop bodies
 * contribute consecutive GLine/GArc descriptor arrays; and the corresponding
 * schema-complete fixed bodies end exactly at the independently validated
 * length echo. A curve array containing any other source class fails closed.
 *
 * This reader deliberately returns curves, not a solid. In the supplied model
 * the two target paths persist their plan separation and elevations, but the
 * frame supplies neither a section profile nor a vertical section dimension.
 */
export function decodeRevit2027TopRailTypeCurves(
  data: Uint8Array,
  frame: ElementObject,
  revitVersion: number,
  limits: Revit2027BalusterDecoderLimits = {},
): Revit2027TopRailTypeCurvesResult {
  const evidence = decodeRevit2027TopRailTypeEvidence(
    data,
    frame,
    revitVersion,
  );
  if (!evidence.ok) return evidence;
  const maxInstances = safeLimit(limits.maxInstances, DEFAULT_MAX_INSTANCES);
  const maxFrameBytes = safeLimit(limits.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES);
  const framed = validateFrame(
    data,
    frame,
    REVIT_2027_TOP_RAIL_TYPE_MARKER,
    revitVersion,
    maxFrameBytes,
  );
  if (!framed.ok) return framed;

  const derivedLoops = decodeCondInt16QueueCollection(
    data,
    frame.offset + TOP_RAIL_TYPE_DERIVED_OFFSET,
  );
  if (!derivedLoops.ok) {
    return { ok: false, error: derivedLoops.error };
  }
  const loopCount = evidence.value.curveLoopCount;
  if (loopCount > maxInstances) {
    return { ok: false, error: "TopRailType curve-loop count exceeds limit" };
  }
  const loopData = locateRailingCurveLoopData(
    data,
    derivedLoops.collection.endOffset + 8,
    framed.echoOffset,
    maxInstances,
    loopCount,
  );
  if (!loopData.ok) return loopData;

  const curveBodyMatches: {
    bodyOffsets: readonly number[];
    persistedBooleans: readonly boolean[];
    collections: readonly (
      ReturnType<typeof decodeCondInt16QueueCollection> & { ok: true }
    )[];
    curves: Array<{
      curve: Revit2027GLine | Revit2027GArc | Revit2027GHermiteSpline;
      kind: "GLine" | "GArc" | "GHermiteSpline";
    }>;
  }[] = [];
  for (
    let offset = loopData.value.at(-1)!.endOffset;
    offset < framed.echoOffset;
    offset += 1
  ) {
    const bodyOffsets: number[] = [];
    const persistedBooleans: boolean[] = [];
    const collections: Array<
      ReturnType<typeof decodeCondInt16QueueCollection> & { ok: true }
    > = [];
    let descriptorOffset = offset;
    let totalEntries = 0;
    for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
      const persistedBoolean = readBoolean(data, descriptorOffset);
      if (persistedBoolean == null) break;
      const collection = decodeCondInt16QueueCollection(
        data,
        descriptorOffset + 1,
        { maxEntries: maxInstances },
      );
      if (!collection.ok || collection.collection.count <= 0) break;
      totalEntries += collection.collection.count;
      if (totalEntries > maxInstances) break;
      bodyOffsets.push(descriptorOffset);
      persistedBooleans.push(persistedBoolean);
      collections.push(collection);
      descriptorOffset = collection.collection.endOffset;
    }
    if (collections.length !== loopCount) continue;
    const entries = collections.flatMap(
      (collection) => collection.collection.entries,
    );
    if (
      entries.length > maxInstances ||
      entries.some(
        (entry) =>
          entry.token <= 0 ||
          entry.sourceClassSlot !== REVIT_2027_GLINE_SOURCE_CLASS_SLOT &&
          entry.sourceClassSlot !== REVIT_2027_GARC_SOURCE_CLASS_SLOT &&
          entry.sourceClassSlot !==
            REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
      ) ||
      entries.some(
        (entry, index) =>
          index > 0 && entry.token !== entries[index - 1]!.token + 1,
      )
    ) {
      continue;
    }
    let curveOffset = descriptorOffset;
    const curves: Array<{
      curve: Revit2027GLine | Revit2027GArc | Revit2027GHermiteSpline;
      kind: "GLine" | "GArc" | "GHermiteSpline";
    }> = [];
    for (const entry of entries) {
      if (entry.sourceClassSlot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT) {
        const decoded = decodeRevit2027GLine(
          data,
          curveOffset,
          curveOffset + REVIT_2027_GLINE_BODY_BYTES,
          revitVersion,
        );
        if (!decoded.ok) break;
        curves.push({ curve: decoded.value, kind: "GLine" });
        curveOffset = decoded.value.endOffset;
      } else if (
        entry.sourceClassSlot === REVIT_2027_GARC_SOURCE_CLASS_SLOT
      ) {
        const decoded = decodeRevit2027GArc(
          data,
          curveOffset,
          curveOffset + REVIT_2027_GARC_BODY_BYTES,
          revitVersion,
        );
        if (!decoded.ok) break;
        curves.push({ curve: decoded.value, kind: "GArc" });
        curveOffset = decoded.value.endOffset;
      } else {
        const decoded = decodeRevit2027GHermiteSpline(
          data,
          curveOffset,
          framed.echoOffset,
          revitVersion,
          { maxNodes: maxInstances },
        );
        if (!decoded.ok) break;
        curves.push({ curve: decoded.value, kind: "GHermiteSpline" });
        curveOffset = decoded.value.endOffset;
      }
    }
    if (curves.length !== entries.length || curveOffset !== framed.echoOffset) {
      continue;
    }
    curveBodyMatches.push({
      bodyOffsets,
      persistedBooleans,
      collections,
      curves,
    });
  }
  if (curveBodyMatches.length !== 1) {
    return {
      ok: false,
      error:
        `TopRailType requires one exact ${loopCount}-CurveLoop curve descriptor ` +
        `sequence ending at its line bodies; found ${curveBodyMatches.length}`,
    };
  }

  const match = curveBodyMatches[0]!;
  const counts = match.collections.map(
    (collection) => collection.collection.count,
  );
  for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
    const heightCount = loopData.value[loopIndex]!.heights.length;
    if (heightCount !== 0 && heightCount !== counts[loopIndex]! * 2) {
      return {
        ok: false,
        error:
          `TopRailType loop ${loopIndex} has ${heightCount} persisted heights ` +
          `for ${counts[loopIndex]} curves`,
      };
    }
  }
  const totalCurveCount = counts.reduce((total, count) => total + count, 0);
  for (const decoded of match.curves) {
    if (decoded.kind !== "GHermiteSpline") continue;
    const spline = decoded.curve as Revit2027GHermiteSpline;
    const first = spline.nodes[0];
    const last = spline.nodes.at(-1);
    if (
      !first ||
      !last ||
      Math.abs(first.parameter - spline.endParameters[0]) > 1e-9 ||
      Math.abs(last.parameter - spline.endParameters[1]) > 1e-9
    ) {
      return {
        ok: false,
        error:
          "TopRailType GHermiteSpline endpoints do not coincide with its " +
          "bounded persisted node array",
      };
    }
  }

  let curveIndex = 0;
  const decodeLoop = (loopIndex: number): Revit2027TopRailCurveLoop => {
    const item = loopData.value[loopIndex]!;
    const segments: Revit2027TopRailCurveSegment[] = [];
    for (let index = 0; index < counts[loopIndex]!; index += 1) {
      const decoded = match.curves[curveIndex++]!;
      const startParameter = decoded.curve.endParameters[0];
      const endParameter = decoded.curve.endParameters[1];
      const pointAt = (
        parameter: number,
      ): readonly [number, number, number] => {
        if (decoded.kind === "GLine") {
          const line = decoded.curve as Revit2027GLine;
          return [
            line.origin[0] + line.direction[0] * parameter,
            line.origin[1] + line.direction[1] * parameter,
            line.origin[2] + line.direction[2] * parameter,
          ];
        }
        if (decoded.kind === "GHermiteSpline") {
          const spline = decoded.curve as Revit2027GHermiteSpline;
          return Math.abs(parameter - spline.endParameters[0]) <= 1e-9
            ? spline.nodes[0]!.point
            : spline.nodes.at(-1)!.point;
        }
        const arc = decoded.curve as Revit2027GArc;
        const cosine = Math.cos(parameter);
        const sine = Math.sin(parameter);
        return [
          arc.center[0] +
            arc.radius *
              (arc.xDirection[0] * cosine + arc.yDirection[0] * sine),
          arc.center[1] +
            arc.radius *
              (arc.xDirection[1] * cosine + arc.yDirection[1] * sine),
          arc.center[2] +
            arc.radius *
              (arc.xDirection[2] * cosine + arc.yDirection[2] * sine),
        ];
      };
      const rawStart = pointAt(startParameter);
      const rawEnd = pointAt(endParameter);
      const start = [
        rawStart[0],
        rawStart[1],
        item.heights.length
          ? item.heights[index * 2]!
          : rawStart[2],
      ] as const;
      const end = [
        rawEnd[0],
        rawEnd[1],
        item.heights.length
          ? item.heights[index * 2 + 1]!
          : rawEnd[2],
      ] as const;
      segments.push({ ...decoded, start, end });
    }
    return {
      curveLoopDescriptorOffset: item.descriptorOffset,
      heightsOffset: item.heightsOffset,
      curveLoopBodyOffset: match.bodyOffsets[loopIndex]!,
      persistedBoolean: match.persistedBooleans[loopIndex]!,
      segments,
    };
  };
  const decodedLoops = Array.from(
    { length: loopCount },
    (_, loopIndex) => decodeLoop(loopIndex),
  );

  return {
    ok: true,
    value: {
      ...evidence.value,
      loops: decodedLoops,
      curveCount: totalCurveCount,
      source: "TopRailType.m_curveLoopData.curves",
    },
  };
}

export function validateRevit2027BalusterDefinitionSymbols(
  definition: Revit2027BalusterInstanceDefinition,
  isCompleteSymbolMesh: (ownerElementId: number) => boolean,
): { ok: true } | { ok: false; error: string } {
  for (const familySymbolElementId of definition.familySymbolElementIds) {
    if (!isCompleteSymbolMesh(familySymbolElementId)) {
      return {
        ok: false,
        error:
          `BaseRailingSym family symbol ${familySymbolElementId} ` +
          `does not resolve to a complete existing mesh`,
      };
    }
  }
  for (const instance of definition.nestedInstances) {
    const symbolElementId = positiveObjectId(instance.symbolElementId);
    if (
      symbolElementId == null ||
      !isCompleteSymbolMesh(symbolElementId)
    ) {
      return {
        ok: false,
        error:
          `BaseRailingSym instance symbol ${instance.symbolElementId} ` +
          `does not resolve to a complete existing mesh`,
      };
    }
  }
  return { ok: true };
}

function balusterDefinitionStructure(
  definition: Revit2027BalusterInstanceDefinition,
): string {
  return JSON.stringify({
    ownerElementId: definition.ownerElementId,
    baseRailingElementId: definition.baseRailingElementId,
    paramsAndIds: definition.paramsAndIds.map((value) => ({
      ...value,
      byteOffset: undefined,
    })),
    nestedInstances: definition.nestedInstances.map((instance) => ({
      symbolElementId: instance.symbolElementId.toString(),
      gRepId: instance.gRepId,
      cda: instance.cda,
      matrix: instance.transform.matrix,
      tagElementId: instance.tagElementId.toString(),
      forbiddenTarget: instance.forbiddenTarget,
      resolveSymbolInView: instance.resolveSymbolInView,
      hasScale: instance.hasScale,
    })),
  });
}

export function deduplicateRevit2027BalusterDefinitions(
  definitions: Iterable<Revit2027BalusterInstanceDefinition>,
): { ok: true; value: ReadonlyMap<number, Revit2027BalusterInstanceDefinition> } |
  { ok: false; error: string } {
  const result = new Map<number, Revit2027BalusterInstanceDefinition>();
  for (const definition of definitions) {
    const existing = result.get(definition.ownerElementId);
    if (!existing) {
      result.set(definition.ownerElementId, definition);
      continue;
    }
    if (
      balusterDefinitionStructure(existing) !==
        balusterDefinitionStructure(definition)
    ) {
      return {
        ok: false,
        error:
          `duplicate BaseRailingSym owner ${definition.ownerElementId} ` +
          "is not byte/structure-equivalent",
      };
    }
  }
  return { ok: true, value: result };
}
