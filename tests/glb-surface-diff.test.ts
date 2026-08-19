import assert from "node:assert/strict";
import test from "node:test";

import {
  attributeResidualComponentsToElements,
  compareGlbs,
  compareVoxels,
  deriveRegistration,
  localizedMissingHorizontalStairResiduals,
  localizedMissingVerticalStairResiduals,
  makeVoxelGrid,
  oversizedHorizontalUpResiduals,
  registeredRvtElementBounds,
  renderDiffSvg,
  residualVerticalBand,
  residualDisposition,
  surfaceOrientation,
} from "../scripts/glb-surface-diff.ts";
import { readIfcStairFlightCounts } from "../scripts/audit-stair-vertical-residuals.ts";
import { categoryDisplayName } from "../lib/reviter/native-categories.ts";
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
  assert.equal(report.referenceResidualClassification.missingVerticalStairRiser, 0);
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
  // Derived, not hard-coded: batch labels are `${categoryName} ${batch}`, and
  // pinning one spelling here is what let the disposition silently stop
  // matching when Revit's label for the stair-run category changed.
  assert.equal(
    residualDisposition(`${categoryDisplayName(-2_000_919)} 1`),
    "retainedClosedStairRun",
  );
  assert.equal(
    residualDisposition("Walls 1"),
    "review",
  );
});

test("oversized horizontal stair bands remain actionable diff residuals", () => {
  const grid = {
    cellMetres: 0.25,
    min: [0, 0, 0] as [number, number, number],
    size: [12, 2, 12] as [number, number, number],
  };
  const index = (x: number, z: number) => x + grid.size[0] * grid.size[1] * z;
  const ordinary = Array.from({ length: 16 }, (_, value) =>
    index(value % 4, Math.floor(value / 4))
  );
  const fan = Array.from({ length: 81 }, (_, value) =>
    index(2 + value % 9, 2 + Math.floor(value / 9))
  );
  assert.equal(oversizedHorizontalUpResiduals(ordinary, grid).size, 0);
  assert.equal(oversizedHorizontalUpResiduals(fan, grid).size, 81);
});

test("finds localized GLB-only stair holes even when the recovered outer bounds match", () => {
  const grid = {
    cellMetres: 0.25,
    min: [0, 0, 0] as [number, number, number],
    size: [24, 4, 24] as [number, number, number],
  };
  const index = (x: number, y: number, z: number) =>
    x + grid.size[0] * (y + grid.size[1] * z);
  const landing = Array.from({ length: 16 }, (_, value) =>
    index(1 + value % 4, 1, 1 + Math.floor(value / 4))
  );
  const sameSizeButOutside = Array.from({ length: 16 }, (_, value) =>
    index(16 + value % 4, 1, 16 + Math.floor(value / 4))
  );
  const matchingRecoveredStairEnvelope = [{
    min: [0.25, 0.25, 0.25] as [number, number, number],
    max: [1.25, 0.5, 1.25] as [number, number, number],
  }];

  const localized = localizedMissingHorizontalStairResiduals(
    [...landing, ...sameSizeButOutside],
    grid,
    matchingRecoveredStairEnvelope,
  );
  assert.deepEqual([...localized].sort((a, b) => a - b), landing.sort((a, b) => a - b));

  const samplingFleck = [index(2, 1, 2)];
  const broadFloor = Array.from({ length: 100 }, (_, value) =>
    index(1 + value % 10, 1, 1 + Math.floor(value / 10))
  );
  const broadEnvelope = [{
    min: [0, 0, 0] as [number, number, number],
    max: [6, 1, 6] as [number, number, number],
  }];
  assert.equal(
    localizedMissingHorizontalStairResiduals(samplingFleck, grid, broadEnvelope).size,
    0,
    "a single sampling cell is not enough evidence for a hole",
  );
  assert.equal(
    localizedMissingHorizontalStairResiduals(broadFloor, grid, broadEnvelope).size,
    0,
    "a broad floor or roof residual is not mislabelled as a stair landing",
  );
});

