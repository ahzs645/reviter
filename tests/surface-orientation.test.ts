import assert from "node:assert/strict";
import test from "node:test";

import {
  addSurfaceTriangle,
  emptySurfaceOrientationTotals,
  hasMaterialSlopeDifference,
  packMeshSurfaceOrientationSignatures,
  slopedSurfaceFraction,
  unpackSurfaceOrientationSignatures,
} from "../lib/reviter/surface-orientation.ts";
import type { MeshData } from "../lib/reviter/types.ts";

test("distinguishes a flattened prism from a materially sloped body", () => {
  const prism = emptySurfaceOrientationTotals();
  addSurfaceTriangle(
    prism,
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
  );
  addSurfaceTriangle(
    prism,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
    { x: 0, y: 0, z: 4 },
  );
  // Four non-degenerate triangles are required before the repair gate opens.
  prism.horizontal *= 2;
  prism.vertical *= 2;
  prism.triangles = 4;

  const roof = emptySurfaceOrientationTotals();
  for (let index = 0; index < 4; index += 1) {
    addSurfaceTriangle(
      roof,
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 1 },
      { x: 0, y: 4, z: 0 },
    );
  }

  assert.equal(slopedSurfaceFraction(prism), 0);
  assert.ok(slopedSurfaceFraction(roof) > 0.99);
  assert.equal(hasMaterialSlopeDifference(prism, roof), true);
});

test("declines ordinary tessellation drift and undersampled evidence", () => {
  const recovered = { horizontal: 80, vertical: 20, sloped: 0, triangles: 12 };
  const slightlyTilted = { horizontal: 75, vertical: 20, sloped: 5, triangles: 20 };
  const oneTriangle = { horizontal: 0, vertical: 0, sloped: 100, triangles: 1 };
  assert.equal(hasMaterialSlopeDifference(recovered, slightlyTilted), false);
  assert.equal(hasMaterialSlopeDifference(recovered, oneTriangle), false);
});

test("packs viewer triangle orientation per native element id", () => {
  const mesh: MeshData = {
    name: "horizontal and sloped",
    positions: Float32Array.from([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 1, 0, 1, 0,
    ]),
    indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    colors: Float32Array.from(Array(18).fill(1)),
    materialIndex: 0,
    elementIds: Uint32Array.from([10, 20]),
  };
  const unpacked = unpackSurfaceOrientationSignatures(
    packMeshSurfaceOrientationSignatures([mesh]),
  );
  assert.equal(unpacked.get(10)?.triangles, 1);
  assert.equal(unpacked.get(10)?.sloped, 0);
  assert.equal(unpacked.get(20)?.triangles, 1);
  assert.ok((unpacked.get(20)?.sloped ?? 0) > 0);
});
