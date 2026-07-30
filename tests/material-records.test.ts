import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_MATERIAL_ELEMENT_MARKER,
  scanMaterialElementRecords,
} from "../lib/reviter/material-records.ts";

const NAME_TRAILER = [0xff, 0xff, 0xff, 0xff, 0xe0, 0x0c] as const;
const NESTED_NAME_SEPARATOR = [
  0x0d, 0xb9, 0xf0, 0xff, 0xff, 0xff,
  0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
] as const;

function writeUtf16(
  data: Uint8Array,
  view: DataView,
  offset: number,
  value: string,
  trailer = false,
): number {
  view.setUint32(offset, value.length, true);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(offset + 4 + index * 2, value.charCodeAt(index), true);
  }
  const end = offset + 4 + value.length * 2;
  if (trailer) data.set(NAME_TRAILER, end);
  return end + (trailer ? NAME_TRAILER.length : 0);
}

function materialRecord({
  elementId = 1_650_844,
  marker = REVIT_2027_MATERIAL_ELEMENT_MARKER,
  echo = true,
  name = "Paint - Sienna",
  objectLength = 320,
}: {
  elementId?: number;
  marker?: number;
  echo?: boolean;
  name?: string;
  objectLength?: number;
} = {}): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(4, 0, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, marker, true);

  // An appearance string comes first, but has no material-name field trailer.
  writeUtf16(data, view, 56, "assetlibrary_base.fbx");
  writeUtf16(data, view, 140, name, true);
  view.setUint32(objectLength + 16, echo ? objectLength : objectLength + 1, true);
  return data;
}

function nestedMaterialRecord({
  elementId = 1_242_151,
  name = "Acier inoxydable, brossé",
  validSeparator = true,
  referenceId = 1_242_063,
  objectLength = 520,
}: {
  elementId?: number;
  name?: string;
  validSeparator?: boolean;
  referenceId?: number;
  objectLength?: number;
} = {}): Uint8Array {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(4, 0, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_MATERIAL_ELEMENT_MARKER, true);
  const descriptionEnd = writeUtf16(
    data,
    view,
    231,
    "Stainless Steel 18/8, brushed finish",
  );
  data.set(NESTED_NAME_SEPARATOR, descriptionEnd);
  if (!validSeparator) data[descriptionEnd] = 0;
  const nameEnd = writeUtf16(
    data,
    view,
    descriptionEnd + NESTED_NAME_SEPARATOR.length,
    name,
  );
  view.setBigUint64(nameEnd + 8, BigInt(referenceId), true);
  view.setUint32(objectLength + 16, objectLength, true);
  return data;
}

test("decodes a framed Revit 2027 material element name and identity", () => {
  const result = scanMaterialElementRecords(materialRecord(), 2027);
  assert.equal(result.framedMaterialElements, 1);
  assert.equal(result.namedMaterialElements, 1);
  assert.deepEqual(result.definitions, [{
    elementId: 1_650_844,
    name: "Paint - Sienna",
    recordOffset: 0,
    objectLength: 320,
    objectMarker: REVIT_2027_MATERIAL_ELEMENT_MARKER,
    evidence: "framed-material-element-name",
  }]);
});

test("keeps Unicode names and skips earlier appearance-asset strings", () => {
  const result = scanMaterialElementRecords(
    materialRecord({ elementId: 617_540, name: "Краска - Охра" }),
    2027,
  );
  assert.equal(result.definitions[0]?.name, "Краска - Охра");
});

test("decodes the nested material name only through its complete field chain", () => {
  const result = scanMaterialElementRecords(nestedMaterialRecord(), 2027);
  assert.deepEqual(result.definitions, [{
    elementId: 1_242_151,
    name: "Acier inoxydable, brossé",
    recordOffset: 0,
    objectLength: 520,
    objectMarker: REVIT_2027_MATERIAL_ELEMENT_MARKER,
    evidence: "framed-nested-material-name",
  }]);

  assert.equal(
    scanMaterialElementRecords(
      nestedMaterialRecord({ validSeparator: false }),
      2027,
    ).namedMaterialElements,
    0,
  );
  assert.equal(
    scanMaterialElementRecords(
      nestedMaterialRecord({ referenceId: 0 }),
      2027,
    ).namedMaterialElements,
    0,
  );
});

test("does not promote a framed material element whose name trailer is absent", () => {
  const data = materialRecord();
  const trailer = data.indexOf(0xe0);
  assert.ok(trailer > 0);
  data[trailer] = 0;
  const result = scanMaterialElementRecords(data, 2027);
  assert.equal(result.framedMaterialElements, 1);
  assert.equal(result.namedMaterialElements, 0);
  assert.deepEqual(result.definitions, []);
});

test("decodes the structurally anchored packed color after a direct material name", () => {
  const name = "Metal - Aluminum";
  const data = materialRecord({ name, objectLength: 1_400 });
  const view = new DataView(data.buffer);
  const nameEnd = 140 + 4 + name.length * 2;
  const colorOffset = nameEnd + 82;
  view.setUint32(colorOffset, 0x00f7_f7f7, true);
  view.setUint32(colorOffset + 4, 0x80, true);

  const definition = scanMaterialElementRecords(data, 2027).definitions[0]!;
  assert.deepEqual(definition.appearance, {
    colorPacked: 0x00f7_f7f7,
    baseColorSrgb: [247, 247, 247],
    colorFieldOffset: colorOffset,
    evidence: "framed-material-color-packed-direct",
  });
});

test("selects the nested render color rather than its different graphic color", () => {
  const name = "Деревянные доски";
  const description = "Stainless Steel 18/8, brushed finish";
  const data = nestedMaterialRecord({ name, objectLength: 1_400 });
  const view = new DataView(data.buffer);
  const descriptionEnd = 231 + 4 + description.length * 2;
  const nameField = descriptionEnd + NESTED_NAME_SEPARATOR.length;
  const nameEnd = nameField + 4 + name.length * 2;
  view.setUint32(nameEnd + 64, 0x0078_7878, true);
  view.setUint32(nameEnd + 72, 0x0073_a0c1, true);
  view.setUint32(nameEnd + 80, 0x0073_a0c1, true);

  const definition = scanMaterialElementRecords(data, 2027).definitions[0]!;
  assert.deepEqual(definition.appearance, {
    colorPacked: 0x0073_a0c1,
    baseColorSrgb: [193, 160, 115],
    colorFieldOffset: nameEnd + 72,
    evidence: "framed-material-color-packed-nested",
  });
});

test("rejects the record on a different release, marker, or broken length echo", () => {
  assert.equal(scanMaterialElementRecords(materialRecord(), 2026).framedMaterialElements, 0);
  assert.equal(
    scanMaterialElementRecords(materialRecord({ marker: 0x08c6 }), 2027)
      .framedMaterialElements,
    0,
  );
  assert.equal(
    scanMaterialElementRecords(materialRecord({ echo: false }), 2027)
      .framedMaterialElements,
    0,
  );
});
