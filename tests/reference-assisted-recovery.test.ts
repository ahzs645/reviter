import assert from "node:assert/strict";
import test from "node:test";

import {
  applyIfcReferenceRepairs,
  hasCompleteRoofReference,
} from "../lib/reviter/reference-assisted-recovery.ts";
import { elementManifest } from "../lib/reviter/export-report.ts";
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
  const retained = applyIfcReferenceRepairs(original, [partialRamp]);
  assert.notEqual(retained, original);
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRampAggregateIds!], [1]);
  assert.match(retained.warnings.at(-1) ?? "", /all six rendered aggregate extents/);
});

function tetrahedronRampModel(): ConvertResult {
  const original = model();
  original.meshes = [{
    name: "complete RVT ramp aggregate",
    positions: Float32Array.from([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    indices: Uint32Array.from([
      0, 2, 1,
      0, 1, 3,
      1, 2, 3,
      2, 0, 3,
    ]),
    colors: Float32Array.from(Array(12).fill(1)),
    materialIndex: 4,
    elementIds: Uint32Array.from([1, 1, 1, 1]),
    source: "display-proxy",
  }];
  original.elementBounds[0]!.categoryId = -2_000_180;
  original.elementBounds[0]!.categoryName = "Ramps";
  original.stats.triangleCount = 4;
  return original;
}

function tetrahedronRampReference(xExtent = 1): ReferenceMeshData {
  const feet = ([x, y, z]: [number, number, number]) => [
    (10 + x) / 3.280839895,
    (20 + y) / 3.280839895,
    (30 + z) / 3.280839895,
  ];
  return {
    name: "tagged direct IfcRamp body",
    positions: Float32Array.from([
      ...feet([0, 0, 0]),
      ...feet([xExtent, 0, 0]),
      ...feet([0, 1, 0]),
      ...feet([0, 0, 1]),
    ]),
    indices: Uint32Array.from([
      0, 2, 1,
      0, 1, 3,
      1, 2, 3,
      2, 0, 3,
    ]),
    elementIds: Uint32Array.from([1, 1, 1, 1]),
    color: [1, 0, 0],
    matched: true,
    diffStatus: "different",
  };
}

test("replaces a direct IFC ramp body only after semantic and six-face extent parity", () => {
  const repaired = applyIfcReferenceRepairs(
    tetrahedronRampModel(),
    [tetrahedronRampReference()],
    { completeRampAggregateElementIds: Uint32Array.from([1]) },
  );
  assert.deepEqual([...repaired.referenceAssistedElementIds!], [1]);
  assert.deepEqual([...repaired.referenceAssistedCompleteRampAggregateIds!], [1]);
  assert.deepEqual([...repaired.referenceAssistedRetainedRampAggregateIds!], []);
  assert.equal(repaired.elementBounds[0]!.renderGeometryProvenance, "reference-assisted");
  assert.match(repaired.warnings.at(-1) ?? "", /semantic completeness and six-face extent parity/);
});

test("retains a semantically direct ramp body when one aggregate extent is short", () => {
  const retained = applyIfcReferenceRepairs(
    tetrahedronRampModel(),
    [tetrahedronRampReference(0.8)],
    { completeRampAggregateElementIds: Uint32Array.from([1]) },
  );
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRampAggregateIds!], [1]);
});

test("extent parity alone cannot certify an IFC ramp aggregate", () => {
  const retained = applyIfcReferenceRepairs(
    tetrahedronRampModel(),
    [tetrahedronRampReference()],
  );
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRampAggregateIds!], [1]);
});

test("reports a retained ramp aggregate when other IFC repairs are applied", () => {
  const original = model();
  original.elementBounds[1]!.categoryName = "Ramps";
  const reference: ReferenceMeshData = {
    name: "roof repair plus partial ramp",
    positions: Float32Array.from([
      11 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      12 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      11 / 3.280839895, 23 / 3.280839895, 33 / 3.280839895,
      12 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      13 / 3.280839895, 22 / 3.280839895, 33 / 3.280839895,
      12 / 3.280839895, 23 / 3.280839895, 33 / 3.280839895,
    ]),
    indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    elementIds: Uint32Array.from([1, 2]),
    color: [1, 0, 0],
    matched: true,
    diffStatus: "different",
  };
  const repaired = applyIfcReferenceRepairs(original, [reference]);
  assert.deepEqual([...repaired.referenceAssistedElementIds!], [1]);
  assert.match(repaired.warnings.at(-1) ?? "", /ramp aggregate retained from RVT/);
});

