import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeRoomCollector,
  NATIVE_ROOM_CATEGORY_ID,
  nativeRoomOutlineFromFaces,
  readNativeRoomFace,
  type NativeRoomFace,
  type NativeSourceRoom,
} from "../lib/reviter/native-source-rooms.ts";
import { emitNativeRoomsIfc } from "../lib/reviter/export-ifc-native-rooms.ts";
import type { ElementHeader } from "../lib/reviter/element-headers.ts";
import { REVIT_2027_ELEMENT_HEADER_CLASS } from "../lib/reviter/element-headers.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const bounds = { min: { x: 0, y: 0, z: 4 }, max: { x: 10, y: 10, z: 14 } };
const source = { stream: "Partitions/room", chunkIndex: 0, rawOffset: 512 };
function faces(ring: [number, number][], z = 4): NativeRoomFace[] {
  return ring.map((point, i) => {
    const next = ring[(i + 1) % ring.length]!, dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy);
    return { uv: [0, 0, length, 10], origin: [point[0], point[1], z], u: [dx / length, dy / length, 0], v: [0, 0, 1] };
  });
}
function solid(elementId = 42, values = faces(square), year = 2024): Uint8Array {
  const header = year === 2023 ? 16 : 12, data = Buffer.alloc(header + 32 + values.length * 174);
  data.writeBigUInt64LE(BigInt(elementId), 0);
  if (year === 2023) data.fill(255, 8, 12);
  data.set([4, 0x90, 8, 0], header - 4);
  values.forEach((face, index) => {
    const at = header + 32 + index * 174;
    data.set([4, 0, 8, 0], at); data[at + 85] = 1;
    for (const [offset, values] of [[20, face.uv], [86, face.origin], [110, face.u], [134, face.v]] as const) {
      values.forEach((value, i) => data.writeDoubleLE(value, at + offset + 8 * i));
    }
  });
  return data;
}
function header(elementId = 42, overrides: Partial<ElementHeader> = {}): ElementHeader {
  return { elementId, categoryId: NATIVE_ROOM_CATEGORY_ID, familyId: null, ownerViewId: null, designOptionId: null, ...overrides };
}
function record(elementId = 42): ElementBoundsRecord {
  return { elementId, ...source, recordOffset: 0, boundsFeet: bounds };
}
function resolve(data: Uint8Array, year = 2024, records: ElementBoundsRecord[] = [record()], headers = [header()]) {
  const collector = createNativeRoomCollector(year);
  collector.consumePage(data, source);
  return collector.resolve({ elementHeaders: new Map(headers.map((entry) => [entry.elementId, entry])), elementBounds: records, declaredElementIds: new Set([42, 43]), levelIds: new Set([311]) });
}
function entries(number: string, name: string, year = 2024, elementId = 42): Uint8Array {
  const width = year === 2023 ? 4 : 8, pieces: Buffer[] = [];
  const id = Buffer.alloc(width);
  if (width === 8) id.writeBigUInt64LE(BigInt(elementId)); else id.writeUInt32LE(elementId);
  pieces.push(Buffer.from([1, 0, 0, 0]), id, Buffer.alloc(24));
  for (const [tag, value] of [[-1006901, number], [-1006900, name]] as const) {
    const bytes = Buffer.alloc(width), text = Buffer.from(value, "utf16le"), length = Buffer.alloc(4);
    if (width === 8) bytes.writeBigInt64LE(BigInt(tag)); else bytes.writeInt32LE(tag);
    length.writeUInt32LE(text.length / 2); pieces.push(bytes, length, text);
  }
  return Buffer.concat(pieces);
}
function block(number = "R42", name = "Room", level = 311): Uint8Array {
  const numberBytes = Buffer.from(number, "utf16le"), nameBytes = Buffer.from(name, "utf16le"), data = Buffer.alloc(525 + numberBytes.length + nameBytes.length);
  data.writeBigUInt64LE(42n, 0); data.writeBigUInt64LE(42n, 0x3c); data.writeBigUInt64LE(BigInt(level), 0x44);
  data.writeUInt32LE(number.length, 505); data.set(numberBytes, 509);
  const at = 509 + numberBytes.length + 8;
  data.writeUInt32LE(name.length, at); data.set(nameBytes, at + 4);
  return data;
}

