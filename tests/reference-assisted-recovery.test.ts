import assert from "node:assert/strict";
import test from "node:test";

import { applyIfcReferenceRepairs } from "../lib/reviter/reference-assisted-recovery.ts";
import type { ConvertResult, MeshData, ReferenceMeshData } from "../lib/reviter/types.ts";

function recoveredMesh(): MeshData {
  return {
    name: "two recovered elements",
    positions: Float32Array.from([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      2, 0, 0, 3, 0, 0, 2, 1, 0,
    ]),
    indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    colors: Float32Array.from(Array(18).fill(1)),
    materialIndex: 4,
    elementIds: Uint32Array.from([1, 2]),
    source: "display-proxy",
  };
}

function model(): ConvertResult {
  return {
    ok: true,
    fileName: "fixture.rvt",
    origin: { x: 10, y: 20, z: 30 },
    meshes: [recoveredMesh()],
    materials: [],
    elementBounds: [1, 2].map((elementId) => ({
      elementId,
      stream: "Partitions/1",
      chunkIndex: 0,
      rawOffset: 0,
      recordOffset: 0,
      boundsFeet: {
        min: { x: elementId, y: 0, z: 0 },
        max: { x: elementId + 1, y: 1, z: 1 },
      },
    })),
    warnings: [],
    stats: { triangleCount: 2 },
  } as unknown as ConvertResult;
}

test("paired IFC repairs only tagged geometric differences and records provenance", () => {
  const reference: ReferenceMeshData = {
    name: "different",
    // Metres, absolute z-up. These become [1,2,3], [2,2,3], [1,3,3]
    // relative to the recovered origin after metres -> feet registration.
    positions: Float32Array.from([
      11 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      12 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      11 / 3.280839895, 23 / 3.280839895, 33 / 3.280839895,
    ]),
    indices: Uint32Array.from([0, 1, 2]),
    elementIds: Uint32Array.from([1]),
    color: [1, 0, 0],
    matched: true,
    diffStatus: "different",
  };
  const context: ReferenceMeshData = {
    ...reference,
    name: "context",
    elementIds: Uint32Array.from([0]),
    diffStatus: "context",
  };
  const original = model();
  const repaired = applyIfcReferenceRepairs(original, [reference, context]);

  assert.notEqual(repaired, original);
  assert.deepEqual([...repaired.referenceAssistedElementIds!], [1]);
  assert.equal(original.elementBounds[0]!.renderGeometryProvenance, undefined);
  assert.equal(repaired.elementBounds[0]!.renderGeometryProvenance, "reference-assisted");
  assert.equal(repaired.elementBounds[1]!.renderGeometryProvenance, undefined);

  const assisted = repaired.meshes.find((mesh) => mesh.source === "reference-ifc")!;
  assert.equal(assisted.materialIndex, 4);
  assert.deepEqual([...assisted.elementIds!], [1]);
  assert.deepEqual(
    [...assisted.positions].map((value) => Number(value.toFixed(5))),
    [1, 2, 3, 2, 2, 3, 1, 3, 3],
  );
  const retainedIds = repaired.meshes.flatMap((mesh) => [...(mesh.elementIds ?? [])]);
  assert.deepEqual(retainedIds.sort((a, b) => a - b), [1, 2]);
  assert.equal(repaired.stats.triangleCount, 2);
});

test("an aligned paired body leaves the RVT result untouched", () => {
  const original = model();
  const aligned: ReferenceMeshData = {
    name: "aligned",
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
    elementIds: Uint32Array.from([1]),
    color: [0, 1, 0],
    matched: true,
    diffStatus: "aligned",
  };
  assert.equal(applyIfcReferenceRepairs(original, [aligned]), original);
});

test("keeps a complete RVT ramp when the IFC tag may name only its landing", () => {
  const original = model();
  original.elementBounds[0]!.categoryId = -2_000_180;
  original.elementBounds[0]!.categoryName = "Ramps";
  const partialRamp: ReferenceMeshData = {
    name: "tagged landing without flights",
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
    elementIds: Uint32Array.from([1]),
    color: [1, 0, 0],
    matched: true,
    diffStatus: "different",
  };
  assert.equal(applyIfcReferenceRepairs(original, [partialRamp]), original);
});
