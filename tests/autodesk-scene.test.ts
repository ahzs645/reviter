import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  batchAutodeskScene,
  setAutodeskLineVisibility,
  type AutodeskSceneBatchStats,
} from "../app/studio/autodesk-scene.ts";
import { applyExplode, collectExplodeParts } from "../app/studio/scene-tools.ts";

test("batches static meshes by material and merges line segments", () => {
  const root = new THREE.Group();
  root.name = "Reference";
  root.position.set(10, 0, 0);
  const nested = new THREE.Group();
  nested.position.set(0, 4, 0);
  root.add(nested);

  const opaque = new THREE.MeshStandardMaterial({ name: "Opaque" });
  const glass = new THREE.MeshStandardMaterial({
    name: "Glass",
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const lineMaterial = new THREE.LineBasicMaterial({ name: "Edges" });
  const sharedBox = new THREE.BoxGeometry(2, 2, 2);
  const glassGeometry = new THREE.BoxGeometry(1, 1, 1);
  const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
  ]);

  const first = new THREE.Mesh(sharedBox, opaque);
  first.position.set(1, 0, 0);
  const second = new THREE.Mesh(sharedBox, opaque);
  second.position.set(3, 0, 0);
  const pane = new THREE.Mesh(glassGeometry, glass);
  pane.position.set(0, 2, 0);
  const firstLine = new THREE.LineSegments(lineGeometry, lineMaterial);
  const secondLine = new THREE.LineSegments(lineGeometry, lineMaterial);
  secondLine.position.set(0, 0, 2);
  nested.add(first, second, pane, firstLine, secondLine);

  let sourceGeometryDisposals = 0;
  let materialDisposals = 0;
  for (const geometry of [sharedBox, glassGeometry, lineGeometry]) {
    geometry.addEventListener("dispose", () => {
      sourceGeometryDisposals += 1;
    });
  }
  for (const material of [opaque, glass, lineMaterial]) {
    material.addEventListener("dispose", () => {
      materialDisposals += 1;
    });
  }

  const batched = batchAutodeskScene(root);
  const stats = batched.userData.batchStats as AutodeskSceneBatchStats;
  assert.deepEqual(stats, {
    sourceTriangleMeshes: 3,
    sourceLineSegments: 2,
    triangleBatches: 2,
    lineBatches: 1,
    triangleInstances: 3,
    mirroredTriangleInstances: 0,
    copiedGeometryVariants: 2,
    disposedSourceGeometries: 3,
    retainedMaterials: 3,
  });
  assert.equal(root.children.length, 0);
  assert.equal(sourceGeometryDisposals, 3);
  assert.equal(materialDisposals, 0);
  assert.equal(batched.matrixAutoUpdate, false);
  assert.equal(batched.matrix.elements[12], 10);

  const batches = batched.children.filter(
    (object): object is THREE.BatchedMesh => (object as THREE.BatchedMesh).isBatchedMesh,
  );
  assert.equal(batches.length, 2);
  const opaqueBatch = batches.find((batch) => batch.material === opaque)!;
  const glassBatch = batches.find((batch) => batch.material === glass)!;
  assert.equal(opaqueBatch.instanceCount, 2);
  assert.equal(glassBatch.instanceCount, 1);
  assert.equal(glassBatch.sortObjects, true);
  assert.equal(glassBatch.perObjectFrustumCulled, true);
  assert.equal(glassBatch.castShadow, false);
  assert.equal(glassBatch.receiveShadow, false);

  const instanceMatrix = opaqueBatch.getMatrixAt(0, new THREE.Matrix4());
  const translatedOrigin = new THREE.Vector3().applyMatrix4(instanceMatrix);
  assert.deepEqual(translatedOrigin.toArray(), [1, 4, 0]);

  const mergedLines = batched.children.find(
    (object): object is THREE.LineSegments => (object as THREE.LineSegments).isLineSegments,
  )!;
  assert.equal(mergedLines.material, lineMaterial);
  assert.equal(mergedLines.geometry.getAttribute("position").count, 4);
  mergedLines.geometry.computeBoundingBox();
  assert.deepEqual(mergedLines.geometry.boundingBox?.min.toArray(), [0, 4, 0]);
  assert.deepEqual(mergedLines.geometry.boundingBox?.max.toArray(), [1, 4, 2]);
  setAutodeskLineVisibility(batched, false);
  assert.equal(mergedLines.visible, false);
  setAutodeskLineVisibility(batched, true);
  assert.equal(mergedLines.visible, true);
});

test("bakes mirrored mesh transforms into right-handed batch instances", () => {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ name: "Mirrored" });
  const geometry = new THREE.BoxGeometry(2, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(5, 0, 0);
  mesh.scale.set(-2, 1, 1);
  root.add(mesh);

  const batched = batchAutodeskScene(root);
  const batch = batched.children.find(
    (object): object is THREE.BatchedMesh => (object as THREE.BatchedMesh).isBatchedMesh,
  )!;
  const matrix = batch.getMatrixAt(0, new THREE.Matrix4());
  assert.ok(matrix.determinant() > 0);
  assert.equal(
    (batched.userData.batchStats as AutodeskSceneBatchStats).mirroredTriangleInstances,
    1,
  );
  assert.equal(batch.userData.geometryVariants, 1);
});

test("expands loader-provided InstancedMesh transforms into batch instances", () => {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ name: "Repeated" });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const instances = new THREE.InstancedMesh(geometry, material, 2);
  instances.position.set(3, 0, 0);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, 0));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
  root.add(instances);

  const batched = batchAutodeskScene(root);
  const batch = batched.children[0] as THREE.BatchedMesh;
  const stats = batched.userData.batchStats as AutodeskSceneBatchStats;
  assert.equal(stats.sourceTriangleMeshes, 1);
  assert.equal(stats.triangleInstances, 2);
  assert.equal(batch.instanceCount, 2);
  assert.deepEqual(
    new THREE.Vector3().applyMatrix4(batch.getMatrixAt(0, new THREE.Matrix4())).toArray(),
    [4, 0, 0],
  );
  assert.deepEqual(
    new THREE.Vector3().applyMatrix4(batch.getMatrixAt(1, new THREE.Matrix4())).toArray(),
    [5, 0, 0],
  );
});

test("explode preserves and restores individual Autodesk batch instances", () => {
  const root = new THREE.Group();
  const batch = new THREE.BatchedMesh(
    1,
    24,
    36,
    new THREE.MeshBasicMaterial(),
  );
  const geometryId = batch.addGeometry(new THREE.BoxGeometry(1, 1, 1));
  const batchId = batch.addInstance(geometryId);
  batch.setMatrixAt(batchId, new THREE.Matrix4().makeTranslation(10, 0, 0));
  root.add(batch);

  const parts = collectExplodeParts(root, new THREE.Vector3());
  assert.equal(parts.length, 1);
  applyExplode(parts, 1);
  assert.ok(batch.getMatrixAt(batchId, new THREE.Matrix4()).elements[12]! > 10);
  applyExplode(parts, 0);
  assert.equal(batch.getMatrixAt(batchId, new THREE.Matrix4()).elements[12], 10);
});
