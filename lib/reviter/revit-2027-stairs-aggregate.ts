import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueCollection,
} from "./dynamic-geometry-queue.ts";

/** Revit 2027 framed-object marker for `StairsElement`. */
export const REVIT_2027_STAIRS_ELEMENT_MARKER = 4075;
/** Revit 2027 framed-object marker for the `StairsLanding` subclass. */
export const REVIT_2027_STAIRS_LANDING_MARKER = 4080;
/** Revit 2027 framed-object marker for the `StairsRun` subclass. */
export const REVIT_2027_STAIRS_RUN_MARKER = 4102;

const STATIC_BODY_OFFSET = 127;
const FRAME_ECHO_OFFSET = 16;
const FRAME_ECHO_BYTES = 20;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_RECIPROCAL_STATIC_BYTES = 16 * 1024;

export type Revit2027StairsElementAggregate = {
  elementId: number;
  objectOffset: number;
  objectLength: number;
  staticBodyOffset: number;
  staticEndOffset: number;
  registeredRailingIds: readonly number[];
  runAndLandingIds: readonly number[];
  stairsBoundaryCurves2d: CondInt16QueueCollection;
  stairsRailingPaths: CondInt16QueueCollection;
  supportIds: readonly number[];
};

export type Revit2027StairsRunAndLandingAggregate = {
  elementId: number;
  stairsId: number;
  triserSymbolId: number | null;
  baseRiserIndex: number;
  isMirrored: boolean;
  stringerIds: readonly number[];
  supportPathCurveLoops: CondInt16QueueCollection;
  supportExistenceStatus: readonly {
    key: number;
    value: number;
  }[];
  objectOffset: number;
  objectLength: number;
  stairsIdOffset: number;
  staticSuffixEndOffset: number;
};

export type Revit2027StairsAggregateDecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type FramedObject = {
  elementId: number;
  marker: number;
  objectEndOffset: number;
};

function fits(
  data: Uint8Array,
  byteOffset: number,
  byteLength: number,
  endOffset = data.byteLength,
): boolean {
  return (
    Number.isSafeInteger(byteOffset) &&
    byteOffset >= 0 &&
    Number.isSafeInteger(byteLength) &&
    byteLength >= 0 &&
    Number.isSafeInteger(endOffset) &&
    endOffset >= byteOffset &&
    endOffset <= data.byteLength &&
    byteOffset <= endOffset - byteLength
  );
}

