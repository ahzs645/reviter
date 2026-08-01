import assert from "node:assert/strict";
import test from "node:test";

import { meshBoundsByElement, summarizeAgreement } from "../scripts/overlay-diff.ts";

test("reports joint centre-and-size agreement separately from either marginal", () => {
  const summary = summarizeAgreement([
    { centre: 0.1, size: 0.8 },
    { centre: 0.8, size: 0.1 },
    { centre: 0.1, size: 0.1 },
    { centre: 0.5, size: 0.1 },
  ]);

  assert.deepEqual(summary, {
    matched: 4,
    centreOk: 2,
    sizeOk: 3,
    bothOk: 1,
    centreOkPercent: 50,
    sizeOkPercent: 75,
    bothOkPercent: 25,
  });
});

test("measures the rendered triangles per element instead of a record envelope", () => {
  const bounds = meshBoundsByElement([{
    name: "two elements",
    positions: Float32Array.from([
      0, 0, 10,
      2, 0, 10,
      0, 3, 11,
      20, 20, 4,
      21, 20, 4,
      20, 22, 5,
    ]),
    indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    colors: new Float32Array(24),
    materialIndex: 0,
    elementIds: Uint32Array.from([101, 202]),
  }], { x: 100, y: -50, z: 5 });

  assert.deepEqual(bounds.get(101), [100, -50, 15, 102, -47, 16]);
  assert.deepEqual(bounds.get(202), [120, -30, 9, 121, -28, 10]);
});

test("unions triangles for one element across render batches", () => {
  const triangle = (positions: number[]) => ({
    name: "batch",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from([0, 1, 2]),
    colors: new Float32Array(12),
    materialIndex: 0,
    elementIds: Uint32Array.from([77]),
  });
  const bounds = meshBoundsByElement([
    triangle([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangle([-2, 3, 4, -1, 3, 4, -2, 5, 6]),
  ]);

  assert.deepEqual(bounds.get(77), [-2, 0, 0, 1, 5, 6]);
});
