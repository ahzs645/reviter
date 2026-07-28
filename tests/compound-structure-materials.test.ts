import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCompoundLayerMaterialAssignments,
  resolveCompoundStructureDefinitions,
  scanCompoundStructureCandidates,
} from "../lib/reviter/compound-structure-materials.ts";

const LAYERS_FIELD = [0xff, 0xff, 0xff, 0xff, 0xab, 0x11] as const;

function wallType(
  layers: Array<{
    width: number;
    materialId: number | null;
    function: number;
    priority: number;
  }>,
  marker = 0x0270,
): Uint8Array {
  const objectLength = 220;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 50_000, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);
  const field = 80;
  data.set(LAYERS_FIELD, field);
  view.setUint32(field + 6, layers.length, true);
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]!;
    const offset = field + 10 + index * 41;
    view.setFloat64(offset, layer.width, true);
    if (layer.materialId == null) {
      view.setUint32(offset + 8, 0xffff_ffff, true);
      view.setUint32(offset + 12, 0xffff_ffff, true);
    } else {
      view.setUint32(offset + 8, layer.materialId, true);
    }
    view.setUint32(offset + 16, 0xffff_ffff, true);
    view.setUint32(offset + 20, 0xffff_ffff, true);
    view.setInt32(offset + 24, layer.function, true);
    view.setInt32(offset + 28, layer.priority, true);
    view.setInt32(offset + 32, -1, true);
    view.setInt32(offset + 36, index, true);
    view.setUint8(offset + 40, 1);
  }
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("decodes the counted 41-byte compound layer grammar", () => {
  const data = wallType([
    { width: 0.25, materialId: 414, function: 4, priority: 4 },
    { width: 0, materialId: 419, function: 100, priority: 999 },
  ]);
  const candidates = scanCompoundStructureCandidates(data, 2027);
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    candidates[0]!.layers.map(
      ({
        layerIndex,
        widthFeet,
        materialId,
        profileId,
        function: layerFunction,
        priority,
      }) => ({
        layerIndex,
        widthFeet,
        materialId,
        profileId,
        function: layerFunction,
        priority,
      }),
    ),
    [
      {
        layerIndex: 0,
        widthFeet: 0.25,
        materialId: 414,
        profileId: null,
        function: 4,
        priority: 4,
      },
      {
        layerIndex: 1,
        widthFeet: 0,
        materialId: 419,
        profileId: null,
        function: 100,
        priority: 999,
      },
    ],
  );
});

test("is release/class gated and rejects an invalid layer sequence", () => {
  const data = wallType([
    { width: 0.25, materialId: 414, function: 4, priority: 4 },
  ]);
  assert.deepEqual(scanCompoundStructureCandidates(data, 2026), []);
  assert.deepEqual(
    scanCompoundStructureCandidates(wallType([
      { width: 0.25, materialId: 414, function: 4, priority: 4 },
    ], 0x08c6), 2027),
    [],
  );
  new DataView(data.buffer).setInt32(80 + 10 + 36, 7, true);
  assert.deepEqual(scanCompoundStructureCandidates(data, 2027), []);
});

test("requires every non-null material target to resolve", () => {
  const candidates = scanCompoundStructureCandidates(wallType([
    { width: 0.5, materialId: 423, function: 1, priority: 1 },
    { width: 0, materialId: null, function: 100, priority: 999 },
  ]), 2027);
  assert.equal(
    resolveCompoundStructureDefinitions(candidates, new Set()).length,
    0,
  );
  const definitions = resolveCompoundStructureDefinitions(
    candidates,
    new Set([423]),
  );
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0]!.evidence, "framed-basic-wall-type-compound-layers");
});

test("retains the exact unassigned default layer without inventing a material", () => {
  const definitions = resolveCompoundStructureDefinitions(
    scanCompoundStructureCandidates(wallType([
      { width: 0.656, materialId: null, function: 0, priority: 999 },
    ]), 2027),
    new Set(),
  );
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0]!.layers[0]!.materialId, null);
  assert.deepEqual(
    resolveCompoundLayerMaterialAssignments(
      [{ elementId: 10, typeId: 50_000 }],
      definitions,
    ),
    [],
  );
});

test("joins layers through persisted element-to-type references", () => {
  const definitions = resolveCompoundStructureDefinitions(
    scanCompoundStructureCandidates(wallType([
      { width: 0.5, materialId: 423, function: 1, priority: 1 },
      { width: 0.1, materialId: 414, function: 4, priority: 4 },
    ]), 2027),
    new Set([414, 423]),
  );
  assert.deepEqual(
    resolveCompoundLayerMaterialAssignments(
      [
        { elementId: 10, typeId: 50_000 },
        { elementId: 11, typeId: 50_000 },
      ],
      definitions,
    ),
    [
      {
        elementId: 10,
        typeId: 50_000,
        layerIndex: 0,
        materialId: 423,
        widthFeet: 0.5,
        function: 1,
        evidence: "persisted-element-type-compound-layer-material",
      },
      {
        elementId: 10,
        typeId: 50_000,
        layerIndex: 1,
        materialId: 414,
        widthFeet: 0.1,
        function: 4,
        evidence: "persisted-element-type-compound-layer-material",
      },
      {
        elementId: 11,
        typeId: 50_000,
        layerIndex: 0,
        materialId: 423,
        widthFeet: 0.5,
        function: 1,
        evidence: "persisted-element-type-compound-layer-material",
      },
      {
        elementId: 11,
        typeId: 50_000,
        layerIndex: 1,
        materialId: 414,
        widthFeet: 0.1,
        function: 4,
        evidence: "persisted-element-type-compound-layer-material",
      },
    ],
  );
});

test("fails closed when one element has conflicting type references", () => {
  const definitions = resolveCompoundStructureDefinitions(
    scanCompoundStructureCandidates(wallType([
      { width: 0.5, materialId: 423, function: 1, priority: 1 },
    ]), 2027),
    new Set([423]),
  );
  assert.deepEqual(
    resolveCompoundLayerMaterialAssignments(
      [
        { elementId: 10, typeId: 50_000 },
        { elementId: 10, typeId: 60_000 },
      ],
      definitions,
    ),
    [],
  );
});