function decodeFrame(
  data: Uint8Array,
  objectOffset: number,
  objectLength: number,
  allowedMarkers: ReadonlySet<number>,
): Revit2027StairsAggregateDecodeResult<FramedObject> {
  if (
    !Number.isSafeInteger(objectLength) ||
    objectLength < STATIC_BODY_OFFSET ||
    !fits(
      data,
      objectOffset,
      objectLength + FRAME_ECHO_BYTES,
    )
  ) {
    return { ok: false, error: "stairs framed object is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(objectOffset + 12, true) !== objectLength) {
    return { ok: false, error: "stairs framed object length does not match" };
  }
  if (
    view.getUint32(
      objectOffset + objectLength + FRAME_ECHO_OFFSET,
      true,
    ) !== objectLength
  ) {
    return { ok: false, error: "stairs framed object length echo does not match" };
  }
  const marker = view.getUint16(objectOffset + 16, true);
  if (!allowedMarkers.has(marker)) {
    return { ok: false, error: "stairs framed object marker is not allowed" };
  }
  if (view.getUint32(objectOffset + 22, true) !== 0) {
    return { ok: false, error: "stairs framed object type high word is nonzero" };
  }
  const elementId = view.getUint32(objectOffset, true);
  if (
    elementId === 0 ||
    view.getUint32(objectOffset + 4, true) !== 0
  ) {
    return { ok: false, error: "stairs framed object element id is invalid" };
  }
  return {
    ok: true,
    value: {
      elementId,
      marker,
      objectEndOffset: objectOffset + objectLength,
    },
  };
}

function readObjectIdArray(
  data: Uint8Array,
  countOffset: number,
  endOffset: number,
): Revit2027StairsAggregateDecodeResult<{
  ids: number[];
  endOffset: number;
}> {
  if (!fits(data, countOffset, 4, endOffset)) {
    return { ok: false, error: "stairs ObjectId collection count is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getInt32(countOffset, true);
  if (count < 0 || count > MAX_COLLECTION_ITEMS) {
    return {
      ok: false,
      error: "stairs ObjectId collection count is outside the safety bound",
    };
  }
  const itemsOffset = countOffset + 4;
  if (!fits(data, itemsOffset, count * 8, endOffset)) {
    return { ok: false, error: "stairs ObjectId collection is truncated" };
  }
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = itemsOffset + index * 8;
    const id = view.getUint32(offset, true);
    if (id === 0 || view.getUint32(offset + 4, true) !== 0) {
      return {
        ok: false,
        error: "stairs ObjectId collection contains an invalid id",
      };
    }
    ids.push(id);
  }
  return { ok: true, value: { ids, endOffset: itemsOffset + count * 8 } };
}

function queueCollectionAt(
  data: Uint8Array,
  countOffset: number,
  endOffset: number,
): Revit2027StairsAggregateDecodeResult<CondInt16QueueCollection> {
  const decoded = decodeCondInt16QueueCollection(
    data.subarray(0, endOffset),
    countOffset,
    { maxEntries: MAX_COLLECTION_ITEMS },
  );
  return decoded.ok
    ? { ok: true, value: decoded.collection }
    : { ok: false, error: decoded.error };
}

/**
 * Decode the exact Revit 2027 `StairsElement` aggregate-bearing static body.
 *
 * `Formats/Latest` orders the relevant direct fields as:
 *
 * 1. `m_registeredRailings` (`PArray<ObjectId>`)
 * 2. `m_runsAndLandings` (`PArray<ObjectId>`)
 * 3. `m_stairsBndryCurves2d` (queued-object collection)
 * 4. `m_stairsRailingPaths` (queued-object collection)
 * 5. `m_supports` (`PArray<ObjectId>`)
 *
 * The remaining 84 scalar bytes are consumed to certify the static cursor.
 */
export function decodeRevit2027StairsElementAggregate(
  data: Uint8Array,
  objectOffset: number,
  objectLength: number,
  revitVersion: number,
): Revit2027StairsAggregateDecodeResult<Revit2027StairsElementAggregate> {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "StairsElement aggregate decoding requires Revit 2027",
    };
  }
  const frame = decodeFrame(
    data,
    objectOffset,
    objectLength,
    new Set([REVIT_2027_STAIRS_ELEMENT_MARKER]),
  );
  if (!frame.ok) return frame;
  const endOffset = frame.value.objectEndOffset;
  let cursor = objectOffset + STATIC_BODY_OFFSET;

  const registeredRailings = readObjectIdArray(data, cursor, endOffset);
  if (!registeredRailings.ok) return registeredRailings;
  cursor = registeredRailings.value.endOffset;

  const runsAndLandings = readObjectIdArray(data, cursor, endOffset);
  if (!runsAndLandings.ok) return runsAndLandings;
  cursor = runsAndLandings.value.endOffset;

  const boundaryCurves = queueCollectionAt(data, cursor, endOffset);
  if (!boundaryCurves.ok) return boundaryCurves;
  cursor = boundaryCurves.value.endOffset;

  const railingPaths = queueCollectionAt(data, cursor, endOffset);
  if (!railingPaths.ok) return railingPaths;
  cursor = railingPaths.value.endOffset;

  const supports = readObjectIdArray(data, cursor, endOffset);
  if (!supports.ok) return supports;
  cursor = supports.value.endOffset;

  const scalarBytes = 84;
  if (!fits(data, cursor, scalarBytes, endOffset)) {
    return { ok: false, error: "StairsElement scalar tail is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const offset of [
    cursor,
    cursor + 8,
    cursor + 24,
    cursor + 40,
    cursor + 56,
  ]) {
    if (!Number.isFinite(view.getFloat64(offset, true))) {
      return { ok: false, error: "StairsElement scalar tail is non-finite" };
    }
  }
  for (const offset of [cursor + 80, cursor + 81, cursor + 82, cursor + 83]) {
    if (data[offset]! > 1) {
      return { ok: false, error: "StairsElement boolean tail is invalid" };
    }
  }
  cursor += scalarBytes;

  return {
    ok: true,
    value: {
      elementId: frame.value.elementId,
      objectOffset,
      objectLength,
      staticBodyOffset: objectOffset + STATIC_BODY_OFFSET,
      staticEndOffset: cursor,
      registeredRailingIds: registeredRailings.value.ids,
      runAndLandingIds: runsAndLandings.value.ids,
      stairsBoundaryCurves2d: boundaryCurves.value,
      stairsRailingPaths: railingPaths.value,
      supportIds: supports.value.ids,
    },
  };
}

