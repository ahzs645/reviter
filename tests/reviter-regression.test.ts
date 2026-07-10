import assert from "node:assert/strict";
import test from "node:test";

import { detectElemTableLayout, parseElemTable } from "../lib/reviter/elem-table.ts";
import { detectDuplicatedBoundsRecord } from "../lib/reviter/convert.ts";
import { decodeArcWall2023Record, decodeRvtMaterialDefinitions, decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { makeGlb, makeIfcCenterlines } from "../lib/reviter/exports.ts";
import { compareRvtToIfc } from "../lib/reviter/regression.ts";
import type { ConvertResult, IfcReferenceManifest, RvtRegressionInput } from "../lib/reviter/types.ts";

test("parses Revit project ElemTable records with 40-byte framing", () => {
  const data = new Uint8Array(34 + 40 * 2);
  data[0] = 2;
  data[2] = 2;
  for (const offset of [34, 74]) data.fill(0xff, offset, offset + 8);
  new DataView(data.buffer).setUint32(34 + 12, 290064, true);
  new DataView(data.buffer).setUint32(74 + 12, 290210, true);

  const layout = detectElemTableLayout(data);
  assert.deepEqual(layout, { start: 34, stride: 40, markerLength: 8, framing: "explicit" });
  const result = parseElemTable(data);
  assert.ok(result);
  assert.deepEqual([...result.uniqueElementIds], [290064, 290210]);
  assert.equal(result.parsedRecordCount, 2);
});

test("decodes a duplicated Revit 2027 element bounding record", () => {
  const data = new Uint8Array(168);
  const view = new DataView(data.buffer);
  view.setUint32(0, 290618, true);
  const bounds = [4.836536977943411, -160.39049213391746, 0, 6.476956925449996, -146.11883859061035, 14.435695538057743];
  for (let copy = 0; copy < 2; copy += 1) {
    bounds.forEach((value, index) => view.setFloat64(72 + copy * 48 + index * 8, value, true));
  }
  assert.deepEqual(detectDuplicatedBoundsRecord(data), {
    elementId: 290618,
    recordOffset: 72,
    boundsFeet: {
      min: { x: bounds[0], y: bounds[1], z: bounds[2] },
      max: { x: bounds[3], y: bounds[4], z: bounds[5] },
    },
  });
});

test("decodes the proven Revit 2023 ArcWall profile and rejects it on other releases", () => {
  const data = new Uint8Array(0x73);
  const view = new DataView(data.buffer);
  view.setUint16(0, 0x0191, true);
  view.setUint32(0x04, 0x0008_8004, true);
  view.setUint32(0x08, 1, true);
  view.setUint32(0x0c, 3, true);
  view.setUint16(0x10, 0x07fa, true);
  const coordinates = [9.23, 25.66, 0, 12.51, 26.49, 6.56];
  for (let copy = 0; copy < 2; copy += 1) {
    coordinates.forEach((value, index) => view.setFloat64(0x12 + copy * 48 + index * 8, value, true));
  }
  data[0x72] = 0x03;

  const decoded = decodeArcWall2023Record(data, 0, 2023);
  assert.ok(decoded);
  assert.deepEqual(decoded.centerline, { x0: 9.23, y0: 25.66, z0: 0, x1: 12.51, y1: 26.49, z1: 6.56 });
  assert.equal(decoded.duplicateMatches, true);
  assert.equal(decodeArcWall2023Record(data, 0, 2024), null);
  assert.equal(decoderPlanForVersion(2027).nativeProfileDecoder, null);
  assert.equal(decoderPlanForVersion(2027).elementBoundsDecoder, "revit-2027-duplicated-bounds-v1");
  assert.equal(decoderPlanForVersion().elementBoundsDecoder, null);
});

test("maps native Revit material fields to linear PBR without inventing assignments", () => {
  const materials = decodeRvtMaterialDefinitions([
    { name: "Glass - Blue", color_packed: 0x00ff_8000, transparency: 0.25 },
    { name: "Steel", color_packed: 0x0080_8080, transparency: 2 },
    {},
  ]);
  assert.equal(materials.length, 2);
  assert.equal(materials[0]!.name, "Glass - Blue");
  assert.equal(materials[0]!.baseColorLinear[3], 0.75);
  assert.equal(materials[0]!.roughness, 0.2);
  assert.equal(materials[0]!.assignedElements, 0);
  assert.equal(materials[1]!.metallic, 0.8);
  assert.equal(materials[1]!.baseColorLinear[3], 0);
});

test("emits rendered IFC solids from RVT element bounds", () => {
  const result: ConvertResult = {
    ok: true,
    fileName: "sample.rvt",
    byteLength: 1,
    meshes: [],
    materials: [{ name: "fallback", baseColorLinear: [0.2, 0.75, 0.78, 1], metallic: 0, roughness: 0.7, doubleSided: true, source: "display-fallback", assignedElements: 0 }],
    segments: [],
    elementBounds: [{
      elementId: 290618,
      stream: "Partitions/325",
      chunkIndex: 1508,
      rawOffset: 28_728_700,
      recordOffset: 72,
      boundsFeet: {
        min: { x: 4, y: -160, z: 0 },
        max: { x: 6, y: -146, z: 14 },
      },
    }],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027, activeDecoders: ["revit-2027-duplicated-bounds-v1"], nativeCurves: 0,
      nativeProfiles: 0, nativeMeshes: 0, nativeMaterialDefinitions: 0, nativeMaterialAssignments: 0,
      approximateSolids: 1, geometryFidelity: "native-bounds-envelope", materialFidelity: "display-fallback",
    },
    origin: { x: 5, y: -153, z: 0 },
    bbox: { min: { x: -1, y: -7, z: 0 }, max: { x: 1, y: 7, z: 14 } },
    levels: [],
    stats: {
      streamCount: 1, partitionStreams: 1, gzipChunks: 1, inflatedBytes: 1,
      candidatesFound: 1, candidatesFocused: 1, candidatesUsed: 1,
      vertexCount: 8, triangleCount: 12, meshCount: 1,
      boundsRecordsFound: 1, solidBoundsRecords: 1, durationMs: 1,
    },
    warnings: [],
    method: "partition-bounds-recovery",
  };
  const ifc = makeIfcCenterlines(result);
  assert.match(ifc, /IFCEXTRUDEDAREASOLID/);
  assert.match(ifc, /Revit element 290618/);
  assert.match(ifc, /duplicated-bounds record/);
});

