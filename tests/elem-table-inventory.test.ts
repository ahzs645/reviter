import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openRevitContainer } from "../lib/reviter/convert-container.ts";
import { makeReport } from "../lib/reviter/export-report.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { FULL_ELEM_TABLE_MAX_RECORDS, parseElemTable, parseFullElemTableInventory } from "../lib/reviter/elem-table.ts";

function table(count: number, options: { narrow?: boolean; firstId?: number; tag?: number } = {}) {
  const narrow = options.narrow ?? false;
  const firstId = options.firstId ?? 1;
  const tag = options.tag ?? (narrow ? 1368 : 1510);
  const stride = narrow ? 28 : 40;
  const bytes = Buffer.alloc(6 + count * stride + (narrow ? 19 : 24));
  bytes.writeUInt16LE(tag); bytes.writeUInt32LE(count, 2);
  for (let index = 0; index < count; index++) {
    const at = 6 + index * stride;
    if (narrow) {
      bytes.writeUInt32LE(firstId + index, at); bytes.writeUInt32LE(firstId + index, at + 4); bytes.writeUInt32LE(0xffff_ffff, at + 24);
    } else {
      bytes.writeBigUInt64LE(BigInt(firstId + index), at); bytes.writeBigUInt64LE(BigInt(firstId + index), at + 20); bytes.writeBigUInt64LE(0xffff_ffff_ffff_ffffn, at + 28);
    }
  }
  bytes.writeUInt32LE(0xffff_ffff, 6 + count * stride + 4);
  return bytes;
}
const full = (bytes: Uint8Array) => parseFullElemTableInventory(bytes, { revitVersion: 2027 });

test("the complete source count is u32 and includes records beyond the legacy 65535 boundary", () => {
  const bytes = table(74_438);
  const inventory = full(bytes);
  assert.equal(inventory.status, "decoded");
  if (inventory.status !== "decoded") throw Error("Expected a decoded inventory");
  assert.equal(inventory.schemaTag, 1510);
  assert.equal(inventory.declaredRecordCount, 74_438);
  assert.equal(inventory.parsedRecordCount, 74_438);
  assert.equal(inventory.elementIds.length, 74_438);
  assert.equal(inventory.elementIds.at(-1), 74_438);
  assert.equal(inventory.declaredElementIds.length, 74_438);
  // This compatibility path remains unchanged, so the inventory fix alone
  // cannot alter geometry admitted by existing converter callers.
  const legacy = parseElemTable(bytes)!;
  assert.equal(legacy.recordCount, 8_902);
  assert.equal(legacy.uniqueElementIds.length, 8_902);
  assert.equal(legacy.declaredElementCount, 1510);
});

test("records begin at byte 6, including first surviving ids and valid id zero", () => {
  const bytes = table(3, { firstId: 0 });
  const inventory = full(bytes);
  assert.equal(inventory.status, "decoded");
  if (inventory.status === "decoded") {
    assert.deepEqual([...inventory.elementIds], [0,1,2]);
    assert.deepEqual([...inventory.declaredElementIds], [0,1,2]);
    assert.deepEqual(inventory.layout, { start: 6, stride: 40, ownerOffset: 28, idBytes: 8, suffixBytes: 24 });
  }
});

test("Snowdon-style primary aliases are preserved while secondary source ids remain authoritative", () => {
  const bytes = table(3);
  bytes.writeBigUInt64LE(100n, 6 + 40);
  const inventory = full(bytes);
  assert.equal(inventory.status, "decoded");
  if (inventory.status === "decoded") {
    assert.deepEqual([...inventory.elementIds], [1,2,3]);
    assert.deepEqual([...inventory.primaryElementIds], [1,100,3]);
    assert.deepEqual([...inventory.declaredElementIds], [1,2,3,100]);
    assert.equal(inventory.differingIdRecordCount, 1);
  }
});

test("exact count/length, schema tag, bounds and project-tail markers must agree", () => {
  const bytes = table(3);
  assert.equal(full(bytes.subarray(0, bytes.length - 1)).status, "unsupported");
  assert.equal(full(Buffer.concat([bytes, Buffer.alloc(1)])).status, "unsupported");
  for (const count of [0, 4, 0xffff_ffff, FULL_ELEM_TABLE_MAX_RECORDS + 1]) {
    const altered = Buffer.from(bytes); altered.writeUInt32LE(count, 2);
    assert.equal(full(altered).status, "unsupported");
  }
  const badTag = Buffer.from(bytes); badTag.writeUInt16LE(1);
  assert.equal(full(badTag).status, "unsupported");
  const badMarker = Buffer.from(bytes); badMarker.writeUInt32LE(0, bytes.length - 24 + 4);
  assert.equal(full(badMarker).status, "unsupported");
  assert.equal(parseFullElemTableInventory(bytes, { revitVersion: 2030 }).status, "unsupported");
  assert.equal(parseFullElemTableInventory(bytes, { revitVersion: 2027, expectedSchemaTag: 0x1234 }).status, "unsupported");
});