function nullableObjectId(
  view: DataView,
  byteOffset: number,
): number | null | undefined {
  const low = view.getUint32(byteOffset, true);
  const high = view.getUint32(byteOffset + 4, true);
  if (low === 0 && high === 0) return null;
  if (low === 0xffff_ffff && high === 0xffff_ffff) return null;
  return high === 0 && low > 0 ? low : undefined;
}

/**
 * Decode the schema-anchored suffix beginning at
 * `StairsRunAndLanding.m_stairsId`.
 *
 * The fields preceding this suffix contain variable inline structures. The
 * suffix is still independently exact and uniquely locatable in every
 * release-gated UNBC run/landing frame:
 *
 * `stairsId, triserSymId, baseRiserIndex, isMirrored, stringerArr,
 * supportPathCurveLoops, supportExistenceStatusMap`.
 */
export function decodeRevit2027StairsRunAndLandingAggregate(
  data: Uint8Array,
  objectOffset: number,
  objectLength: number,
  revitVersion: number,
  options: { knownStairsElementIds?: ReadonlySet<number> } = {},
): Revit2027StairsAggregateDecodeResult<Revit2027StairsRunAndLandingAggregate> {
  if (revitVersion !== 2027) {
    return {
      ok: false,
      error: "StairsRunAndLanding aggregate decoding requires Revit 2027",
    };
  }
  const frame = decodeFrame(
    data,
    objectOffset,
    objectLength,
    new Set([
      REVIT_2027_STAIRS_LANDING_MARKER,
      REVIT_2027_STAIRS_RUN_MARKER,
    ]),
  );
  if (!frame.ok) return frame;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const searchStart = objectOffset + STATIC_BODY_OFFSET;
  const searchEnd = Math.min(
    frame.value.objectEndOffset,
    objectOffset + MAX_RECIPROCAL_STATIC_BYTES,
  );
  const candidates: Revit2027StairsRunAndLandingAggregate[] = [];

  for (let stairsIdOffset = searchStart; stairsIdOffset + 25 <= searchEnd; stairsIdOffset += 1) {
    const stairsId = nullableObjectId(view, stairsIdOffset);
    if (stairsId == null) continue;
    if (
      options.knownStairsElementIds &&
      !options.knownStairsElementIds.has(stairsId)
    ) {
      continue;
    }
    const triserSymbolId = nullableObjectId(view, stairsIdOffset + 8);
    if (triserSymbolId === undefined) continue;
    const baseRiserIndex = view.getInt32(stairsIdOffset + 16, true);
    if (baseRiserIndex < -1 || baseRiserIndex > 1_000_000) continue;
    const mirrored = data[stairsIdOffset + 20]!;
    if (mirrored > 1) continue;

    const stringers = readObjectIdArray(
      data,
      stairsIdOffset + 21,
      frame.value.objectEndOffset,
    );
    if (!stringers.ok) continue;
    const supportPaths = queueCollectionAt(
      data,
      stringers.value.endOffset,
      frame.value.objectEndOffset,
    );
    if (!supportPaths.ok) continue;
    let cursor = supportPaths.value.endOffset;
    if (!fits(data, cursor, 4, frame.value.objectEndOffset)) continue;
    const statusCount = view.getInt32(cursor, true);
    if (statusCount < 0 || statusCount > MAX_COLLECTION_ITEMS) continue;
    cursor += 4;
    if (!fits(data, cursor, statusCount * 8, frame.value.objectEndOffset)) {
      continue;
    }
    const supportExistenceStatus: { key: number; value: number }[] = [];
    for (let index = 0; index < statusCount; index += 1) {
      supportExistenceStatus.push({
        key: view.getInt32(cursor, true),
        value: view.getInt32(cursor + 4, true),
      });
      cursor += 8;
    }
    candidates.push({
      elementId: frame.value.elementId,
      stairsId,
      triserSymbolId,
      baseRiserIndex,
      isMirrored: mirrored === 1,
      stringerIds: stringers.value.ids,
      supportPathCurveLoops: supportPaths.value,
      supportExistenceStatus,
      objectOffset,
      objectLength,
      stairsIdOffset,
      staticSuffixEndOffset: cursor,
    });
  }

  if (candidates.length !== 1) {
    return {
      ok: false,
      error:
        candidates.length === 0
          ? "StairsRunAndLanding aggregate suffix was not found"
          : "StairsRunAndLanding aggregate suffix is ambiguous",
    };
  }
  return { ok: true, value: candidates[0]! };
}
