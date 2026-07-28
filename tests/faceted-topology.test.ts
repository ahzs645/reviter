import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFacetedTopologyFields,
  type FacetedTopologyFieldLayout,
} from "../lib/reviter/faceted-topology.ts";

function writeFloat32(view: DataView, offset: number, values: number[]): void {
  values.forEach((value, index) => view.setFloat32(offset + index * 4, value, true));
}

function writeFloat64(view: DataView, offset: number, values: number[]): void {
  values.forEach((value, index) => view.setFloat64(offset + index * 8, value, true));
}

test("decodes float64 points and int32 triangular facets", () => {
  const data = new Uint8Array(96);
  const view = new DataView(data.buffer);
  writeFloat64(view, 0, [0, 0, 0, 2, 0, 0, 0, 3, 0]);
  [0, 1, 2].forEach((value, index) => view.setInt32(72 + index * 4, value, true));

  const result = decodeFacetedTopologyFields(data, {
    vertexCount: 3,
    triangleCount: 1,
    points: { byteOffset: 0, encoding: "float64-le" },
    facets: { byteOffset: 72, encoding: "int32-le" },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.mesh.positions], [0, 0, 0, 2, 0, 0, 0, 3, 0]);
  assert.deepEqual([...result.mesh.indices], [0, 1, 2]);
  assert.equal(result.mesh.degenerateTriangles, 0);
});

test("applies offset-float storage, widens uint16 indices, and retains optional fields", () => {
  const data = new Uint8Array(96);
  const view = new DataView(data.buffer);
  writeFloat32(view, 0, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  [0, 1, 2].forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  writeFloat32(view, 48, [0, 0, 1]);
  data.set([1, 0, 1], 60);

  const result = decodeFacetedTopologyFields(data, {
    vertexCount: 3,
    triangleCount: 1,
    points: { byteOffset: 0, encoding: "float32-le" },
    pointOffset: [100, -20, 7],
    facets: { byteOffset: 36, encoding: "uint16-le" },
    normals: { byteOffset: 48, encoding: "float32-le", binding: "common" },
    edgeVisibility: { byteOffset: 60, byteCount: 3 },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    [...result.mesh.positions],
    [100, -20, 7, 101, -20, 7, 100, -19, 7],
  );
  assert.deepEqual([...result.mesh.indices], [0, 1, 2]);
  assert.deepEqual([...result.mesh.normals!], [0, 0, 1]);
  assert.equal(result.mesh.normalBinding, "common");
  assert.deepEqual([...result.mesh.edgeVisibility!], [1, 0, 1]);
  assert.equal(result.mesh.sourceStorage.pointOffsetApplied, true);
});

test("supports per-vertex normals and reports repeated-index triangles", () => {
  const data = new Uint8Array(128);
  const view = new DataView(data.buffer);
  writeFloat32(view, 0, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  [0, 1, 1].forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  writeFloat32(view, 48, [0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const result = decodeFacetedTopologyFields(data, {
    vertexCount: 3,
    triangleCount: 1,
    points: { byteOffset: 0, encoding: "float32-le" },
    facets: { byteOffset: 36, encoding: "uint16-le" },
    normals: { byteOffset: 48, encoding: "float32-le", binding: "per-vertex" },
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mesh.degenerateTriangles, 1);
});

test("rejects truncated, out-of-range, and non-finite fields without throwing", () => {
  const base: FacetedTopologyFieldLayout = {
    vertexCount: 3,
    triangleCount: 1,
    points: { byteOffset: 0, encoding: "float32-le" },
    facets: { byteOffset: 36, encoding: "uint16-le" },
  };

  assert.deepEqual(
    decodeFacetedTopologyFields(new Uint8Array(40), base),
    { ok: false, error: "facet field extends past the supplied bytes" },
  );

  const invalidIndex = new Uint8Array(48);
  const indexView = new DataView(invalidIndex.buffer);
  writeFloat32(indexView, 0, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  [0, 1, 3].forEach((value, index) => indexView.setUint16(36 + index * 2, value, true));
  assert.equal(decodeFacetedTopologyFields(invalidIndex, base).ok, false);

  const invalidPoint = new Uint8Array(48);
  const pointView = new DataView(invalidPoint.buffer);
  writeFloat32(pointView, 0, [0, 0, 0, 1, 0, 0, Number.NaN, 1, 0]);
  [0, 1, 2].forEach((value, index) => pointView.setUint16(36 + index * 2, value, true));
  assert.equal(decodeFacetedTopologyFields(invalidPoint, base).ok, false);

  const negativeIndex = new Uint8Array(96);
  const negativeView = new DataView(negativeIndex.buffer);
  writeFloat64(negativeView, 0, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  [0, 1, -1].forEach((value, index) => negativeView.setInt32(72 + index * 4, value, true));
  assert.equal(
    decodeFacetedTopologyFields(negativeIndex, {
      vertexCount: 3,
      triangleCount: 1,
      points: { byteOffset: 0, encoding: "float64-le" },
      facets: { byteOffset: 72, encoding: "int32-le" },
    }).ok,
    false,
  );
});

test("enforces allocation bounds before reading field data", () => {
  const result = decodeFacetedTopologyFields(
    new Uint8Array(0),
    {
      vertexCount: 1_001,
      triangleCount: 1,
      points: { byteOffset: 0, encoding: "float32-le" },
      facets: { byteOffset: 0, encoding: "uint16-le" },
    },
    { maxVertices: 1_000 },
  );
  assert.deepEqual(result, {
    ok: false,
    error: "vertexCount is outside the allowed range",
  });
});
