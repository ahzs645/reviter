import {
  decodeCondInt16QueueCollection,
  type CondInt16QueueCollection,
} from "./dynamic-geometry-queue.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { canonicalClassTag, readsElementRecordLayout } from "./revit-class-tags.ts";

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

/**
 * The same records where ids are 32-bit (Revit 2019 to 2023). The 2023 RAC
 * sample's two stairs and their runs, against the 2025 copy:
 *
 * - the frame header is 12 bytes and `Element`'s eight ids are four bytes
 *   each, so `StairsElement`'s own fields start at +91 rather than +127;
 * - every `ObjectId` in the arrays and the run suffix is four bytes;
 * - `StairsElement`'s scalar tail is declared doubles first: five doubles,
 *   `m_actualNumberOfRisers`, the base, multistorey and top level ids,
 *   `m_triserNumberBaseIndex`, `m_typeId` and four booleans, 68 bytes where
 *   2024 on interleave the ids with the doubles in 84.
 */
const NARROW = {
  staticBodyOffset: 91,
  echoOffset: 12,
  echoBytes: 16,
  lengthOffset: 8,
  markerOffset: 12,
  /** The second `Element` pointer, null in every stairs record, as the wide +22. */
  nullPointerOffset: 18,
  idBytes: 4,
  scalarTailBytes: 68,
  scalarTailDoubles: [0, 8, 16, 24, 32],
  scalarTailBooleans: 64,
} as const;
const WIDE = {
  staticBodyOffset: STATIC_BODY_OFFSET,
  echoOffset: FRAME_ECHO_OFFSET,
  echoBytes: FRAME_ECHO_BYTES,
  lengthOffset: 12,
  markerOffset: 16,
  nullPointerOffset: 22,
  idBytes: 8,
  scalarTailBytes: 84,
  scalarTailDoubles: [0, 8, 24, 40, 56],
  scalarTailBooleans: 80,
} as const;