test("stored faces recover concave source outlines and preserve shaft holes", () => {
  const concave: [number, number][] = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 10], [0, 10]];
  const hole: [number, number][] = [[1, 1], [1, 2], [2, 2], [2, 1]];
  const [room] = resolve(solid(42, [...faces(concave), ...faces(hole)]));
  assert.equal(room!.outlineStatus, "recovered");
  assert.equal(room!.outline!.areaSquareFeet, 83);
  assert.equal(room!.outline!.holesFeet.length, 1);
  assert.equal(room!.certifiedForRouting, false);
  assert.equal(room!.outline!.source, "partition_room_solid_faces");
  assert.deepEqual(room!.outline!.evidence, { ...source, offset: 0 });
});

test("source identity survives absent bounds, names and malformed solids", () => {
  const [boxless] = resolve(Buffer.alloc(0), 2024, []);
  assert.equal(boxless!.elementId, 42);
  assert.equal(boxless!.outlineStatus, "no-record-bounds");
  assert.equal(boxless!.boundsFeet, undefined);
  assert.equal(boxless!.outline, undefined);
  const [open] = resolve(solid(42, faces(square).slice(0, 3)));
  assert.equal(open!.elementId, 42); assert.equal(open!.outline, undefined);
});

test("measured solid layouts admit 2023–2025 only; identity recovery is independent", () => {
  for (const year of [2023, 2024, 2025]) assert.equal(resolve(solid(42, faces(square), year), year)[0]!.outlineStatus, "recovered");
  for (const year of [2019, 2022, 2026, 2027]) {
    const [room] = resolve(solid(), year);
    assert.equal(room!.outlineStatus, "unsupported-release"); assert.equal(room!.outline, undefined);
  }
});

test("source room category and standalone model identity are required", () => {
  for (const override of [{ categoryId: -2000011 }, { familyId: 1 }, { ownerViewId: 10 }, { unplacedOwnerId: 100 }]) assert.deepEqual(resolve(solid(), 2024, [], [header(42, override)]), []);
  const collector = createNativeRoomCollector(2024);
  collector.consumePage(solid(), source);
  assert.deepEqual(collector.resolve({ elementHeaders: new Map([[42, header()]]), elementBounds: [record()], declaredElementIds: new Set() }), []);
});

test("outline must match the exact room record's partition, floor and plan extent", () => {
  assert.equal(resolve(solid(42, faces(square, 5)))[0]!.outline, undefined);
  assert.equal(resolve(solid(), 2024, [{ ...record(), stream: "Partitions/other" }])[0]!.outline, undefined);
  assert.equal(nativeRoomOutlineFromFaces(faces(square), { ...bounds, max: { ...bounds.max, x: 11 } }), undefined);
});

test("ceiling steps are excluded and only bounded vertex dust is snapped", () => {
  const walls = faces(square), raised = faces([[2, 2], [8, 2], [8, 8], [2, 8]], 8);
  walls[1]!.origin[0] += 0.00003;
  assert.ok(Math.abs(nativeRoomOutlineFromFaces([...walls, ...raised], bounds)!.areaSquareFeet - 100) < 0.001);
  walls[1]!.origin[0] += 0.01;
  assert.equal(nativeRoomOutlineFromFaces(walls, bounds), undefined);
});

test("open, branching, bow-tie, touching and non-finite profiles fail closed", () => {
  const bad = [
    faces(square).slice(0, 3),
    [...faces(square), ...faces([[0, 0], [5, 5], [0, 10]])],
    faces([[0, 0], [10, 10], [0, 10], [10, 0]]),
    [...faces(square), ...faces([[0, 2], [2, 2], [2, 4], [0, 4]])],
  ];
  for (const candidate of bad) assert.equal(nativeRoomOutlineFromFaces(candidate, bounds), undefined);
  const encoded = Buffer.from(solid()); encoded.writeDoubleLE(NaN, 44 + 86);
  assert.equal(readNativeRoomFace(encoded, 44), undefined);
  for (let length = 0; length < 170; length++) assert.doesNotThrow(() => resolve(encoded.subarray(0, length)));
});

test("conflicting same-partition solids never pick an arbitrary outline", () => {
  const cut: [number, number][] = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 10], [0, 10]];
  const [room] = resolve(Buffer.concat([solid(), Buffer.alloc(1024), solid(42, faces(cut))]));
  assert.equal(room!.outlineStatus, "conflicting-solids"); assert.equal(room!.outline, undefined);
  const [duplicate] = resolve(Buffer.concat([solid(), Buffer.alloc(1024), solid(42, faces([...square].reverse()))]));
  assert.equal(duplicate!.outlineStatus, "recovered");
});

