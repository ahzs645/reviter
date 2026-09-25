import assert from "node:assert/strict";
import test from "node:test";

import { readLevelDefinition, REVIT_2027_LEVEL_CLASS } from "../lib/reviter/level-definitions.ts";

/** A framed `Level`: its name where `DatumPlane.m_text` sits, the elevation 40 bytes from the end. */
function levelFrame(name: string, elevationFeet: number, objectLength = 760) {
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 694, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_LEVEL_CLASS, true);
  view.setUint32(129, name.length, true);
  data.set(Buffer.from(name, "utf16le"), 133);
  view.setFloat64(objectLength - 40, elevationFeet, true);
  view.setUint32(objectLength + 16, objectLength, true);
  return {
    data,
    frame: { offset: 0, elementId: 694, objectLength, marker: REVIT_2027_LEVEL_CLASS, typeCode: 0 },
  };
}

test("a level states its own name and elevation", () => {
  const { data, frame } = levelFrame("02 - Floor", 12.467191601049869);
  assert.deepEqual(readLevelDefinition(data, frame), {
    levelId: 694,
    name: "02 - Floor",
    elevationFeet: 12.467191601049869,
  });
});

test("only a Level frame with a finite elevation and a name is read", () => {
  const { data, frame } = levelFrame("Roof", 37.4);
  assert.equal(readLevelDefinition(data, { ...frame, marker: 0x08c6 }), null);
  new DataView(data.buffer).setFloat64(frame.objectLength - 40, Number.NaN, true);
  assert.equal(readLevelDefinition(data, frame), null);
});
