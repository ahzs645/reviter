import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeAxisAlignedSegmentInExactParts,
  nativeSegmentInExactParts,
  nativeConservativeTwoFootStation,
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

test("rotated stations retain full conservative width and cross every exact hole boundary", () => {
  const [a, b] = nativeConservativeTwoFootStation(p(2, 2), [3, 4]);
  assert.equal(nativeSegmentInExactParts(a, b, rectangle), true);
  assert.equal(nativeSegmentInExactParts(b, a, rectangle), true);
  const gap = nativeRationalOverlay("difference", rectangle, [[[p(1.9, 1.9), p(2.1, 1.9), p(2.1, 2.1), p(1.9, 2.1)]]]);
  assert.equal(nativeSegmentInExactParts(a, b, gap), false);
  // Disconnected support cannot be borrowed from the other end of a station.
  const separate = nativeRationalOverlay("union", [[[p(0, 0), p(1.9, 0), p(1.9, 4), p(0, 4)]]], [[[p(2.1, 0), p(4, 0), p(4, 4), p(2.1, 4)]]]);
  assert.equal(nativeSegmentInExactParts(a, b, separate), false);
  assert.equal(nativeSegmentInExactParts(p(0, 0), p(4, 4), rectangle), true);
  assert.equal(nativeSegmentInExactParts(p(-1, -1), p(4, 4), rectangle), false);
  const exact = (points: NativeRationalPoint[]) => points.map(point => point.map(q => `${q.n}/${q.d}`));
  assert.deepEqual(exact(nativeConservativeTwoFootStation(p(2, 2), [1, 0])), exact([p(1, 2), p(3, 2)]));
  // L-infinity normalization has length >= 1, so the full station is >= 2ft.
  assert.deepEqual(exact([a, b]), exact([p(1.25, 1), p(2.75, 3)]));
  assert.throws(() => nativeConservativeTwoFootStation(p(2, 2), [0, 0]), /Degenerate/);
  assert.throws(() => nativeConservativeTwoFootStation(p(2, 2), [NaN, 1]), /Invalid/);
});

test("a rotated narrow tread supports its native lateral direction while both world axes fail", () => {
  const rotatedTread = [[[p(-2.1, -1.9), p(1.9, 2.1), p(2.1, 1.9), p(-1.9, -2.1)]]];
  assert.equal(nativeSegmentInExactParts(...nativeConservativeTwoFootStation(p(0, 0), [1, 1]), rotatedTread), true);
  assert.equal(nativeAxisAlignedSegmentInExactParts(p(-1, 0), p(1, 0), rotatedTread), false);
  assert.equal(nativeAxisAlignedSegmentInExactParts(p(0, -1), p(0, 1), rotatedTread), false);
  assert.equal(nativeSegmentInExactParts(...nativeConservativeTwoFootStation(p(0, 0), [1, -1]), rotatedTread), false);
});
