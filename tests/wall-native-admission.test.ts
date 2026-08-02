import assert from "node:assert/strict";
import test from "node:test";

import { nativeWallProxyReplacementIds } from "../lib/reviter/wall-native-admission.ts";
import type { ElementBoundsRecord, MeshData } from "../lib/reviter/types.ts";

function boxMesh(boxes: Array<{ elementId: number; bounds: number[] }>): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  const elementIds: number[] = [];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  for (const { elementId, bounds } of boxes) {
    const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
    const offset = positions.length / 3;
    positions.push(
      minX!, minY!, minZ!, maxX!, minY!, minZ!,
      maxX!, maxY!, minZ!, minX!, maxY!, minZ!,
      minX!, minY!, maxZ!, maxX!, minY!, maxZ!,
      maxX!, maxY!, maxZ!, minX!, maxY!, maxZ!,
    );
    for (const face of faces) {
      indices.push(...face.map((index) => index + offset));
      elementIds.push(elementId);
    }
  }
  return {
    name: "native walls",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: new Float32Array(0),
    materialIndex: 0,
    elementIds: Uint32Array.from(elementIds),
    source: "native-brep",
  };
}

function wall(elementId: number, categoryId = -2_000_011): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/325",
    chunkIndex: 1,
    rawOffset: 0,
    recordOffset: 0,
    categoryId,
    boundsFeet: {
      min: { x: 0, y: -0.5, z: 0 },
      max: { x: 10, y: 0.5, z: 10 },
    },
    solid: {
      elementId,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 1,
    },
  };
}

test("prefers a centre-corroborating wall solid when the native plan span overfills it", () => {
  const mesh = boxMesh([
    { elementId: 1, bounds: [-0.4, -0.5, 0, 10.4, 0.5, 10] },
    { elementId: 2, bounds: [0.6, -0.5, 0, 11.4, 0.5, 10] },
    { elementId: 3, bounds: [0, -0.5, -0.4, 10, 0.5, 10.4] },
    { elementId: 4, bounds: [-0.4, -0.5, 0, 10.4, 0.5, 10] },
  ]);
  const replacements = nativeWallProxyReplacementIds(
    [mesh],
    { x: 0, y: 0, z: 0 },
    [wall(1), wall(2), wall(3), wall(4, -2_000_023)],
  );
  assert.deepEqual([...replacements], [1]);
});

test("checks the rendered proxy after hosted openings are cut", () => {
  const native = boxMesh([
    { elementId: 1, bounds: [-0.4, -0.5, 0, 10.4, 0.5, 10] },
  ]);
  const clippedProxy = boxMesh([
    { elementId: 1, bounds: [4, -0.5, 0, 10, 0.5, 10] },
  ]);
  const replacements = nativeWallProxyReplacementIds(
    [native],
    { x: 0, y: 0, z: 0 },
    [wall(1)],
    [clippedProxy],
  );
  assert.deepEqual([...replacements], []);
});
