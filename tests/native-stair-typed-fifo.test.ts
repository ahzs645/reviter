import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readNativeStairTypedFifo } from "../lib/reviter/native-stair-typed-fifo.ts";
import {
  readSchema,
  schemaFieldVariant,
  type SchemaStream,
  type SchemaStreamClass,
  type SchemaStreamProperty,
} from "../lib/reviter/schema-reader.ts";

function field(
  name: string,
  fieldType: number,
  extra: Partial<SchemaStreamProperty> = {},
): SchemaStreamProperty {
  return {
    name,
    fieldType,
    variant: schemaFieldVariant(fieldType)!,
    loadingMode: 0,
    itemMode: 0,
    unknownWord: 0,
    offset: 123,
    ...extra,
  };
}

function sourceClass(
  index: number,
  name: string,
  properties: SchemaStreamProperty[],
): SchemaStreamClass {
  return {
    index,
    name,
    parent: { kind: "none" },
    version: 0,
    propertyCount: properties.length,
    properties,
    guids: [],
    unknownWord: 0,
    inline: false,
    offset: 0,
    endOffset: 0,
  };
}

function fixture() {
  const classes = [
    sourceClass(4102, "StairsRun", [
      field("m_id", 14, {
        staticType: { kind: "reference", index: 20, name: "ElementId" },
      }),
      field("m_refs", 14, { loadingMode: 1, itemMode: 5 }),
    ]),
    sourceClass(20, "ElementId", [
      field("m_id", 14, {
        staticType: { kind: "reference", index: 21, name: "Identifier" },
      }),
    ]),
    sourceClass(21, "Identifier", [field("m_id64", 11)]),
    sourceClass(1973, "GLine", [
      field("m_endParams", 7, { itemMode: 1, size: 2 }),
      field("m_origin", 7, { itemMode: 1, size: 3 }),
      field("m_dirVec", 7, { itemMode: 1, size: 3 }),
    ]),
    sourceClass(1974, "GPoint", []),
  ];
  const schema: SchemaStream = {
    byteLength: 8,
    consumedBytes: 0,
    terminatorBytes: 8,
    trailingBytes: 0,
    classes,
    classesByIndex: new Map(classes.map((c) => [c.index, c])),
    topLevelClassCount: classes.length,
    propertyCount: classes.reduce((n, c) => n + c.propertyCount, 0),
    unresolvedReferences: [],
    inlineIndexMismatches: [],
  };
  const bytes = new Uint8Array(180),
    view = new DataView(bytes.buffer);
  view.setBigInt64(0, 101n, true);
  view.setUint32(12, 160, true);
  view.setUint16(16, 4102, true);
  view.setBigInt64(18, 101n, true);
  view.setInt32(26, 3, true);
  for (const [offset, token] of [
    [30, 3],
    [36, 3],
    [42, -1],
  ]) {
    view.setInt32(offset!, token!, true);
    view.setInt16(offset! + 4, 1973, true);
  }
  for (let offset = 48; offset < 176; offset += 8)
    view.setFloat64(
      offset,
      offset === 48 ? 1.0000000000000002 : offset / 8,
      true,
    );
  view.setUint32(176, 160, true);
  return { bytes, view, schema };
}

function rejects(f: ReturnType<typeof fixture>, pattern: RegExp) {
  const result = readNativeStairTypedFifo(f.bytes, f.schema);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, pattern);
}

test("strict typed root preserves Float64, shared tokens and untracked FIFO bodies", () => {
  const f = fixture(),
    original = f.bytes.slice();
  const result = readNativeStairTypedFifo(f.bytes, f.schema);
  assert.ok(result.ok);
  assert.equal(result.value.nativeElementId, 101);
  assert.equal(result.value.rootStaticEnd, 48);
  assert.equal(result.value.endOffset, 176);
  assert.deepEqual(
    result.value.entries.map((e) => [e.descriptor.token, e.start, e.end]),
    [
      [3, 48, 112],
      [-1, 112, 176],
    ],
  );
  assert.equal(
    (result.value.entries[0]!.value.m_endParams as number[])[0],
    1.0000000000000002,
  );
  assert.notEqual(
    (result.value.entries[0]!.value.m_endParams as number[])[0],
    Math.fround(1.0000000000000002),
  );
  assert.deepEqual(f.bytes, original);
});

test("owner and explicit expected root class must agree with the original frame", () => {
  const f = fixture();
  f.view.setBigInt64(18, 102n, true);
  rejects(f, /owner field/);
  const wrong = fixture();
  wrong.view.setUint16(16, 1973, true);
  rejects(wrong, /root is not StairsRun/);
  const symbol = fixture();
  symbol.schema.classes[0]!.name = "StairsTriserSymbol";
  rejects(symbol, /root is not StairsRun/);
  const result = readNativeStairTypedFifo(
    symbol.bytes,
    symbol.schema,
    "StairsTriserSymbol",
  );
  assert.ok(result.ok);
  assert.equal(result.value.rootClassName, "StairsTriserSymbol");
});

