/**
 * The 32-bit-id record layouts (Revit 2023 and older), on synthetic bytes laid
 * out as the 2023 RAC sample writes them. Each test installs the narrow id
 * width and restores the default, which every other test file relies on.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { detectDuplicatedBoundsRecords } from "../lib/reviter/bounds-records.ts";
import {
  activeElementIdBytes,
  elementIdBytesFromSchema,
  frameHeaderBytes,
  setActiveElementIdBytes,
} from "../lib/reviter/element-id-width.ts";
import {
  REVIT_2027_ELEMENT_HEADER_CLASS,
  scanElementHeaders,
} from "../lib/reviter/element-headers.ts";
import {
  chainElementObjects,
  markerObjectSeeds,
  scanFramedElementObjects,
  scanObjectMarkers,
} from "../lib/reviter/element-objects.ts";
import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import { collectTypeLinks } from "../lib/reviter/element-types.ts";
import { referencedElementIds } from "../lib/reviter/family-type-names.ts";
import { readLevelDefinition, REVIT_2027_LEVEL_CLASS } from "../lib/reviter/level-definitions.ts";
import { scanAssociatedLevelRelationCandidates } from "../lib/reviter/level-relations.ts";
import {
  REVIT_2027_MATERIAL_ELEMENT_MARKER,
  scanMaterialElementRecords,
} from "../lib/reviter/material-records.ts";
import { scanNameEntries } from "../lib/reviter/name-entries.ts";
import { decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import {
  REVIT_2027_CLASS_NAMES,
  REVIT_2027_FIRST_CLASS_INDEX,
} from "../lib/reviter/revit-2027-class-names.data.ts";
import {
  buildClassTagTranslation,
  fileClassTag,
  readsElementRecordLayout,
  setActiveClassTagTranslation,
  usesNarrowIdRecordLayout,
  usesRevit2027RecordLayout,
} from "../lib/reviter/revit-class-tags.ts";
import { createSplitFrameStream } from "../lib/reviter/split-frame-stream.ts";

const GELEMENT = 0x08c6;

function narrow<T>(body: () => T): T {
  setActiveElementIdBytes(4);
  try {
    return body();
  } finally {
    setActiveElementIdBytes(null);
  }
}

/** Little-endian byte writer. */
class Bytes {
  readonly out: number[] = [];
  u8(value: number): this { this.out.push(value & 0xff); return this; }
  u16(value: number): this { return this.u8(value).u8(value >> 8); }
  u32(value: number): this { return this.u16(value & 0xffff).u16(value >>> 16); }
  i32(value: number): this { return this.u32(value >>> 0); }
  f32(value: number): this { const b = Buffer.alloc(4); b.writeFloatLE(value); this.out.push(...b); return this; }
  f64(value: number): this { const b = Buffer.alloc(8); b.writeDoubleLE(value); this.out.push(...b); return this; }
  utf16(text: string): this { this.u32(text.length); this.out.push(...Buffer.from(text, "utf16le")); return this; }
  zeros(count: number): this { for (let i = 0; i < count; i += 1) this.out.push(0); return this; }
  get length(): number { return this.out.length; }
}

/**
 * One narrow frame: `[u32 id][u32 discriminator][u32 length][u16 class]`, the
 * body, and the length echoed `length` bytes after the class.
 */
function narrowFrame(elementId: number, marker: number, body: number[], discriminator = 0x39a09c7e): number[] {
  const objectLength = 2 + body.length;
  return new Bytes()
    .u32(elementId).u32(discriminator).u32(objectLength).u16(marker)
    .out.concat(body, new Bytes().u32(objectLength).out);
}

/** An `ElementHeader` as a narrow file writes it: `[u32 id][u32 length][u16 class]` and its fields. */
function narrowHeader(elementId: number, { category = -2000011, ownerView = -1, family = -1 } = {}): number[] {
  const body = new Bytes().u32(0).i32(category).i32(family).i32(ownerView).i32(-1).i32(-1).i32(-1).out;
  const recordLength = 2 + body.length;
  return new Bytes().u32(elementId).u32(recordLength).u16(REVIT_2027_ELEMENT_HEADER_CLASS).out
    .concat(body, new Bytes().u32(recordLength).out);
}

