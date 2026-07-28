import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveFamilySymbolRelations,
  resolveGeometryMaterialAssignments,
  scanPersistedRelationshipCandidates,
} from "../lib/reviter/family-material-relations.ts";

function object(
  elementId: number,
  marker: number,
  objectLength: number,
  fields: Array<[number, number]>,
): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  for (const [offset, id] of fields) view.setUint32(offset, id, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("decodes and resolves the persisted FamilySymbol to Family relation", () => {
  const family = object(105_786, 0x07d9, 80, []);
  const symbol = object(2_447_093, 0x0810, 520, [[449, 105_786]]);
  const page = new Uint8Array(family.length + symbol.length);
  page.set(family);
  page.set(symbol, family.length);

  const scan = scanPersistedRelationshipCandidates(page, 2027);
  assert.deepEqual(scan.familyElementIds, [105_786]);
  assert.equal(scan.familySymbolCandidates.length, 1);
  assert.deepEqual(
    resolveFamilySymbolRelations(
      scan.familySymbolCandidates,
      new Set(scan.familyElementIds),
      new Set([2_447_093]),
    ).map(({ symbolId, familyId, evidence }) => ({ symbolId, familyId, evidence })),
    [{
      symbolId: 2_447_093,
      familyId: 105_786,
      evidence: "framed-family-symbol-family-id",
    }],
  );
});

test("only promotes geometry material ids that resolve to MaterialElem definitions", () => {
  const shape = object(290_626, 0x10dc, 1_379, [[135, 298_295]]);
  const scan = scanPersistedRelationshipCandidates(shape, 2027);
  assert.equal(scan.geometryMaterialCandidates.length, 1);
  assert.deepEqual(
    resolveGeometryMaterialAssignments(
      scan.geometryMaterialCandidates,
      new Set([298_295]),
      new Set([290_626]),
    ).map(({ geometryId, materialId, fieldOffset, evidence }) => ({
      geometryId,
      materialId,
      fieldOffset,
      evidence,
    })),
    [{
      geometryId: 290_626,
      materialId: 298_295,
      fieldOffset: 135,
      evidence: "framed-geometry-material-id",
    }],
  );
  assert.deepEqual(
    resolveGeometryMaterialAssignments(
      scan.geometryMaterialCandidates,
      new Set(),
      new Set([290_626]),
    ),
    [],
  );
});

test("is release gated and rejects a broken object-length echo", () => {
  const data = object(7, 0x0810, 520, [[449, 8]]);
  assert.equal(scanPersistedRelationshipCandidates(data, 2026).familySymbolCandidates.length, 0);
  new DataView(data.buffer).setUint32(536, 519, true);
  assert.equal(scanPersistedRelationshipCandidates(data, 2027).familySymbolCandidates.length, 0);
});
