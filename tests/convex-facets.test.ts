import assert from "node:assert/strict";
import test from "node:test";

import { convexFacetMesh } from "../lib/reviter/convex-facets.ts";
import type { PlanePatch, Vector3 } from "../lib/reviter/surfaces.ts";

function plane(
  offset: number,
  origin: Vector3,
  uDir: Vector3,
  vDir: Vector3,
  uMin: number,
  vMin: number,
  uMax: number,
  vMax: number,
): PlanePatch {
  return { kind: "plane", offset, origin, uDir, vDir, uMin, vMin, uMax, vMax };
}

function boxPlanes(): PlanePatch[] {
  return [
    plane(1, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 0, 0, 2, 3),
    plane(2, { x: 4, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 0, 0, 2, 3),
    plane(3, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0, 0, 4, 3),
    plane(4, { x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 0, 0, 4, 3),
    plane(5, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0, 0, 4, 2),
    plane(6, { x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0, 0, 4, 2),
  ];
}

test("rebuilds a closed convex body from its persisted trimmed planes", () => {
  const mesh = convexFacetMesh(42, boxPlanes());
  assert.ok(mesh);
  assert.equal(mesh.elementId, 42);
  assert.equal(mesh.positions.length / 3, 8);
  assert.equal(mesh.indices.length / 3, 12);
  assert.equal(mesh.sourcePlaneOffsets.length, 12);
  assert.deepEqual([...new Set(mesh.sourcePlaneOffsets)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test("deduplicates repeated faces without duplicating triangles", () => {
  const source = boxPlanes();
  const mesh = convexFacetMesh(42, [...source, ...source]);
  assert.ok(mesh);
  assert.equal(mesh.indices.length / 3, 12);
});

test("declines an open face set", () => {
  assert.equal(convexFacetMesh(42, boxPlanes().slice(0, 5)), null);
});

test("declines a solid whose intersection leaves a persisted trim", () => {
  const source = boxPlanes();
  source[5] = { ...source[5]!, uMax: 1 };
  assert.equal(convexFacetMesh(42, source), null);
});

test("declines distinct coplanar regions until loop unioning is available", () => {
  const source = boxPlanes();
  source.push({ ...source[5]!, offset: 7, uMin: 1 });
  assert.equal(convexFacetMesh(42, source), null);
});
