import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  connectedSurfaceFaceIndices,
  createElementSelection,
  createFaceSelection,
  elementIdAtIntersection,
  type ViewerIntersection,
} from "../app/studio/viewer-picking.ts";
import { batchReferenceScene } from "../app/studio/reference-scene.ts";

function floorAndWallGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, 0, -1,
    1, 0, -1,
    1, 0, 1,
    -1, 0, 1,
    1, 2, -1,
    1, 2, 1,
  ], 3));
  geometry.setIndex([
    0, 2, 1,
    0, 3, 2,
    1, 2, 4,
    2, 5, 4,
  ]);
  return geometry;
}

function intersection(
  object: THREE.Mesh,
  faceIndex: number,
  batchId?: number,
): ViewerIntersection {
  return {
    distance: 5,
    point: new THREE.Vector3(0, 0, 0),
    object,
    faceIndex,
    face: {
      a: 0,
      b: 2,
      c: 1,
      normal: new THREE.Vector3(0, 1, 0),
      materialIndex: 0,
    },
    ...(batchId == null ? {} : { batchId }),
  };
}

test("selection grows across a continuous face but stops at a hard edge", () => {
  const mesh = new THREE.Mesh(floorAndWallGeometry(), new THREE.MeshBasicMaterial());
  const hit = intersection(mesh, 0);
  assert.deepEqual(connectedSurfaceFaceIndices(hit).sort((a, b) => a - b), [0, 1]);

  const selection = createFaceSelection(
    hit,
    new THREE.PerspectiveCamera(45, 1, 0.1, 100),
    1,
  )!;
  assert.equal(selection.userData.triangleCount, 2);
  assert.equal(selection.userData.boundaryEdgeCount, 4);
  const outline = selection.children.find(
    (child): child is THREE.LineSegments => (child as THREE.LineSegments).isLineSegments,
  )!;
  assert.equal(outline.geometry.getAttribute("position").count, 8);
});

test("IFC triangle tags resolve to Revit ids while context zero stays anonymous", () => {
  const mesh = new THREE.Mesh(floorAndWallGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.elementIds = new Uint32Array([1845590, 0, 1460781, 318643]);
  assert.equal(elementIdAtIntersection(intersection(mesh, 0)), 1845590);
  assert.equal(elementIdAtIntersection(intersection(mesh, 1)), null);
  assert.equal(elementIdAtIntersection(undefined), null);
});

test("batched selection stays inside the picked instance geometry range", () => {
  const geometry = floorAndWallGeometry();
  const batch = new THREE.BatchedMesh(2, 12, 24, new THREE.MeshBasicMaterial());
  const firstGeometry = batch.addGeometry(geometry);
  const secondGeometry = batch.addGeometry(geometry);
  batch.addInstance(firstGeometry);
  const secondInstance = batch.addInstance(secondGeometry);
  batch.setMatrixAt(secondInstance, new THREE.Matrix4().makeTranslation(5, 0, 0));
  batch.updateMatrixWorld(true);
  const range = batch.getGeometryRangeAt(secondGeometry)!;
  const hit = intersection(batch, range.start / 3, secondInstance);
  const selection = createFaceSelection(
    hit,
    new THREE.PerspectiveCamera(45, 1, 0.1, 100),
    1,
  )!;
  assert.equal(selection.userData.triangleCount, 2);
  const fill = selection.children.find(
    (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh,
  )!;
  fill.geometry.computeBoundingBox();
  assert.equal(fill.geometry.boundingBox!.min.x, 4);
  assert.equal(fill.geometry.boundingBox!.max.x, 6);
  const throughMaterial = fill.material as THREE.MeshBasicMaterial;
  assert.equal(throughMaterial.depthTest, false);
  const outline = selection.children.find(
    (child): child is THREE.LineSegments => (child as THREE.LineSegments).isLineSegments,
  )!;
  assert.equal((outline.material as THREE.LineBasicMaterial).depthTest, false);
  batch.dispose();
});

test("Autodesk element selection collects every same-key material fragment", () => {
  const root = new THREE.Group();
  const first = new THREE.Mesh(
    floorAndWallGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x777777 }),
  );
  const second = new THREE.Mesh(
    floorAndWallGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x999999 }),
  );
  first.name = "stair-42";
  second.name = "stair-42";
  second.position.x = 5;
  root.add(first, second);
  const batched = batchReferenceScene(root);
  batched.updateMatrixWorld(true);
  const pickedBatch = batched.children.find(
    (child): child is THREE.BatchedMesh =>
      (child as THREE.BatchedMesh).isBatchedMesh
      && child.userData.elementKeys[0] === "stair-42",
  )!;
  const geometryId = pickedBatch.getGeometryIdAt(0);
  const range = pickedBatch.getGeometryRangeAt(geometryId)!;
  const selection = createElementSelection(
    intersection(pickedBatch, range.start / 3, 0),
    1,
  )!;

  assert.equal(selection.userData.scope, "element");
  assert.equal(selection.userData.elementKey, "stair-42");
  assert.equal(selection.userData.fragmentCount, 2);
  assert.equal(selection.userData.triangleCount, 8);
  const fill = selection.children.find(
    (child): child is THREE.Mesh => (child as THREE.Mesh).isMesh,
  )!;
  fill.geometry.computeBoundingBox();
  assert.ok(fill.geometry.boundingBox!.min.x < -0.99);
  assert.ok(fill.geometry.boundingBox!.max.x > 5.99);
});
