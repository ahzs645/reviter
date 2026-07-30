import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNativeMaterialIndices,
  buildNativeMaterialPalette,
} from "../lib/reviter/material-palette.ts";
import type { LocatedNativeMaterialDefinition } from "../lib/reviter/types.ts";

function material(
  elementId: number,
  name: string,
  rgb?: [number, number, number],
): LocatedNativeMaterialDefinition {
  return {
    elementId,
    name,
    recordOffset: 0,
    objectLength: 1_400,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
    ...(rgb
      ? {
          appearance: {
            colorPacked: rgb[0] | (rgb[1] << 8) | (rgb[2] << 16),
            baseColorSrgb: rgb,
            colorFieldOffset: 401,
            evidence: "framed-material-color-packed-direct" as const,
          },
        }
      : {}),
    stream: "Partitions/1",
    chunkIndex: 0,
    storedOffset: 0,
  };
}

test("builds byte-exact Autodesk-style factors from native packed RVT colors", () => {
  const palette = buildNativeMaterialPalette([
    material(26, "Стекло", [0, 128, 192]),
    material(30_200, "Дверь - Каркас", [118, 70, 51]),
    material(99, "Unresolved"),
  ], [
    { elementId: 1, materialId: 26 },
    { elementId: 1, materialId: 26 },
    { elementId: 2, materialId: 26 },
  ]);

  assert.equal(palette.length, 2);
  assert.deepEqual(palette[0], {
    materialElementId: 26,
    material: {
      name: "Стекло",
      baseColorLinear: [0, 128 / 255, 192 / 255, 1],
      metallic: 0,
      roughness: 0.2,
      doubleSided: true,
      source: "rvt-material",
      assignedElements: 2,
    },
  });
  assert.deepEqual(
    palette.map((entry) => entry.materialElementId),
    [26, 30_200],
  );
});

test("applies native palette slots only to meshes with a resolved persisted id", () => {
  const meshes = [
    {
      name: "glass",
      positions: new Float32Array(),
      indices: new Uint32Array(),
      colors: new Float32Array(),
      materialIndex: 0,
      nativeMaterialElementId: 26,
    },
    {
      name: "unknown material",
      positions: new Float32Array(),
      indices: new Uint32Array(),
      colors: new Float32Array(),
      materialIndex: 0,
      nativeMaterialElementId: 99,
    },
    {
      name: "proxy",
      positions: new Float32Array(),
      indices: new Uint32Array(),
      colors: new Float32Array(),
      materialIndex: 4,
    },
  ];

  assert.equal(applyNativeMaterialIndices(meshes, new Map([[26, 12]])), 1);
  assert.deepEqual(meshes.map((mesh) => mesh.materialIndex), [12, 0, 4]);
});