test("finds subdivided riser slits hidden by the one-cell neighbour tolerance", () => {
  const grid = {
    cellMetres: 0.25,
    min: [0, 0, 0] as [number, number, number],
    size: [24, 12, 24] as [number, number, number],
  };
  const index = (x: number, y: number, z: number) =>
    x + grid.size[0] * (y + grid.size[1] * z);
  // The GLB riser is split across two primitives/partial edges. The recovered
  // surface one cell behind it makes the ordinary ±1-cell audit call it equal.
  const firstPartialEdge = [index(3, 2, 4), index(4, 2, 4)];
  const secondPartialEdge = [index(5, 2, 4), index(6, 2, 4)];
  const referenceRiser = [...firstPartialEdge, ...secondPartialEdge];
  const recovered = new Set(referenceRiser.map((_, offset) => index(3 + offset, 2, 5)));
  const ordinary = compareVoxels(recovered, new Set(referenceRiser), grid);
  assert.equal(
    ordinary.referenceOnly.length,
    0,
    "the existing neighbour tolerance intentionally hides the one-cell slit",
  );

  const stairEnvelope = [{
    min: [0.5, 0.25, 0.75] as [number, number, number],
    max: [2, 1, 1.5] as [number, number, number],
  }];
  const localized = localizedMissingVerticalStairResiduals(
    referenceRiser,
    recovered,
    grid,
    stairEnvelope,
  );
  assert.deepEqual(
    [...localized].sort((a, b) => a - b),
    [...referenceRiser].sort((a, b) => a - b),
  );

  const oneCellNoise = [index(10, 2, 4)];
  const noiseNeighbour = new Set([index(10, 2, 5)]);
  assert.equal(
    localizedMissingVerticalStairResiduals(
      oneCellNoise,
      noiseNeighbour,
      grid,
      [{ min: [2, 0, 0.5], max: [3, 1, 1.5] }],
    ).size,
    0,
    "isolated one-cell registration noise is ignored",
  );

  const broadWall = Array.from({ length: 64 }, (_, value) =>
    index(2 + value % 8, 1 + Math.floor(value / 8), 12)
  );
  const broadWallNeighbours = new Set(broadWall.map((cell) => cell + grid.size[0] * grid.size[1]));
  assert.equal(
    localizedMissingVerticalStairResiduals(
      broadWall,
      broadWallNeighbours,
      grid,
      [{ min: [0, 0, 2.5], max: [4, 3, 3.5] }],
    ).size,
    0,
    "broad wall residuals exceed the conservative riser area limit",
  );

  const floorPatch = [
    index(2, 2, 2), index(3, 2, 2),
    index(2, 2, 3), index(3, 2, 3),
  ];
  const floorNeighbours = new Set(floorPatch.map((cell) => cell + grid.size[0]));
  assert.equal(
    localizedMissingVerticalStairResiduals(
      floorPatch,
      floorNeighbours,
      grid,
      [{ min: [0, 0, 0], max: [2, 1, 2] }],
    ).size,
    0,
    "a two-axis floor patch is not a thin vertical plane",
  );
});

test("attributes stair residuals to exact RVT elements rather than a category batch", () => {
  const registration = {
    scale: 0.5,
    sourceCenter: [0, 0, 0] as [number, number, number],
    referenceCenter: [10, 20, 30] as [number, number, number],
  };
  assert.deepEqual(
    registeredRvtElementBounds([2, 4, 6, 8, 10, 12], registration),
    { min: [11, 23, 25], max: [14, 26, 28] },
  );

  const grid = {
    cellMetres: 1,
    min: [0, 0, 0] as [number, number, number],
    size: [12, 4, 12] as [number, number, number],
  };
  const index = (x: number, y: number, z: number) =>
    x + grid.size[0] * (y + grid.size[1] * z);
  const first = [index(1, 1, 1), index(2, 1, 1)];
  const second = [index(7, 1, 7), index(8, 1, 7)];
  const crossing = [index(4, 1, 4), index(5, 1, 4)];
  const attributed = attributeResidualComponentsToElements(
    [...first, ...second, ...crossing],
    grid,
    [
      { elementId: 101, bounds: { min: [0, 0, 0], max: [3, 2, 3] } },
      { elementId: 202, bounds: { min: [7, 0, 7], max: [9, 2, 9] } },
    ],
  );
  assert.deepEqual(
    attributed.assignments.map(({ elementId, components, indices }) => ({
      elementId,
      components,
      voxels: indices.length,
    })),
    [
      { elementId: 101, components: 1, voxels: 2 },
      { elementId: 202, components: 1, voxels: 2 },
    ],
  );
  assert.deepEqual(attributed.unassignedIndices.sort((a, b) => a - b), crossing);
});

test("reads IFC stair-flight riser and tread counts by native Revit tag", () => {
  const counts = readIfcStairFlightCounts([
    "#10=IFCSTAIRFLIGHT('guid',#6,'Run',$,$,#1,#2,'1821222',32,31,0.45,0.98);",
    "#11=IFCSTAIRFLIGHT('guid2',#6,'Run',$,$,#1,#2,'1801503',8,7,1.23,0.98);",
    "#12=IFCWALL('guid3',#6,'Wall',$,$,#1,#2,'999');",
  ].join("\n"));
  assert.deepEqual(counts.get(1_821_222), { risers: 32, treads: 31 });
  assert.deepEqual(counts.get(1_801_503), { risers: 8, treads: 7 });
  assert.equal(counts.has(999), false);
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