test("consecutive pages complete split room evidence and keep original byte provenance", () => {
  const data = Buffer.concat([solid(), Buffer.alloc(1024), entries("42", "Split room")]);
  const collector = createNativeRoomCollector(2024);
  const cuts = [300, 1600, data.length];
  let previous = 0;
  for (let index = 0; index < cuts.length; index++) {
    collector.consumePage(data.subarray(previous, cuts[index]), { ...source, chunkIndex: index, rawOffset: 512 + index * 100 });
    previous = cuts[index]!;
  }
  const [room] = collector.resolve({ elementHeaders: new Map([[42, header()]]), elementBounds: [record()] });
  assert.equal(room!.outlineStatus, "recovered"); assert.equal(room!.name, "Split room");
  assert.deepEqual(room!.outline!.evidence, { ...source, offset: 0 });
  assert.equal(collector.diagnostics().solidCandidates, 1);
});

test("overlap resets at a partition boundary or missing page", () => {
  for (const next of [{ ...source, stream: "Partitions/other", chunkIndex: 1 }, { ...source, chunkIndex: 2 }, { ...source, chunkIndex: 1, complete: false }]) {
    const collector = createNativeRoomCollector(2024), data = solid();
    collector.consumePage(data.subarray(0, 300), source);
    collector.consumePage(data.subarray(300), next);
    assert.equal(collector.resolve({ elementHeaders: new Map([[42, header()]]), elementBounds: [record()] })[0]!.outline, undefined);
  }
});

test("room's own standalone record supplies bounds without a scene geometry record", () => {
  const own = Buffer.alloc(136);
  own.writeBigUInt64LE(42n, 0); own.writeBigInt64LE(BigInt(NATIVE_ROOM_CATEGORY_ID), 0x12);
  own.fill(255, 0x32, 0x3a); own.writeUInt32LE(0xffffef7f, 0x42); own.writeUInt32LE(0xffffffff, 0x4c);
  own.set([0x46, 1, 255, 255, 255, 255, 0xab, 5], 0x50);
  [0, 0, 4, 10, 10, 14].forEach((value, index) => own.writeDoubleLE(value, 0x58 + 8 * index));
  const [room] = resolve(Buffer.concat([own, Buffer.alloc(16), solid()]), 2024, []);
  assert.equal(room!.boundsSource, "partition_room_record"); assert.equal(room!.outlineStatus, "recovered");
  own.writeUInt32LE(0xffff8000, 0x42);
  assert.equal(resolve(Buffer.concat([own, solid()]), 2024, [])[0]!.boundsFeet, undefined);
  own.writeUInt32LE(0xffffef7f, 0x42); own.writeBigUInt64LE(100n, 0x32);
  assert.equal(resolve(Buffer.concat([own, solid()]), 2024, [])[0]!.boundsFeet, undefined);
});

test("counted room regeneration history retains exact owner and record bounds", () => {
  const own = Buffer.alloc(136 + 22 * 6);
  own.writeBigUInt64LE(42n, 0); own.writeUInt16LE(REVIT_2027_ELEMENT_HEADER_CLASS, 12); own.writeUInt32LE(6, 14);
  const tail = 22 * 6;
  own.writeBigInt64LE(BigInt(NATIVE_ROOM_CATEGORY_ID), tail + 0x12);
  own.fill(255, tail + 0x32, tail + 0x3a); own.writeUInt32LE(0xffffef7f, tail + 0x42); own.writeUInt32LE(0xffffffff, tail + 0x4c);
  own.set([0x46, 1, 255, 255, 255, 255, 0xab, 5], tail + 0x50);
  [0, 0, 4, 10, 10, 14].forEach((value, index) => own.writeDoubleLE(value, tail + 0x58 + 8 * index));
  const [room] = resolve(Buffer.concat([own, Buffer.alloc(16), solid()]), 2024, []);
  assert.equal(room!.boundsSource, "partition_room_record"); assert.equal(room!.record!.offset, 0); assert.equal(room!.outlineStatus, "recovered");
});

