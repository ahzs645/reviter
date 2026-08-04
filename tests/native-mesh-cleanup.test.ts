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

function boxTriangles(
  min: [number, number, number],
  max: [number, number, number],
): { positions: number[]; indices: number[] } {
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;
  return {
    positions: [
      minX, minY, minZ,
      maxX, minY, minZ,
      maxX, maxY, minZ,
      minX, maxY, minZ,
      minX, minY, maxZ,
      maxX, minY, maxZ,
      maxX, maxY, maxZ,
      minX, maxY, maxZ,
    ],
    indices: [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6,
      3, 0, 4, 3, 4, 7,
    ],
  };
}

test("the complete generic face batch beside a certified sloped wall is removed", () => {
  const preferred = mesh(
    "Compound wall body",
    [
      0, 0, 0,
      1, 0, 0,
      0, 10, 0,
      1, 10, 0,
      0, 10, 8,
      1, 10, 8,
    ],
    [
      0, 2, 3, 0, 3, 1,
      2, 4, 5, 2, 5, 3,
      0, 4, 2,
      1, 3, 5,
      0, 1, 5, 0, 5, 4,
    ],
    Array(8).fill(1845205),
    423,
  );
  const envelope = boxTriangles([0, -2, 0], [1, 12, 9]);
  // The in-bounds generic face is part of the same redundant batch. Keeping it
  // produces a stepped projection along the otherwise continuous raked top.
  const generic = mesh(
    "Default wall display faces",
    [
      ...envelope.positions,
      0.5, 2, 0,
      0.5, 5, 0,
      0.5, 5, 3,
    ],
    [...envelope.indices, 8, 9, 10],
    Array(13).fill(1845205),
    24,
  );
  const result = cleanNativeMeshScene([preferred, generic], {
    preferredMaterialIdsByElement: new Map([[1845205, new Set([423])]]),
    wallElementIds: new Set([1845205]),
  });

  assert.equal(result.redundantWallShellElements, 1);
  assert.equal(result.redundantWallShellTrianglesRemoved, 13);
  assert.equal(result.outputTriangles, 8);
  assert.equal(
    result.meshes.some((entry) => entry.nativeMaterialElementId === 24),
    false,
  );
});

test("an in-bounds generic fragment is removed without requiring AABB overhang", () => {
  const preferred = mesh(
    "Compound raked wall",
    [
      0, 0, 0,
      1, 0, 0,
      0, 10, 0,
      1, 10, 0,
      0, 10, 8,
      1, 10, 8,
    ],
    [
      0, 2, 3, 0, 3, 1,
      2, 4, 5, 2, 5, 3,
      0, 4, 2,
      1, 3, 5,
      0, 1, 5, 0, 5, 4,
    ],
    Array(8).fill(2165915),
    423,
  );
  const generic = mesh(
    "Default internal display face",
    [
      0.5, 2, 0,
      0.5, 5, 0,
      0.5, 5, 3,
    ],
    [0, 1, 2],
    [2165915],
    24,
  );

  const result = cleanNativeMeshScene([preferred, generic], {
    preferredMaterialIdsByElement: new Map([[2165915, new Set([423])]]),
    wallElementIds: new Set([2165915]),
  });
  assert.equal(result.redundantWallShellTrianglesRemoved, 1);
  assert.equal(result.outputTriangles, 8);
});

test("the envelope gate does not alter non-wall or ordinary rectangular bodies", () => {
  const body = boxTriangles([0, 0, 0], [1, 10, 8]);
  const envelope = boxTriangles([0, -2, 0], [1, 12, 9]);
  const run = (wallElementIds: ReadonlySet<number>) => cleanNativeMeshScene([
    mesh("Preferred rectangular body", body.positions, body.indices, Array(12).fill(900), 423),
    mesh("Generic envelope", envelope.positions, envelope.indices, Array(12).fill(900), 24),
  ], {
    preferredMaterialIdsByElement: new Map([[900, new Set([423])]]),
    wallElementIds,
  });

  assert.equal(run(new Set()).redundantWallShellTrianglesRemoved, 0);
  assert.equal(
    run(new Set([900])).redundantWallShellTrianglesRemoved,
    0,
    "a body without a sloped face is not sufficient evidence",
  );
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
