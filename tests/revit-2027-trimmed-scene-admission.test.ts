import assert from "node:assert/strict";
import test from "node:test";

import type { NeutralFaceMesh } from "../lib/reviter/brep-tessellator.ts";
import {
  buildRevit2027NativeMeshScene,
  type Revit2027NativeMeshCollection,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID } from "../lib/reviter/revit-2027-trimmed-owner-mesh.ts";
import { isNonSceneObjectDefinition } from "../lib/reviter/scene.ts";

function triangles(count: number, decoderId: string): NeutralFaceMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    positions.push(index, 0, 0, index + 1, 0, 0, index, 1, 0);
    indices.push(index * 3, index * 3 + 1, index * 3 + 2);
  }
  const provenance = { decoderId };
  return {
    brepId: decoderId,
    positions: Float64Array.from(positions),
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    groups: [{
      faceId: "face",
      indexOffset: 0,
      indexCount: indices.length,
      vertexOffset: 0,
      vertexCount: positions.length / 3,
      materialId: null,
      sourceTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      brepProvenance: provenance,
      faceProvenance: provenance,
    }],
  };
}

function collection(
  owners: readonly [number, number, string][],
): Revit2027NativeMeshCollection {
  return {
    enabled: true,
    reconstructedOwnerIds: new Set(),
    owners: new Map(owners.map(([ownerElementId, count, decoderId]) => [
      ownerElementId,
      {
        ownerElementId,
        faces: [{ faceToken: 1, mesh: triangles(count, decoderId) }],
        triangles: count,
      },
    ])),
    scannedFrames: owners.length,
    eligibleRoots: owners.length,
    boundedTessellatorCandidateRoots: 0,
    completeBoundedTessellatorRoots: 0,
    boundedTessellatorOwnerIds: new Set(),
    conditionedGeometryCandidateRoots: 0,
    completeConditionedGeometryRoots: 0,
    conditionedGeometryOwnerIds: new Set(),
    embeddedGeometryCandidateRoots: 0,
    completeEmbeddedGeometryRoots: 0,
    embeddedGeometryOwnerIds: new Set(),
    replayedOwners: owners.length,
    completeOwners: owners.length,
    incompleteOwners: 0,
    excludedNonTopologicalFaces: 0,
    failedOwners: 0,
    storedTriangles: owners.reduce((sum, [, count]) => sum + count, 0),
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
}

test("an over-budget scene admits trimmed-surface items after all others, smallest first", () => {
  const scene = buildRevit2027NativeMeshScene(
    collection([
      [10, 3, REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID],
      [11, 4, "revit-2027-planar-owner-mesh"],
      [12, 1, REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID],
      [13, 2, "revit-2027-cylinder-owner-mesh"],
    ]),
    [],
    { x: 0, y: 0, z: 0 },
    { maxOutputTriangles: 7 },
  );
  // The other paths' 6 triangles first, then the 1-triangle trimmed item.
  assert.deepEqual([...scene.coveredElementIds].sort((a, b) => a - b), [11, 12, 13]);
  assert.equal(scene.triangles, 7);
  assert.equal(scene.truncated, true);
});

test("a scene within budget keeps its arrival order and admits everything", () => {
  const scene = buildRevit2027NativeMeshScene(
    collection([
      [10, 3, REVIT_2027_TRIMMED_OWNER_MESH_DECODER_ID],
      [11, 4, "revit-2027-planar-owner-mesh"],
    ]),
    [],
    { x: 0, y: 0, z: 0 },
    { maxOutputTriangles: 7 },
  );
  assert.deepEqual([...scene.coveredElementIds], [10, 11]);
  assert.equal(scene.truncated, false);
});

test("a family document's solid forms are definitions, not scene elements", () => {
  const unnamed = { categoryId: undefined, categoryName: undefined };
  // ExtrusionElem, BlendElem, RevolutionElem, SweepElem, SweptBlendElem, GenSweep.
  for (const marker of [1728, 647, 3817, 4297, 4308, 648]) {
    assert.equal(isNonSceneObjectDefinition(unnamed, new Set([marker]), false), true);
  }
  // A named element or a placed instance is never overruled.
  assert.equal(
    isNonSceneObjectDefinition({ categoryId: -2000151, categoryName: "Generic Models" }, new Set([3817]), false),
    false,
  );
  assert.equal(isNonSceneObjectDefinition(unnamed, new Set([3817]), true), false);
  assert.equal(isNonSceneObjectDefinition(unnamed, new Set([2246]), false), false);
});
