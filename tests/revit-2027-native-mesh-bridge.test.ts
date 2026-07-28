import assert from "node:assert/strict";
import test from "node:test";

import type { NeutralFaceMesh } from "../lib/reviter/brep-tessellator.ts";
import {
  buildRevit2027NativeMeshScene,
  certifyRevit2027DrawableFaceCoverage,
  createRevit2027NativeMeshCollector,
  type Revit2027NativeMeshCollection,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { REVIT_2027_FACE_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-face-static.ts";

function faceValue(surfaceToken: number, loopToken: number): unknown {
  return {
    surface: { token: surfaceToken },
    firstLoop: { token: loopToken },
    faceRegions: { entries: [] },
  };
}

function triangle(materialId: number | null = null): NeutralFaceMesh {
  return {
    brepId: "test",
    positions: Float64Array.from([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    normals: Float32Array.from([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    indices: Uint32Array.from([0, 1, 2]),
    groups: [{
      faceId: "face",
      indexOffset: 0,
      indexCount: 3,
      vertexOffset: 0,
      vertexCount: 3,
      materialId,
      sourceTransform: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      brepProvenance: { decoderId: "test" },
      faceProvenance: { decoderId: "test" },
    }],
  };
}

test("drawable coverage excludes zero-loop reference faces and fails closed on positive-loop issues", () => {
  const spans = [
    {
      propertyToken: 1,
      propertySourceClassSlot: REVIT_2027_FACE_SOURCE_CLASS_SLOT,
      value: faceValue(11, 21),
    },
    {
      propertyToken: 2,
      propertySourceClassSlot: REVIT_2027_FACE_SOURCE_CLASS_SLOT,
      value: faceValue(12, 0),
    },
  ];
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(spans, [{ faceToken: 1 }]),
    {
      complete: true,
      drawableFaces: 1,
      meshedDrawableFaces: 1,
      missingFaceTokens: [],
      code: "complete",
    },
  );
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(
      spans,
      [{ faceToken: 1 }],
      [{ issue: { code: "edge-link-mismatch", faceToken: 1 } }],
    ),
    {
      complete: false,
      drawableFaces: 1,
      meshedDrawableFaces: 0,
      missingFaceTokens: [1],
      code: "incomplete-drawable-faces",
    },
  );
  assert.equal(
    certifyRevit2027DrawableFaceCoverage(
      spans,
      [{ faceToken: 1 }],
      [{ issue: { code: "material-unresolved", faceToken: 1 } }],
    ).complete,
    true,
  );
});

test("collector is inert outside the Revit 2027 release gate", () => {
  const collector = createRevit2027NativeMeshCollector(2026);
  collector.scanPage(new Uint8Array(256));
  const state = collector.snapshot([10]);
  assert.equal(state.enabled, false);
  assert.equal(state.scannedFrames, 0);
  assert.equal(state.owners.size, 0);
  assert.equal(state.requestedOwnerDefinitions, 0);
});

test("collector reports an absent persisted placement owner without publishing geometry", () => {
  const state = createRevit2027NativeMeshCollector(2027).snapshot([
    10,
    10,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ]);
  assert.equal(state.requestedOwnerDefinitions, 1);
  assert.equal(state.completeRequestedOwners, 0);
  assert.equal(state.partialRequestedOwners, 1);
  assert.equal(state.requestedOwnerFailures, 1);
  assert.equal(state.owners.size, 0);
  assert.deepEqual(state.requestedOwnerFailureSamples, [{
    ownerElementId: 10,
    detail: "persisted placement geometry owner has no framed GRep definition",
  }]);
});

test("native scene places shared owners, recentres once, groups proven materials, and covers only admitted elements", () => {
  const collection: Revit2027NativeMeshCollection = {
    enabled: true,
    owners: new Map([
      [10, {
        ownerElementId: 10,
        faces: [{ faceToken: 1, mesh: triangle() }],
        triangles: 1,
      }],
      [20, {
        ownerElementId: 20,
        faces: [{ faceToken: 2, mesh: triangle(99) }],
        triangles: 1,
      }],
    ]),
    scannedFrames: 2,
    eligibleRoots: 2,
    replayedOwners: 2,
    completeOwners: 2,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 2,
    storedBytes: 0,
    truncated: false,
    incompleteSamples: [],
    nestedDefinitions: 0,
    nestedLinks: 0,
    nestedRootOwners: 0,
    completeNestedRoots: 0,
    partialNestedRoots: 0,
    nestedTriangles: 0,
    nestedFailures: 0,
    nestedFailureSamples: [],
    requestedOwnerDefinitions: 0,
    completeRequestedOwners: 0,
    partialRequestedOwners: 0,
    requestedOwnerTriangles: 0,
    requestedOwnerFailures: 0,
    requestedOwnerFailureSamples: [],
  };
  const scene = buildRevit2027NativeMeshScene(
    collection,
    [{
      elementId: 30,
      geometryId: 20,
      symbolId: 20,
      basis: [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ],
      origin: [10, 20, 30],
    }],
    { x: 1, y: 2, z: 3 },
    {
      materialElementIds: new Set([99]),
      sharedOwnerIds: new Set([20]),
    },
  );
  assert.deepEqual([...scene.coveredElementIds].sort((a, b) => a - b), [10, 30]);
  assert.equal(scene.ownerElements, 1);
  assert.equal(scene.placedElements, 1);
  assert.equal(scene.triangles, 2);
  assert.equal(scene.meshes.length, 2);
  assert.deepEqual([...scene.meshes[0]!.positions.slice(0, 3)], [-1, -2, -3]);
  assert.deepEqual([...scene.meshes[1]!.positions.slice(0, 3)], [9, 18, 27]);
  assert.equal(scene.meshes[1]!.nativeMaterialElementId, 99);
  assert.deepEqual([...scene.meshes[1]!.elementIds!], [30]);
});

test("output cap declines an element atomically and leaves its proxy eligible", () => {
  const collection: Revit2027NativeMeshCollection = {
    enabled: true,
    owners: new Map([
      [10, {
        ownerElementId: 10,
        faces: [{ faceToken: 1, mesh: triangle() }],
        triangles: 1,
      }],
      [11, {
        ownerElementId: 11,
        faces: [{ faceToken: 2, mesh: triangle() }],
        triangles: 1,
      }],
    ]),
    scannedFrames: 2,
    eligibleRoots: 2,
    replayedOwners: 2,
    completeOwners: 2,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 2,
    storedBytes: 0,
    truncated: false,
    incompleteSamples: [],
    nestedDefinitions: 0,
    nestedLinks: 0,
    nestedRootOwners: 0,
    completeNestedRoots: 0,
    partialNestedRoots: 0,
    nestedTriangles: 0,
    nestedFailures: 0,
    nestedFailureSamples: [],
    requestedOwnerDefinitions: 0,
    completeRequestedOwners: 0,
    partialRequestedOwners: 0,
    requestedOwnerTriangles: 0,
    requestedOwnerFailures: 0,
    requestedOwnerFailureSamples: [],
  };
  const scene = buildRevit2027NativeMeshScene(
    collection,
    [],
    { x: 0, y: 0, z: 0 },
    { maxOutputTriangles: 1 },
  );
  assert.deepEqual([...scene.coveredElementIds], [10]);
  assert.equal(scene.triangles, 1);
  assert.equal(scene.truncated, true);
});

test("nested owner faces compose root-local transforms before scene placement and preserve materials", () => {
  const nestedTransform = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    5, 6, 7, 1,
  ] as const;
  const collection: Revit2027NativeMeshCollection = {
    enabled: true,
    owners: new Map([
      [40, {
        ownerElementId: 40,
        faces: [{
          faceToken: 3,
          mesh: triangle(99),
          nestedTransform,
        }],
        triangles: 1,
      }],
    ]),
    scannedFrames: 2,
    eligibleRoots: 1,
    replayedOwners: 2,
    completeOwners: 2,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 1,
    storedBytes: 0,
    truncated: false,
    incompleteSamples: [],
    nestedDefinitions: 2,
    nestedLinks: 1,
    nestedRootOwners: 1,
    completeNestedRoots: 1,
    partialNestedRoots: 0,
    nestedTriangles: 1,
    nestedFailures: 0,
    nestedFailureSamples: [],
    requestedOwnerDefinitions: 0,
    completeRequestedOwners: 0,
    partialRequestedOwners: 0,
    requestedOwnerTriangles: 0,
    requestedOwnerFailures: 0,
    requestedOwnerFailureSamples: [],
  };
  const scene = buildRevit2027NativeMeshScene(
    collection,
    [],
    { x: 1, y: 2, z: 3 },
    {
      materialElementIds: new Set([99]),
      expectedBoundsByElement: new Map([
        [40, {
          min: { x: 5, y: 6, z: 7 },
          max: { x: 6, y: 7, z: 7 },
        }],
      ]),
      boundsToleranceFeet: 0,
    },
  );
  assert.deepEqual([...scene.coveredElementIds], [40]);
  assert.deepEqual([...scene.meshes[0]!.positions.slice(0, 3)], [4, 4, 4]);
  assert.equal(scene.meshes[0]!.nativeMaterialElementId, 99);
});

test("independent RVT bounds reject mismatched direct and placed coordinates without suppressing proxies", () => {
  const collection: Revit2027NativeMeshCollection = {
    enabled: true,
    owners: new Map([
      [10, {
        ownerElementId: 10,
        faces: [{ faceToken: 1, mesh: triangle() }],
        triangles: 1,
      }],
      [20, {
        ownerElementId: 20,
        faces: [{ faceToken: 2, mesh: triangle() }],
        triangles: 1,
      }],
    ]),
    scannedFrames: 2,
    eligibleRoots: 2,
    replayedOwners: 2,
    completeOwners: 2,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: 2,
    storedBytes: 0,
    truncated: false,
    incompleteSamples: [],
    nestedDefinitions: 0,
    nestedLinks: 0,
    nestedRootOwners: 0,
    completeNestedRoots: 0,
    partialNestedRoots: 0,
    nestedTriangles: 0,
    nestedFailures: 0,
    nestedFailureSamples: [],
    requestedOwnerDefinitions: 0,
    completeRequestedOwners: 0,
    partialRequestedOwners: 0,
    requestedOwnerTriangles: 0,
    requestedOwnerFailures: 0,
    requestedOwnerFailureSamples: [],
  };
  const scene = buildRevit2027NativeMeshScene(
    collection,
    [{
      elementId: 30,
      geometryId: 20,
      basis: [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ],
      origin: [10, 20, 30],
    }],
    { x: 0, y: 0, z: 0 },
    {
      sharedOwnerIds: new Set([20]),
      expectedBoundsByElement: new Map([
        [10, {
          min: { x: 100, y: 100, z: 100 },
          max: { x: 101, y: 101, z: 101 },
        }],
        [30, {
          min: { x: -10, y: -10, z: -10 },
          max: { x: -9, y: -9, z: -9 },
        }],
      ]),
    },
  );
  assert.equal(scene.boundsMismatches, 2);
  assert.equal(scene.missingBounds, 0);
  assert.deepEqual([...scene.coveredElementIds], []);
  assert.equal(scene.meshes.length, 0);
  assert.deepEqual(
    scene.boundsMismatchSamples.map((sample) => ({
      elementId: sample.elementId,
      placed: sample.placed,
      code: sample.code,
    })),
    [
      { elementId: 10, placed: false, code: "bounds-mismatch" },
      { elementId: 30, placed: true, code: "bounds-mismatch" },
    ],
  );
});
