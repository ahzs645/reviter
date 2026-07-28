import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveElementMaterialAssignments,
  resolveFamilySymbolRelations,
  resolveGeometryMaterialAssignments,
  resolveUniqueFamilySymbolTargets,
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

function writeUtf16String(
  data: Uint8Array,
  offset: number,
  value: string,
): number {
  const view = new DataView(data.buffer);
  view.setUint32(offset, value.length, true);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(offset + 4 + index * 2, value.charCodeAt(index), true);
  }
  return offset + 4 + value.length * 2;
}

test("decodes and resolves the persisted FamilySymbol to Family relation", () => {
  const family = object(105_786, 0x07d9, 360, []);
  const pathOffset = writeUtf16String(
    family,
    133,
    "Колонна прямоугольного сечения",
  );
  writeUtf16String(
    family,
    pathOffset,
    "D:\\Library\\Columns\\",
  );
  const symbol = object(2_447_093, 0x0810, 520, [[449, 105_786]]);
  const page = new Uint8Array(family.length + symbol.length);
  page.set(family);
  page.set(symbol, family.length);

  const scan = scanPersistedRelationshipCandidates(page, 2027);
  assert.deepEqual(scan.familyElementIds, [105_786]);
  assert.deepEqual(
    scan.familyDefinitions.map(
      ({ familyId, name, pathKind, nameOffset, pathOffset: decodedPathOffset, evidence }) => ({
        familyId,
        name,
        pathKind,
        nameOffset,
        pathOffset: decodedPathOffset,
        evidence,
      }),
    ),
    [{
      familyId: 105_786,
      name: "Колонна прямоугольного сечения",
      pathKind: "directory",
      nameOffset: 133,
      pathOffset,
      evidence: "framed-family-name-path",
    }],
  );
  assert.equal(scan.familySymbolCandidates.length, 1);
  assert.equal(scan.familySymbolReferenceSets.length, 1);
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
  assert.deepEqual(
    resolveUniqueFamilySymbolTargets(
      scan.familySymbolReferenceSets,
      new Set(scan.familyElementIds),
      new Set([2_447_093]),
    ).map(({ symbolId, familyId, fieldOffset, evidence }) => ({
      symbolId,
      familyId,
      fieldOffset,
      evidence,
    })),
    [{
      symbolId: 2_447_093,
      familyId: 105_786,
      fieldOffset: 449,
      evidence: "framed-family-symbol-static-tail",
    }],
  );
});

test("resolves only one Family target following the exact static tail", () => {
  const familyA = object(101, 0x07d9, 180, []);
  const familyB = object(102, 0x07d9, 180, []);
  const variable = object(201, 0x0810, 1_100, [[919, 101]]);
  const ambiguous = object(202, 0x0810, 1_100, [[449, 101], [625, 102]]);
  const emptyOutline = object(203, 0x0810, 760, [[74, 101], [371, 102]]);
  const emptyOutlineView = new DataView(emptyOutline.buffer);
  for (let index = 0; index < 3; index += 1) {
    emptyOutlineView.setFloat64(371 - 112 + index * 8, 1e30, true);
    emptyOutlineView.setFloat64(371 - 112 + (index + 3) * 8, -1e30, true);
  }
  const page = new Uint8Array(
    familyA.length +
      familyB.length +
      variable.length +
      ambiguous.length +
      emptyOutline.length,
  );
  let offset = 0;
  for (const bytes of [
    familyA,
    familyB,
    variable,
    ambiguous,
    emptyOutline,
  ]) {
    page.set(bytes, offset);
    offset += bytes.length;
  }

  const scan = scanPersistedRelationshipCandidates(page, 2027);
  assert.deepEqual(
    resolveUniqueFamilySymbolTargets(
      scan.familySymbolReferenceSets,
      new Set(scan.familyElementIds),
      new Set([201, 202, 203]),
    ),
    [
      {
        symbolId: 201,
        familyId: 101,
        recordOffset: familyA.length + familyB.length,
        fieldOffset: 919,
        objectLength: 1_100,
        objectMarker: 0x0810,
        evidence: "framed-family-symbol-static-tail",
      },
      {
        symbolId: 203,
        familyId: 102,
        recordOffset:
          familyA.length +
          familyB.length +
          variable.length +
          ambiguous.length,
        fieldOffset: 371,
        objectLength: 760,
        objectMarker: 0x0810,
        evidence: "framed-family-symbol-static-tail",
      },
    ],
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

test("joins persisted instance geometry to exact geometry materials", () => {
  const geometryAssignments = [
    {
      geometryId: 100,
      materialId: 5,
      recordOffset: 0,
      fieldOffset: 135,
      objectLength: 200,
      objectMarker: 0x10dc,
      evidence: "framed-geometry-material-id" as const,
    },
    {
      geometryId: 100,
      materialId: 6,
      recordOffset: 0,
      fieldOffset: 197,
      objectLength: 200,
      objectMarker: 0x10dc,
      evidence: "framed-geometry-material-id" as const,
    },
  ];
  assert.deepEqual(
    resolveElementMaterialAssignments(
      [
        { elementId: 10, geometryId: 100 },
        { elementId: 11, geometryId: 100 },
        { elementId: 12, geometryId: 101 },
      ],
      geometryAssignments,
      new Set([100]),
    ),
    [
      {
        elementId: 10,
        geometryId: 100,
        materialId: 5,
        evidence: "persisted-instance-shared-geometry-material",
      },
      {
        elementId: 10,
        geometryId: 100,
        materialId: 6,
        evidence: "persisted-instance-shared-geometry-material",
      },
      {
        elementId: 11,
        geometryId: 100,
        materialId: 5,
        evidence: "persisted-instance-shared-geometry-material",
      },
      {
        elementId: 11,
        geometryId: 100,
        materialId: 6,
        evidence: "persisted-instance-shared-geometry-material",
      },
    ],
  );
});

test("fails closed when one element has conflicting shared geometry ids", () => {
  const geometryAssignments = [
    {
      geometryId: 100,
      materialId: 5,
      recordOffset: 0,
      fieldOffset: 135,
      objectLength: 200,
      objectMarker: 0x10dc,
      evidence: "framed-geometry-material-id" as const,
    },
    {
      geometryId: 101,
      materialId: 6,
      recordOffset: 0,
      fieldOffset: 135,
      objectLength: 200,
      objectMarker: 0x10dc,
      evidence: "framed-geometry-material-id" as const,
    },
  ];
  assert.deepEqual(
    resolveElementMaterialAssignments(
      [
        { elementId: 10, geometryId: 100 },
        { elementId: 10, geometryId: 101 },
      ],
      geometryAssignments,
      new Set([100, 101]),
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
