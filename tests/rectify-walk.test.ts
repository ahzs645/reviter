import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_STEP_UP_FEET, rectifiedTriangles, walkFrom, walkIndexes, wingsFor,
} from "../lib/reviter/rectify-walk.ts";
import type { ConvertResult, MeshData } from "../lib/reviter/types.ts";

/** A z-up slab: `w` x `d` feet at height `z`, as two triangles. */
function slab(x0: number, y0: number, x1: number, y1: number, z: number,
              elementId = 1): MeshData {
  return {
    name: "slab",
    positions: new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    colors: new Float32Array(12),
    materialIndex: 0,
    elementIds: new Uint32Array([elementId, elementId]),
  } as unknown as MeshData;
}

function model(meshes: MeshData[]): ConvertResult {
  return { meshes, elementBounds: [], levels: [] } as unknown as ConvertResult;
}

test("a flat floor is walked end to end", () => {
  const indexes = walkIndexes(rectifiedTriangles(model([slab(0, 0, 40, 40, 0)])));
  const report = walkFrom(indexes, [20, 20], { stride: 4 });
  assert.ok(report.start, "the walker should find the floor under it");
  // An 11x11 lattice of 4 ft cells covers 0..40 in both axes.
  assert.ok(report.reached >= 100, `expected to cover the slab, reached ${report.reached}`);
});

test("a step within the step-up is climbed; one above it is not", () => {
  const low = slab(0, 0, 20, 40, 0);
  const easy = slab(20, 0, 40, 40, MAX_STEP_UP_FEET - 0.2, 2);
  const hard = slab(20, 0, 40, 40, MAX_STEP_UP_FEET + 2, 3);
  const climbed = walkFrom(walkIndexes(rectifiedTriangles(model([low, easy]))),
    [4, 20], { stride: 4 });
  const refused = walkFrom(walkIndexes(rectifiedTriangles(model([low, hard]))),
    [4, 20], { stride: 4 });
  assert.ok(climbed.reached > refused.reached,
    `a 0.4 m rise should be walkable and a 2.6 m one not: ${climbed.reached} vs ${refused.reached}`);
  assert.ok(refused.blockedByRise > 0, "the high step should be refused as a rise");
  assert.ok(refused.bounds![2] <= 24, `the walk should stop at the step, got ${refused.bounds}`);
});

test("a wing transform moves the triangles it claims and no others", () => {
  const spine = slab(-40, 0, -1, 20, 0, 1);
  const wing = slab(1, 0, 40, 20, 0, 2);
  // Built through the real conversion, so the test cannot pass on a Wing shape
  // the library does not actually use.
  const wings = wingsFor({
    wings: [{
      rotation_deg: 0, pivot_xy_m: [0, 0], shift_xy_m: [0, 100 * 0.3048],
      hull_half_planes: [[-1, 0, 0]],
    }],
    hull_margin_m: 0,
  });
  const before = rectifiedTriangles(model([spine, wing]));
  const after = rectifiedTriangles(model([spine, wing]), wings);
  assert.equal(before.length, after.length);
  const movedY = (a: Float32Array) => {
    let north = 0;
    for (let i = 1; i < a.length; i += 3) if (a[i]! > 99) north += 1;
    return north;
  };
  assert.equal(movedY(before), 0);
  assert.equal(movedY(after), 6, "the wing's two triangles, six vertices, travel north");
  // And the spine's own corner is exactly where it was.
  assert.equal(after[0], -40);
});

test("a walker that starts in mid-air reports no floor rather than guessing", () => {
  const indexes = walkIndexes(rectifiedTriangles(model([slab(0, 0, 10, 10, 0)])));
  const report = walkFrom(indexes, [500, 500], { stride: 4 });
  assert.equal(report.start, null);
  assert.equal(report.reached, 0);
});
