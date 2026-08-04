import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVoxels,
  deriveRegistration,
  makeVoxelGrid,
  renderDiffSvg,
  residualVerticalBand,
  residualDisposition,
  surfaceOrientation,
} from "../scripts/glb-surface-diff.ts";
import * as THREE from "three";

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
