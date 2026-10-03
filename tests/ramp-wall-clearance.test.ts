import test from "node:test";
import assert from "node:assert/strict";
import pc from "polygon-clipping";
import { rampFacesOutsideWalls } from "../lib/reviter/ramp-wall-clearance.ts";
import { nativeWallSolidPolygon } from "../lib/reviter/architectural-plan.ts";
import { triangleSurfaceHeight } from "../lib/reviter/indoor-ramps.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type P = [number, number, number];
const triangles: P[][] = [
  [
    [0, 0, 0],
    [10, 0, 3],
    [10, 6, 3],
  ],
  [
    [10, 6, 3],
    [0, 6, 0],
    [0, 0, 0],
  ],
];
function model(base = 0, top = 10) {
  const s = {
    elementId: 1,
    start: { x: 5, y: -1 },
    end: { x: 5, y: 7 },
    thickness: 1,
    baseElevation: base,
    topElevation: top,
  };
  return {
    elementBounds: [
      {
        elementId: 1,
        categoryId: -2000011,
        boundsFeet: {
          min: { x: 4.5, y: -1, z: base },
          max: { x: 5.5, y: 7, z: top },
        },
        solids: [s],
      },
    ],
  } as unknown as ConvertResult;
}
const area = (ts: P[][]) =>
  ts.reduce(
    (n, t) =>
      n +
      Math.abs(
        (t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) -
          (t[1]![1] - t[0]![1]) * (t[2]![0] - t[0]![0]),
      ) /
        2,
    0,
  );
test("ramp display stops at native wall faces, retains slope and never adds walking surface", () => {
  const m = model(),
    out = rampFacesOutsideWalls(m, triangles);
  assert.ok(Math.abs(area(out) - 54) < 1e-8);
  const wall = nativeWallSolidPolygon(m.elementBounds[0]!.solids![0]!);
  for (const t of out) {
    const intersection = pc.intersection(
      [t.map((p): [number, number] => [p[0], p[1]])],
      [wall],
    );
    assert.ok(!intersection.length);
    for (const p of t)
      assert.ok(
        triangles.some((original) => {
          const z = triangleSurfaceHeight(p, original);
          return z !== undefined && Math.abs(p[2] - z) < 1e-8;
        }),
      );
  }
  assert.deepEqual(triangles[0], [
    [0, 0, 0],
    [10, 0, 3],
    [10, 6, 3],
  ]);
});
test("walls above or below the ramp do not change its shape", () => {
  assert.deepEqual(rampFacesOutsideWalls(model(8, 10), triangles), triangles);
  assert.deepEqual(rampFacesOutsideWalls(model(-4, -2), triangles), triangles);
});
test("a wall starting midway up the slope clips only overlapping heights", () => {
  const out = rampFacesOutsideWalls(model(1.5, 10), triangles);
  assert.ok(Math.abs(area(out) - 57) < 1e-8);
  assert.ok(
    out
      .flat()
      .some((p) => Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[2] - 1.5) < 1e-9),
  );
});
