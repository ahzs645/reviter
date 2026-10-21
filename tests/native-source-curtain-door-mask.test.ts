import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  rational,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import {
  inspectCurtainDoorMaterialMaskFrames,
  inspectOriginalCurrentCurtainDoorMask,
} from "../lib/reviter/native-source-curtain-door-mask.ts";
const file = (n: string) =>
    readFileSync(new URL(`./fixtures/${n}`, import.meta.url)),
  occurrence = file("native-curtain-door-2315416-graphics.bin"),
  definition = file("native-curtain-door-definition-2312095-graphics.bin");
const mask = (points: number[][]): NativeRationalParts => [
  [points.map((p) => [rational(p[0]!), rational(p[1]!)])],
];
const original = mask([
  [30.65416869440381, 526.6952031186182],
  [30.65416869440382, 530.4038645359411],
  [30.570835361070582, 530.4038645359411],
  [30.570835361070575, 526.6952031186182],
]);
test("all three complete original saved components remain outside the unchanged thin mask; no mask or leaf exemption is invented", () => {
  const r = inspectCurtainDoorMaterialMaskFrames(
    occurrence,
    definition,
    original,
  );
  assert.equal(r.components.length, 3);
  assert.equal(r.savedMaterialEnclosuresEntirelyInsideComparedMask, false);
  assert.ok(
    r.components.every((c) => c.outsideComparedMaskResidualFeet.length > 0),
  );
  assert.deepEqual(
    r.components.map((c) => c.originalGeometryToken),
    [17, 18, 19],
  );
  assert.equal(r.sourceLeafOperationApproved, false);
  assert.equal(r.sourceMaterialOmitted, false);
  assert.equal(r.sourceApertureApproved, false);
});
test("a complete synthetic comparison enclosure proves mathematical containment only", () => {
  const r = inspectCurtainDoorMaterialMaskFrames(
    occurrence,
    definition,
    mask([
      [30, 526],
      [31, 526],
      [31, 531],
      [30, 531],
    ]),
  );
  assert.equal(r.savedMaterialEnclosuresEntirelyInsideComparedMask, true);
  assert.equal(r.comparedMaskSuppliedForComparisonOnly, true);
  assert.equal(r.sourceApertureApproved, false);
  assert.equal(r.sourceLeafOperationApproved, false);
});
test("damaged native bytes, a self-crossing or holed mask and forged source/container contexts refuse", () => {
  const b = Uint8Array.from(definition);
  b[40] ^= 1;
  assert.throws(
    () => inspectCurtainDoorMaterialMaskFrames(occurrence, b, original),
    /checksum/,
  );
  assert.throws(() =>
    inspectCurtainDoorMaterialMaskFrames(
      occurrence,
      definition,
      mask([
        [30, 526],
        [31, 531],
        [30, 531],
        [31, 526],
      ]),
    ),
  );
  assert.throws(
    () =>
      inspectCurtainDoorMaterialMaskFrames(occurrence, definition, [
        [original[0]![0]!, original[0]![0]!],
      ]),
    /one valid finite/,
  );
  assert.throws(
    () =>
      inspectOriginalCurrentCurtainDoorMask(
        {} as never,
        {} as never,
        2315416,
        original,
      ),
    /Untrusted/,
  );
});
