import assert from "node:assert/strict";
import test from "node:test";

import { makeGlb } from "../lib/reviter/export-glb.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

function glbJson(glb: ArrayBuffer): Record<string, unknown> {
  const bytes = new Uint8Array(glb);
  const view = new DataView(glb);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  return JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim(),
  ) as Record<string, unknown>;
}

test("GLB primitives preserve an exact persisted face MaterialElem id as metadata", () => {
  const result = {
    fileName: "native-material.rvt",
    method: "partition-bounds-recovery",
    origin: { x: 0, y: 0, z: 0 },
    warnings: [],
    decoderCoverage: {},
    meshes: [{
      name: "Certified native BRep · Material 30200",
      positions: Float32Array.from([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]),
      indices: Uint32Array.from([0, 1, 2]),
      colors: Float32Array.from([
        1, 1, 1,
        1, 1, 1,
        1, 1, 1,
      ]),
      materialIndex: 0,
      nativeMaterialElementId: 30_200,
    }],
    materials: [{
      name: "Neutral fallback",
      baseColorLinear: [1, 1, 1, 1],
      metallic: 0,
      roughness: 1,
      doubleSided: true,
      source: "display-fallback",
      assignedElements: 0,
    }],
  } as unknown as ConvertResult;

  const document = glbJson(makeGlb(result));
  const meshes = document.meshes as Array<{
    primitives: Array<{ extras?: Record<string, unknown> }>;
  }>;
  assert.deepEqual(meshes[0]!.primitives[0]!.extras, {
    revitMaterialElementId: 30_200,
    evidence: "persisted-face-material",
  });
});