test("tokens must append consecutively, retain their class and use supported negative form", () => {
  const gap = fixture();
  gap.view.setInt32(30, 5, true);
  rejects(gap, /Non-append/);
  const changed = fixture();
  changed.view.setInt16(40, 1974, true);
  rejects(changed, /Reused token changed/);
  const negative = fixture();
  negative.view.setInt32(42, -2, true);
  rejects(negative, /Unsupported negative/);
  const unknown = fixture();
  unknown.view.setInt16(34, 9999, true);
  rejects(unknown, /Unknown conditional/);
});

test("documented object loading modes 2 and 4 retain the same descriptor FIFO checks", () => {
  for (const loadingMode of [2, 4]) {
    const f = fixture();
    f.schema.classes[0]!.properties[1]!.loadingMode = loadingMode;
    const result = readNativeStairTypedFifo(f.bytes, f.schema);
    assert.ok(result.ok);
    assert.equal(result.value.entries.length, 2);
    f.view.setInt32(30, 7, true);
    rejects(f, /Non-append/);
  }
});

test("truncation, changed echo, trailing bytes, invalid doubles and collection overflow fail closed", () => {
  const echo = fixture();
  echo.view.setUint32(176, 159, true);
  rejects(echo, /length echo/);
  const truncated = fixture();
  truncated.bytes = truncated.bytes.subarray(0, 179);
  rejects(truncated, /length echo/);
  const trailing = fixture();
  trailing.bytes = new Uint8Array(181);
  rejects(trailing, /length echo/);
  const body = fixture();
  body.view.setFloat64(48, NaN, true);
  rejects(body, /Non-finite/);
  const count = fixture();
  count.view.setInt32(26, 100001, true);
  rejects(count, /collection count/);
});

test("unsupported source grammar and incomplete embedded schema cannot yield a partial receipt", () => {
  const mode = fixture();
  mode.schema.classes[0]!.properties[1]!.loadingMode = 7;
  rejects(mode, /Unsupported source loading/);
  const item = fixture();
  item.schema.classes[0]!.properties[1]!.itemMode = 6;
  rejects(item, /Unsupported source item/);
  const flag = fixture();
  flag.schema.classes[0]!.properties[1]!.unknownWord = 2;
  rejects(flag, /Unsupported flagged/);
  const dynamic = fixture();
  dynamic.schema.classes[3]!.name = "UnknownGeometry";
  rejects(dynamic, /Unsupported dynamic source class/);
  const schema = fixture();
  schema.schema.trailingBytes = 1;
  rejects(schema, /Incomplete/);
  const unresolved = fixture();
  unresolved.schema.unresolvedReferences.push({
    offset: 0,
    index: 9999,
    definedClassCount: 0,
  });
  rejects(unresolved, /Incomplete/);
});

const originalFixtureDirectory = process.env.UNBC_TYPED_STAIR_FIXTURE_DIR;
test(
  "original 1972518 full FIFO independently reproduces the existing canonical geometry and Face spans",
  { skip: !originalFixtureDirectory },
  () => {
    const base = originalFixtureDirectory!;
    const bytes = readFileSync(join(base, "frames/run-1972518-0.bin"));
    const schema = readSchema(readFileSync(join(base, "embedded-schema.bin")));
    assert.ok(schema.ok);
    const sha = (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex");
    assert.equal(
      sha(bytes),
      "210a7abeabe3ebce9a96d752df97a2929757d3c844d276457f61221b89de1ea4",
    );
    const result = readNativeStairTypedFifo(bytes, schema.schema);
    assert.ok(result.ok);
    const geometry = result.value.entries.find(
      (e) => e.descriptor.token === 73,
    )!;
    assert.deepEqual(
      [geometry.sourceClassName, geometry.start, geometry.end],
      ["Geometry", 26811, 27717],
    );
    const face = result.value.entries.find((e) => e.descriptor.token === 378)!;
    assert.deepEqual(
      [face.sourceClassName, face.start, face.end],
      ["Face", 85288, 85348],
    );
    assert.equal(
      sha(bytes.subarray(face.start, face.end)),
      "b3751ab328d9be90239fdf90c340ccd95d767765dced6c32098d5d3eb124cbc1",
    );
    assert.equal(
      result.value.entries.filter(
        (e) => e.sourceClassName === "StairsTreadInfo",
      ).length,
      26,
    );
  },
);


test("import-only dynamic classes do not broaden the legacy stair root grammar", () => {
  const f = fixture();
  f.schema.classes.find(c => c.index === 1973)!.name = "InstanceInfo";
  rejects(f, /Unsupported dynamic source class InstanceInfo/);
});
