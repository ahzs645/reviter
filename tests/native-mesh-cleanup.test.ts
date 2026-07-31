import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { cleanNativeMeshScene } from "../lib/reviter/native-mesh-cleanup.ts";
import type { MeshData } from "../lib/reviter/types.ts";

function mesh(
  name: string,
  positions: number[],
  indices: number[],
  elementIds: number[],
  materialId: number,
): MeshData {
  return {
    name,
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: Float32Array.from(
      Array.from({ length: positions.length / 3 }, () => [1, 1, 1]).flat(),
    ),
    materialIndex: 0,
    nativeMaterialElementId: materialId,
    elementIds: Uint32Array.from(elementIds),
    source: "native-brep",
  };
}

test("coincident wall triangles keep the persisted compound-layer material", () => {
  const triangle = [
    0, 0, 0,
    0, 4, 0,
    0, 0, 4,
  ];
  const result = cleanNativeMeshScene(
    [
      mesh("Default Wall", triangle, [0, 1, 2], [900], 24),
      mesh("Gypsum Wallboard", triangle, [2, 1, 0], [900], 423),
    ],
    {
      preferredMaterialIdsByElement: new Map([[900, new Set([423])]]),
    },
  );

  assert.equal(result.duplicateTrianglesRemoved, 1);
  assert.equal(result.crossMaterialDuplicateTrianglesRemoved, 1);
  assert.equal(result.outputTriangles, 1);
  assert.equal(result.meshes.length, 1);
  assert.equal(result.meshes[0]!.nativeMaterialElementId, 423);
});

test("a persisted hosted opening cuts both faces of a native wall", () => {
  const wall = mesh(
    "Wall 804162",
    [
      0, 0, 0,
      0, 10, 0,
      0, 10, 10,
      0, 0, 10,
      0.4, 0, 0,
      0.4, 10, 0,
      0.4, 10, 10,
      0.4, 0, 10,
    ],
    [
      0, 1, 2,
      0, 2, 3,
      4, 6, 5,
      4, 7, 6,
    ],
    [804162, 804162, 804162, 804162],
    423,
  );
  const result = cleanNativeMeshScene([wall], {
    hostedOpeningsByWall: new Map([[804162, [{
      min: { x: -1, y: 3, z: 0 },
      max: { x: 2, y: 7, z: 8 },
    }]]]),
  });

  assert.equal(result.hostTrianglesClipped, 4);
  assert.ok(result.outputTriangles > 0);
  const geometry = new THREE.BufferGeometry();
  for (const data of result.meshes) {
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  }
  const rendered = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  rendered.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const hitsAt = (y: number, z: number) => {
    ray.set(new THREE.Vector3(2, y, z), new THREE.Vector3(-1, 0, 0));
    return ray.intersectObject(rendered).length;
  };
  assert.equal(hitsAt(5, 4), 0, "the doorway is clear through both wall faces");
  assert.ok(hitsAt(1, 4) >= 2, "both wall faces remain beside the doorway");
  geometry.dispose();
  (rendered.material as THREE.Material).dispose();
});