function layout(): typeof NARROW | typeof WIDE {
  return narrowElementIds() ? NARROW : WIDE;
}

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
  /** Exact leading `StairsRun` fields; null for `StairsLanding`. */
  runProperties: {
    bottomElevationFeet: number;
    topElevationFeet: number;
    extendBelowBaseFeet: number;
    extendBelowTreadBaseFeet: number;
    actualRunWidthFeet: number;
    leftStringerWidthFeet: number;
    rightStringerWidthFeet: number;
    topRiserIndex: number;
    centerMarkVisible: boolean;
    beginWithRiser: boolean;
    endWithRiser: boolean;
  } | null;
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
  const at = layout();
  if (
    !Number.isSafeInteger(objectLength) ||
    objectLength < at.staticBodyOffset ||
    !fits(
      data,
      objectOffset,
      objectLength + at.echoBytes,
    )
  ) {
    return { ok: false, error: "stairs framed object is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(objectOffset + at.lengthOffset, true) !== objectLength) {
    return { ok: false, error: "stairs framed object length does not match" };
  }
  if (
    view.getUint32(
      objectOffset + objectLength + at.echoOffset,
      true,
    ) !== objectLength
  ) {
    return { ok: false, error: "stairs framed object length echo does not match" };
  }
  const marker = canonicalClassTag(view.getUint16(objectOffset + at.markerOffset, true));
  if (!allowedMarkers.has(marker)) {
    return { ok: false, error: "stairs framed object marker is not allowed" };
  }
  if (view.getUint32(objectOffset + at.nullPointerOffset, true) !== 0) {
    return { ok: false, error: "stairs framed object type high word is nonzero" };
  }
  const elementId = view.getUint32(objectOffset, true);
  if (
    elementId === 0 ||
    (at.idBytes === 8
      ? view.getUint32(objectOffset + 4, true) !== 0
      : elementId > 0x7fff_ffff)
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
  const idBytes = layout().idBytes;
  if (!fits(data, itemsOffset, count * idBytes, endOffset)) {
    return { ok: false, error: "stairs ObjectId collection is truncated" };
  }
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = itemsOffset + index * idBytes;
    const id = view.getUint32(offset, true);
    if (
      id === 0 ||
      (idBytes === 8 ? view.getUint32(offset + 4, true) !== 0 : id > 0x7fff_ffff)
    ) {
      return {
        ok: false,
        error: "stairs ObjectId collection contains an invalid id",
      };
    }
    ids.push(id);
  }
  return { ok: true, value: { ids, endOffset: itemsOffset + count * idBytes } };
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
  if (!readsElementRecordLayout(revitVersion)) {
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
  const at = layout();
  let cursor = objectOffset + at.staticBodyOffset;

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

  const scalarBytes = at.scalarTailBytes;
  if (!fits(data, cursor, scalarBytes, endOffset)) {
    return { ok: false, error: "StairsElement scalar tail is truncated" };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const offset of at.scalarTailDoubles.map((delta) => cursor + delta)) {
    if (!Number.isFinite(view.getFloat64(offset, true))) {
      return { ok: false, error: "StairsElement scalar tail is non-finite" };
    }
  }
  const booleans = cursor + at.scalarTailBooleans;
  for (const offset of [booleans, booleans + 1, booleans + 2, booleans + 3]) {
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
      staticBodyOffset: objectOffset + at.staticBodyOffset,
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
  if (narrowElementIds()) {
    const id = view.getUint32(byteOffset, true);
    if (id === 0 || id === 0xffff_ffff) return null;
    return id <= 0x7fff_ffff ? id : undefined;
  }
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
  if (!readsElementRecordLayout(revitVersion)) {
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
  // `[id m_stairsId][id m_triserSymId][i32 m_baseRiserIndex][u8 m_isMirrored]`,
  // each id eight bytes, or four where ids are 32-bit.
  const idBytes = layout().idBytes;
  const searchStart = objectOffset + layout().staticBodyOffset;
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
    const triserSymbolId = nullableObjectId(view, stairsIdOffset + idBytes);
    if (triserSymbolId === undefined) continue;
    const baseRiserIndex = view.getInt32(stairsIdOffset + 2 * idBytes, true);
    if (baseRiserIndex < -1 || baseRiserIndex > 1_000_000) continue;
    const mirrored = data[stairsIdOffset + 2 * idBytes + 4]!;
    if (mirrored > 1) continue;

    const stringers = readObjectIdArray(
      data,
      stairsIdOffset + 2 * idBytes + 5,
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
    let runProperties: Revit2027StairsRunAndLandingAggregate["runProperties"] =
      null;
    if (frame.value.marker === REVIT_2027_STAIRS_RUN_MARKER) {
      if (fits(data, cursor, 63, frame.value.objectEndOffset)) {
        const scalars = Array.from(
          { length: 7 },
          (_, index) => view.getFloat64(cursor + index * 8, true),
        );
        const topRiserIndex = view.getInt32(cursor + 56, true);
        const booleans = [
          data[cursor + 60]!,
          data[cursor + 61]!,
          data[cursor + 62]!,
        ];
        if (
          scalars.every(Number.isFinite) &&
          topRiserIndex >= -1 &&
          topRiserIndex <= 1_000_000 &&
          booleans.every((value) => value <= 1)
        ) {
          runProperties = {
            bottomElevationFeet: scalars[0]!,
            topElevationFeet: scalars[1]!,
            extendBelowBaseFeet: scalars[2]!,
            extendBelowTreadBaseFeet: scalars[3]!,
            actualRunWidthFeet: scalars[4]!,
            leftStringerWidthFeet: scalars[5]!,
            rightStringerWidthFeet: scalars[6]!,
            topRiserIndex,
            centerMarkVisible: booleans[0] === 1,
            beginWithRiser: booleans[1] === 1,
            endWithRiser: booleans[2] === 1,
          };
        }
      }
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
      runProperties,
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
