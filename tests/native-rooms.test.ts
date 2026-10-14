import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeRoomEvidence, scanNativeRoomEvidence, resolveNativeRooms, nativeRoomOutline, scanNativeRoomRecords, NATIVE_ROOM_CATEGORY } from '../lib/reviter/native-rooms.ts';
import type { ElementBoundsRecord } from '../lib/reviter/types.ts';
const location = { stream: 'Partitions/1', chunkIndex: 0, offset: 0 };
const bounds = { min: { x: 0, y: 0, z: 3 }, max: { x: 10, y: 8, z: 12 } };
const edge = (a: [number, number], b: [number, number], bottom = 3) => ({ a, b, bottom });
const ring = (points: [number, number][]) => points.map((p, i) => edge(p, points[(i + 1) % points.length]));
const rectangle = ring([[0, 0], [10, 0], [10, 8], [0, 8]]);
const header = (elementId = 42) => ({ elementId, categoryId: NATIVE_ROOM_CATEGORY, familyId: null, ownerViewId: null, designOptionId: null });
const record: ElementBoundsRecord = { elementId: 42, ...location, rawOffset: 0, recordOffset: 0, boundsFeet: bounds };
const resolve = (evidence = createNativeRoomEvidence(), records: ElementBoundsRecord[] = [], revitVersion = 2024) => resolveNativeRooms({ revitVersion, headers: new Map([[42, header()]]), evidence, bounds: records, parameters: new Map(), levels: [] });

test('boxless room retains exact native identity without inventing geometry or level', () => {
  const result = resolve();
  assert.equal(result.nativeRooms.length, 1);
  assert.equal(result.nativeRooms[0].elementId, 42);
  assert.equal(result.nativeRooms[0].outlineStatus, 'missing-record-bounds');
  assert.equal(result.nativeRooms[0].levelId, undefined);
  assert.equal(result.nativeRoomCoverage.boxlessRooms, 1);
});

test('outline retains inner shaft and floor height, ignores upper ceiling step', () => {
  const hole = ring([[2, 2], [3, 2], [3, 3], [2, 3]]);
  const shape = nativeRoomOutline([...rectangle, ...hole, edge([1, 1], [9, 1], 8)], bounds, location)!;
  assert.equal(shape.holes.length, 1);
  assert.equal(shape.areaSquareFeet, 79);
  assert.equal(shape.elevationFeet, 3);
  assert.deepEqual(shape.location, location);
});

test('outline rejects open edges, parity disagreement, self intersection and disjoint outer cells', () => {
  assert.equal(nativeRoomOutline(rectangle.slice(1), bounds, location), undefined);
  assert.equal(nativeRoomOutline(rectangle, { ...bounds, max: { ...bounds.max, x: 11 } }, location), undefined);
  assert.equal(nativeRoomOutline(ring([[0, 0], [10, 8], [0, 8], [10, 0]]), bounds, location), undefined);
  assert.equal(nativeRoomOutline([...rectangle, ...ring([[20, 0], [21, 0], [21, 1], [20, 1]])], bounds, location), undefined);
});

test('duplicates must agree and outlines only join a record in the same stream', () => {
  const evidence = createNativeRoomEvidence();
  evidence.solids.set(42, [{ edges: rectangle, location: { ...location, stream: 'Partitions/other' } }]);
  assert.equal(resolve(evidence, [record]).nativeRooms[0].outline, undefined);
  evidence.solids.set(42, [{ edges: rectangle, location }, { edges: [...rectangle, ...ring([[2, 2], [3, 2], [3, 3], [2, 3]])], location }]);
  assert.equal(resolve(evidence, [record]).nativeRooms[0].outline, undefined);
  evidence.solids.set(42, [{ edges: rectangle, location }, { edges: [...rectangle].reverse(), location }]);
  assert.equal(resolve(evidence, [record]).nativeRooms[0].outlineStatus, 'decoded');
  assert.equal(resolve(evidence, [record], 2027).nativeRooms[0].outlineStatus, 'unsupported-release');
});

function solidFixture(): Uint8Array {
  const bytes = new Uint8Array(900), view = new DataView(bytes.buffer);
  view.setBigUint64(0, 42n, true); bytes.set([4, 0x90, 8, 0], 8);
  rectangle.forEach((edge, i) => {
    const at = 32 + i * 174;
    bytes.set([4, 0, 8, 0], at); bytes[at + 85] = 1;
    const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], len = Math.hypot(dx, dy);
    const fields: [number, number[]][] = [[20, [0, 0, len, 9]], [86, [...edge.a, 3]], [110, [dx / len, dy / len, 0]], [134, [0, 0, 1]]];
    for (const [offset, values] of fields) values.forEach((v, j) => view.setFloat64(at + offset + j * 8, v, true));
  }); return bytes;
}

