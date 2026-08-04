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

function notchedWallPrism(
  minX: number,
  maxX: number,
  profile: readonly [number, number][],
): { positions: number[]; indices: number[] } {
  const positions = [minX, maxX].flatMap((x) =>
    profile.flatMap(([y, z]) => [x, y, z]));
  const count = profile.length;
  const indices: number[] = [];
  for (let index = 1; index < count - 1; index += 1) {
    indices.push(0, index + 1, index);
    indices.push(count, count + index, count + index + 1);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
  }
  return { positions, indices };
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

test("an overfilled rectangular wall keeps its compound body and removes its generic shell", () => {
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
  const wall = run(new Set([900]));
  assert.equal(wall.redundantWallShellElements, 1);
  assert.equal(wall.redundantWallShellTrianglesRemoved, 12);
  assert.equal(wall.outputTriangles, 12);
});

test("the rectangular wall gate preserves shells without material overfill", () => {
  const body = boxTriangles([0, 0, 0], [1, 10, 8]);
  const inset = boxTriangles([0.1, 0.1, 0.1], [0.9, 9.9, 7.9]);
  const result = cleanNativeMeshScene([
    mesh("Preferred rectangular body", body.positions, body.indices, Array(12).fill(901), 423),
    mesh("In-bounds second material", inset.positions, inset.indices, Array(12).fill(901), 24),
  ], {
    preferredMaterialIdsByElement: new Map([[901, new Set([423])]]),
    wallElementIds: new Set([901]),
  });

  assert.equal(result.redundantWallShellTrianglesRemoved, 0);
  assert.equal(result.outputTriangles, 24);
  assert.equal(
    result.meshes.some((entry) => entry.nativeMaterialElementId === 24),
    true,
  );
});

test("the rectangular wall gate preserves a generic lower continuation", () => {
  const upperBody = boxTriangles([0, 0, 7], [1, 10, 14]);
  const completeBody = boxTriangles([0, 0, 0], [1, 10, 14]);
  const result = cleanNativeMeshScene([
    mesh("Preferred upper compound body", upperBody.positions, upperBody.indices, Array(12).fill(902), 423),
    mesh("Generic lower continuation", completeBody.positions, completeBody.indices, Array(12).fill(902), 24),
  ], {
    preferredMaterialIdsByElement: new Map([[902, new Set([423])]]),
    wallElementIds: new Set([902]),
  });

  assert.equal(result.redundantWallShellTrianglesRemoved, 0);
  assert.equal(result.outputTriangles, 22);
  assert.equal(
    result.meshes.some((entry) => entry.nativeMaterialElementId === 24),
    true,
  );
});

test("wall 883117 removes the half-thickness joined-end display shell", () => {
  const preferred = notchedWallPrism(
    -5.494807720184326,
    -5.101106643676758,
    [
      [-138.1666717529297, 7.21784782409668],
      [-132.14076232910156, 7.21784782409668],
      [-132.14076232910156, 20.99737548828125],
      [-133.38746643066406, 20.99737548828125],
      [-133.38746643066406, 16.404197692871094],
      [-138.1666717529297, 16.404197692871094],
    ],
  );
  const genericBox = boxTriangles(
    [-5.494807720184326, -138.363525390625, 7.21784782409668],
    [-5.101106643676758, -132.45245361328125, 20.99737548828125],
  );
  // The source batch has 14 triangles. These two extra internal faces make the
  // fixture reproduce that topology without changing its measured bounds.
  const genericPositions = [
    ...genericBox.positions,
    -5.494807720184326, -137, 8,
    -5.494807720184326, -136, 8,
    -5.494807720184326, -136, 9,
    -5.494807720184326, -137, 9,
  ];
  const genericIndices = [
    ...genericBox.indices,
    8, 9, 10,
    8, 10, 11,
  ];
  const result = cleanNativeMeshScene([
    mesh(
      "Wall 883117 compound body",
      preferred.positions,
      preferred.indices,
      Array(preferred.indices.length / 3).fill(883117),
      423,
    ),
    mesh(
      "Wall 883117 default joined-end shell",
      genericPositions,
      genericIndices,
      Array(genericIndices.length / 3).fill(883117),
      24,
    ),
  ], {
    preferredMaterialIdsByElement: new Map([[883117, new Set([423])]]),
    wallElementIds: new Set([883117]),
  });

  assert.equal(preferred.indices.length / 3, 20);
  assert.equal(genericIndices.length / 3, 14);
  assert.equal(result.redundantWallShellElements, 1);
  assert.equal(result.redundantWallShellTrianglesRemoved, 14);
  assert.equal(result.outputTriangles, 20);
  assert.equal(
    result.meshes.some((entry) => entry.nativeMaterialElementId === 24),
    false,
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