test("room names use release-width parameter entries; conflicting copies lose labels", () => {
  for (const year of [2023, 2024, 2025]) {
    const [room] = resolve(entries("01", "Café \u{1f600}", year), year, []);
    assert.equal(room!.number, "01"); assert.equal(room!.name, "Café \u{1f600}");
    assert.equal(room!.parameterSource, "partition_room_parameter_entries");
  }
  const [conflict] = resolve(Buffer.concat([entries("01", "Office"), entries("01", "Store")]));
  assert.equal(conflict!.name, undefined);
  const [invalid] = resolve(entries("01", "Bad\u0000Name")); assert.equal(invalid!.name, undefined);
});

test("2024 confirmed-owner block supplements a proven Level, with entry names preferred", () => {
  const [room] = resolve(Buffer.concat([block("old", "Old Name"), entries("42", "Current Name")]));
  assert.equal(room!.number, "42"); assert.equal(room!.name, "Current Name"); assert.equal(room!.levelId, 311);
  const [unknownLevel] = resolve(block("42", "Room", 999)); assert.equal(unknownLevel!.levelId, undefined);
  const [blockOnly] = resolve(block()); assert.equal(blockOnly!.parameterSource, "partition_room_parameter_block");
  const [wrongRelease] = resolve(block(), 2025); assert.equal(wrongRelease!.levelId, undefined); assert.equal(wrongRelease!.name, undefined);
  const [levelConflict] = resolve(Buffer.concat([block(), block("R42", "Room", 999)])); assert.equal(levelConflict!.levelId, undefined);
});

function emit(rooms: NativeSourceRoom[], excluded = new Set<number>(), representedKeys = new Set<string>(), suppressed = new Set<number>()) {
  const lines: string[] = [];
  const output = emitNativeRoomsIfc({ add(value) { lines.push(value); return lines.length + 100; } }, rooms, {
    ownerHistory: 1, modelPlacement: 2, bodyContext: 3, extrusionDirection: 4, buildingEntity: 5,
    origin: { x: 0, y: 0, z: 0 }, storeyByLevelId: new Map([[311, 6]]),
    representedSourceElementIds: excluded, representedSourceRoomKeys: representedKeys, suppressedElementIds: suppressed,
    guid: (_kind, key) => `0${String(key).padStart(21, "0")}`,
    globalId: () => "1234567890123456789012", quoted: (text) => `'${text.replaceAll("'", "''")}'`,
  });
  return { lines, output };
}
test("native IFC spaces retain GlobalId, holes and explicit source-only provenance", () => {
  const [room] = resolve(Buffer.concat([solid(42, [...faces(square), ...faces([[1, 1], [1, 2], [2, 2], [2, 1]])]), block()]));
  const { lines, output } = emit([room!]);
  assert.equal(output.spaceCount, 1); assert.equal(output.outlineExtrusionCount, 1); assert.equal(output.identityOnlyCount, 0);
  assert.ok(lines.some((line) => line.startsWith("IFCARBITRARYPROFILEDEFWITHVOIDS")));
  assert.ok(lines.some((line) => line.startsWith("IFCSPACE('1234567890123456789012'")));
  assert.ok(lines.some((line) => line.includes("'CertifiedForRouting',$,IFCBOOLEAN(.F.)")));
  assert.ok(lines.some((line) => line.startsWith("IFCRELAGGREGATES") && line.includes(",#6,")));
});
test("boxless or invalid native IFC rooms export identity only and never infer a storey", () => {
  const [room] = resolve(Buffer.alloc(0), 2024, []);
  const { lines, output } = emit([room!, room!]);
  assert.equal(output.spaceCount, 1); assert.equal(output.identityOnlyCount, 1);
  assert.ok(!lines.some((line) => line.startsWith("IFCEXTRUDEDAREASOLID")));
  assert.ok(lines.some((line) => line.startsWith("IFCRELAGGREGATES") && line.includes(",#5,")));
  assert.equal(emit([room!], new Set([42])).output.spaceCount, 0);
  assert.equal(emit([room!], new Set(), new Set(["native-room-42"])).output.spaceCount, 0);
  assert.equal(emit([room!], new Set(), new Set(), new Set([42])).output.spaceCount, 0);
  const [withOutline] = resolve(solid());
  withOutline!.outline!.outerFeet[0]![0] = NaN;
  assert.equal(emit([withOutline!]).output.identityOnlyCount, 1);
});
