/**
 * Browser-safe native Revit identity decoding for the measured 2027 layout.
 *
 * Revit's persisted UniqueId joins two independent streams:
 *
 * - `Global/History` maps an integer episode id to a GUID;
 * - `Global/ElemTable` stores each element history's creation episode and
 *   original element id.
 *
 * The decoder is deliberately release-gated and checks the complete stream
 * shapes plus temporal invariants before formatting any UniqueId.
 *
 * **Where ids are 32-bit** (Revit 2019 to 2023; `element-id-width.ts`)
 * `Global/History` has the same shape under an older format number in its
 * first two bytes (`0x045d` in 2019 up to `0x04dc` in 2023, against `0x0552`
 * in 2027), and an `ElemTable` row is 28 bytes from byte 30: `[i32 owner][i32
 * id][i32 original id][u32 creation][u32 last modification][u32 last user
 * modification][u32]`. On the 2023 RAC sample every one of the 5,092 elements
 * Autodesk's capture of the 2025 copy gives a UniqueId has that UniqueId.
 *
 * **2024 to 2026** files use the 2027 layout under their own format numbers
 * (`0x04ff`, `0x051d`, `0x0538`). Every UniqueId decoded for an element
 * Autodesk's captures name agrees with the capture: 34,063 in the 2024
 * Snowdon sample, 12,260 in the 2025 technical school and 5,192 in the 2025
 * RAC sample, none different. The 2026 RAC sample agrees with its 2025 copy
 * on all 8,325 elements both hold.
 */
import { narrowElementIds } from "./element-id-width.ts";
import { readsElementRecordLayout, usesRevit2027RecordLayout } from "./revit-class-tags.ts";

const HISTORY_PREFIX = [
  0x52, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
] as const;
const HISTORY_SEQUENCE_OFFSET = 14;
const HISTORY_GUID_SLOTS_OFFSET = 22;
const HISTORY_GUID_SLOT_COUNT = 5;
const HISTORY_INDEX_COUNT_OFFSET = 102;
const EPISODE_BYTES = 17;
const EPISODE_STRENGTH = 0x28;
const HISTORY_SUFFIX_BYTES = 4;
const MAX_HISTORY_ITEMS = 1_000_000;

const ELEMENT_RECORD_START = 34;
const ELEMENT_RECORD_BYTES = 40;
const ELEMENT_TABLE_SUFFIX_BYTES = 36;
const NARROW_ELEMENT_RECORD_START = 30;
const NARROW_ELEMENT_RECORD_BYTES = 28;
const NARROW_ELEMENT_TABLE_SUFFIX_BYTES = 23;
/** `Global/History` format numbers of the 2019 to 2023 releases. */
const NARROW_HISTORY_FORMATS = new Set([0x045d, 0x0468, 0x0482, 0x04a2, 0x04dc]);
/** `Global/History` format numbers of the 2024, 2025, 2026 and 2027 releases. */
const WIDE_HISTORY_FORMATS = new Set([0x04ff, 0x051d, 0x0538, 0x0552]);

function narrowIdentityLayout(revitVersion: number): boolean {
  return !usesRevit2027RecordLayout(revitVersion) &&
    readsElementRecordLayout(revitVersion) &&
    narrowElementIds();
}
const MAX_ELEMENT_RECORDS = 10_000_000;
const NO_EPISODE = 0xffff_ffff;

export type RevitEpisode = {
  episodeId: number;
  guid: string;
  strength: number;
  byteOffset: number;
};

export type RevitDocumentHistory = {
  format: "revit-2027-history-v0x10552" | "revit-2019-2023-history";
  nextLocalSequenceNumber: number;
  subsequenceNumberDeficit: number;
  documentGuidSlots: string[];
  historyIndexValues: number[];
  episodes: RevitEpisode[];
};

export type NativeElementIdentity = {
  elementId: number;
  originalElementId: number;
  creationEpisodeId: number;
  lastModificationEpisodeId: number;
  lastUserModificationEpisodeId: number | null;
  episodeGuid: string;
  uniqueId: string;
  byteOffset: number;
  provenance: "Global/ElemTable.ElementHistory+Global/History.Episode";
};

export type NativeIdentityDecode = {
  format: "revit-2027-native-identity" | "revit-2019-2023-native-identity";
  declaredRecordCount: number;
  decodedIdentityCount: number;
  skippedLeadingRecordCount: 1;
  identities: NativeElementIdentity[];
};

export type NativeIdentityFailure = {
  format: "unsupported";
  reason: string;
};

function unsupported(reason: string): NativeIdentityFailure {
  return { format: "unsupported", reason };
}

function matches(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || offset + expected.length > data.byteLength) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (data[offset + index] !== expected[index]) return false;
  }
  return true;
}

