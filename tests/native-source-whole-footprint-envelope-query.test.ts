import test from "node:test";
import assert from "node:assert/strict";
import { inspectWholeFootprintEnvelopeCandidates } from "../lib/reviter/native-source-whole-footprint-envelope-query.ts";
import { originalSourceBaseApproachDemand } from "../lib/reviter/native-source-stair-base-approach-demand.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import { rational } from "../lib/reviter/native-rational-overlay.ts";
const bounds = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
test("a diagonal conservative side-band body is retained even outside both endpoint standing queries", () => {
  const footprint = originalSourceBaseApproachDemand(
      [0, 0, 0],
      [4, 2, 0],
    ).completeFootprintFeet,
    rows = [
      { nativeElementId: 1, boundsFeet: bounds(1.49, 1.99, 1, 1.51, 2.01, 2) },
    ];
  for (const p of [
    [0, 0],
    [4, 2],
  ])
    assert.deepEqual(
      inspectWholeFootprintEnvelopeCandidates(
        rows,
        originalTwoFootStandingSquare([rational(p[0]!), rational(p[1]!)]),
        rational(0),
        rational(6),
      ).candidateNativeElementIds,
      [],
    );
  assert.deepEqual(
    inspectWholeFootprintEnvelopeCandidates(
      rows,
      footprint,
      rational(0),
      rational(6),
    ).candidateNativeElementIds,
    [1],
  );
});
test("full-footprint queries retain side/head tangencies, zero-area line/point boxes and every unbounded source row", () => {
  const footprint = originalSourceBaseApproachDemand(
      [0, 0, 0],
      [4, 2, 0],
    ).completeFootprintFeet,
    rows = [
      { nativeElementId: 2, boundsFeet: bounds(0, 0, 6, 0, 0, 6) },
      { nativeElementId: 3, boundsFeet: bounds(1.5, 1.99, 1, 1.5, 2.01, 2) },
      { nativeElementId: 4, boundsFeet: bounds(0, 0, -1, 0.1, 0.1, 0) },
      { nativeElementId: 5, boundsFeet: bounds(0, 0, 6.001, 0.1, 0.1, 7) },
      { nativeElementId: 6, boundsFeet: bounds(-1, -1, 1, -1, -1, 2) },
      { nativeElementId: 7 },
      {
        nativeElementId: 8,
        boundsFeet: bounds(100, 100, 1, 101, 101, 2),
        blocker: "unknown-original-body",
      },
    ],
    before = structuredClone(rows),
    result = inspectWholeFootprintEnvelopeCandidates(
      rows,
      footprint,
      rational(0),
      rational(6),
    );
  assert.deepEqual(result.candidateNativeElementIds, [2, 3, 6]);
  assert.deepEqual(result.unboundedNativeElementIds, [7, 8]);
  assert.equal(result.censusRecordsChecked, rows.length);
  assert.equal(result.foreignHumanClearanceApproved, false);
  assert.equal(result.routeApproved, false);
  assert.deepEqual(rows, before);
});
