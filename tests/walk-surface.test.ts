import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { WalkSurfaceIndex } from "../app/studio/walk-surface.ts";

function tread(height: number, z: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 0.18, 0.3);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(0, height - 0.09, z);
  mesh.updateMatrix();
  return mesh;
}

test("walk surface follows exact stair tread heights in both directions", () => {
  const index = new WalkSurfaceIndex({ cellSize: 0.5 });
  const stairs = [tread(0, 0), tread(0.18, 0.3), tread(0.36, 0.6)];
  for (const step of stairs) index.addGeometry(step.geometry, step.matrix);

  const query = { maxDrop: 3, maximumHeight: 0.6 };
  assert.ok(Math.abs(index.floorAt(new THREE.Vector3(0, 1.7, 0), query)! - 0) < 1e-6);
  assert.ok(Math.abs(index.floorAt(new THREE.Vector3(0, 1.88, 0.3), query)! - 0.18) < 1e-6);
  assert.ok(Math.abs(index.floorAt(new THREE.Vector3(0, 2.06, 0.6), query)! - 0.36) < 1e-6);
  assert.ok(Math.abs(index.floorAt(new THREE.Vector3(0, 1.88, 0.3), query)! - 0.18) < 1e-6);
});

test("walk surface rejects walls and surfaces above the step-up ceiling", () => {
  const index = new WalkSurfaceIndex({ cellSize: 0.5 });
  const floor = tread(0, 0);
  const upper = tread(3, 0);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 1));
  wall.updateMatrix();
  index.addGeometry(floor.geometry, floor.matrix);
  index.addGeometry(upper.geometry, upper.matrix);
  index.addGeometry(wall.geometry, wall.matrix);

  assert.ok(Math.abs(
    index.floorAt(new THREE.Vector3(0, 1.7, 0), { maxDrop: 3, maximumHeight: 0.5 })!,
  ) < 1e-6);
  assert.equal(
    index.floorAt(new THREE.Vector3(4, 1.7, 0), { maxDrop: 3, maximumHeight: 0.5 }),
    null,
  );
});
