import assert from "node:assert/strict";
import test from "node:test";

import type { NeutralFaceMesh } from "../lib/reviter/brep-tessellator.ts";
import {
  buildRevit2027NativeMeshScene,
  certifyRevit2027DrawableFaceCoverage,
  createRevit2027NativeMeshCollector,
  decodedStairStringerIds,
  readRevit2027ConditionalStateCarrier,
  type Revit2027NativeMeshCollection,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { REVIT_2027_FACE_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-face-static.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import { REVIT_2027_BASE_RAILING_SYMBOL_MARKER } from "../lib/reviter/revit-2027-baluster-instances.ts";

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

function replaySpan(
  replayIndex: number,
  propertySourceClassSlot: number,
  parentReplayIndex: number | null,
  value: unknown,
): Revit2027GRepReplaySpan {
  return {
    replayIndex,
    queueSequence: replayIndex,
    ownerElementId: 10n,
    path: [replayIndex],
    parentPath: parentReplayIndex == null ? null : [parentReplayIndex],
    parentReplayIndex,
    propertyToken: replayIndex + 1,
    propertySourceClassSlot,
    descriptorOffset: 0,
    descriptorEndOffset: 0,
    startOffset: 0,
    endOffset: 0,
    readerId: "test",
    value,
  };
}

test("conditional sibling reconstruction is scoped to decoded stair stringers", () => {
  const stringers = decodedStairStringerIds(new Map([
    [100, {
      elementId: 100,
      stairsId: 90,
      triserSymbolId: null,
      baseRiserIndex: 0,
      isMirrored: false,
      stringerIds: [101, 102],
      supportPathCurveLoops: {
        countOffset: 0,
        entriesOffset: 4,
        endOffset: 4,
        count: 0,
        entries: [],
      },
      supportExistenceStatus: [],
      objectOffset: 0,
      objectLength: 0,
      stairsIdOffset: 0,
      staticSuffixEndOffset: 0,
      runProperties: null,
    }],
  ]));
  assert.deepEqual([...stringers], [101, 102]);
  assert.equal(stringers.has(1850389), false, "a curtain panel cannot enter the stringer-only route");
});

function conditionalStateReplay(
  secondStateValue = 2,
): Revit2027GRepReplay {
  return {
    ownerElementId: 10n,
    startOffset: 0,
    endOffset: 0,
    initialTokenCount: 0,
    finalTokenCount: 0,
    descriptors: [],
    spans: [
      replaySpan(0, 2254, null, {}),
      replaySpan(1, 1973, null, {
        origin: [0, 0, 7],
        direction: [1, 0, 0],
      }),
      replaySpan(2, 2343, null, {}),
      replaySpan(3, 2271, 0, { coordinate: [3, 5, 11] }),
      replaySpan(4, 2271, 0, { coordinate: [1, 2, 4] }),
      replaySpan(5, 2238, 0, {
        compareMode: 3,
        parameter: 3,
        value: 1,
      }),
      replaySpan(6, 2238, 0, {
        compareMode: 3,
        parameter: 3,
        value: secondStateValue,
      }),
    ],
  };
}

test("conditional-state carrier recognizes only the complete paired-state schema", () => {
  assert.deepEqual(
    readRevit2027ConditionalStateCarrier(conditionalStateReplay()),
    {
      displacement: [2, 3, 7],
      lineOrigin: [0, 0, 7],
      lineDirection: [1, 0, 0],
    },
  );
  assert.equal(
    readRevit2027ConditionalStateCarrier(conditionalStateReplay(3)),
    null,
  );
});

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

test("collector admits a complete oversized alternate frame directly", () => {
  const objectLength = 70_000;
  const frame = new Uint8Array(objectLength + 20);
  const view = new DataView(frame.buffer);
  view.setUint32(0, 1856526, true);
  view.setUint32(4, 0, true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_BASE_RAILING_SYMBOL_MARKER, true);
  view.setUint32(18, 123, true);
  view.setUint32(objectLength + 16, objectLength, true);

  let providerCalls = 0;
  const collector = createRevit2027NativeMeshCollector(
    2027,
    {},
    (_data, decodedFrame) => {
      providerCalls += 1;
      assert.equal(decodedFrame.elementId, 1856526);
      assert.equal(decodedFrame.objectLength, objectLength);
      return { ok: true, value: null };
    },
  );
  collector.scanAlternateFrame(frame);
  assert.equal(providerCalls, 1);
  assert.equal(collector.snapshot().scannedFrames, 1);

  view.setUint32(objectLength + 16, objectLength - 1, true);
  collector.scanAlternateFrame(frame);
  assert.equal(providerCalls, 1, "a bad independent length echo fails closed");
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
    reconstructedOwnerIds: new Set([20]),
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
    boundedTessellatorCandidateRoots: 1,
    completeBoundedTessellatorRoots: 1,
    boundedTessellatorOwnerIds: new Set([10]),
    conditionedGeometryCandidateRoots: 1,
    completeConditionedGeometryRoots: 1,
    conditionedGeometryOwnerIds: new Set([10]),
    embeddedGeometryCandidateRoots: 0,
    completeEmbeddedGeometryRoots: 0,
    embeddedGeometryOwnerIds: new Set(),
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
  assert.deepEqual([...scene.reconstructedElementIds], [30]);
  assert.equal(scene.ownerElements, 1);
  assert.equal(scene.placedElements, 1);
  assert.equal(scene.boundedTessellatorElements, 1);
  assert.equal(scene.conditionedGeometryElements, 1);
  assert.equal(scene.embeddedGeometryElements, 0);
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
    reconstructedOwnerIds: new Set(),
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
    boundedTessellatorCandidateRoots: 2,
    completeBoundedTessellatorRoots: 2,
    boundedTessellatorOwnerIds: new Set([10, 11]),
    conditionedGeometryCandidateRoots: 0,
    completeConditionedGeometryRoots: 0,
    conditionedGeometryOwnerIds: new Set(),
    embeddedGeometryCandidateRoots: 1,
    completeEmbeddedGeometryRoots: 1,
    embeddedGeometryOwnerIds: new Set([10]),
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
  assert.equal(scene.boundedTessellatorElements, 1);
  assert.equal(scene.conditionedGeometryElements, 0);
  assert.equal(scene.embeddedGeometryElements, 1);
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
    reconstructedOwnerIds: new Set(),
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
    boundedTessellatorCandidateRoots: 1,
    completeBoundedTessellatorRoots: 1,
    boundedTessellatorOwnerIds: new Set([40]),
    conditionedGeometryCandidateRoots: 1,
    completeConditionedGeometryRoots: 1,
    conditionedGeometryOwnerIds: new Set([40]),
    embeddedGeometryCandidateRoots: 0,
    completeEmbeddedGeometryRoots: 0,
    embeddedGeometryOwnerIds: new Set(),
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
  assert.equal(scene.boundedTessellatorElements, 1);
  assert.equal(scene.conditionedGeometryElements, 1);
  assert.equal(scene.embeddedGeometryElements, 0);
  assert.deepEqual([...scene.meshes[0]!.positions.slice(0, 3)], [4, 4, 4]);
  assert.equal(scene.meshes[0]!.nativeMaterialElementId, 99);
});

test("independent RVT bounds reject mismatched direct and placed coordinates without suppressing proxies", () => {
  const collection: Revit2027NativeMeshCollection = {
    enabled: true,
    reconstructedOwnerIds: new Set(),
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
    boundedTessellatorCandidateRoots: 2,
    completeBoundedTessellatorRoots: 2,
    boundedTessellatorOwnerIds: new Set([10, 20]),
    conditionedGeometryCandidateRoots: 2,
    completeConditionedGeometryRoots: 2,
    conditionedGeometryOwnerIds: new Set([10, 20]),
    embeddedGeometryCandidateRoots: 2,
    completeEmbeddedGeometryRoots: 2,
    embeddedGeometryOwnerIds: new Set([10, 20]),
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
  assert.equal(scene.boundedTessellatorElements, 0);
  assert.equal(scene.conditionedGeometryElements, 0);
  assert.equal(scene.embeddedGeometryElements, 0);
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
