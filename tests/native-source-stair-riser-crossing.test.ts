import assert from "node:assert/strict";
import test from "node:test";
import {
  rational,
  type NativeRationalPoint,
} from "../lib/reviter/native-rational-overlay.ts";
import {
  inspectOriginalFiniteTwoFootRiserCrossing,
  inspectOriginalNativeTerminalRiserCrossing,
  type OriginalFiniteNativeRiserLine,
} from "../lib/reviter/native-source-stair-riser-crossing.ts";
import type { OriginalNativeStairPhysicalContext } from "../lib/reviter/native-source-stair-physical-inventory.ts";
const p = (x: number, y: number): NativeRationalPoint => [
    rational(x),
    rational(y),
  ],
  line: OriginalFiniteNativeRiserLine = {
    m_origin: [0, 0, 100],
    m_dirVec: [0, 1, 0],
    m_endParams: [-2, 2],
  };
test("every endpoint track crosses the finite original riser at an exact internal go parameter", () => {
  const r = inspectOriginalFiniteTwoFootRiserCrossing(line, p(-1, 0), p(1, 0));
  assert.equal(r.properCrossingForFullTwoFootStrip, true);
  assert.deepEqual(
    r.endpointTrackIntersections.map((i) => [
      String(i.goParameter.n),
      String(i.goParameter.d),
    ]),
    [
      ["1", "2"],
      ["1", "2"],
    ],
  );
  assert.equal(r.sourcePlanHeightRetainedAsMetadataFeet.n, 100n);
  assert.equal(r.originalSourceAuthorityGranted, false);
  assert.equal(r.physicalRiserCorrespondenceApproved, false);
  assert.equal(r.routeApproved, false);
});
test("finite line width, no crossing, endpoint-only and parallel traces cannot become a full-width riser event", () => {
  for (const [from, to, l] of [
    [p(-1, 0), p(1, 0), { ...line, m_endParams: [-0.5, 0.5] }],
    [p(-2, 0), p(-1, 0), line],
    [p(0, 0), p(1, 0), line],
    [p(1, -1), p(1, 1), line],
  ] as [
    NativeRationalPoint,
    NativeRationalPoint,
    OriginalFiniteNativeRiserLine,
  ][]) {
    assert.equal(
      inspectOriginalFiniteTwoFootRiserCrossing(l, from, to)
        .properCrossingForFullTwoFootStrip,
      false,
    );
  }
});
test("a point crossing never hides the missing opposite side of a diagonal conservative two-foot strip", () => {
  const r = inspectOriginalFiniteTwoFootRiserCrossing(
    { ...line, m_endParams: [-0.25, 0.25] },
    p(-1, -1),
    p(1, 1),
  );
  assert.equal(r.properCrossingForFullTwoFootStrip, false);
  assert.ok(
    r.endpointTrackIntersections.some((i) => !i.withinOriginalFiniteRiser),
  );
  assert.throws(
    () =>
      inspectOriginalNativeTerminalRiserCrossing(
        {} as OriginalNativeStairPhysicalContext,
        1696012,
        "lower",
        p(-1, 0),
        p(1, 0),
      ),
    /Untrusted/,
  );
});
