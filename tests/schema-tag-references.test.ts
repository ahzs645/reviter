import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectSchemaTagReference,
  selectSchemaReferenceRecord,
} from "../lib/reviter/schema-tag-references.ts";

function name16(name: string): number[] {
  const bytes = [...new TextEncoder().encode(name)];
  return [bytes.length & 0xff, bytes.length >>> 8, ...bytes];
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function layout(name: string, classId: number, version: number, fields: string[]): number[] {
  const bytes = [...name16(name), ...u16(classId), ...u32(version), ...u32(fields.length)];
  for (const field of fields) {
    const encoded = [...new TextEncoder().encode(field)];
    bytes.push(...u32(encoded.length), ...encoded, 0x0e, 0, 0, 0);
  }
  return bytes;
}

test("preserves multiple geometry class records that share one tag reference", () => {
  const classId = 1426;
  const schema = Uint8Array.from([
    ...name16("GEdgeBase"),
    ...u16(classId | 0x8000),
    0,
    0,
    ...name16("GNode"),
    0,
    0,
    ...u32(0),
    ...u32(0),
    ...layout("GBRep", classId, 1, ["m_pFaces"]),
    ...layout("GFakeBRep", classId, 1, ["m_recoveryKey"]),
    ...layout("GPolyMesh", classId, 10, ["m_pFacetedTopology"]),
  ]);

  const result = inspectSchemaTagReference(schema, classId);
  assert.equal(result.status, "shared-reference");
  assert.deepEqual(result.taggedDefinitions.map((entry) => entry.name), ["GEdgeBase"]);
  assert.deepEqual(
    result.referenceRecords.map(({ name, version, fieldCount, firstFieldName }) => ({
      name,
      version,
      fieldCount,
      firstFieldName,
    })),
    [
      { name: "GBRep", version: 1, fieldCount: 1, firstFieldName: "m_pFaces" },
      {
        name: "GFakeBRep",
        version: 1,
        fieldCount: 1,
        firstFieldName: "m_recoveryKey",
      },
      {
        name: "GPolyMesh",
        version: 10,
        fieldCount: 1,
        firstFieldName: "m_pFacetedTopology",
      },
    ],
  );
});

test("does not infer an object class from a shared schema tag reference", () => {
  const classId = 1426;
  const schema = Uint8Array.from([
    ...layout("GBRep", classId, 1, ["m_pFaces"]),
    ...layout("GPolyMesh", classId, 10, ["m_pFacetedTopology"]),
  ]);
  const inspection = inspectSchemaTagReference(schema, classId);

  assert.deepEqual(selectSchemaReferenceRecord(inspection), {
    ok: false,
    error: "tag reference 1426 is shared by several class records",
    candidates: ["GBRep", "GPolyMesh"],
  });
  const selected = selectSchemaReferenceRecord(inspection, "GPolyMesh");
  assert.equal(selected.ok, true);
  if (selected.ok) {
    assert.equal(selected.record.name, "GPolyMesh");
    assert.equal(selected.selectedBy, "expected-name");
  }
});

test("rejects raw slot coincidences and malformed layout headers", () => {
  const classId = 1426;
  const schema = Uint8Array.from([
    0x92,
    0x05,
    ...name16("GNoise"),
    ...u16(classId),
    ...u32(1),
    ...u32(1),
    ...u32(400),
    0x41,
  ]);

  assert.deepEqual(inspectSchemaTagReference(schema, classId), {
    tagReference: classId,
    taggedDefinitions: [],
    referenceRecords: [],
    status: "missing",
  });
  assert.throws(() => inspectSchemaTagReference(schema, 0x8000), RangeError);
});
