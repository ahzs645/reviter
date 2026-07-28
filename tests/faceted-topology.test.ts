import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFacetedTopologyFields,
  locateFacetedTopology8Body,
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

test("locates the corroborated selector-free FacetedTopology8 body", () => {
  const data = new Uint8Array(91);
  const view = new DataView(data.buffer);
  const start = 4;
  view.setInt32(start, 2, true);
  writeFloat32(view, start + 4, [0, 0, 0]);
  view.setInt32(start + 16, 1, true);
  writeFloat32(view, start + 20, [0, 0, 1]);
  view.setInt32(start + 32, 3, true);
  writeFloat32(view, start + 36, [0, 0, 0, 2, 0, 0, 0, 3, 0]);
  view.setInt32(start + 72, 1, true);
  [0, 1, 2].forEach((value, index) =>
    view.setUint16(start + 76 + index * 2, value, true),
  );
  view.setInt32(start + 82, 1, true);
  data[start + 86] = 5;

  const located = locateFacetedTopology8Body(data, start);
  assert.equal(located.ok, true);
  if (!located.ok) return;
  assert.equal(located.body.endOffset, 91);
  assert.equal(located.body.byteLength, 87);
  assert.equal(located.body.normalCount, 1);
  assert.equal(located.body.vertexCount, 3);
  assert.equal(located.body.triangleCount, 1);
  assert.equal(located.body.layout.normals?.binding, "per-face");

  const decoded = decodeFacetedTopologyFields(data, located.body.layout);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual([...decoded.mesh.positions], [0, 0, 0, 2, 0, 0, 0, 3, 0]);
  assert.deepEqual([...decoded.mesh.indices], [0, 1, 2]);
  assert.deepEqual([...decoded.mesh.normals!], [0, 0, 1]);
  assert.deepEqual([...decoded.mesh.edgeVisibility!], [5]);
});

test("FacetedTopology8 locator fails closed on unsupported mode and count mismatch", () => {
  const unsupported = new Uint8Array(20);
  new DataView(unsupported.buffer).setInt32(0, 3, true);
  assert.deepEqual(locateFacetedTopology8Body(unsupported, 0), {
    ok: false,
    error: "FacetedTopology8 normalsFlag is not the corroborated per-face mode 2",
  });

  const mismatch = new Uint8Array(87);
  const view = new DataView(mismatch.buffer);
  view.setInt32(0, 2, true);
  view.setInt32(16, 0, true);
  view.setInt32(20, 3, true);
  writeFloat32(view, 24, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  view.setInt32(60, 1, true);
  [0, 1, 2].forEach((value, index) =>
    view.setUint16(64 + index * 2, value, true),
  );
  view.setInt32(70, 1, true);
  mismatch[74] = 3;
  assert.deepEqual(locateFacetedTopology8Body(mismatch, 0), {
    ok: false,
    error: "FacetedTopology8 face-normal count does not match facet count",
  });
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
