import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeSchemaClassAt,
  findSchemaClassDefinition,
  flattenSchemaFields,
  locateDirectFacetedTuplePair,
  readClassSelector,
  readCountedArrayHeader,
} from "../lib/reviter/schema-fields.ts";

const FACETED_TOPOLOGY_0_SCHEMA = Uint8Array.from(
  Buffer.from(
    "100046616365746564546f706f6c6f6779304d870000" +
      "1400466c6f617446616365746564546f706f6c6f67796505" +
      "0100000001000000" +
      "0b0000006d5f706f696e7473417272" +
      "0d5000000100000020061000000300000000000000" +
      "0100000001000000" +
      "0b0000006d5f666163657473417272" +
      "0d5000000100000020031000000300000000000000",
    "hex",
  ),
);

test("decodes the recursive FacetedTopology0 schema and its PArray tuple descriptors", () => {
  const result = decodeSchemaClassAt(FACETED_TOPOLOGY_0_SCHEMA, 0);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.layer.name, "FacetedTopology0");
  assert.equal(result.layer.classId, 1869);
  assert.equal(result.layer.parent?.name, "FloatFacetedTopology");
  assert.equal(result.layer.parent?.classId, 1381);
  assert.equal(result.layer.parent?.fields[0]?.name, "m_pointsArr");
  assert.deepEqual(result.layer.parent?.fields[0]?.arrayElement, {
    typeCode: 6,
    tupleWidth: 3,
  });
  assert.equal(result.layer.fields[0]?.name, "m_facetsArr");
  assert.deepEqual(result.layer.fields[0]?.arrayElement, {
    typeCode: 3,
    tupleWidth: 3,
  });
  assert.deepEqual(
    flattenSchemaFields(result.layer).map((field) => field.name),
    ["m_pointsArr", "m_facetsArr"],
  );
  assert.equal(result.layer.endOffset, FACETED_TOPOLOGY_0_SCHEMA.length);
});

test("finds an exact high-bit definition and ignores a low-id reference", () => {
  const lowReference = FACETED_TOPOLOGY_0_SCHEMA.subarray(24);
  const combined = new Uint8Array(lowReference.length + FACETED_TOPOLOGY_0_SCHEMA.length);
  combined.set(lowReference);
  combined.set(FACETED_TOPOLOGY_0_SCHEMA, lowReference.length);

  const result = findSchemaClassDefinition(combined, "FacetedTopology0");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.layer.offset, lowReference.length);
});

test("reads signed class selectors and bounded dynamic collection counts", () => {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setInt16(1, 1869, true);
  view.setInt16(3, -1, true);
  view.setInt32(5, 42, true);

  assert.equal(readClassSelector(data, 1), 1869);
  assert.equal(readClassSelector(data, 3), -1);
  assert.deepEqual(readCountedArrayHeader(data, 5, 100), {
    ok: true,
    count: 42,
    itemsOffset: 9,
  });
  assert.equal(readCountedArrayHeader(data, 5, 10).ok, false);
  assert.equal(readCountedArrayHeader(data, 10).ok, false);
});

test("fails closed on an unresolved descriptor instead of desynchronising", () => {
  const corrupt = FACETED_TOPOLOGY_0_SCHEMA.slice();
  const pointsDescriptor = 69;
  corrupt[pointsDescriptor + 1] = 0x51;
  const result = decodeSchemaClassAt(corrupt, 0);
  assert.deepEqual(result, {
    ok: false,
    error: "unresolved property descriptor for m_pointsArr",
    offset: pointsDescriptor,
  });
});

test("locates a direct counted point/facet tuple body without allocating", () => {
  const data = new Uint8Array(2 + 4 + 3 * 3 * 4 + 4 + 2 * 3 * 2);
  const view = new DataView(data.buffer);
  view.setInt16(0, 1869, true);
  view.setInt32(2, 3, true);
  [0, 0, 0, 2, 0, 0, 0, 3, 0].forEach((value, index) => {
    view.setFloat32(6 + index * 4, value, true);
  });
  view.setInt32(42, 2, true);
  [0, 1, 2, 2, 1, 0].forEach((value, index) => {
    view.setUint16(46 + index * 2, value, true);
  });

  const result = locateDirectFacetedTuplePair(data, 0, 4, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pair.selector, 1869);
  assert.equal(result.pair.points.count, 3);
  assert.equal(result.pair.points.itemsOffset, 6);
  assert.equal(result.pair.facets.count, 2);
  assert.equal(result.pair.facets.itemsOffset, 46);
  assert.equal(result.pair.facets.endOffset, data.length);
});