test("emits a standalone GLB from recovered browser geometry", () => {
  const result: ConvertResult = {
    ok: true,
    fileName: "sample.rvt",
    byteLength: 1,
    meshes: [{
      name: "sample bounds",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      colors: new Float32Array([0.2, 0.7, 0.8, 0.2, 0.7, 0.8, 0.2, 0.7, 0.8]),
      indices: new Uint32Array([0, 1, 2]),
      materialIndex: 0,
    }],
    materials: [{ name: "fallback", baseColorLinear: [0.2, 0.75, 0.78, 1], metallic: 0, roughness: 0.7, doubleSided: true, source: "display-fallback", assignedElements: 0 }],
    segments: [],
    elementBounds: [],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: null, activeDecoders: [], nativeCurves: 0, nativeProfiles: 0, nativeMeshes: 0,
      nativeMaterialDefinitions: 0, nativeMaterialAssignments: 0, approximateSolids: 1,
      geometryFidelity: "diagnostic-only", materialFidelity: "display-fallback",
    },
    origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
    levels: [],
    stats: {
      streamCount: 1, partitionStreams: 1, gzipChunks: 1, inflatedBytes: 1,
      candidatesFound: 1, candidatesFocused: 1, candidatesUsed: 1,
      vertexCount: 3, triangleCount: 1, meshCount: 1,
      boundsRecordsFound: 0, solidBoundsRecords: 0, durationMs: 1,
    },
    warnings: [],
    method: "partition-coordinate-recovery",
  };
  const glb = makeGlb(result);
  const view = new DataView(glb);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), glb.byteLength);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
});

test("rejects recovered geometry when identity, extents, topology, and semantics diverge", () => {
  const rvt: RvtRegressionInput = {
    elemTableIds: new Uint32Array([290064, 290210]),
    partitionRecordIds: new Uint32Array([290618]),
    partitionRecords: [],
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 1262, y: 1553, z: 184 } },
    triangleCount: 105_852,
    productionElements: 0,
  };
  const reference: IfcReferenceManifest = {
    fileName: "reference.ifc",
    byteLength: 1,
    schema: "IFC2X3",
    elementCount: 41_312,
    taggedElementCount: 38_687,
    matchedElementCount: 4_171,
    unmatchedTaggedElementCount: 34_516,
    matchedGeometryProducts: 4_000,
    storeyCount: 13,
    geometryProducts: 36_282,
    placedGeometries: 56_728,
    vertexCount: 2_394_161,
    triangleCount: 934_123,
    boundsMetres: { min: { x: 0, y: 0, z: 0 }, max: { x: 218, y: 19.4, z: 375 } },
    elementTypes: [],
    matchedSamples: [],
    durationMs: 1,
  };

  const result = compareRvtToIfc(rvt, reference);
  assert.equal(result.status, "fail");
  assert.equal(result.gates.every((gate) => gate.status === "fail"), true);
  assert.match(result.conclusion, /fails/);
});
