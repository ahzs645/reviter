import assert from "node:assert/strict";
import test from "node:test";

import { IfcAPI } from "web-ifc";

import { makeIfc } from "../lib/reviter/export-ifc.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { ReviewedRoom } from "../lib/reviter/room-review.ts";

function fixture(): ConvertResult {
  return {
    ok: true,
    fileName: "ifc-export-fixture.rvt",
    byteLength: 64,
    meshes: [{
      name: "Recovered elements",
      positions: new Float32Array([
        0, 0, 0, 4, 0, 0, 0, 0, 3,
        1, 0, 0, 2, 0, 0, 1, 0, 2,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      colors: new Float32Array(18),
      elementIds: new Uint32Array([10, 11]),
      materialIndex: 0,
      source: "native-brep",
    }],
    materials: [{
      name: "Concrete",
      baseColorLinear: [0.5, 0.5, 0.5, 1],
      metallic: 0,
      roughness: 0.8,
      doubleSided: false,
      source: "rvt-material",
      assignedElements: 1,
    }],
    segments: [],
    elementBounds: [{
      elementId: 10,
      stream: "Partitions/1",
      chunkIndex: 2,
      rawOffset: 10,
      recordOffset: 20,
      categoryId: -2_000_011,
      categoryName: "Walls",
      categorySource: "native-token",
      typeId: 20,
      typeName: "Exterior Wall - 200mm",
      parameters: [{ parameterId: -1_001_105, name: "Unconnected Height", value: 3 }],
      renderGeometryProvenance: "native",
      boundsFeet: { min: { x: 100, y: 200, z: 10 }, max: { x: 104, y: 201, z: 13 } },
    }, {
      elementId: 11,
      stream: "Partitions/1",
      chunkIndex: 2,
      rawOffset: 40,
      recordOffset: 50,
      categoryId: -2_000_023,
      categoryName: "Doors",
      categorySource: "native-object",
      typeId: 21,
      typeName: "0915 x 2134 mm",
      familyId: 22,
      familyName: "Single Flush",
      renderGeometryProvenance: "reconstructed",
      boundsFeet: { min: { x: 101, y: 200, z: 10 }, max: { x: 104, y: 200.5, z: 12 } },
    }],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027,
      activeDecoders: [],
      nativeCurves: 0,
      nativeProfiles: 0,
      nativeMeshes: 1,
      nativeMaterialDefinitions: 0,
      nativeMaterialAssignments: 1,
      approximateSolids: 1,
      nativeCategorisedElements: 2,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned",
      semanticFidelity: "native-categories",
    },
    origin: { x: 100, y: 200, z: 10 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 1, z: 3 } },
    levels: [{ elevation: 10, candidates: 2, levelId: 30, source: "assoc-level-id" }],
    stats: {
      streamCount: 1,
      partitionStreams: 1,
      gzipChunks: 1,
      inflatedBytes: 1,
      candidatesFound: 2,
      candidatesFocused: 2,
      candidatesUsed: 2,
      vertexCount: 6,
      triangleCount: 2,
      meshCount: 1,
      boundsRecordsFound: 2,
      solidBoundsRecords: 2,
      durationMs: 1,
    },
    warnings: [],
    method: "partition-bounds-recovery",
    nativeIdentity: {
      format: "revit-2027-native-identity",
      declaredRecordCount: 3,
      decodedIdentityCount: 2,
      skippedLeadingRecordCount: 1,
      identities: [10, 11].map((elementId, index) => ({
        elementId,
        originalElementId: elementId,
        creationEpisodeId: 0,
        lastModificationEpisodeId: 0,
        lastUserModificationEpisodeId: null,
        episodeGuid: "11111111-2222-3333-4444-555555555555",
        uniqueId: `11111111-2222-3333-4444-555555555555-0000000${index === 0 ? "a" : "b"}`,
        byteOffset: 34 + index * 40,
        provenance: "Global/ElemTable.ElementHistory+Global/History.Episode" as const,
      })),
    },
    nativeElementMaterialAssignments: [{
      elementId: 10,
      geometryId: 50,
      materialId: 40,
      evidence: "persisted-instance-shared-geometry-material",
    }],
    nativeCompoundLayerMaterialAssignments: [{
      elementId: 10,
      typeId: 20,
      layerIndex: 0,
      materialId: 40,
      widthFeet: 0.5,
      function: 1,
      evidence: "persisted-element-type-compound-layer-material",
    }, {
      elementId: 10,
      typeId: 20,
      layerIndex: 1,
      materialId: 41,
      widthFeet: 0.25,
      function: 2,
      evidence: "persisted-element-type-compound-layer-material",
    }],
    nativeHostRelations: [{
      elementId: 11,
      hostId: 10,
      fieldOffset: 151,
      recordOffset: 50,
      objectLength: 200,
      objectMarker: 0x07ef,
      kind: "host",
      source: "Partitions/InsertableInst.m_hostId",
      evidence: "persisted",
    }],
    nativeAssociatedLevelRelations: [10, 11].map((elementId) => ({
      elementId,
      levelId: 30,
      fieldOffset: 64 as const,
      recordOffset: elementId * 2,
      objectLength: 200,
      objectMarker: 1,
      kind: "associated-level" as const,
      source: "Partitions/Element.m_assocLevelId" as const,
      evidence: "persisted" as const,
    })),
  };
}

