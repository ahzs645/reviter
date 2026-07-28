import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
  formatNativeRevitUniqueId,
  formatRevitGuid,
} from "../lib/reviter/native-identity.ts";

const HISTORY_PREFIX = [
  0x52, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
] as const;

function guidBytes(seed: number): Uint8Array {
  return Uint8Array.from([
    seed, 0x33, 0x22, 0x11, 0x55, 0x44, 0x77, 0x66,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, seed,
  ]);
}

function historyFixture(): Uint8Array {
  const episodeCount = 3;
  const historyIndexCount = 2;
  const episodeCountOffset = 106 + historyIndexCount * 4;
  const episodeStart = episodeCountOffset + 4;
  const data = new Uint8Array(episodeStart + episodeCount * 17 + 4);
  const view = new DataView(data.buffer);
  data.set(HISTORY_PREFIX, 0);
  view.setUint32(14, episodeCount, true);
  view.setInt32(18, 0, true);
  for (let index = 0; index < 5; index += 1) data.set(guidBytes(0x10 + index), 22 + index * 16);
  view.setUint32(102, historyIndexCount, true);
  view.setUint32(106, 101, true);
  view.setUint32(110, 202, true);
  view.setUint32(episodeCountOffset, episodeCount, true);
  // Storage is newest-first: storage rows map to episode ids 2, 1, 0.
  for (let index = 0; index < episodeCount; index += 1) {
    data.set(guidBytes(0x20 + index), episodeStart + index * 17);
    data[episodeStart + index * 17 + 16] = 0x28;
  }
  return data;
}

function elementTableFixture(): Uint8Array {
  const data = new Uint8Array(34 + 40 + 36);
  const view = new DataView(data.buffer);
  view.setUint32(2, 2, true);
  const row = 34;
  view.setBigUint64(row, 0xffff_ffff_ffff_ffffn, true);
  view.setUint32(row + 8, 0, true);
  view.setBigUint64(row + 12, 0x1234n, true);
  view.setUint32(row + 20, 1, true);
  view.setUint32(row + 24, 2, true);
  view.setUint32(row + 28, 0xffff_ffff, true);
  view.setBigUint64(row + 32, 0xabcdefn, true);
  return data;
}

test("formats Microsoft-layout GUID bytes and the native UniqueId suffix", () => {
  const bytes = Uint8Array.from([
    0xbe, 0x1b, 0x80, 0x88, 0x4f, 0x80, 0x6f, 0x48,
    0x82, 0xc6, 0x7f, 0x7a, 0xfc, 0x65, 0x9f, 0xde,
  ]);
  const guid = formatRevitGuid(bytes);
  assert.equal(guid, "88801bbe-804f-486f-82c6-7f7afc659fde");
  assert.equal(
    formatNativeRevitUniqueId(guid!, 0xabc),
    "88801bbe-804f-486f-82c6-7f7afc659fde-00000abc",
  );
});

test("decodes reverse-indexed episode GUIDs from the complete history framing", () => {
  const result = decodeRevitDocumentHistory(historyFixture(), 2027);
  if (result.format === "unsupported") assert.fail(result.reason);
  assert.equal(result.episodes.length, 3);
  assert.deepEqual(result.episodes.map((episode) => episode.episodeId), [0, 1, 2]);
  assert.equal(result.episodes[1]!.guid, "11223321-4455-6677-8899-aabbccddee21");
  assert.deepEqual(result.historyIndexValues, [101, 202]);
});

test("joins creation history and original id even when it differs from current id", () => {
  const history = decodeRevitDocumentHistory(historyFixture(), 2027);
  assert.notEqual(history.format, "unsupported");
  if (history.format === "unsupported") return;
  const result = decodeRevitNativeIdentities(elementTableFixture(), history, 2027);
  if (result.format === "unsupported") assert.fail(result.reason);
  assert.deepEqual(result.identities, [{
    elementId: 0x1234,
    originalElementId: 0xabcdef,
    creationEpisodeId: 1,
    lastModificationEpisodeId: 2,
    lastUserModificationEpisodeId: null,
    episodeGuid: "11223321-4455-6677-8899-aabbccddee21",
    uniqueId: "11223321-4455-6677-8899-aabbccddee21-00abcdef",
    byteOffset: 34,
    provenance: "Global/ElemTable.ElementHistory+Global/History.Episode",
  }]);
});

test("rejects unsupported history framing and impossible element chronology", () => {
  const brokenHistory = historyFixture();
  brokenHistory[brokenHistory.length - 5] = 0x29;
  assert.equal(decodeRevitDocumentHistory(brokenHistory, 2027).format, "unsupported");
  assert.equal(decodeRevitDocumentHistory(historyFixture(), 2026).format, "unsupported");

  const history = decodeRevitDocumentHistory(historyFixture(), 2027);
  assert.notEqual(history.format, "unsupported");
  if (history.format === "unsupported") return;
  const table = elementTableFixture();
  new DataView(table.buffer).setUint32(34 + 24, 0, true);
  assert.equal(decodeRevitNativeIdentities(table, history, 2027).format, "unsupported");
});