function isZeroGuid(data: Uint8Array, offset: number): boolean {
  for (let index = 0; index < 16; index += 1) {
    if (data[offset + index] !== 0) return false;
  }
  return true;
}

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}

/** Convert an in-memory/Microsoft GUID byte layout to canonical lowercase text. */
export function formatRevitGuid(data: Uint8Array, offset = 0): string | null {
  if (offset < 0 || offset + 16 > data.byteLength) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tail = Array.from(data.subarray(offset + 8, offset + 16), (byte) => hex(byte, 2));
  return [
    hex(view.getUint32(offset, true), 8),
    hex(view.getUint16(offset + 4, true), 4),
    hex(view.getUint16(offset + 6, true), 4),
    `${tail[0]}${tail[1]}`,
    tail.slice(2).join(""),
  ].join("-");
}

/**
 * Decode the complete supplied Revit 2027 `Global/History` representation.
 *
 * Episode objects are persisted newest-first as a 16-byte GUID and one-byte
 * strength. Native `getEpisode(id)` addresses them at `count - id - 1`.
 */
export function decodeRevitDocumentHistory(
  data: Uint8Array,
  revitVersion: number,
): RevitDocumentHistory | NativeIdentityFailure {
  const narrow = narrowIdentityLayout(revitVersion);
  if (!usesRevit2027RecordLayout(revitVersion) && !narrow) {
    return unsupported(`unsupported Revit release ${revitVersion}`);
  }
  const header = data.byteLength >= 128 &&
    (narrow ? NARROW_HISTORY_FORMATS : WIDE_HISTORY_FORMATS).has(data[0]! | (data[1]! << 8)) &&
    matches(data, 2, HISTORY_PREFIX.slice(2));
  if (!header) {
    return unsupported("Global/History does not have the measured 2027 header");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nextLocalSequenceNumber = view.getUint32(HISTORY_SEQUENCE_OFFSET, true);
  const subsequenceNumberDeficit = view.getInt32(HISTORY_SEQUENCE_OFFSET + 4, true);
  const historyIndexCount = view.getUint32(HISTORY_INDEX_COUNT_OFFSET, true);
  if (
    nextLocalSequenceNumber < 1 ||
    nextLocalSequenceNumber > MAX_HISTORY_ITEMS ||
    historyIndexCount > MAX_HISTORY_ITEMS
  ) {
    return unsupported("Global/History contains an implausible collection count");
  }

  const historyIndexStart = HISTORY_INDEX_COUNT_OFFSET + 4;
  const episodeCountOffset = historyIndexStart + historyIndexCount * 4;
  if (episodeCountOffset + 4 > data.byteLength) {
    return unsupported("Global/History index array exceeds the stream");
  }
  const episodeCount = view.getUint32(episodeCountOffset, true);
  if (episodeCount !== nextLocalSequenceNumber) {
    return unsupported(
      `episode count ${episodeCount} does not equal next sequence ${nextLocalSequenceNumber}`,
    );
  }

  const episodeStart = episodeCountOffset + 4;
  const expectedBytes =
    episodeStart + episodeCount * EPISODE_BYTES + HISTORY_SUFFIX_BYTES;
  if (expectedBytes !== data.byteLength) {
    return unsupported(
      `episode count and stream length disagree (${expectedBytes} != ${data.byteLength})`,
    );
  }
  if (view.getUint32(data.byteLength - HISTORY_SUFFIX_BYTES, true) !== 0) {
    return unsupported("Global/History suffix is not the measured zero word");
  }

  const documentGuidSlots: string[] = [];
  for (let index = 0; index < HISTORY_GUID_SLOT_COUNT; index += 1) {
    const offset = HISTORY_GUID_SLOTS_OFFSET + index * 16;
    documentGuidSlots.push(
      isZeroGuid(data, offset) ? "00000000-0000-0000-0000-000000000000" :
        formatRevitGuid(data, offset)!,
    );
  }

  const historyIndexValues: number[] = [];
  for (let index = 0; index < historyIndexCount; index += 1) {
    historyIndexValues.push(view.getUint32(historyIndexStart + index * 4, true));
  }

  const episodes: RevitEpisode[] = [];
  const guids = new Set<string>();
  for (let storageIndex = 0; storageIndex < episodeCount; storageIndex += 1) {
    const byteOffset = episodeStart + storageIndex * EPISODE_BYTES;
    if (isZeroGuid(data, byteOffset)) {
      return unsupported(`episode storage row ${storageIndex} has a zero GUID`);
    }
    const strength = data[byteOffset + 16]!;
    if (strength !== EPISODE_STRENGTH) {
      return unsupported(
        `episode storage row ${storageIndex} has unsupported strength 0x${hex(strength, 2)}`,
      );
    }
    const guid = formatRevitGuid(data, byteOffset)!;
    if (guids.has(guid)) return unsupported(`duplicate episode GUID ${guid}`);
    guids.add(guid);
    episodes.push({
      episodeId: episodeCount - storageIndex - 1,
      guid,
      strength,
      byteOffset,
    });
  }
  episodes.sort((left, right) => left.episodeId - right.episodeId);

  return {
    format: narrow ? "revit-2019-2023-history" : "revit-2027-history-v0x10552",
    nextLocalSequenceNumber,
    subsequenceNumberDeficit,
    documentGuidSlots,
    historyIndexValues,
    episodes,
  };
}

/** Format the public Revit UniqueId contract without truncating large handles. */
export function formatNativeRevitUniqueId(
  episodeGuid: string,
  originalElementId: number,
): string {
  return `${episodeGuid}-${originalElementId.toString(16).padStart(8, "0")}`;
}

/**
 * Join compact element-history rows to the document episode table.
 *
 * The three episode words are accepted only when creation is not after either
 * modification date. `0xffffffff` is the supported missing-user-date sentinel.
 */
export function decodeRevitNativeIdentities(
  data: Uint8Array,
  history: RevitDocumentHistory,
  revitVersion: number,
): NativeIdentityDecode | NativeIdentityFailure {
  if (narrowIdentityLayout(revitVersion)) return decodeNarrowNativeIdentities(data, history);
  if (!usesRevit2027RecordLayout(revitVersion)) return unsupported(`unsupported Revit release ${revitVersion}`);
  if (data.byteLength < ELEMENT_RECORD_START + ELEMENT_TABLE_SUFFIX_BYTES) {
    return unsupported("Global/ElemTable is shorter than the measured 2027 framing");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredRecordCount = view.getUint32(2, true);
  if (declaredRecordCount < 2 || declaredRecordCount > MAX_ELEMENT_RECORDS) {
    return unsupported(`implausible element record count ${declaredRecordCount}`);
  }
  const decodedIdentityCount = declaredRecordCount - 1;
  const expectedBytes =
    ELEMENT_RECORD_START +
    decodedIdentityCount * ELEMENT_RECORD_BYTES +
    ELEMENT_TABLE_SUFFIX_BYTES;
  if (expectedBytes !== data.byteLength) {
    return unsupported(
      `element count and stream length disagree (${expectedBytes} != ${data.byteLength})`,
    );
  }

  const episodeById = new Map(history.episodes.map((episode) => [episode.episodeId, episode]));
  const elementIds = new Set<number>();
  const uniqueIds = new Set<string>();
  const identities: NativeElementIdentity[] = [];

  for (let index = 0; index < decodedIdentityCount; index += 1) {
    const byteOffset = ELEMENT_RECORD_START + index * ELEMENT_RECORD_BYTES;
    if (view.getUint32(byteOffset + 8, true) !== 0) {
      return unsupported(`element row ${index} has a nonzero object-id prefix`);
    }
    const elementId64 = view.getBigUint64(byteOffset + 12, true);
    const originalElementId64 = view.getBigUint64(byteOffset + 32, true);
    if (
      elementId64 < 1n ||
      originalElementId64 < 1n ||
      elementId64 > BigInt(Number.MAX_SAFE_INTEGER) ||
      originalElementId64 > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return unsupported(`element row ${index} contains an unsupported 64-bit id`);
    }
    const elementId = Number(elementId64);
    const originalElementId = Number(originalElementId64);
    if (elementIds.has(elementId)) return unsupported(`duplicate element id ${elementId}`);
    elementIds.add(elementId);

    const creationEpisodeId = view.getUint32(byteOffset + 20, true);
    const lastModificationEpisodeId = view.getUint32(byteOffset + 24, true);
    const rawLastUserEpisodeId = view.getUint32(byteOffset + 28, true);
    const creationEpisode = episodeById.get(creationEpisodeId);
    if (!creationEpisode) {
      return unsupported(
        `element ${elementId} creation episode ${creationEpisodeId} is unresolved`,
      );
    }
    if (
      !episodeById.has(lastModificationEpisodeId) ||
      lastModificationEpisodeId < creationEpisodeId
    ) {
      return unsupported(`element ${elementId} has an invalid modification episode`);
    }
    if (
      rawLastUserEpisodeId !== NO_EPISODE &&
      (!episodeById.has(rawLastUserEpisodeId) ||
        rawLastUserEpisodeId < creationEpisodeId)
    ) {
      return unsupported(`element ${elementId} has an invalid user-modification episode`);
    }

    const uniqueId = formatNativeRevitUniqueId(
      creationEpisode.guid,
      originalElementId,
    );
    if (uniqueIds.has(uniqueId)) return unsupported(`duplicate native UniqueId ${uniqueId}`);
    uniqueIds.add(uniqueId);
    identities.push({
      elementId,
      originalElementId,
      creationEpisodeId,
      lastModificationEpisodeId,
      lastUserModificationEpisodeId:
        rawLastUserEpisodeId === NO_EPISODE ? null : rawLastUserEpisodeId,
      episodeGuid: creationEpisode.guid,
      uniqueId,
      byteOffset,
      provenance: "Global/ElemTable.ElementHistory+Global/History.Episode",
    });
  }

  return {
    format: "revit-2027-native-identity",
    declaredRecordCount,
    decodedIdentityCount,
    skippedLeadingRecordCount: 1,
    identities,
  };
}

/** The same join over the 2019-2023 element table's 28-byte rows. */
function decodeNarrowNativeIdentities(
  data: Uint8Array,
  history: RevitDocumentHistory,
): NativeIdentityDecode | NativeIdentityFailure {
  if (data.byteLength < NARROW_ELEMENT_RECORD_START + NARROW_ELEMENT_TABLE_SUFFIX_BYTES) {
    return unsupported("Global/ElemTable is shorter than the 2019-2023 framing");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declaredRecordCount = view.getUint32(2, true);
  if (declaredRecordCount < 2 || declaredRecordCount > MAX_ELEMENT_RECORDS) {
    return unsupported(`implausible element record count ${declaredRecordCount}`);
  }
  const decodedIdentityCount = declaredRecordCount - 1;
  const expectedBytes =
    NARROW_ELEMENT_RECORD_START +
    decodedIdentityCount * NARROW_ELEMENT_RECORD_BYTES +
    NARROW_ELEMENT_TABLE_SUFFIX_BYTES;
  if (expectedBytes !== data.byteLength) {
    return unsupported(
      `element count and stream length disagree (${expectedBytes} != ${data.byteLength})`,
    );
  }

  const episodeById = new Map(history.episodes.map((episode) => [episode.episodeId, episode]));
  const elementIds = new Set<number>();
  const uniqueIds = new Set<string>();
  const identities: NativeElementIdentity[] = [];
  for (let index = 0; index < decodedIdentityCount; index += 1) {
    const byteOffset = NARROW_ELEMENT_RECORD_START + index * NARROW_ELEMENT_RECORD_BYTES;
    const elementId = view.getInt32(byteOffset + 4, true);
    const originalElementId = view.getInt32(byteOffset + 8, true);
    if (elementId < 1 || originalElementId < 1) {
      return unsupported(`element row ${index} contains an invalid id`);
    }
    if (elementIds.has(elementId)) return unsupported(`duplicate element id ${elementId}`);
    elementIds.add(elementId);

    const creationEpisodeId = view.getUint32(byteOffset + 12, true);
    const lastModificationEpisodeId = view.getUint32(byteOffset + 16, true);
    const rawLastUserEpisodeId = view.getUint32(byteOffset + 20, true);
    const creationEpisode = episodeById.get(creationEpisodeId);
    if (!creationEpisode) {
      return unsupported(
        `element ${elementId} creation episode ${creationEpisodeId} is unresolved`,
      );
    }
    if (
      !episodeById.has(lastModificationEpisodeId) ||
      lastModificationEpisodeId < creationEpisodeId
    ) {
      return unsupported(`element ${elementId} has an invalid modification episode`);
    }
    if (
      rawLastUserEpisodeId !== NO_EPISODE &&
      (!episodeById.has(rawLastUserEpisodeId) ||
        rawLastUserEpisodeId < creationEpisodeId)
    ) {
      return unsupported(`element ${elementId} has an invalid user-modification episode`);
    }
    const uniqueId = formatNativeRevitUniqueId(creationEpisode.guid, originalElementId);
    if (uniqueIds.has(uniqueId)) return unsupported(`duplicate native UniqueId ${uniqueId}`);
    uniqueIds.add(uniqueId);
    identities.push({
      elementId,
      originalElementId,
      creationEpisodeId,
      lastModificationEpisodeId,
      lastUserModificationEpisodeId:
        rawLastUserEpisodeId === NO_EPISODE ? null : rawLastUserEpisodeId,
      episodeGuid: creationEpisode.guid,
      uniqueId,
      byteOffset,
      provenance: "Global/ElemTable.ElementHistory+Global/History.Episode",
    });
  }
  return {
    format: "revit-2019-2023-native-identity",
    declaredRecordCount,
    decodedIdentityCount,
    skippedLeadingRecordCount: 1,
    identities,
  };
}
