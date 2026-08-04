import assert from "node:assert/strict";
import test from "node:test";

import {
  compareGlbs,
  compareVoxels,
  deriveRegistration,
  makeVoxelGrid,
  renderDiffSvg,
  residualVerticalBand,
  residualDisposition,
  surfaceOrientation,
} from "../scripts/glb-surface-diff.ts";
import * as THREE from "three";

function glb(
  document: Record<string, unknown>,
  chunks: readonly Uint8Array[],
): Uint8Array {
  const binaryLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const binary = new Uint8Array((binaryLength + 3) & ~3);
  let binaryOffset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, binaryOffset);
    binaryOffset += chunk.byteLength;
  }
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (encodedJson.byteLength + 3) & ~3;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binary.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return bytes;
}

function floatBytes(values: readonly number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(values).buffer);
}

function ushortBytes(values: readonly number[]): Uint8Array {
  return new Uint8Array(Uint16Array.from(values).buffer);
}

function instancingFixture(instanced: boolean): Uint8Array {
  const positions = floatBytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = ushortBytes([0, 1, 2]);
  const indexPadding = new Uint8Array(2);
  const translations = floatBytes([0, 0, 0, 10, 0, 0]);
  const nodes = instanced
    ? [{
        mesh: 0,
        extensions: {
          EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 2 } },
        },
      }]
    : [{ mesh: 0 }, { mesh: 0, translation: [10, 0, 0] }];
  return glb({
    asset: { version: "2.0" },
    buffers: [{ byteLength: positions.byteLength + indices.byteLength + 2 + translations.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength + indices.byteLength + 2,
        byteLength: translations.byteLength,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    scene: 0,
    extensionsUsed: instanced ? ["EXT_mesh_gpu_instancing"] : [],
  }, [positions, indices, indexPadding, translations]);
}

test("derives the feet-to-metre scale and centre registration from paired bounds", () => {
  const registration = deriveRegistration(
    { min: [-10, 0, -20], max: [10, 8, 20] },
    { min: [-3.048, -1.2192, -6.096], max: [3.048, 1.2192, 6.096] },
  );
  assert.ok(Math.abs(registration.scale - 0.3048) < 1e-12);
  assert.deepEqual(registration.sourceCenter, [0, 4, 0]);
  assert.deepEqual(registration.referenceCenter, [0, 0, 0]);
});

test("surface comparison tolerates adjacent voxels but reports real gaps both ways", () => {
  const grid = makeVoxelGrid({ min: [0, 0, 0], max: [10, 10, 10] }, 1);
  const index = (x: number, y: number, z: number) =>
    x + grid.size[0] * (y + grid.size[1] * z);
  const recovered = new Set([index(2, 2, 2), index(8, 8, 8)]);
  const reference = new Set([index(3, 2, 2), index(5, 5, 5)]);
  const diff = compareVoxels(recovered, reference, grid);
  assert.deepEqual(diff.recoveredOnly, [index(8, 8, 8)]);
  assert.deepEqual(diff.referenceOnly, [index(5, 5, 5)]);
  assert.equal(diff.recoveredCoverage, 0.5);
  assert.equal(diff.referenceCoverage, 0.5);
});

test("surface comparison expands EXT_mesh_gpu_instancing placements", () => {
  const report = compareGlbs(instancingFixture(false), instancingFixture(true), 0.25);
  assert.equal(report.diff.recoveredOnly.length, 0);
  assert.equal(report.diff.referenceOnly.length, 0);
  assert.equal(report.diff.recoveredCoverage, 1);
  assert.equal(report.diff.referenceCoverage, 1);
  assert.ok(
    report.referenceOnlyByMesh.some((entry) => entry.mesh === "Mesh 1 · instance 2"),
    "per-instance labels keep residuals attributable after shared geometry is expanded",
  );
});

test("visual diff uses unambiguous red RVT and grey reference layers", () => {
  const grid = makeVoxelGrid({ min: [0, 0, 0], max: [2, 2, 2] }, 1);
  const svg = renderDiffSvg({
    recoveredVoxels: 1,
    referenceVoxels: 1,
    recoveredOnly: [0],
    referenceOnly: [1],
    recoveredCoverage: 0,
    referenceCoverage: 0,
  }, grid);
  assert.match(svg, /#d62929/);
  assert.match(svg, /#8b9298/);
  assert.match(svg, /RVT-only surface/);
  assert.match(svg, /GLB-only surface/);
});

test("classifies signed Y-up surface orientations", () => {
  const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  assert.equal(
    surfaceOrientation(point(0, 0, 0), point(0, 0, 1), point(1, 0, 0)),
    "horizontalUp",
  );
  assert.equal(
    surfaceOrientation(point(0, 0, 0), point(1, 0, 0), point(0, 0, 1)),
    "horizontalDown",
  );
  assert.equal(
    surfaceOrientation(point(0, 0, 0), point(1, 0, 0), point(0, 1, 0)),
    "vertical",
  );
  assert.equal(
    surfaceOrientation(point(0, 0, 0), point(0, 1, 1), point(1, 0, 0)),
    "obliqueUp",
  );
});

test("retains certified native surfaces and closed stairs without hiding proxy residuals", () => {
  assert.equal(
    residualDisposition("Certified native BRep · Material 26 · 20", {
      alphaMode: "BLEND",
      pbrMetallicRoughness: { baseColorFactor: [0.1, 0.2, 0.3, 0.1] },
    }),
    "retainedNativeGlazingShell",
  );
  assert.equal(
    residualDisposition("Certified native BRep 4", {
      alphaMode: "OPAQUE",
      pbrMetallicRoughness: { baseColorFactor: [0.4, 0.4, 0.4, 1] },
    }),
    "retainedCertifiedNativeSurface",
  );
  assert.equal(
    residualDisposition("Stairs Runs 1"),
    "retainedClosedStairRun",
  );
  assert.equal(
    residualDisposition("Walls 1"),
    "review",
  );
});

test("distinguishes interior residuals from genuine top-edge residuals", () => {
  const mesh: { min: [number, number, number]; max: [number, number, number] } = {
    min: [0, 1, 0],
    max: [4, 5, 4],
  };
  assert.equal(
    residualVerticalBand(mesh, { min: [1, 2, 1], max: [3, 4, 3] }, 0.25),
    "interior",
  );
  assert.equal(
    residualVerticalBand(mesh, { min: [1, 4, 1], max: [3, 4.9, 3] }, 0.25),
    "top-edge",
  );
  assert.equal(residualVerticalBand(mesh, null, 0.25), "none");
});