const page = (...records: number[][]) =>
  Uint8Array.from([...new Array(16).fill(0), ...records.flat(), ...new Array(64).fill(0)]);

test("the schema's Identifier declares the id width", () => {
  const identifier = (kind: string) => [{ name: "Identifier", properties: [{ name: "m_id", variant: { kind } }] }];
  assert.equal(elementIdBytesFromSchema(identifier("int32")), 4);
  assert.equal(elementIdBytesFromSchema(identifier("int64")), 8);
  assert.equal(elementIdBytesFromSchema(identifier("double")), null);
  assert.equal(elementIdBytesFromSchema([]), null);
  assert.equal(activeElementIdBytes(), 8);
  narrow(() => assert.equal(frameHeaderBytes(), 12));
  assert.equal(frameHeaderBytes(), 16);
});

test("narrow frames are read with a 12-byte header and chained 16 bytes past their length", () => {
  const level = narrowFrame(311, REVIT_2027_LEVEL_CLASS, new Array(60).fill(7));
  const element = narrowFrame(12344, GELEMENT, new Array(48).fill(3), 0x2cb61d93);
  const data = page(level, element);
  narrow(() => {
    const frames = scanFramedElementObjects(data);
    assert.deepEqual(
      frames.map((frame) => [frame.offset, frame.elementId, frame.objectLength, frame.marker]),
      [[16, 311, 62, REVIT_2027_LEVEL_CLASS], [16 + level.length, 12344, 50, GELEMENT]],
    );
    // Seeded from the second object alone, the chain walks back to the first.
    assert.deepEqual(chainElementObjects(data, [16 + level.length]).map((frame) => frame.elementId), [311, 12344]);
    assert.deepEqual(markerObjectSeeds(data, GELEMENT), [16 + level.length]);
    assert.deepEqual([...scanObjectMarkers(data)], [[REVIT_2027_LEVEL_CLASS, 1], [GELEMENT, 1]]);
  });
  // Read with the 16-byte header, the same bytes hold no frame.
  assert.deepEqual(scanFramedElementObjects(data), []);
});

test("an ElementHeader record is not read as a frame four bytes early, and repeated words frame nothing", () => {
  const data = page(narrowFrame(700, GELEMENT, new Array(48).fill(3)), narrowHeader(1098307));
  const repeated = new Bytes();
  for (let word = 0; word < 200; word += 1) repeated.u32(0x100);
  narrow(() => {
    assert.deepEqual(scanFramedElementObjects(data).map((frame) => frame.elementId), [700]);
    assert.deepEqual(scanFramedElementObjects(Uint8Array.from(repeated.out)), []);
  });
});

test("a narrow ElementHeader states category, family and owning view as int32 ids", () => {
  const data = page(
    narrowHeader(198694),
    narrowHeader(213581, { category: -2000300, ownerView: 312 }),
    narrowHeader(295447, { family: 295427 }),
    narrowHeader(4242, { category: 12 }),
  );
  assert.deepEqual(narrow(() => scanElementHeaders(data)), [
    { elementId: 198694, categoryId: -2000011, familyId: null, ownerViewId: null, designOptionId: null },
    { elementId: 213581, categoryId: -2000300, familyId: null, ownerViewId: 312, designOptionId: null },
    { elementId: 295447, categoryId: -2000011, familyId: 295427, ownerViewId: null, designOptionId: null },
  ]);
  // The 64-bit reader finds no owner id with a zero high word here.
  assert.deepEqual(scanElementHeaders(data), []);
});

