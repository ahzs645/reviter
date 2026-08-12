import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNativeMaterialIndices,
  buildNativeMaterialPalette,
} from "../lib/reviter/material-palette.ts";
import { decodeRvtMaterialDefinitions } from "../lib/reviter/native-decoder.ts";
import type { LocatedNativeMaterialDefinition } from "../lib/reviter/types.ts";

/**
 * The IEC 61966-2-1 sRGB electro-optical transfer function, restated here so the
 * expectation is independent of whatever the modules under test implement.
 */
function referenceSrgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

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

test("converts native packed RVT colors into linear-sRGB base colour factors", () => {
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
      baseColorLinear: [
        referenceSrgbToLinear(0),
        referenceSrgbToLinear(128 / 255),
        referenceSrgbToLinear(192 / 255),
        1,
      ],
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

/**
 * `MaterialData.baseColorLinear` reaches `THREE.Color.setRGB` (whose default
 * colour space is the linear-sRGB working space) and glTF `baseColorFactor`
 * (linear by specification). Both native producers append to the same
 * `ConvertResult.materials` array, so a byte that survives one path has to come
 * out identical on the other.
 */
test("both native material producers write linear-sRGB into baseColorLinear", () => {
  // 10 exercises the 12.92 linear segment below the 0.04045 knee, 128 the
  // power segment, and 0/255 the endpoints the two segments must both fix.
  const bytes: Array<[number, number, number]> = [
    [10, 128, 255],
    [0, 127, 192],
  ];

  for (const [red, green, blue] of bytes) {
    const packed = red | (green << 8) | (blue << 16);
    const expected = [
      referenceSrgbToLinear(red / 255),
      referenceSrgbToLinear(green / 255),
      referenceSrgbToLinear(blue / 255),
    ];

    const fromPalette = buildNativeMaterialPalette([
      material(26, "Palette entry", [red, green, blue]),
    ])[0]!.material.baseColorLinear;
    const fromDecoder = decodeRvtMaterialDefinitions([
      { name: "Reader entry", color_packed: packed },
    ])[0]!.baseColorLinear;

    assert.deepEqual(fromPalette.slice(0, 3), expected, `palette ${red},${green},${blue}`);
    assert.deepEqual(fromDecoder.slice(0, 3), expected, `decoder ${red},${green},${blue}`);
    assert.deepEqual(fromPalette, fromDecoder, `producers disagree on ${red},${green},${blue}`);
  }

  // A concrete anchor: mid-grey sRGB 128 is 0.2158605 linear, not 0.5019608.
  const midGrey = buildNativeMaterialPalette([
    material(26, "Mid grey", [128, 128, 128]),
  ])[0]!.material.baseColorLinear;
  assert.ok(
    Math.abs(midGrey[0] - 0.215_860_5) < 1e-6,
    `sRGB byte 128 must be 0.2158605 linear, got ${midGrey[0]}`,
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
