import assert from "node:assert/strict";
import test from "node:test";

import { scanCompoundStructureCandidates } from "../lib/reviter/compound-structure-materials.ts";
import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  REVIT_2027_CLASS_NAMES,
  REVIT_2027_FIRST_CLASS_INDEX,
} from "../lib/reviter/revit-2027-class-names.data.ts";
import {
  buildClassTagTranslation,
  setActiveClassTagTranslation,
} from "../lib/reviter/revit-class-tags.ts";

/**
 * A `MaterialElem` frame whose `Material` fields follow the name with the two
 * structural property-set pointers null, as both 2025 files write every
 * material: the name, eight null-pointer bytes, six ids, two ratios, four
 * pattern colours, the colour and the shininess.
 */
function materialFrame(name: string, colour: number, transparency: number): Uint8Array {
  const objectLength = 400;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 20_001, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, 0x0ad3, true);
  let at = 80;
  view.setUint32(at, name.length, true);
  data.set(Buffer.from(name, "utf16le"), at + 4);
  at += 4 + name.length * 2;
  at += 8; // m_oStructuralPropertySet and m_oStructuralPropertySetNew: null
  view.setBigInt64(at, 20_002n, true); // m_appearanceAssetId
  for (let id = 1; id < 6; id += 1) view.setBigInt64(at + id * 8, -1n, true);
  view.setFloat32(at + 48, transparency, true);
  view.setFloat32(at + 52, 0.5, true);
  view.setUint32(at + 72, colour, true);
  view.setInt32(at + 76, 64, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("a material's colour and transparency are read through its pointer fields", () => {
  const scan = scanMaterialElementRecords(materialFrame("Masonry - Brick", 0x6964aa, 0.25), 2025);
  assert.equal(scan.definitions.length, 1);
  const [definition] = scan.definitions;
  assert.equal(definition!.name, "Masonry - Brick");
  assert.equal(definition!.appearance?.colorPacked, 0x6964aa);
  assert.deepEqual(definition!.appearance?.baseColorSrgb, [0xaa, 0x64, 0x69]);
  assert.equal(definition!.appearance?.transparency, 0.25);
  assert.equal(definition!.appearance?.evidence, "framed-material-color-schema");
});

/** A `BasicWallType` whose layers have no `m_layerPriority`: 37 bytes each. */
function wallTypeWithoutPriority(): Uint8Array {
  const objectLength = 220;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 50_000, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, 0x0270, true);
  const field = 80;
  data.set([0xff, 0xff, 0xff, 0xff, 0xab, 0x11], field);
  view.setUint32(field + 6, 2, true);
  const layers = [{ width: 0.1, material: 423, function: 5 }, { width: 0.6, material: 416, function: 1 }];
  layers.forEach((layer, index) => {
    const offset = field + 10 + index * 37;
    view.setFloat64(offset, layer.width, true);
    view.setUint32(offset + 8, layer.material, true);
    view.setBigInt64(offset + 16, -1n, true);
    view.setInt32(offset + 24, layer.function, true);
    view.setInt32(offset + 28, -1, true);
    view.setInt32(offset + 32, index, true);
    view.setUint8(offset + 36, 1);
  });
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("compound layers follow the layout the file's schema declares", () => {
  const data = wallTypeWithoutPriority();
  // Read as the 2027 layout, the second layer is misaligned and nothing is found.
  assert.deepEqual(scanCompoundStructureCandidates(data, 2027), []);

  // A schema declaring seven `CompoundStructureLayer` fields, as 2025 does.
  const schema = REVIT_2027_CLASS_NAMES.map((name, position) => ({
    name,
    tag: REVIT_2027_FIRST_CLASS_INDEX + position,
    declaredFieldCount: name === "CompoundStructureLayer" ? 7 : 0,
  }));
  setActiveClassTagTranslation(buildClassTagTranslation(schema));
  try {
    const [candidate] = scanCompoundStructureCandidates(data, 2025);
    assert.deepEqual(
      candidate?.layers.map((layer) => [layer.materialId, layer.function, layer.priority]),
      [[423, 5, 5], [416, 1, 1]],
    );
  } finally {
    setActiveClassTagTranslation(null);
  }
});