test("a narrow GElement bounds record: id, flags, record code, then the field table and bounds", () => {
  const sorted = [43.52, -11.167, 8.858, 44.854, 9.844, 30.179];
  const body = new Bytes().u32(198694).u32(0).u32(0x1e).u32(0x0008_8004).u32(2)
    .u32(3).u16(0x0821).u32(4).u16(0x0821);
  for (let copy = 0; copy < 2; copy += 1) for (const value of sorted) body.f64(value);
  body.zeros(24);
  const data = page(narrowFrame(198694, GELEMENT, body.out));
  const records = narrow(() => detectDuplicatedBoundsRecords(data));
  assert.equal(records.length, 1);
  assert.deepEqual(
    { ...records[0]!, boundsFeet: undefined },
    { elementId: 198694, recordOffset: 16, boundsOffset: 46, recordCode: 0x1e, recordCount: 2, duplicated: true, boundsFeet: undefined },
  );
  assert.deepEqual(records[0]!.boundsFeet, {
    min: { x: sorted[0], y: sorted[1], z: sorted[2] },
    max: { x: sorted[3], y: sorted[4], z: sorted[5] },
  });
  assert.deepEqual(detectDuplicatedBoundsRecords(data), []);
});

test("a narrow Level keeps its elevation 56 bytes before the echo and its name 36 bytes earlier", () => {
  const objectLength = 700;
  const data = new Uint8Array(objectLength + 16);
  const view = new DataView(data.buffer);
  view.setUint32(0, 245423, true);
  view.setUint32(4, 0x12345678, true);
  view.setUint32(8, objectLength, true);
  view.setUint16(12, REVIT_2027_LEVEL_CLASS, true);
  view.setUint32(95, "Level 2".length, true);
  data.set(Buffer.from("Level 2", "utf16le"), 99);
  view.setFloat64(objectLength + 12 - 56, 9.84251968503937, true);
  view.setUint32(objectLength + 12, objectLength, true);
  const frame = narrow(() => scanFramedElementObjects(data))[0]!;
  assert.deepEqual(narrow(() => readLevelDefinition(data, frame)), {
    levelId: 245423,
    name: "Level 2",
    elevationFeet: 9.84251968503937,
  });
});

test("a narrow Material's fields: ratios first, pattern ids beside their colours, the colour 40 bytes in", () => {
  const fields = new Bytes()
    .f32(0.9).f32(0.5)
    .i32(-1).u32(0x808080).i32(-1).u32(0x808080).i32(1201).u32(0x404040).i32(-1).u32(0x808080)
    .u32(0xc07f00).i32(64)
    .i32(-1).i32(-1);
  const body = new Bytes().zeros(60).utf16("Glass").i32(0).i32(0);
  body.out.push(...fields.out);
  body.zeros(32);
  const data = page(narrowFrame(26, REVIT_2027_MATERIAL_ELEMENT_MARKER, body.out));
  const scan = narrow(() => scanMaterialElementRecords(data, 2023));
  assert.equal(scan.framedMaterialElements, 1);
  assert.equal(scan.definitions.length, 1);
  const [definition] = scan.definitions;
  assert.equal(definition!.name, "Glass");
  assert.equal(definition!.appearance?.colorPacked, 0xc07f00);
  assert.ok(Math.abs(definition!.appearance!.transparency! - 0.9) < 1e-6);
  // A 2023 file whose schema was not read is not decoded at all.
  assert.equal(scanMaterialElementRecords(data, 2023).definitions.length, 0);
});

test("2019 to 2023 are admitted only while the schema declares 32-bit ids", () => {
  assert.equal(usesNarrowIdRecordLayout(2023), false);
  assert.equal(readsElementRecordLayout(2023), false);
  assert.equal(decoderPlanForVersion(2023).elementBoundsDecoder, null);
  narrow(() => {
    assert.equal(usesNarrowIdRecordLayout(2023), true);
    assert.equal(readsElementRecordLayout(2023), true);
    assert.equal(usesRevit2027RecordLayout(2023), false);
    assert.equal(usesNarrowIdRecordLayout(2019), true);
    assert.equal(usesNarrowIdRecordLayout(2018), false);
    assert.equal(usesNarrowIdRecordLayout(2024), false);
    assert.equal(decoderPlanForVersion(2023).elementBoundsDecoder, "revit-2027-duplicated-bounds-v1");
  });
  assert.equal(readsElementRecordLayout(2025), true);
});

