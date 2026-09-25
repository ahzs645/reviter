import assert from "node:assert/strict";
import test from "node:test";

import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import {
  formatParameterValue,
  isInternalParameter,
  parameterKind,
  parameterStorage,
} from "../lib/reviter/parameter-specs.ts";

test("parameters are shown in the unit Autodesk declares for them", () => {
  // Values as the 2027 UNBC project stores them.
  const show = (parameterId: number, value: number | string) =>
    formatParameterValue({ parameterId, value });
  assert.equal(show(-1001105, 13.123359580052492), "13.1234 ft"); // Unconnected Height
  assert.equal(show(-1001108, -0), "0 ft"); // Base Offset
  assert.equal(show(-1001955, 2.5830872929516078), "148°"); // Span Direction
  assert.equal(show(-1001955, -Math.PI / 2), "-90°");
  assert.equal(show(-1001954, 1), "Yes"); // Structural
  assert.equal(show(-1006205, 0), "No"); // Visible
  assert.equal(show(-1001203, "2720"), "2720"); // Mark
  // Area and volume are square and cubic feet.
  assert.equal(parameterKind(-1012805), "area"); // HOST_AREA_COMPUTED
  assert.equal(show(-1012805, 12.5), "12.5 ft²");
  assert.equal(parameterKind(-1012806), "volume"); // HOST_VOLUME_COMPUTED
  assert.equal(show(-1012806, 3.25), "3.25 ft³");
});

test("a value that cannot be what its parameter declares is not shown", () => {
  assert.equal(formatParameterValue({ parameterId: -1001954, value: 7 }), null);
  // Base Constraint is a level's element id.
  assert.equal(formatParameterValue({ parameterId: -1001107, value: 311 }), "Element 311");
  assert.equal(formatParameterValue({ parameterId: -1001107, value: -1 }), "None");
  assert.equal(formatParameterValue({ parameterId: -1001107, value: 1.5e-321 }), null);
});

test("parameters Revit never shows are internal", () => {
  assert.equal(isInternalParameter(-1001101), true); // wallHeightParam
  assert.equal(isInternalParameter(-1001115), true); // cwallFakeEndParamn0
  assert.equal(isInternalParameter(-65536), true); // listed nowhere
  assert.equal(isInternalParameter(-1001105), false); // Unconnected Height
});

/** An element record that declares only a double value set, then its table. */
function elementWithDoubleTable(entries: Array<[number, number]>): Uint8Array {
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  const elementId = 4242;
  const start = 16;
  view.setUint32(start, elementId, true);
  view.setUint32(start + 12, 300, true);
  let cursor = start + 18;
  // m_pParamValueSetDouble live; the other three sets and both geometry
  // pointers null; an empty m_constrInfo.
  view.setInt32(cursor, 1, true);
  cursor += 6;
  for (let field = 1; field < 6; field += 1) cursor += 4;
  cursor += 4;
  data.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00], cursor);
  view.setUint32(cursor + 10, elementId, true);
  let table = cursor + 10 + 8 + 7 * 8 + 3;
  view.setUint32(table, entries.length, true);
  table += 4;
  for (const [parameterId, value] of entries) {
    view.setBigInt64(table, BigInt(parameterId), true);
    view.setFloat64(table + 8, value, true);
    table += 16;
  }
  view.setUint32(start + 300 + 16, 300, true);
  return data;
}

test("a table holding element-id parameters is not read as the double table", () => {
  assert.equal(parameterStorage(-1001105), "double");
  assert.equal(parameterStorage(-1001107), "elementId");
  const [doubles] = collectElementParameters(elementWithDoubleTable([[-1001105, 13.25], [-1001108, 0]]));
  assert.deepEqual(doubles?.parameters.map((parameter) => parameter.value), [13.25, 0]);
  // Base and Top Constraint are element ids, which share the double table's
  // 16-byte stride; read as doubles, level id 311 is a denormal.
  const levelIds = new DataView(new ArrayBuffer(8));
  levelIds.setBigInt64(0, 311n, true);
  const denormal = levelIds.getFloat64(0, true);
  assert.deepEqual(
    collectElementParameters(elementWithDoubleTable([[-1001107, denormal], [-1001103, denormal]])),
    [],
  );
});
