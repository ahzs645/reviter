import assert from "node:assert/strict";
import test from "node:test";

import {
  buildElementOwnershipGraph,
  decodeElementOwnership,
} from "../lib/reviter/element-relations.ts";

const INVALID_OBJECT_ID = 0xffff_ffff_ffff_ffffn;

function fixture(
  rows: Array<{ elementId: number; owningElementId: number | null; originalElementId?: number }>,
): Uint8Array {
  const data = new Uint8Array(34 + rows.length * 40 + 36);
  const view = new DataView(data.buffer);
  view.setUint32(2, rows.length + 1, true);
  rows.forEach((row, index) => {
    const offset = 34 + index * 40;
    view.setBigUint64(
      offset,
      row.owningElementId == null ? INVALID_OBJECT_ID : BigInt(row.owningElementId),
      true,
    );
    view.setUint32(offset + 8, 0, true);
    view.setBigUint64(offset + 12, BigInt(row.elementId), true);
    view.setBigUint64(offset + 32, BigInt(row.originalElementId ?? row.elementId), true);
  });
  return data;
}

test("decodes persisted owning-element ids and builds a bidirectional graph", () => {
  const result = decodeElementOwnership(fixture([
    { elementId: 100, owningElementId: null },
    { elementId: 101, owningElementId: 100 },
    { elementId: 102, owningElementId: 100 },
    { elementId: 200, owningElementId: 200 },
  ]));
  assert.equal(result.format, "revit-2024-2027-elem-table");

  assert.equal(result.declaredRecordCount, 5);
  assert.equal(result.decodedRecordCount, 4);
  assert.equal(result.rootRecordCount, 1);
  assert.equal(result.selfOwnedRecordCount, 1);
  assert.equal(result.danglingOwnerCount, 0);
  assert.deepEqual(result.relations, [
    {
      ownerId: 100,
      elementId: 101,
      kind: "owning-element",
      source: "Global/ElemTable.OwningElementId",
      evidence: "persisted",
    },
    {
      ownerId: 100,
      elementId: 102,
      kind: "owning-element",
      source: "Global/ElemTable.OwningElementId",
      evidence: "persisted",
    },
  ]);

  const graph = buildElementOwnershipGraph(result);
  assert.equal(graph.parentByElement.get(101), 100);
  assert.deepEqual(graph.childrenByOwner.get(100), [101, 102]);
  assert.deepEqual(graph.roots, [100]);
  assert.deepEqual(graph.selfOwned, [200]);
});

test("does not turn row adjacency into an ownership relation", () => {
  const result = decodeElementOwnership(fixture([
    { elementId: 1_272_040, owningElementId: 1_271_877 },
    { elementId: 1_272_041, owningElementId: 1_271_877 },
  ]));
  assert.equal(result.format, "revit-2024-2027-elem-table");

  assert.equal(
    result.relations.some(
      ({ ownerId, elementId }) => ownerId === 1_272_040 && elementId === 1_272_041,
    ),
    false,
  );
});

test("accepts a distinct original id and rejects a nonzero object-id prefix", () => {
  const data = fixture([{ elementId: 101, owningElementId: 100 }]);
  new DataView(data.buffer).setBigUint64(34 + 32, 999n, true);
  assert.equal(decodeElementOwnership(data).format, "revit-2024-2027-elem-table");

  new DataView(data.buffer).setUint32(34 + 8, 1, true);
  const result = decodeElementOwnership(data);
  assert.deepEqual(result, {
    format: "unsupported",
    reason: "row 0 has a non-zero object-id prefix",
  });
});