test("the split-frame stream reassembles a narrow frame across pages", () => {
  const frame = Uint8Array.from(narrowFrame(4401, GELEMENT, new Array(300).fill(9)));
  const stream = narrow(() => createSplitFrameStream({ markers: [GELEMENT], minObjectLength: 40, maxFrameBytes: 4096 }));
  const first = Uint8Array.from([...new Array(10).fill(0), ...frame.subarray(0, 150)]);
  const second = Uint8Array.from([...frame.subarray(150), ...new Array(40).fill(0)]);
  const out = narrow(() => [...stream.push(first), ...stream.push(second)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.elementId, 4401);
  assert.equal(out[0]!.objectLength, 302);
  assert.equal(out[0]!.crossedPage, true);
  assert.deepEqual([...out[0]!.data], [...frame]);
});

test("a narrow name entry is [u32 id][u32 n][UTF-16][i32 category]; an array of categories is not one", () => {
  const entry = new Bytes().u32(697447).utf16("hood enclosure").i32(-2001100);
  const categories = new Bytes().u32(9).u32(2);
  for (const category of [-2000032, -2000023]) categories.i32(category);
  categories.i32(-2001040);
  const data = page(entry.out, [0, 0, 0, 0], categories.out);
  assert.deepEqual(narrow(() => scanNameEntries(data)), [
    { elementId: 697447, name: "hood enclosure", categoryId: -2001100 },
  ]);
  assert.deepEqual(scanNameEntries(data), []);
});

test("a narrow instance's referenced ids are every non-negative u32 in its body", () => {
  const body = new Bytes().u32(0).u32(506157).i32(-1).u32(211850).zeros(40);
  const data = page(narrowFrame(211850, 0x07ef, body.out));
  const frame = narrow(() => scanFramedElementObjects(data))[0]!;
  const ids = narrow(() => [...referencedElementIds(data, frame)]);
  assert.ok(ids.includes(506157));
  assert.ok(!ids.includes(211850), "the instance's own id is not a reference");
  assert.ok(ids.every((id) => id > 0 && id <= 0x7fff_ffff));
});

test("a narrow element's m_assocLevelId follows its pointers, cell list, doc stub and four-byte m_id", () => {
  const body = new Bytes()
    .i32(-1).u16(0x0c93) // m_pParamValueSetDouble, live
    .i32(0).i32(0).i32(0).i32(0).i32(0) // the other five pointers, null
    .u32(0) // m_constrInfo, empty
    .i32(-1).u16(0x0310) // m_cellList
    .u32(1) // m_docAccess.m_pDoc
    .u32(765523) // m_id
    .u32(245423) // m_assocLevelId
    .zeros(40);
  const data = page(narrowFrame(765523, 0x0f3b, body.out));
  const candidates = narrow(() => scanAssociatedLevelRelationCandidates(data, 2023));
  assert.deepEqual(
    candidates.map(({ elementId, levelId, fieldOffset }) => ({ elementId, levelId, fieldOffset })),
    [{ elementId: 765523, levelId: 245423, fieldOffset: 14 + 6 + 20 + 4 + 6 + 4 + 4 }],
  );
  assert.deepEqual(scanAssociatedLevelRelationCandidates(data, 2023), []);
});

test("a narrow wall's type is read by VWall's field order after its curve-driver slot", () => {
  const wall = (elementId: number, liveRunTime: boolean) => {
    const body = new Bytes().zeros(40)
      .i32(-1).u16(0x116f).u32(2).u32(3).u16(0x0671).u32(4).u16(0x0671) // m_pCurveDriver, m_pRefFaces
      .u32(0); // m_embeddedTo
    if (liveRunTime) body.i32(-1).u16(0x10a8);
    else body.i32(0);
    body.f64(-0.3302).f64(0).u32(198367).u32(245423).zeros(24);
    return narrowFrame(elementId, 3899, body.out);
  };
  const links = narrow(() => collectTypeLinks(page(wall(427092, false), wall(198694, true))));
  assert.deepEqual(links.references, [
    { elementId: 427092, typeId: 198367 },
    { elementId: 198694, typeId: 198367 },
  ]);
});

test("narrow parameter tables: 12-byte doubles value first, 8-byte integers, [i32 id][u32 n] text", () => {
  // -1001200 is an id Autodesk's storage table does not list, so it may stand
  // in the integer table.
  const tables = new Bytes()
    .u32(2).f64(0).i32(-1012829).f64(-0.984251968503937).i32(-1001111)
    .u32(1).i32(-1001200).i32(1)
    .u32(1).i32(-1001203).utf16("206B").out;
  const body = new Bytes()
    .i32(-1).u16(0x0c93).i32(-1).u16(0x0c94).i32(-1).u16(0x0c95).i32(0).i32(0).i32(0) // pointers
    .u32(0) // m_constrInfo
    .i32(-1).u16(0x0310).u32(1) // the anchor: m_cellList and m_docAccess
    .u32(431198) // m_id
    .i32(-1).i32(-1).i32(-1).i32(-1).i32(-1).i32(-1).i32(-1) // seven ids
    .zeros(3) // flags
    .zeros(20);
  body.out.push(...tables);
  body.zeros(16);
  const data = page(narrowFrame(431198, 0x07ef, body.out));
  const read = narrow(() => collectElementParameters(data));
  assert.equal(read.length, 1);
  assert.equal(read[0]!.elementId, 431198);
  assert.deepEqual(
    read[0]!.parameters.map((parameter) => [parameter.parameterId, parameter.value]),
    [[-1012829, 0], [-1001111, -0.984251968503937], [-1001200, 1], [-1001203, "206B"]],
  );
});

test("a subnormal read as a narrow double parameter is not a table", () => {
  const body = new Bytes()
    .i32(-1).u16(0x0c93).i32(0).i32(0).i32(0).i32(0).i32(0).u32(0)
    .i32(-1).u16(0x0310).u32(1).u32(765523)
    .i32(-1).i32(-1).i32(-1).i32(-1).i32(-1).i32(-1).i32(-1).zeros(3)
    .u32(1).u32(0x0000_0001).u32(0).i32(-65280) // a subnormal and a plausible id
    .u32(1).f64(10.170603674540683).i32(-1001111)
    .zeros(16);
  const data = page(narrowFrame(765523, 3899, body.out));
  const read = narrow(() => collectElementParameters(data));
  assert.deepEqual(
    read.map((table) => table.parameters.map((parameter) => parameter.value)),
    [[10.170603674540683]],
  );
});

test("before 2022 a narrow wall type's name follows its PatternHelper cell pointer", () => {
  const index2027 = (name: string) => REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.indexOf(name);
  // A schema without the taperable-wall cells, renumbered as a 2021 file is.
  const names = REVIT_2027_CLASS_NAMES.filter((name) => !name.startsWith("TaperableWallType"));
  setActiveClassTagTranslation(buildClassTagTranslation(
    names.map((name, position) => ({ name, tag: REVIT_2027_FIRST_CLASS_INDEX + position })),
  ));
  try {
    const body = new Bytes().zeros(40)
      .i32(-1).u16(fileClassTag(index2027("AnalyticalPropertiesCell")))
      .i32(-1).u16(fileClassTag(index2027("PatternHelper")))
      .utf16("Wall - Timber Clad")
      .zeros(24);
    const frame = narrowFrame(198367, fileClassTag(index2027("BasicWallType")), body.out);
    assert.deepEqual(
      narrow(() => collectTypeLinks(page(frame)).names),
      [{ typeId: 198367, name: "Wall - Timber Clad" }],
    );
    // A 64-bit-id file keeps keying on the taperable cell, which this schema lacks.
    assert.deepEqual(collectTypeLinks(page(frame)).names, []);
  } finally {
    setActiveClassTagTranslation(null);
  }
});
