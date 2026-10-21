import test from "node:test";
import assert from "node:assert/strict";
import { originalSourceBaseApproachDemand } from "../lib/reviter/native-source-stair-base-approach-demand.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import { nativeConservativeTwoFootStrip } from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { inspectOriginalFloorCapBoundaryDemand } from "../lib/reviter/native-source-floor-cap-demand.ts";
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
} from "../lib/reviter/native-rational-overlay.ts";
import type { OriginalLocalFloorCapEnvelope } from "../lib/reviter/native-source-floor-local-support.ts";
test("source-base approach includes both complete standing squares, including corners outside the connecting strip", () => {
  const start: [number, number, number] = [0, 0, 0],
    end: [number, number, number] = [4, 2, 0],
    before = structuredClone([start, end]),
    demand = originalSourceBaseApproachDemand(start, end);
  for (const point of [start, end])
    assert.equal(
      nativeRationalOverlay(
        "difference",
        originalTwoFootStandingSquare([rational(point[0]), rational(point[1])]),
        demand.completeFootprintFeet,
      ).length,
      0,
    );
  assert.deepEqual([start, end], before);
  assert.equal(demand.sourceGeometryOrRouteApproved, false);
  const outer = [
      [-2, -2],
      [7, -2],
      [7, 5],
      [-2, 5],
    ],
    hole = [
      [4.8, 2.8],
      [5.1, 2.8],
      [5.1, 3.1],
      [4.8, 3.1],
    ],
    rings = [outer, hole],
    cap = {
      nativeFloorElementId: 1,
      originalFaceToken: 5,
      originalPhysicalTopElevationFeet: rational(0),
      originalCapLoopTokens: [1, 2],
      originalCapEdgeTokens: [1, 2, 3, 4, 5, 6, 7, 8],
      originalChainEnvelopeLoops: [],
      originalReferenceWindingPartsFeet: [
        [outer.map((p) => p.map(rational)), hole.map((p) => p.map(rational))],
      ],
      retainedPositiveBoundaryUncertaintyPartsFeet: [],
      retainedZeroAreaBoundarySegmentsFeet: rings.flatMap((r) =>
        r.map((p, i) =>
          [p, r[(i + 1) % r.length]!].map((q) => q.map(rational)),
        ),
      ),
    } as unknown as OriginalLocalFloorCapEnvelope,
    strip = nativeConservativeTwoFootStrip(
      [rational(0), rational(0)],
      [rational(4), rational(2)],
    );
  assert.equal(
    inspectOriginalFloorCapBoundaryDemand(cap, strip as NativeRationalParts)
      .completeConnectedDemandSupported,
    true,
  );
  assert.equal(
    inspectOriginalFloorCapBoundaryDemand(cap, demand.completeFootprintFeet)
      .completeConnectedDemandSupported,
    false,
  );
});
test("a base approach cannot move either checked endpoint, hide a vertical segment or repeat a path station", () => {
  const start: [number, number, number] = [0, 0, 0],
    end: [number, number, number] = [4, 2, 0];
  for (const path of [
    [
      [0.00000000000001, 0],
      [4, 2],
    ],
    [
      [0, 0],
      [4, 2.00000000000001],
    ],
    [
      [0, 0],
      [0, 0],
      [4, 2],
    ],
  ] as [number, number][][])
    assert.throws(() => originalSourceBaseApproachDemand(start, end, path));
  assert.throws(
    () => originalSourceBaseApproachDemand(start, [4, 2, 0.00000000000001]),
    /foot plane/,
  );
});