function tetrahedronRoofModel(): ConvertResult {
  const original = tetrahedronRampModel();
  original.elementBounds[0]!.categoryId = -2_000_035;
  original.elementBounds[0]!.categoryName = "Roofs";
  return original;
}

test("replaces a roof only after direct IfcRoof identity, shape, and extent gates", () => {
  const repaired = applyIfcReferenceRepairs(
    tetrahedronRoofModel(),
    [tetrahedronRampReference()],
    {
      directRoofGeometryElementIds: Uint32Array.from([1]),
      shapeDifferentElementIds: Uint32Array.from([1]),
    },
  );
  assert.deepEqual([...repaired.referenceAssistedElementIds!], [1]);
  assert.deepEqual([...repaired.referenceAssistedCompleteRoofIds!], [1]);
  assert.deepEqual([...repaired.referenceAssistedRetainedRoofIds!], []);
  assert.equal(repaired.elementBounds[0]!.renderGeometryProvenance, "reference-assisted");
  assert.match(repaired.warnings.at(-1) ?? "", /direct tagged IfcRoof body/);

  const exported = elementManifest(repaired).find(
    (element) => element.elementId === 1,
  )!;
  assert.equal(exported.geometry.source, "paired-ifc-tessellation");
  assert.equal(exported.geometry.finalProvenance, "reference-assisted");
});

test("a numeric roof tag without direct IfcRoof identity is retained", () => {
  const retained = applyIfcReferenceRepairs(
    tetrahedronRoofModel(),
    [tetrahedronRampReference()],
    { shapeDifferentElementIds: Uint32Array.from([1]) },
  );
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRoofIds!], [1]);
  assert.equal(retained.elementBounds[0]!.renderGeometryProvenance, undefined);
});

test("a direct bounds-aligned IfcRoof without a confirmed shape difference is retained", () => {
  const retained = applyIfcReferenceRepairs(
    tetrahedronRoofModel(),
    [tetrahedronRampReference()],
    { directRoofGeometryElementIds: Uint32Array.from([1]) },
  );
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRoofIds!], [1]);
});

test("a direct shape-different IfcRoof outside tight six-face parity is retained", () => {
  const retained = applyIfcReferenceRepairs(
    tetrahedronRoofModel(),
    [tetrahedronRampReference(0.8)],
    {
      directRoofGeometryElementIds: Uint32Array.from([1]),
      shapeDifferentElementIds: Uint32Array.from([1]),
    },
  );
  assert.equal(retained.referenceAssistedElementIds, undefined);
  assert.deepEqual([...retained.referenceAssistedRetainedRoofIds!], [1]);
});

test("an incomplete rendered roof may use matching persisted native bounds", () => {
  const original = tetrahedronRoofModel();
  original.meshes[0]!.positions[3] = 0.8;
  original.elementBounds[0]!.boundsFeet = {
    min: { x: 10, y: 20, z: 30 },
    max: { x: 11, y: 21, z: 31 },
  };
  const repaired = applyIfcReferenceRepairs(
    original,
    [tetrahedronRampReference()],
    {
      directRoofGeometryElementIds: Uint32Array.from([1]),
      shapeDifferentElementIds: Uint32Array.from([1]),
    },
  );
  assert.deepEqual([...repaired.referenceAssistedCompleteRoofIds!], [1]);
  assert.equal(repaired.elementBounds[0]!.renderGeometryProvenance, "reference-assisted");
});

test("the strict roof gate rejects missing, degenerate, and mismatched evidence", () => {
  const summary = {
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    },
    triangles: 4,
  };
  assert.equal(hasCompleteRoofReference(summary, summary, true, true), true);
  assert.equal(hasCompleteRoofReference(summary, summary, false, true), false);
  assert.equal(hasCompleteRoofReference(summary, summary, true, false), false);
  assert.equal(hasCompleteRoofReference(undefined, summary, true, true), false);
  assert.equal(hasCompleteRoofReference(
    undefined,
    summary,
    true,
    true,
    0.05,
    summary.bounds,
  ), true);
  assert.equal(hasCompleteRoofReference(
    undefined,
    summary,
    false,
    true,
    0.05,
    summary.bounds,
  ), false);
  assert.equal(hasCompleteRoofReference(
    summary,
    {
      bounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0.9, y: 1, z: 1 },
      },
      triangles: 4,
    },
    true,
    true,
  ), false);
});
