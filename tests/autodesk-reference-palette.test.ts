import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { AUTODESK_REFERENCE_GLB_PALETTE } from "../lib/reviter/autodesk-reference-palette.ts";

type GlbMaterial = {
  alphaMode?: "OPAQUE" | "BLEND";
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
};

function materialPaletteFromGlb(path: string) {
  const glb = readFileSync(path);
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "expected a glTF binary");
  assert.equal(view.getUint32(4, true), 2, "expected glTF 2.0");
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "expected a JSON first chunk");

  const jsonLength = view.getUint32(12, true);
  const jsonBytes = glb.subarray(20, 20 + jsonLength);
  const document = JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as {
    materials?: GlbMaterial[];
  };

  return (document.materials ?? []).map((material, materialIndex) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const baseColorFactor = pbr.baseColorFactor ?? [1, 1, 1, 1];

    return {
      materialIndex,
      rgbaBytes: baseColorFactor.map((channel) => Math.round(channel * 255)),
      baseColorFactor,
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      alphaMode: material.alphaMode ?? "OPAQUE",
    };
  });
}

test("saved Autodesk palette matches public/autodesk-reference.glb", () => {
  const glbPath = fileURLToPath(new URL("../public/autodesk-reference.glb", import.meta.url));
  const actual = materialPaletteFromGlb(glbPath);

  assert.equal(AUTODESK_REFERENCE_GLB_PALETTE.length, 22);
  assert.deepEqual(actual, AUTODESK_REFERENCE_GLB_PALETTE);
});
