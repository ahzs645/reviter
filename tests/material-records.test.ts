import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_MATERIAL_ELEMENT_MARKER,
  scanMaterialElementRecords,
} from "../lib/reviter/material-records.ts";

const NAME_TRAILER = [0xff, 0xff, 0xff, 0xff, 0xe0, 0x0c] as const;

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
}: {
  elementId?: number;
  marker?: number;
  echo?: boolean;
  name?: string;
} = {}): Uint8Array {
  const objectLength = 320;
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
