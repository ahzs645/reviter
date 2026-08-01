import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGlbDocument } from "../scripts/glb-statistics.ts";

test("counts stored and instantiated GLB triangles independently", () => {
  const report = analyzeGlbDocument({
    asset: { generator: "fixture" }, scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, translation: [10, 0, 0] }, { mesh: 0, translation: [-10, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { componentType: 5126, count: 4, min: [-1, -2, -3], max: [1, 2, 3] },
      { componentType: 5123, count: 6 },
    ], materials: [{}, {}],
  });
  assert.equal(report.storedTriangles, 2);
  assert.equal(report.instantiatedTriangles, 4);
  assert.equal(report.meshInstances, 2);
  assert.deepEqual(report.spans, [22, 4, 6]);
  assert.equal(report.materialCount, 2);
});

test("normalizes quantized signed-short accessor bounds before transforms", () => {
  const report = analyzeGlbDocument({
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, scale: [2, 3, 4] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { componentType: 5122, normalized: true, count: 3,
        min: [-32_768, -16_384, 0], max: [32_767, 16_384, 32_767] },
      { componentType: 5123, count: 3 },
    ],
  });
  assert.deepEqual(report.bounds?.min, [-2, -1.500045777764214, 0]);
  assert.deepEqual(report.bounds?.max, [2, 1.500045777764214, 4]);
});
