import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeStairStationLateralDirection,
  nativeStairStationParallelToSourceDirection,
  type NativeStairStationLateral,
} from "../lib/reviter/native-source-stair-stepped-stations.ts";

test("stated station orientation must exactly follow a retained finite source direction", () => {
  assert.equal(nativeStairStationParallelToSourceDirection({ lateralAxis: "y" }, [0, -4]), true);
  assert.equal(nativeStairStationParallelToSourceDirection({ lateralDirectionFeet: [3, 4] }, [-6, -8]), true);
  assert.equal(nativeStairStationParallelToSourceDirection({ lateralDirectionFeet: [3, 4] }, [4, 3]), false);
  assert.equal(nativeStairStationParallelToSourceDirection({ lateralAxis: "x" }, [3, 4]), false);
});

test("ambiguous, absent, sparse and degenerate directions cannot narrow an admitted station", () => {
  for (const value of [
    {}, { lateralAxis: "z" }, { lateralAxis: "x", lateralDirectionFeet: [1, 0] },
    { lateralDirectionFeet: [0, 0] }, { lateralDirectionFeet: [NaN, 1] },
    { lateralDirectionFeet: new Array(2) },
  ]) assert.throws(() => nativeStairStationLateralDirection(value as NativeStairStationLateral), /lateral station direction/);
  for (const value of [[0, 0], [Infinity, 0], new Array(2)]) assert.throws(
    () => nativeStairStationParallelToSourceDirection({ lateralAxis: "x" }, value as [number, number]),
    /original lateral boundary direction/,
  );
});
