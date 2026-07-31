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

/** `BaseRailingSym`, measured from the release-2027 framed class table. */
export const REVIT_2027_BASE_RAILING_SYMBOL_MARKER = 605;
/** `TopRailType` class id 969 is persisted with this framed marker. */
export const REVIT_2027_TOP_RAIL_TYPE_MARKER = 967;
/** Formats/Latest source slot for `RailingCurveLoopData`. */
export const REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT = 3444;

const FRAME_HEADER_BYTES = 18;
const FRAME_ECHO_OFFSET = 16;
const FRAME_TRAILER_BYTES = 20;
const BASE_RAILING_SYMBOL_DERIVED_OFFSET = 149;
const PARAMS_AND_ID_BYTES = 57;
const BASE_RAILING_SYMBOL_DERIVED_SUFFIX_BYTES = 35;
const TOP_RAIL_TYPE_DERIVED_OFFSET = 149;
const TOP_RAIL_TYPE_CURVE_LOOP_COUNT = 2;
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
  curveLoopCount: 2;
  curveLoopSourceClassSlot: 3444;
  frameOffset: number;
  frameEndOffset: number;
  objectLength: number;
  source: "TopRailType.m_curveLoopData";
};

export type Revit2027TopRailTypeEvidenceResult =
  | { ok: true; value: Revit2027TopRailTypeEvidence }
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
  paramsAndIds: readonly Revit2027BalusterParamAndId[],
): { ok: true; values: Array<
  Revit2027InstanceInfo
> } | { ok: false; error: string } {
  const count = paramsAndIds.length;
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
        positiveObjectId(decoded.value.symbolElementId) !==
          paramsAndIds[index]!.symbolElementId
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
        `matching m_paramsAndIds; found ${matches.length}`,
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
 * unique, count-sized run and every InstanceInfo symbol agrees with the
 * corresponding persisted params record.
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
  if (paramsCount !== balusters.collection.count) {
    return {
      ok: false,
      error:
        `BaseRailingSym count mismatch: ${balusters.collection.count} ` +
        `m_balusterInstances versus ${paramsCount} m_paramsAndIds`,
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
    paramsCount,
  );
  if (!gInstances.ok) return gInstances;
  const instanceInfos = locateUniqueInstanceInfoBlock(
    data,
    cursor,
    framed.echoOffset,
    paramsAndIds,
  );
  if (!instanceInfos.ok) return instanceInfos;

  const nestedInstances: Revit2027NestedInstance[] = [];
  for (let index = 0; index < paramsCount; index += 1) {
    const instance = gInstances.values[index]!;
    const info = instanceInfos.values[index]!;
    const symbolElementId = positiveObjectId(info.symbolElementId);
    if (symbolElementId == null) {
      return { ok: false, error: "BaseRailingSym InstanceInfo symbol id is invalid" };
    }
    nestedInstances.push({
      ownerElementId: BigInt(frame.elementId),
      instanceReplayIndex: index,
      instanceInfoReplayIndex: paramsCount + index,
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
 * 3444 as `RailingCurveLoopData`; the target frame carries exactly two such
 * descriptors followed by the owning TopRail id. No certified sweep/profile
 * body is implied by this evidence reader.
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
    loops.collection.count !== TOP_RAIL_TYPE_CURVE_LOOP_COUNT ||
    loops.collection.entries.some(
      (entry) =>
        entry.token !== -1 ||
        entry.sourceClassSlot !==
          REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
    )
  ) {
    return {
      ok: false,
      error: "TopRailType does not contain the certified two RailingCurveLoopData descriptors",
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
      curveLoopCount: 2,
      curveLoopSourceClassSlot:
        REVIT_2027_RAILING_CURVE_LOOP_DATA_SOURCE_CLASS_SLOT,
      frameOffset: frame.offset,
      frameEndOffset: framed.echoOffset + 4,
      objectLength: frame.objectLength,
      source: "TopRailType.m_curveLoopData",
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
