import assert from "node:assert/strict";
import test from "node:test";

import type { WallSolid } from "../lib/reviter/native-geometry.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import { recoverWallJoinCorners } from "../lib/reviter/wall-joins.ts";

function record(elementId: number, solid: WallSolid, bounds: ElementBoundsRecord["boundsFeet"]): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 1,
    boundsFeet: bounds,
    categoryId: -2_000_011,
    categoryName: "Walls",
    solid,
    solids: [solid],
  };
}

test("recovers a diagonal wall cap from an adjacent native wall face", () => {
  const target: WallSolid = {
    elementId: 1,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    thickness: 2,
    baseElevation: 0,
    topElevation: 10,
  };
  const neighbour: WallSolid = {
    elementId: 2,
    start: { x: 8, y: -2 },
    end: { x: 12, y: 2 },
    thickness: 2,
    baseElevation: 0,
    topElevation: 10,
  };
  // The target is trimmed to the neighbour's +normal face. Its cap corners are
  // offset by sqrt(2) along the target and differ by two feet, so this exact
  // joined-body envelope is not rectangular.
  const far = 11 + Math.SQRT2;
  const near = 9 + Math.SQRT2;
  const targetRecord = record(1, target, {
    min: { x: 0, y: -1, z: 0 },
    max: { x: far, y: 1, z: 10 },
  });
  const neighbourRecord = record(2, neighbour, {
    min: { x: 7.5, y: -2.5, z: 0 },
    max: { x: 12.5, y: 2.5, z: 10 },
  });

  assert.equal(recoverWallJoinCorners([targetRecord, neighbourRecord]), 1);
  assert.ok(target.endCorners);
  assert.ok(Math.abs(target.endCorners[0].x - far) < 1e-9);
  assert.ok(Math.abs(target.endCorners[0].y - 1) < 1e-9);
  assert.ok(Math.abs(target.endCorners[1].x - near) < 1e-9);
  assert.ok(Math.abs(target.endCorners[1].y - -1) < 1e-9);
  assert.deepEqual(target.end, { x: 10, y: 0 });
});

test("declines an uncorroborated crossing and a synthesised envelope", () => {
  const target: WallSolid = {
    elementId: 1,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    thickness: 1,
    baseElevation: 0,
    topElevation: 10,
  };
  const crossing: WallSolid = {
    elementId: 2,
    start: { x: 50, y: -5 },
    end: { x: 50, y: 5 },
    thickness: 1,
    baseElevation: 0,
    topElevation: 10,
  };
  const targetRecord = record(1, target, {
    min: { x: 0, y: -0.5, z: 0 },
    max: { x: 10, y: 0.5, z: 10 },
  });
  targetRecord.recordOffset = -1;
  assert.equal(recoverWallJoinCorners([
    targetRecord,
    record(2, crossing, {
      min: { x: 49.5, y: -5, z: 0 },
      max: { x: 50.5, y: 5, z: 10 },
    }),
  ]), 0);
  assert.equal(target.startCorners, undefined);
  assert.equal(target.endCorners, undefined);
});

test("indexes a large wall population instead of scanning every pair", () => {
  const records: ElementBoundsRecord[] = [];
  for (let index = 0; index < 5_000; index += 1) {
    const x = index * 20;
    const run: WallSolid = {
      elementId: index + 1,
      start: { x, y: 0 },
      end: { x: x + 10, y: 0 },
      thickness: 1,
      baseElevation: 0,
      topElevation: 10,
    };
    records.push(record(index + 1, run, {
      min: { x, y: -0.5, z: 0 },
      max: { x: x + 10, y: 0.5, z: 10 },
    }));
  }

  const before = performance.now();
  assert.equal(recoverWallJoinCorners(records), 0);
  const durationMs = performance.now() - before;
  // The generous ceiling is a regression tripwire for the former O(n²) scan:
  // 50 million end/run comparisons are avoidable when only nearby runs can join.
  assert.ok(durationMs < 1_000, `spatially indexed wall joins took ${durationMs.toFixed(1)} ms`);
});