test("exports a schema-readable IFC4 population with typed tessellated elements", async () => {
  const source = makeIfc(fixture());
  for (const pattern of [
    /IFCTRIANGULATEDFACESET/,
    /IFCWALL\(/,
    /IFCDOOR\(/,
    /IFCRELVOIDSELEMENT/,
    /IFCRELFILLSELEMENT/,
    /IFCRELDEFINESBYTYPE/,
    /IFCRELASSOCIATESMATERIAL/,
    /IFCMATERIALLAYERSETUSAGE/,
    /IFCMATERIALLAYERSET/,
    /'GeometryExact',\$,IFCBOOLEAN\(\.T\.\)/,
    /'GeometryExact',\$,IFCBOOLEAN\(\.F\.\)/,
  ]) assert.match(source, pattern);

  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  assert.ok(model >= 0);
  try {
    assert.equal(api.GetModelSchema(model), "IFC4");
    const types = api.GetAllTypesOfModel(model);
    const count = (name: string) => {
      const type = types.find((candidate) => candidate.typeName.toUpperCase() === name);
      return type ? api.GetLineIDsWithType(model, type.typeID).size() : 0;
    };
    assert.equal(count("IFCWALL"), 1);
    assert.equal(count("IFCDOOR"), 1);
    assert.equal(count("IFCBUILDINGSTOREY"), 1);

    let products = 0;
    let triangles = 0;
    api.StreamAllMeshes(model, (mesh) => {
      products += 1;
      for (let index = 0; index < mesh.geometries.size(); index += 1) {
        const placed = mesh.geometries.get(index);
        const geometry = api.GetGeometry(model, placed.geometryExpressID);
        triangles += api.GetIndexArray(
          geometry.GetIndexData(),
          geometry.GetIndexDataSize(),
        ).length / 3;
        geometry.delete();
      }
      if (typeof mesh.delete === "function") mesh.delete();
    });
    assert.equal(products, 2);
    assert.equal(triangles, 2);
  } finally {
    api.CloseModel(model);
    api.Dispose();
  }
});

test("exports only approved room reviews as IfcSpace on their exact storey", () => {
  const timestamp = "2026-08-04T12:00:00.000Z";
  const room = (disposition: ReviewedRoom["disposition"], roomId: string): ReviewedRoom => ({
    roomId,
    candidateKey: `candidate-${roomId}`,
    levelId: 30,
    closure: "closed",
    disposition,
    geometry: {
      areaSquareFeet: 12,
      centroidFeet: [102, 202],
      loopsFeet: [[[101, 201], [103, 201], [103, 203], [101, 203]]],
    },
    gapIds: [],
    details: {
      number: "101", name: "Seminar", longName: "Seminar room 101", description: "Reviewed room",
      department: "Teaching", occupancyType: "Assembly", accessibility: "Accessible", notes: "", heightFeet: 9,
    },
    ifc: { export: true, predefinedType: "INTERNAL" },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const source = makeIfc(fixture(), { rooms: [room("accepted", "accepted"), room("unreviewed", "pending")] });
  assert.equal((source.match(/IFCSPACE\(/g) ?? []).length, 1);
  assert.match(source, /IFCSPACE\([^\n]+Seminar/);
  assert.match(source, /'Reviter_RoomReview'/);
  assert.match(source, /IFCARBITRARYCLOSEDPROFILEDEF/);
  assert.doesNotMatch(source, /candidate-pending/);
});

test("keeps element IFC GUIDs stable when the same native model is renamed", () => {
  const first = fixture();
  const second = fixture();
  second.fileName = "renamed-copy.rvt";
  const firstGuid = /IFCWALL\('([^']+)'/.exec(makeIfc(first))?.[1];
  const secondGuid = /IFCWALL\('([^']+)'/.exec(makeIfc(second))?.[1];
  assert.ok(firstGuid);
  assert.equal(secondGuid, firstGuid);
  assert.match(firstGuid, /^[0-3][0-9A-Za-z_$]{21}$/);
});
