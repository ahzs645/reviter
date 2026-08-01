import assert from "node:assert/strict";
import test from "node:test";

import {
  persistedCadFileNames,
  scanPersistedDwgFileNames,
} from "../lib/reviter/cad-files.ts";

function utf16(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true);
  }
  return bytes;
}

test("finds persisted English and Cyrillic DWG names without claiming a payload", () => {
  const names = scanPersistedDwgFileNames(utf16(
    "\u0001Building 10 - Teaching Centre - L3.DWG\u0002Подложка всего здания.dwg\u0000",
  ));
  assert.deepEqual(names, [
    "Building 10 - Teaching Centre - L3.DWG",
    "Подложка всего здания.dwg",
  ]);

  const report = persistedCadFileNames(new Map([
    ["building.dwg", { fileName: "Building.DWG", occurrences: 2 }],
  ]));
  assert.deepEqual(report, [{
    fileName: "Building.DWG",
    occurrences: 2,
    evidence: "partition-utf16-file-name",
    rawDwgPayloadAvailable: false,
  }]);
});

test("does not mistake ordinary text for a DWG record", () => {
  assert.deepEqual(scanPersistedDwgFileNames(utf16("DWG preview and AutoCAD material")), []);
});