test('measured solid layout decodes and refuses malformed axes/truncation/unsupported release', () => {
  const bytes = solidFixture(), evidence = createNativeRoomEvidence();
  scanNativeRoomEvidence(bytes, 2024, location, evidence, new Set([42]));
  assert.equal(resolve(evidence, [record]).nativeRooms[0].outline?.areaSquareFeet, 80);
  for (const corrupted of [bytes.slice(0, 300), (() => { const b = bytes.slice(); new DataView(b.buffer).setFloat64(32 + 110, NaN, true); return b; })()]) {
    const bad = createNativeRoomEvidence(); scanNativeRoomEvidence(corrupted, 2024, location, bad, new Set([42]));
    assert.equal(resolve(bad, [record]).nativeRooms[0].outline, undefined);
  }
  const unsupported = createNativeRoomEvidence(); scanNativeRoomEvidence(bytes, 2027, location, unsupported, new Set([42]));
  assert.equal(unsupported.solids.size, 0);
});

function namesFixture(name: string, width = 8): Uint8Array {
  const data = new Uint8Array(256), view = new DataView(data.buffer);
  view.setUint32(0, 1, true); view.setUint32(4, 42, true);
  let p = 30;
  for (const [id, text] of [[-1006901, 'A-42'], [-1006900, name]] as const) {
    if (width === 8) view.setBigInt64(p, BigInt(id), true); else view.setInt32(p, id, true);
    p += width; view.setUint32(p, text.length, true); p += 4;
    [...text].forEach(c => { view.setUint16(p, c.charCodeAt(0), true); p += 2; });
  } return data;
}

test('adjacent room-number/name pair binds a native room only and disagreements stay unresolved', () => {
  for (const version of [2023, 2024, 2025, 2027]) {
    const evidence = createNativeRoomEvidence();
    scanNativeRoomEvidence(namesFixture('Office', version === 2023 ? 4 : 8), version, location, evidence, new Set([42]));
    assert.equal(resolve(evidence, [], version).nativeRooms[0].name, 'Office');
    scanNativeRoomEvidence(namesFixture('Other', version === 2023 ? 4 : 8), version, location, evidence, new Set([42]));
    assert.equal(resolve(evidence, [], version).nativeRooms[0].name, undefined);
  }
  const unrelated = createNativeRoomEvidence(); scanNativeRoomEvidence(namesFixture('Office'), 2024, location, unrelated, new Set());
  assert.equal(unrelated.names.size, 0);
});

const schema = { taggedClasses: [
  { name: 'ElementHeader', tag: 101 }, { name: 'Outline', tag: 102 },
  { name: 'ElementParents', tag: 103 }, { name: 'RoomElem', tag: 104 },
] } as unknown as import('../lib/reviter/schema.ts').SchemaSummary;
function recordFixture(box = true): Uint8Array {
  const bytes = new Uint8Array(160), view = new DataView(bytes.buffer);
  view.setBigUint64(0, 42n, true); view.setUint16(12, 101, true);
  view.setBigInt64(18, BigInt(NATIVE_ROOM_CATEGORY), true);
  view.setUint32(0x42, 0xffffef7f, true); view.setUint16(0x4a, 104, true);
  if (box) {
    view.setUint16(0x50, 102, true); bytes.fill(255, 0x52, 0x56); view.setUint16(0x56, 103, true);
    [0, 0, 3, 10, 8, 12].forEach((v, i) => view.setFloat64(0x58 + 8 * i, v, true));
  } return bytes;
}
test('RoomElem own box requires schema tags and selected boxless source is never backfilled', () => {
  const evidence = createNativeRoomEvidence();
  scanNativeRoomRecords(recordFixture(), 2024, undefined, location, evidence, new Set([42]));
  assert.equal(evidence.records.size, 0);
  scanNativeRoomRecords(recordFixture(), 2024, schema, location, evidence, new Set([42]));
  assert.deepEqual(resolve(evidence).nativeRooms[0].boundsFeet, bounds);
  const boxless = createNativeRoomEvidence();
  scanNativeRoomRecords(recordFixture(false), 2024, schema, location, boxless, new Set([42]));
  scanNativeRoomRecords(recordFixture(), 2024, schema, { ...location, stream: 'Partitions/old' }, boxless, new Set([42]));
  assert.equal(resolve(boxless, [record]).nativeRooms[0].boundsFeet, undefined);
  assert.equal(resolve(boxless, [record]).nativeRooms[0].outlineStatus, 'missing-record-bounds');
});

test('curved face cannot silently drop an interior cylindrical shaft from a closed outline', () => {
  const bytes = new Uint8Array(1100); bytes.set(solidFixture());
  const at = 32 + 4 * 174, view = new DataView(bytes.buffer);
  bytes.set([4, 0, 8, 0], at); bytes[at + 85] = 1;
  for (const [offset, values] of [[20, [0, -9, Math.PI * 2, 0]], [86, [0, 0, 0]], [110, [1, 0, 0]], [134, [0, 1, 0]], [158, [0, 0, 1]]] as [number, number[]][]) {
    values.forEach((v, i) => view.setFloat64(at + offset + 8 * i, v, true));
  }
  const evidence = createNativeRoomEvidence();
  scanNativeRoomEvidence(bytes, 2025, location, evidence, new Set([42]));
  assert.equal(resolve(evidence, [record], 2025).nativeRooms[0].outline, undefined);
});
