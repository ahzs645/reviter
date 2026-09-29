import assert from "node:assert/strict";
import test from "node:test";
import { selectElementMeshes } from "../scripts/compare-element-surfaces.ts";
import type { MeshData } from "../lib/reviter/types.ts";

test("local surface checks compact only the selected element's indexed triangles", () => {
  const mesh: MeshData = { name: "test", materialIndex: 0, positions: new Float32Array([90,90,90, 0,0,0, 1,0,0, 0,1,0]), colors: new Float32Array(12).fill(1), indices: new Uint32Array([0,1,2, 1,2,3]), elementIds: new Uint32Array([2,1]) };
  const selected = selectElementMeshes([mesh],1);
  assert.equal(selected.length,1);
  assert.deepEqual([...selected[0]!.positions],[0,0,0,1,0,0,0,1,0]);
  assert.deepEqual([...selected[0]!.indices],[0,1,2]);
  assert.deepEqual(selectElementMeshes([mesh],3),[]);
  assert.equal(mesh.indices.length,6);
});