test("duplicates, unsafe ids and invented ownership cannot authorize a source inventory", () => {
  for (const change of [
    (bytes: Buffer) => bytes.writeBigUInt64LE(1n, 6 + 40 + 20),
    (bytes: Buffer) => bytes.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 6),
    (bytes: Buffer) => bytes.writeBigUInt64LE(999n, 6 + 28),
    (bytes: Buffer) => bytes.writeBigUInt64LE(1n, 6 + 28),
    (bytes: Buffer) => { bytes.writeBigUInt64LE(2n, 6 + 28); bytes.writeBigUInt64LE(1n, 6 + 40 + 28); },
  ]) { const bytes = table(3); change(bytes); assert.equal(full(bytes).status, "unsupported"); }
});

test("wide source ids remain exact above UINT32 rather than truncating silently", () => {
  const bytes = table(2, { firstId: 0x1_0000_0001 });
  const inventory = full(bytes);
  assert.equal(inventory.status, "decoded");
  if (inventory.status === "decoded") assert.deepEqual([...inventory.elementIds], [0x1_0000_0001, 0x1_0000_0002]);
});

test("narrow project framing needs its actual schema tag and keeps the complete u32 count", () => {
  const bytes = table(65_537, { narrow: true });
  assert.equal(parseFullElemTableInventory(bytes, { revitVersion: 2023 }).status, "unsupported");
  const inventory = parseFullElemTableInventory(bytes, { revitVersion: 2023, expectedSchemaTag: 1368 });
  assert.equal(inventory.status, "decoded");
  if (inventory.status === "decoded") {
    assert.equal(inventory.layout.stride, 28);
    assert.equal(inventory.declaredRecordCount, 65_537);
    assert.equal(inventory.elementIds.at(-1), 65_537);
  }
});

test("validated owner columns use original record slots and handle roots without guessed relationships", () => {
  const bytes = table(4);
  bytes.writeBigUInt64LE(1n, 6 + 40 + 28);
  bytes.writeBigUInt64LE(2n, 6 + 80 + 28);
  bytes.writeBigUInt64LE(0n, 6 + 120 + 28);
  const inventory = full(bytes);
  assert.equal(inventory.status, "decoded");
  if (inventory.status === "decoded") {
    assert.deepEqual([...inventory.ownerElementIds], [-1,1,2,-1]);
    assert.equal(inventory.ownerRecordCount, 2);
  }
});

function inventoryReport(inventory: ReturnType<typeof parseFullElemTableInventory>) {
  const origin = { x: 0, y: 0, z: 0 };
  const result = { ok: true, fileName: "inventory.rvt", byteLength: 1, origin, bbox: { min: origin, max: origin },
    method: "partition-bounds-recovery", elementBounds: [], meshes: [], levels: [], materials: [], nativeProfiles: [], stats: {}, decoderCoverage: {}, warnings: [],
    fullElementInventory: inventory } as unknown as ConvertResult;
  return JSON.parse(makeReport(result, null)).fullElementInventory;
}

test("audit reports serialize full inventory typed arrays as arrays and preserve unsupported reasons", () => {
  const inventory = full(table(3));
  const report = inventoryReport(inventory);
  for (const key of ["elementIds", "primaryElementIds", "ownerElementIds", "declaredElementIds"]) assert.ok(Array.isArray(report[key]), key);
  assert.deepEqual(report.elementIds, [1,2,3]);
  assert.deepEqual(report.ownerElementIds, [-1,-1,-1]);
  assert.deepEqual(inventoryReport({ status: "unsupported", reason: "schema-tag-mismatch" }), { status: "unsupported", reason: "schema-tag-mismatch" });
});

const modelsDir = process.env.RVT_ELEMENT_INVENTORY_MODELS;
test("supplied RVT container inventories retain full counts without expanding legacy scene admission", { skip: !modelsDir }, () => {
  for (const [name, count, ids, legacyCount, aliases] of [
    ["snowdon", 47_233, 47_317, 47_233, 84], ["rac", 8_327, 8_327, 8_327, 0],
    ["school", 17_524, 17_524, 17_524, 0], ["unbc", 74_438, 74_438, 8_902, 0],
  ] as const) {
    const container = openRevitContainer(readFileSync(join(modelsDir!, `${name}.rvt`)), {});
    const inventory = container.fullElementInventory;
    assert.equal(inventory?.status, "decoded", name);
    if (inventory?.status !== "decoded") throw Error(`${name}: no complete inventory`);
    assert.equal(inventory.declaredRecordCount, count, name);
    assert.equal(inventory.parsedRecordCount, count, name);
    assert.equal(inventory.declaredElementIds.length, ids, name);
    assert.equal(inventory.differingIdRecordCount, aliases, name);
    assert.equal(container.elementIndex?.recordCount, legacyCount, `${name}: legacy geometry admission remains separate`);
    const report = inventoryReport(inventory);
    assert.ok(Array.isArray(report.declaredElementIds));
    assert.equal(report.elementIds.length, count, name);
  }
});
