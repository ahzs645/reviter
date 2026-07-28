import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveFamilySymbolMaterialAssignments,
  resolveFamilySymbolMaterialMaps,
  scanFamilySymbolMaterialReferenceSets,
} from "../lib/reviter/family-symbol-materials.ts";

function familySymbol(
  maps: Array<Array<{ geometryTag: number; materialId: number }>>,
  marker = 0x0810,
): Uint8Array {
  const objectLength = 260;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 50_000, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  let offset = 80;
  for (const entries of maps) {
    view.setUint32(offset, entries.length, true);
    offset += 4;
    for (const entry of entries) {
      view.setInt32(offset, entry.geometryTag, true);
      view.setUint32(offset + 4, entry.materialId, true);
      view.setUint32(offset + 8, 0, true);
      offset += 12;
    }
    offset += 16;
  }
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("decodes a counted FamilySymbol geometry-tag material map", () => {
  const referenceSets = scanFamilySymbolMaterialReferenceSets(
    familySymbol([[
      { geometryTag: 27, materialId: 26 },
      { geometryTag: 46, materialId: 182_549 },
      { geometryTag: 65, materialId: 182_549 },
    ]]),
    2027,
  );
  const maps = resolveFamilySymbolMaterialMaps(
    referenceSets,
    new Set([26, 182_549]),
  );
  assert.equal(maps.length, 1);
  assert.equal(maps[0]!.mapOffset, 80);
  assert.deepEqual(maps[0]!.entries, [
    { geometryTag: 27, materialId: 26 },
    { geometryTag: 46, materialId: 182_549 },
    { geometryTag: 65, materialId: 182_549 },
  ]);
});

test("is release/class gated and requires every MaterialElem target", () => {
  const data = familySymbol([[
    { geometryTag: 27, materialId: 26 },
    { geometryTag: 46, materialId: 182_549 },
  ]]);
  assert.deepEqual(scanFamilySymbolMaterialReferenceSets(data, 2026), []);
  assert.deepEqual(
    scanFamilySymbolMaterialReferenceSets(
      familySymbol([[{ geometryTag: 27, materialId: 26 }]], 0x08c6),
      2027,
    ),
    [],
  );
  const referenceSets = scanFamilySymbolMaterialReferenceSets(data, 2027);
  assert.deepEqual(
    resolveFamilySymbolMaterialMaps(referenceSets, new Set([26])),
    [],
  );
});

test("fails closed on two distinct counted maps in one symbol", () => {
  const referenceSets = scanFamilySymbolMaterialReferenceSets(
    familySymbol([
      [{ geometryTag: 27, materialId: 26 }],
      [{ geometryTag: 46, materialId: 182_549 }],
    ]),
    2027,
  );
  assert.deepEqual(
    resolveFamilySymbolMaterialMaps(
      referenceSets,
      new Set([26, 182_549]),
    ),
    [],
  );
});

test("ignores an isolated material id outside a counted map", () => {
  const data = familySymbol([[
    { geometryTag: 27, materialId: 26 },
  ]]);
  const view = new DataView(data.buffer);
  view.setUint32(200, 182_549, true);
  view.setUint32(204, 0, true);
  const maps = resolveFamilySymbolMaterialMaps(
    scanFamilySymbolMaterialReferenceSets(data, 2027),
    new Set([26, 182_549]),
  );
  assert.deepEqual(maps[0]!.entries, [{ geometryTag: 27, materialId: 26 }]);
});

test("joins placements and deduplicates repeated material geometry tags", () => {
  const maps = resolveFamilySymbolMaterialMaps(
    scanFamilySymbolMaterialReferenceSets(
      familySymbol([[
        { geometryTag: 27, materialId: 26 },
        { geometryTag: 46, materialId: 182_549 },
        { geometryTag: 65, materialId: 182_549 },
      ]]),
      2027,
    ),
    new Set([26, 182_549]),
  );
  assert.deepEqual(
    resolveFamilySymbolMaterialAssignments(
      [{ elementId: 10, geometryId: 50_000, symbolId: 50_000 }],
      maps,
    ),
    [
      {
        elementId: 10,
        symbolId: 50_000,
        materialId: 26,
        geometryTags: [27],
        evidence: "persisted-instance-family-symbol-geometry-tag-material",
      },
      {
        elementId: 10,
        symbolId: 50_000,
        materialId: 182_549,
        geometryTags: [46, 65],
        evidence: "persisted-instance-family-symbol-geometry-tag-material",
      },
    ],
  );
});

test("fails closed when one element has conflicting symbol placements", () => {
  const maps = resolveFamilySymbolMaterialMaps(
    scanFamilySymbolMaterialReferenceSets(
      familySymbol([[{ geometryTag: 27, materialId: 26 }]]),
      2027,
    ),
    new Set([26]),
  );
  assert.deepEqual(
    resolveFamilySymbolMaterialAssignments(
      [
        { elementId: 10, geometryId: 50_000 },
        { elementId: 10, geometryId: 60_000 },
      ],
      maps,
    ),
    [],
  );
});
