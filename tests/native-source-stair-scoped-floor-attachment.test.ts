import assert from "node:assert/strict";
import test from "node:test";
import {
  originalStairTerminalWalkingFootprint,
  inspectOriginalNativeStairScopedFloorAttachment,
} from "../lib/reviter/native-source-stair-scoped-floor-attachment.ts";
import {
  nativeConservativeTwoFootStrip,
  nativeConservativeTwoFootStation,
  nativeSegmentInExactParts,
} from "../lib/reviter/native-source-stair-stepped-stations.ts";
import { originalTwoFootStandingSquare } from "../lib/reviter/native-source-standing-footprint.ts";
import {
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
} from "../lib/reviter/native-rational-overlay.ts";

const point = (x: number, y: number): NativeRationalPoint => [
  rational(x),
  rational(y),
];
test("the bounded floor request encloses full standing and turning strips with the original oriented terminal line", () => {
  const path: [number, number][] = [
      [0, 0],
      [0, 4],
      [3, 7],
    ],
    p = path.map(([x, y]) => point(x, y)),
    demand = originalStairTerminalWalkingFootprint(path, {
      lateralDirectionFeet: [3, 4],
    });
  assert.equal(demand.length, 1);
  assert.equal(demand[0]!.length, 1);
  for (const square of p.slice(0, -1).map(originalTwoFootStandingSquare))
    assert.deepEqual(nativeRationalOverlay("difference", square, demand), []);
  for (let i = 1; i < p.length; i++)
    assert.deepEqual(
      nativeRationalOverlay(
        "difference",
        nativeConservativeTwoFootStrip(p[i - 1]!, p[i]!),
        demand,
      ),
      [],
    );
  const line = nativeConservativeTwoFootStation(p.at(-1)!, [3, 4]);
  assert.equal(nativeSegmentInExactParts(line[0], line[1], demand), true);
  // A request patch has finite bounds, never whole-floor authority.
  assert.notDeepEqual(
    nativeRationalOverlay(
      "difference",
      originalTwoFootStandingSquare(point(100, 100)),
      demand,
    ),
    [],
  );
});
test("malformed paths and directions cannot make a narrow support request", () => {
  for (const path of [
    [],
    [[0, 0]],
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [NaN, 1],
    ],
  ])
    assert.throws(() =>
      originalStairTerminalWalkingFootprint(path as [number, number][], {
        lateralAxis: "y",
      }),
    );
  assert.throws(() =>
    originalStairTerminalWalkingFootprint(
      [
        [0, 0],
        [0, 3],
      ],
      { lateralDirectionFeet: [0, 0] },
    ),
  );
});
test("a detached patch or cloned source object does not restore native floor attachment authority", () => {
  assert.throws(() =>
    inspectOriginalNativeStairScopedFloorAttachment(
      {} as Parameters<
        typeof inspectOriginalNativeStairScopedFloorAttachment
      >[0],
      {} as Parameters<
        typeof inspectOriginalNativeStairScopedFloorAttachment
      >[1],
      1,
      {
        originalLogicalGraphNodeId: "original",
        originalLogicalPointFeet: [0, 0, 0],
        nativeFloorElementId: 2,
        originalTrimmedFloorFaceToken: 5,
        runTerminal: "lower",
        lateralAxis: "y",
      },
      originalTwoFootStandingSquare(point(0, 0)),
    ),
  );
});
