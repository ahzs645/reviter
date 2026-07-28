import assert from "node:assert/strict";
import test from "node:test";

import { makeReport } from "../lib/reviter/export-report.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

function resultWithOwnership(): ConvertResult {
  return {
    ok: true,
    fileName: "ownership.rvt",
    byteLength: 1_024,
    meshes: [],
    materials: [],
    segments: [],
    elementBounds: [],
    nativeProfiles: [],
    elementOwnership: {
      format: "revit-2024-2027-elem-table",
      declaredRecordCount: 4,
      decodedRecordCount: 3,
      skippedLeadingRecordCount: 1,
      rootRecordCount: 1,
      selfOwnedRecordCount: 0,
      danglingOwnerCount: 0,
      records: [
        { elementId: 100, owningElementId: null, byteOffset: 34 },
        { elementId: 101, owningElementId: 100, byteOffset: 74 },
        { elementId: 102, owningElementId: 100, byteOffset: 114 },
      ],
      relations: [
        {
          ownerId: 100,
          elementId: 101,
          kind: "owning-element",
          source: "Global/ElemTable.OwningElementId",
          evidence: "persisted",
        },
        {
          ownerId: 100,
          elementId: 102,
          kind: "owning-element",
          source: "Global/ElemTable.OwningElementId",
          evidence: "persisted",
        },
      ],
    },
    nativeIdentity: {
      format: "revit-2027-native-identity",
      declaredRecordCount: 4,
      decodedIdentityCount: 3,
      skippedLeadingRecordCount: 1,
      identities: [100, 101, 102].map((elementId, index) => ({
        elementId,
        originalElementId: elementId,
        creationEpisodeId: 0,
        lastModificationEpisodeId: 1,
        lastUserModificationEpisodeId: null,
        episodeGuid: "11223344-5566-7788-99aa-bbccddeeff00",
        uniqueId:
          `11223344-5566-7788-99aa-bbccddeeff00-${elementId.toString(16).padStart(8, "0")}`,
        byteOffset: 34 + index * 40,
        provenance: "Global/ElemTable.ElementHistory+Global/History.Episode" as const,
      })),
    },
    nativeMaterialDefinitions: [{
      elementId: 100,
      name: "Concrete",
      recordOffset: 12,
      objectLength: 96,
      objectMarker: 0x0ad3,
      evidence: "framed-material-element-name",
      stream: "Partitions/1",
      chunkIndex: 2,
      storedOffset: 65_249,
    }],
    decoderCoverage: {
      revitVersion: 2027,
      activeDecoders: ["revit-2024-2027-elem-table-ownership-v1"],
      nativeCurves: 0,
      nativeProfiles: 0,
      nativeMeshes: 0,
      nativeMaterialDefinitions: 1,
      nativeMaterialAssignments: 0,
      nativeUniqueIds: 3,
      nativeOwnershipRecords: 3,
      nativeOwnershipRelations: 2,
      approximateSolids: 0,
      nativeCategorisedElements: 0,
      geometryFidelity: "diagnostic-only",
      materialFidelity: "native-definitions-unassigned",
      semanticFidelity: "native-ownership",
    },
    origin: { x: 0, y: 0, z: 0 },
    bbox: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    },
    levels: [],
    stats: {
      streamCount: 1,
      partitionStreams: 0,
      gzipChunks: 1,
      inflatedBytes: 1,
      candidatesFound: 0,
      candidatesFocused: 0,
      candidatesUsed: 0,
      vertexCount: 0,
      triangleCount: 0,
      meshCount: 0,
      boundsRecordsFound: 0,
      solidBoundsRecords: 0,
      durationMs: 1,
    },
    warnings: [],
    method: "partition-coordinate-recovery",
  };
}

test("semantic report carries persisted model-tree nodes and fidelity counts", () => {
  const report = JSON.parse(makeReport(resultWithOwnership(), null));
  assert.equal(report.fidelity.modelTree, "native-revit-owning-element");
  assert.equal(report.fidelity.modelTreeRecords, 3);
  assert.equal(report.fidelity.modelTreeMemberships, 2);
  assert.deepEqual(report.modelTree, {
    evidence: "persisted",
    source: "Global/ElemTable.OwningElementId",
    format: "revit-2024-2027-elem-table",
    declaredRecordCount: 4,
    recordCount: 3,
    membershipCount: 2,
    rootRecordCount: 1,
    selfOwnedRecordCount: 0,
    danglingOwnerCount: 0,
    elements: [
      {
        elementId: 100,
        owningElementId: null,
        byteOffset: 34,
        uniqueId: "11223344-5566-7788-99aa-bbccddeeff00-00000064",
      },
      {
        elementId: 101,
        owningElementId: 100,
        byteOffset: 74,
        uniqueId: "11223344-5566-7788-99aa-bbccddeeff00-00000065",
      },
      {
        elementId: 102,
        owningElementId: 100,
        byteOffset: 114,
        uniqueId: "11223344-5566-7788-99aa-bbccddeeff00-00000066",
      },
    ],
  });
  assert.equal(
    report.elementManifest.unavailableFields.includes("model-tree hierarchy"),
    false,
  );
  assert.equal(
    report.elementManifest.unavailableFields.includes("Revit UniqueId"),
    false,
  );
  assert.equal(report.fidelity.nativeUniqueIds, 3);
  assert.deepEqual(report.nativeMaterialDefinitions, [{
    elementId: 100,
    name: "Concrete",
    recordOffset: 12,
    objectLength: 96,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
    stream: "Partitions/1",
    chunkIndex: 2,
    storedOffset: 65_249,
  }]);
});
