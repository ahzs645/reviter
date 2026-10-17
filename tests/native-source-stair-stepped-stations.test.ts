import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeAxisAlignedSegmentInExactParts,
  nativeConservativeTwoFootStrip,
  inspectOriginalNativeStairSteppedStations,
} from "../lib/reviter/native-source-stair-stepped-stations.ts";
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
} from "../lib/reviter/native-rational-overlay.ts";
import type { OriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
const p = (x: number, y: number): NativeRationalPoint => [
    rational(x),
    rational(y),
  ],
  rectangle = [[[p(0, 0), p(4, 0), p(4, 4), p(0, 4)]]];
test("a full lateral station uses exact segment containment including every hole crossing", () => {
  assert.equal(
    nativeAxisAlignedSegmentInExactParts(p(2, 1), p(2, 3), rectangle),
    true,
  );
  const hole = [[[p(1.9, 1.9), p(2.1, 1.9), p(2.1, 2.1), p(1.9, 2.1)]]];
  const parts = nativeRationalOverlay("difference", rectangle, hole);
  assert.equal(
    nativeAxisAlignedSegmentInExactParts(p(2, 1), p(2, 3), parts),
    false,
  );
  assert.equal(
    nativeAxisAlignedSegmentInExactParts(p(1, 1), p(1, 3), parts),
    true,
  );
  assert.equal(
    nativeAxisAlignedSegmentInExactParts(p(1, 1), p(3, 2), parts),
    false,
  );
});
test("untrusted source labels cannot generate physical tread stations", () => {
  assert.throws(
    () =>
      inspectOriginalNativeStairSteppedStations(
        {} as OriginalNativeStairPhysicalContext,
        1696012,
        [],
      ),
    /Untrusted/,
  );
});

test("an unsupported gap cannot become a same-tread turning movement", () => {
  const floor = nativeRationalOverlay("difference", rectangle, [
    [[p(1.9, 1.9), p(2.1, 1.9), p(2.1, 2.1), p(1.9, 2.1)]],
  ]);
  const demand = nativeConservativeTwoFootStrip(p(1, 2), p(3, 2));
  assert.ok(nativeRationalOverlay("difference", demand, floor).length > 0);
  assert.deepEqual(
    nativeRationalOverlay(
      "difference",
      nativeConservativeTwoFootStrip(p(1, 1), p(3, 1)),
      rectangle,
    ),
    [],
  );
});
