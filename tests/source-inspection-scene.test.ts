import assert from "node:assert/strict";
import test from "node:test";
import { sourceInspectionScene } from "../lib/reviter/source-inspection-scene.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
const model = () => ({ origin: { x: 0, y: 0, z: 0 }, materials: [{ name: "source" }],
  meshes: [{ name: "one", positions: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 0, 7: 1, 8: 0 },
    indices: { 0: 0, 1: 1, 2: 2 } }] }) as unknown as ConvertResult;
test("restores checkpoint render arrays losslessly without editing source objects or materials", () => {
  const m = model(), before = JSON.stringify(m), result = sourceInspectionScene(m);
  assert.equal(result.vertices, 3); assert.equal(result.triangles, 1);
  assert.ok(result.model.meshes[0]!.positions instanceof Float32Array);
  assert.equal(JSON.stringify(m), before); assert.equal(result.model.materials, m.materials);
  result.model.meshes[0]!.positions[0] = 2;
  assert.equal(JSON.stringify(m), before);
});
test("typed arrays and serialized arrays give the same vertices and triangles", () => {
  const a = sourceInspectionScene(model()), b = sourceInspectionScene(a.model);
  assert.deepEqual(a.model.meshes[0]!.positions, b.model.meshes[0]!.positions);
  assert.deepEqual(a.model.meshes[0]!.indices, b.model.meshes[0]!.indices);
});
test("refuses empty scenes, sparse/noncanonical indices and lossy float restoration", () => {
  const empty = model(); empty.meshes = []; assert.throws(() => sourceInspectionScene(empty), /empty/);
  const sparse = model(); sparse.meshes[0]!.indices = { 0: 0, 2: 2 } as unknown as Uint32Array;
  assert.throws(() => sourceInspectionScene(sparse), /Noncontiguous/);
  const loss = model(); loss.meshes[0]!.positions[0] = .1;
  assert.throws(() => sourceInspectionScene(loss), /Lossy/);
  const topology = model(); topology.meshes[0]!.indices[2] = 99;
  assert.throws(() => sourceInspectionScene(topology), /topology/);
});
