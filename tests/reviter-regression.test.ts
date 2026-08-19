import assert from "node:assert/strict";
import test from "node:test";

import { detectElemTableLayout, parseElemTable } from "../lib/reviter/elem-table.ts";
import {
  boundsOfRecords,
  detectDuplicatedBoundsRecord,
  detectDuplicatedBoundsRecords,
  framingBoundsOfRecords,
} from "../lib/reviter/bounds-records.ts";
import { gzipOffsets } from "../lib/reviter/revit-container.ts";
import { summariseSchema } from "../lib/reviter/schema.ts";
import { parsePartitionNames } from "../lib/reviter/partition-names.ts";
import { measureStream, summariseCoverage } from "../lib/reviter/stream-coverage.ts";
import {
  chainElementObjects,
  dominantMarker,
  markerObjectSeeds,
  scanObjectMarkers,
} from "../lib/reviter/element-objects.ts";
import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import { collectSurfaces, summariseSurfaces } from "../lib/reviter/surfaces.ts";
import { collectTypeLinks } from "../lib/reviter/element-types.ts";
import { surfaceQuadsFor, wallSolidsFor } from "../lib/reviter/native-geometry.ts";
import { instanceCorners, readLocalBounds } from "../lib/reviter/instanced-geometry.ts";
import { boundaryLoopsFor, collectSketchCurves } from "../lib/reviter/sketch-curves.ts";
import { groupRings, ringArea, triangulate } from "../lib/reviter/polygon.ts";
import type { Point2 } from "../lib/reviter/polygon.ts";
import type { PlanePatch } from "../lib/reviter/surfaces.ts";
import { segmentScaleFor } from "../lib/reviter/segment-scan.ts";
import {
  applyNativeCategories,
  categoryFromNativeObjectEvidence,
  categoryDisplayName,
  collectCategoryTokens,
  deriveRecordCodeCategories,
  recordCodeKey,
  resolveElementCategories,
} from "../lib/reviter/native-categories.ts";
import { decodeArcWall2023Record, decodeRvtMaterialDefinitions, decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { elementManifest, makeGlb, makeIfcCenterlines, makeReport } from "../lib/reviter/exports.ts";
import { compareRvtToIfc } from "../lib/reviter/regression.ts";
import {
  buildBoundsMeshes,
  curtainAssemblyHelperProxyIds,
  displayRole,
  excludeMeshElementIds,
  isNonSceneObjectDefinition,
  nonSceneNativeMeshHelperIds,
  isStairOrRailingHelperProxy,
  selectDisplayBounds,
  stairAssembliesWithRecoveredNativeRuns,
} from "../lib/reviter/scene.ts";
import type { ConvertResult, ElementBoundsRecord, IfcReferenceManifest, RvtRegressionInput } from "../lib/reviter/types.ts";
import { boxDifference } from "../lib/reviter/drawn-bounds.ts";
import { residualDatumPileElementIds } from "../lib/reviter/datum-pile.ts";

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
  view.setUint16(16, 0x08c6, true);
  view.setUint32(18, 30, true);
  view.setUint32(26, 290618, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, 5, true);
  view.setUint32(42, 3, true);
  const bounds = [4.836536977943411, -160.39049213391746, 0, 6.476956925449996, -146.11883859061035, 14.435695538057743];
  for (let copy = 0; copy < 2; copy += 1) {
    bounds.forEach((value, index) => view.setFloat64(72 + copy * 48 + index * 8, value, true));
  }
  assert.deepEqual(detectDuplicatedBoundsRecord(data), {
    elementId: 290618,
    recordOffset: 0,
    boundsOffset: 72,
    recordCode: 30,
    recordCount: 5,
    duplicated: true,
    boundsFeet: {
      min: { x: bounds[0], y: bounds[1], z: bounds[2] },
      max: { x: bounds[3], y: bounds[4], z: bounds[5] },
    },
  });
});

test("finds multiple nested Revit 2027 records in one inflated partition page", () => {
  const data = new Uint8Array(380);
  const view = new DataView(data.buffer);
  const writeRecord = (offset: number, elementId: number, recordCode: number, count: number) => {
    view.setUint32(offset, elementId, true);
    view.setUint16(offset + 16, 0x08c6, true);
    view.setUint32(offset + 18, recordCode, true);
    view.setUint32(offset + 26, elementId, true);
    view.setUint32(offset + 34, 0x0008_8004, true);
    view.setUint32(offset + 38, count, true);
    view.setUint32(offset + 42, 3, true);
    const boundsOffset = offset + 42 + count * 6;
    const bounds = [elementId / 10_000, -20, 0, elementId / 10_000 + 1, -18, 9];
    for (let copy = 0; copy < 2; copy += 1) {
      bounds.forEach((value, index) => view.setFloat64(boundsOffset + copy * 48 + index * 8, value, true));
    }
  };
  writeRecord(7, 290618, 30, 5);
  writeRecord(201, 1080819, 116, 1);

  const records = detectDuplicatedBoundsRecords(data);
  assert.deepEqual(records.map(({ elementId, recordOffset, recordCode, recordCount }) => ({
    elementId, recordOffset, recordCode, recordCount,
  })), [
    { elementId: 290618, recordOffset: 7, recordCode: 30, recordCount: 5 },
    { elementId: 1080819, recordOffset: 201, recordCode: 116, recordCount: 1 },
  ]);
});

test("keeps the Revit 2023 ArcWall block as a bounds hypothesis and rejects it on other releases", () => {
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
  assert.deepEqual(decoded.boundsFeet, {
    min: { x: 9.23, y: 25.66, z: 0 },
    max: { x: 12.51, y: 26.49, z: 6.56 },
  });
  assert.equal(decoded.confidence, "bounds-hypothesis");
  assert.equal(decoded.duplicateMatches, true);
  assert.equal(decodeArcWall2023Record(data, 0, 2024), null);
  assert.equal(decoderPlanForVersion(2023).nativeProfileDecoder, null);
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

function boundsResult(): ConvertResult {
  return {
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
      approximateSolids: 1, nativeCategorisedElements: 0, geometryFidelity: "native-bounds-envelope",
      materialFidelity: "display-fallback", semanticFidelity: "record-code-heuristic",
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
}

test("emits rendered IFC solids from RVT element bounds", () => {
  const ifc = makeIfcCenterlines(boundsResult());
  assert.match(ifc, /IFCEXTRUDEDAREASOLID/);
  assert.match(ifc, /Revit element 290618/);
  assert.match(ifc, /GeometryProvenance'\,\$\,IFCTEXT\('bounds-fallback'\)/);
  assert.match(ifc, /GeometryExact'\,\$\,IFCBOOLEAN\(\.F\.\)/);
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
      nativeCategorisedElements: 0, geometryFidelity: "diagnostic-only",
      materialFidelity: "display-fallback", semanticFidelity: "none",
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

test("exports one semantic manifest record per recovered element", () => {
  const result = boundsResult();
  const record = result.elementBounds[0]!;
  record.categoryId = -2_000_011;
  record.categoryName = "Walls";
  record.categorySource = "native-token";
  record.typeId = 609157;
  record.typeName = "Interior Wall - 120mm";
  record.parameters = [{ parameterId: -1_001_105, name: "Unconnected Height", value: 14 }];
  result.meshes[0] = {
    name: "Walls",
    positions: new Float32Array(),
    colors: new Float32Array(),
    indices: new Uint32Array(),
    elementIds: new Uint32Array([290618]),
    materialIndex: 1,
  };

  assert.deepEqual(elementManifest(result), [{
    elementId: 290618,
    displayed: true,
    category: { id: -2_000_011, name: "Walls", evidence: "native-token" },
    type: { elementId: 609157, name: "Interior Wall - 120mm" },
    geometry: {
      source: "validated-bounds-envelope",
      finalProvenance: "bounds-fallback",
      boundsFeet: record.boundsFeet,
      bodies: 1,
      nativeFaces: 0,
    },
    parameters: [{ id: -1_001_105, name: "Unconnected Height", value: 14 }],
  }]);

  const report = JSON.parse(makeReport(result, {
    version: "2027",
    username: "private-user",
    centralModelPath: "C:\\private\\central.rvt",
    lastSavePath: "C:\\private\\local.rvt",
    basicFileInfo: {
      locale: "ENU",
      properties: {
        Username: "nested-private-user",
        "Central Model Path": "C:\\nested\\central.rvt",
        Worksharing: "Enabled",
      },
    },
  })) as {
    schemaVersion: number;
    file: { metadata: Record<string, unknown> };
    elementManifest: { count: number; unavailableFields: string[]; elements: unknown[] };
  };
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.elementManifest.count, 1);
  assert.equal(report.elementManifest.elements.length, 1);
  assert.ok(report.elementManifest.unavailableFields.includes("model-tree hierarchy"));
  assert.deepEqual(report.file.metadata, {
    version: "2027",
    basicFileInfo: {
      locale: "ENU",
      properties: { Worksharing: "Enabled" },
    },
  });
});

test("types IFC elements from native categories while retaining approximate geometry evidence", () => {
  const base = boundsResult();
  const record = base.elementBounds[0]!;
  record.categoryId = -2_000_011;
  record.categoryName = "Walls";
  record.categorySource = "native-token";
  const ifc = makeIfcCenterlines(base);
  assert.match(ifc, /IFCWALL\('[^']*',#\d+,'Walls 290618'/);
  assert.match(ifc, /RevitCategoryId'\,\$\,IFCINTEGER\(-2000011\)/);
  assert.match(ifc, /CategoryEvidence'\,\$\,IFCTEXT\('native-token'\)/);
  assert.match(ifc, /GeometryExact'\,\$\,IFCBOOLEAN\(\.F\.\)/);
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

test("uses native category coverage and reports the geometric diff as its own gate", () => {
  const rvt: RvtRegressionInput = {
    elemTableIds: new Uint32Array([1, 2]),
    partitionRecordIds: new Uint32Array(),
    partitionRecords: [],
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 30 } },
    triangleCount: 100,
    productionElements: 0,
    typedElements: 95,
  };
  const reference: IfcReferenceManifest = {
    fileName: "reference.ifc",
    byteLength: 1,
    schema: "IFC4",
    elementCount: 100,
    taggedElementCount: 2,
    matchedElementCount: 2,
    unmatchedTaggedElementCount: 0,
    matchedGeometryProducts: 2,
    storeyCount: 1,
    geometryProducts: 2,
    placedGeometries: 2,
    vertexCount: 100,
    triangleCount: 100,
    geometricComparedElementCount: 2,
    geometricAlignedElementCount: 1,
    geometricDifferentElementCount: 1,
    geometryToleranceFeet: 0.5,
    boundsMetres: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10 * 0.3048, y: 20 * 0.3048, z: 30 * 0.3048 },
    },
    elementTypes: [],
    matchedSamples: [],
    durationMs: 1,
  };

  const result = compareRvtToIfc(rvt, reference);
  assert.equal(result.gates.find((gate) => gate.id === "semantics")?.status, "pass");
  assert.equal(result.gates.find((gate) => gate.id === "geometry")?.status, "warn");
  assert.equal(result.semanticCoverage, 0.95);
});

test("measures geometric diff by worst-axis centre and size errors", () => {
  const difference = boxDifference(
    [0, 0, 0, 10, 20, 30],
    [0.2, -0.1, 0, 10.2, 20.3, 30],
  );
  assert.ok(Math.abs(difference.centreErrorFeet - 0.2) < 1e-9);
  assert.ok(Math.abs(difference.sizeErrorFeet - 0.4) < 1e-9);
});

test("decodes a native Revit BuiltInCategory token and its preceding element id", () => {
  const data = new Uint8Array(64);
  const view = new DataView(data.buffer);
  // Element id written as a 64-bit value ahead of the token.
  view.setUint32(8, 978605, true);
  view.setUint32(12, 0, true);
  const token = 24;
  data[token] = 0x04;
  data[token + 1] = 0x00;
  view.setUint32(token + 2, 0x0000_0006, true);
  view.setUint32(token + 6, (-2_000_011 + 0x1_0000_0000) >>> 0, true);
  view.setUint32(token + 10, 0xffff_ffff, true);
  view.setUint32(token + 14, 0xffff_ffff, true);

  const tokens = collectCategoryTokens(data);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.categoryId, -2_000_011);
  assert.ok(tokens[0]!.ownerCandidates.includes(978605));

  const resolved = resolveElementCategories(tokens, new Set([978605]));
  assert.deepEqual([...resolved], [[978605, -2_000_011]]);
  assert.equal(categoryDisplayName(-2_000_011), "Walls");
});

test("ignores category-shaped bytes outside the Revit BuiltInCategory range", () => {
  const data = new Uint8Array(32);
  const view = new DataView(data.buffer);
  data[8] = 0x04;
  view.setUint32(10, 6, true);
  view.setUint32(14, (-1_000_110 + 0x1_0000_0000) >>> 0, true);
  view.setUint32(18, 0xffff_ffff, true);
  view.setUint32(22, 0xffff_ffff, true);
  assert.deepEqual(collectCategoryTokens(data), []);
});

test("derives a record-code category consensus only above the support and purity floors", () => {
  const walls = Array.from({ length: 12 }, (_, index) => ({
    elementId: 1_000 + index,
    recordCode: 30,
    recordCount: 5,
  }));
  const thin = [{ elementId: 2_000, recordCode: 44, recordCount: 1 }];
  const resolved = new Map<number, number>([
    ...walls.map((record, index) => [record.elementId, index === 0 ? -2_000_023 : -2_000_011] as const),
    [2_000, -2_000_023],
  ]);

  const consensus = deriveRecordCodeCategories([...walls, ...thin], resolved);
  assert.deepEqual(consensus.get(recordCodeKey(30, 5)), {
    categoryId: -2_000_011,
    support: 12,
    purity: 11 / 12,
  });
  // One supporting element is below the floor, so no consensus is published.
  assert.equal(consensus.get(recordCodeKey(44, 1)), undefined);
});

test("overrides a donated token only where the element's own cluster disagrees decisively", () => {
  // Nine floors resolve their own tokens cleanly; the plate's only token has a
  // nearer candidate that the persisted element table proves is a real —
  // undrawn — element, so its mullion label is a fall-through donation.
  const floors = Array.from({ length: 9 }, (_, index) => ({
    elementId: 100 + index,
    recordCode: 54,
    recordCount: 1,
  }));
  const plate = { elementId: 200, recordCode: 54, recordCount: 1 };
  // A donated drawing-aid label with no contradicting cluster stays: the scene
  // admission rules depend on it and nothing stronger disagrees.
  const helper = { elementId: 300, recordCode: 99, recordCount: 2 };
  const undrawnMullion = 999_555;
  const undrawnPathOwner = 999_666;
  const tokens = [
    ...floors.map((record) => ({
      categoryId: -2_000_032,
      ownerCandidates: [record.elementId],
    })),
    { categoryId: -2_000_171, ownerCandidates: [undrawnMullion, plate.elementId] },
    { categoryId: -2_000_938, ownerCandidates: [undrawnPathOwner, helper.elementId] },
  ];

  type Records = Parameters<typeof applyNativeCategories>[0];
  const records = [...floors, plate, helper] as unknown as Records;
  const summary = applyNativeCategories(
    records,
    tokens,
    undefined,
    new Set([undrawnMullion, undrawnPathOwner]),
  );
  const byId = new Map(records.map((record) => [record.elementId, record]));
  assert.equal(byId.get(200)!.categoryName, "Floors");
  assert.equal(byId.get(200)!.categorySource, "record-code-consensus");
  // Revit's own label for `OST_StairsPaths`, which is not the humanised enumerator.
  assert.equal(byId.get(300)!.categoryName, "Stair Paths");
  assert.equal(byId.get(300)!.categorySource, "native-token");
  assert.equal(summary.donatedTokenElements, 2);
  assert.equal(summary.donatedTokensOverridden, 1);

  // Without the persisted ownership evidence the fall-through is invisible and
  // the plate keeps the mullion's token — the documented 447970 defect.
  const legacy = [...floors, { ...plate }, { ...helper }] as unknown as Records;
  applyNativeCategories(legacy, tokens);
  assert.equal(legacy[9]!.categoryName, "Curtain Wall Mullions");
});

test("skips gzip signatures whose reserved header flag bits are set", () => {
  const data = new Uint8Array(64);
  // A real Revit chunk header: signature, DEFLATE method, no flags.
  data.set([0x1f, 0x8b, 0x08, 0x00], 0);
  // A signature that occurs by chance inside compressed data: flag byte 0xb2
  // sets reserved bits, so it must not be treated as a chunk boundary.
  data.set([0x1f, 0x8b, 0x08, 0xb2], 32);
  assert.deepEqual(gzipOffsets(data), [0]);
});

test("reads a component-scale coordinate window for family files", () => {
  const project = segmentScaleFor("model.rvt");
  const family = segmentScaleFor("component.rfa");
  assert.equal(segmentScaleFor("template.rft"), family);
  // A family's curves are far shorter than a building's, so a project window
  // discards them and admits long spurious runs the component cannot contain.
  assert.ok(family.minLength < project.minLength);
  assert.ok(family.maxLength < project.maxLength);
  // An explicit request always wins over the extension.
  assert.equal(segmentScaleFor("component.rfa", "project"), project);
  assert.equal(segmentScaleFor("model.rvt", "family"), family);
});

test("inventories tagged classes only when a parent record corroborates them", () => {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const name = (text: string) => {
    const encoded = encoder.encode(text);
    bytes.push(encoded.length & 0xff, encoded.length >> 8, ...encoded);
  };
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const dword = (value: number) => {
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
  };
  // The word after a class name is the *parent's* type reference, and the
  // reader registers a class before the parent it defines inline, so the
  // class's own tag is one below the word written here.
  const declare = (className: string, parentRef: number, parent: string, version: number, fields: number) => {
    name(className);
    word(parentRef | 0x8000);
    word(0);
    name(parent);
    word(0);
    dword(version);
    dword(fields);
  };

  declare("ArcWall", 0x01c3, "VWall", 2, 0);
  declare("HostObjAttr", 0x006f, "Symbol", 3, 0);
  // A tagged name with no parent record after it is compressed noise, not a
  // class. Scanning loosely admits mangled strings exactly like this one.
  name("Cuuuuuuuaaaas");
  word(0x0123 | 0x8000);
  word(0);
  bytes.push(0xff, 0xfe, 0x01, 0x02);

  const summary = summariseSchema(new Uint8Array(bytes));
  assert.deepEqual(
    summary.taggedClasses.map(({ name: className, tag, parent, version }) => ({ className, tag, parent, version })),
    [
      { className: "HostObjAttr", tag: 0x006e, parent: "Symbol", version: 3 },
      { className: "ArcWall", tag: 0x01c2, parent: "VWall", version: 2 },
    ],
  );
  assert.equal(summary.rejectedCandidates, 1);
});

test("reads partition names as UTF-16 with a character count", () => {
  const name = "Workset1";
  const data = new Uint8Array(4 + name.length * 2);
  const view = new DataView(data.buffer);
  view.setUint32(0, name.length, true);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(4 + index * 2, name.charCodeAt(index), true);
  }
  assert.deepEqual(parsePartitionNames(data).map((entry) => entry.name), ["Workset1"]);
  // A count that overruns the stream is not a name.
  view.setUint32(0, 4_000, true);
  assert.deepEqual(parsePartitionNames(data), []);
});

test("accounts for every container stream and grades how deeply it is read", () => {
  const streams = [
    measureStream("BasicFileInfo", new Uint8Array(16)),
    measureStream("Global/ElemTable", new Uint8Array(32)),
    measureStream("Global/History", new Uint8Array(64)),
    measureStream("Something/Unknown", new Uint8Array(8)),
  ];
  assert.deepEqual(streams.map((stream) => [stream.decoder, stream.depth]), [
    ["metadata", "full"],
    ["element-index", "partial"],
    ["element-index", "partial"],
    ["none", "none"],
  ]);

  const summary = summariseCoverage(streams);
  assert.deepEqual(
    { full: summary.fullStreams, partial: summary.partialStreams, undecoded: summary.undecodedStreams },
    { full: 1, partial: 2, undecoded: 1 },
  );
  // Largest stream first, so the most significant coverage row is never buried.
  assert.equal(summary.streams[0]!.path, "Global/History");
});

test("chains element objects through the length echo behind each object", () => {
  const build = (lengths: number[]) => {
    const total = lengths.reduce((sum, length) => sum + length + 20, 0);
    const data = new Uint8Array(total);
    const view = new DataView(data.buffer);
    let offset = 0;
    lengths.forEach((length, index) => {
      view.setUint32(offset, 5_000 + index, true);   // element id
      view.setUint32(offset + 4, 0, true);
      view.setUint32(offset + 12, length, true);     // objLen
      view.setUint16(offset + 16, 0x08c6, true);     // marker
      view.setUint32(offset + 18, 30, true);         // type code
      view.setUint32(offset + length + 16, length, true); // echo
      offset += length + 20;
    });
    return data;
  };

  const data = build([64, 48, 80]);
  // Seed on the middle object only: the walk must reach its neighbours in both
  // directions, which is what recovers objects that carry no bounds record.
  const objects = chainElementObjects(data, [84]);
  assert.deepEqual(objects.map((object) => object.elementId), [5_000, 5_001, 5_002]);
  assert.deepEqual(objects.map((object) => object.objectLength), [64, 48, 80]);
  assert.equal(dominantMarker(objects), 0x08c6);

  // Break the echo and the chain must stop rather than walk into noise.
  const broken = build([64, 48, 80]);
  new DataView(broken.buffer).setUint32(64 + 16, 999, true);
  assert.deepEqual(chainElementObjects(broken, [0]).map((object) => object.elementId), []);
});

test("decodes an element parameter table from its own anchor", () => {
  const parameters: [number, number][] = [[-1001105, 13.123359580052492], [-1001108, -0.65616797900262]];
  const data = new Uint8Array(64 + parameters.length * 16);
  const view = new DataView(data.buffer);
  // ff ff ff ff 10 03 01 00 00 00 then the element restating its own id.
  data.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00], 8);
  view.setUint32(18, 978605, true);
  view.setUint32(22, 0, true);
  const table = 32;
  view.setUint32(table, parameters.length, true);
  parameters.forEach(([id, value], index) => {
    view.setUint32(table + 4 + index * 16, id + 0x1_0000_0000, true);
    view.setUint32(table + 8 + index * 16, 0xffff_ffff, true);
    view.setFloat64(table + 12 + index * 16, value, true);
  });

  const decoded = collectElementParameters(data);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0]!.elementId, 978605);
  assert.deepEqual(
    decoded[0]!.parameters.map(({ parameterId, name, value }) => ({ parameterId, name, value })),
    [
      { parameterId: -1001105, name: "Unconnected Height", value: 13.123359580052492 },
      { parameterId: -1001108, name: "Base Offset", value: -0.65616797900262 },
    ],
  );
});

test("decodes a trimmed analytic plane and rejects a non-orthonormal one", () => {
  const build = (uDir: number[], vDir: number[]) => {
    const data = new Uint8Array(105);
    const view = new DataView(data.buffer);
    data[0] = 0x01;
    [4.5, -160.25, 0].forEach((value, index) => view.setFloat64(1 + index * 8, value, true));
    uDir.forEach((value, index) => view.setFloat64(25 + index * 8, value, true));
    vDir.forEach((value, index) => view.setFloat64(49 + index * 8, value, true));
    // uMin, vMin, uMax, vMax — the wall runs 0..14.27 ft and is 13.78 ft tall.
    [0, 0, 14.271653543307087, 13.779527559055119].forEach((value, index) =>
      view.setFloat64(73 + index * 8, value, true),
    );
    return data;
  };

  const surfaces = collectSurfaces(build([0, 1, 0], [0, 0, 1]));
  assert.equal(surfaces.length, 1);
  const plane = surfaces[0]!;
  assert.equal(plane.kind, "plane");
  if (plane.kind !== "plane") return;
  assert.deepEqual(plane.origin, { x: 4.5, y: -160.25, z: 0 });
  // Wall height is the v-range; the location line runs along uDir over u.
  assert.ok(Math.abs(plane.vMax - plane.vMin - 13.779527559055119) < 1e-12);
  assert.deepEqual(summariseSurfaces(surfaces), { planes: 1, cylinders: 0, verticalPlanes: 1 });

  // Directions that are not perpendicular are not a surface record.
  assert.deepEqual(collectSurfaces(build([0, 1, 0], [0, 1, 0])), []);
  // Nor are directions that are not unit length.
  assert.deepEqual(collectSurfaces(build([0, 2, 0], [0, 0, 1])), []);
});

test("reads a type name from behind the 0x1104 field slot", () => {
  const name = "Interior Wall - 120mm";
  const data = new Uint8Array(64 + name.length * 2);
  const view = new DataView(data.buffer);
  view.setUint32(0, 609157, true);      // the type element's own id
  view.setUint32(4, 0, true);
  view.setUint32(8, 0x1234_5678, true); // per-record stamp, not all zero or ones
  view.setUint32(12, 0x9abc_def0, true);
  view.setUint16(16, 0x0f3b, true);
  view.setUint32(18, 0xffff_ffff, true);
  view.setUint16(22, 0x0c93, true);
  // ff ff ff ff 04 11 then the length-prefixed UTF-16 name.
  data.set([0xff, 0xff, 0xff, 0xff, 0x04, 0x11], 28);
  view.setUint32(34, name.length, true);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(38 + index * 2, name.charCodeAt(index), true);
  }

  const { names } = collectTypeLinks(data);
  assert.deepEqual(names, [{ typeId: 609157, name: "Interior Wall - 120mm" }]);

  // A character count that runs past the buffer is not a name.
  view.setUint32(34, 5_000, true);
  assert.deepEqual(collectTypeLinks(data).names, []);
});

test("rebuilds an oriented solid from a wall's plane triple", () => {
  // Centre plane plus two face planes at the fixed stride, offset by half the
  // thickness along the plane normal.
  const plane = (offset: number, sideways: number): PlanePatch => ({
    kind: "plane",
    offset,
    origin: { x: 10 + sideways * 0, y: 20 + sideways, z: 3 },
    uDir: { x: 1, y: 0, z: 0 },
    vDir: { x: 0, y: 0, z: 1 },
    uMin: 0,
    vMin: 0,
    uMax: 25,
    vMax: 13.779527559055119,
  });
  const solids = wallSolidsFor(978605, [plane(0, 0), plane(105, -0.5), plane(210, 0.5)]);

  assert.equal(solids.length, 1);
  const solid = solids[0]!;
  assert.deepEqual(solid.start, { x: 10, y: 20 });
  assert.deepEqual(solid.end, { x: 35, y: 20 });
  assert.equal(solid.baseElevation, 3);
  assert.ok(Math.abs(solid.topElevation - 16.779527559055119) < 1e-12);
  // 1 ft between the faces, and the wall is 25 ft long — not the 25x1 box that
  // an axis-aligned envelope would give for a wall running at an angle.
  assert.ok(Math.abs(solid.thickness - 1) < 1e-12);

  // Planes that are not at the fixed stride are not one wall's triple.
  assert.deepEqual(wallSolidsFor(1, [plane(0, 0), plane(200, -0.5), plane(400, 0.5)]), []);
});

test("draws a trimmed plane as its four corners in trim order", () => {
  const plane: PlanePatch = {
    kind: "plane",
    offset: 0,
    origin: { x: 5, y: -2, z: 1 },
    uDir: { x: 1, y: 0, z: 0 },
    vDir: { x: 0, y: 0, z: 1 },
    uMin: 0,
    vMin: 0,
    uMax: 4,
    vMax: 3,
  };
  const [quad] = surfaceQuadsFor(290618, [plane]);
  assert.ok(quad);
  assert.equal(quad!.elementId, 290618);
  assert.deepEqual(quad!.corners, [
    [5, -2, 1],
    [9, -2, 1],
    [9, -2, 4],
    [5, -2, 4],
  ]);

  // A plane with no extent in one direction is an edge, not a face.
  assert.deepEqual(surfaceQuadsFor(1, [{ ...plane, uMax: 0 }]), []);
});

test("places a family instance through its transform and shared shape", () => {
  // A quarter turn about Z: the columns of the row-major 3x3 are the local axes.
  const placement = {
    elementId: 1_080_812,
    basis: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    origin: [10, 20, 3] as [number, number, number],
    geometryId: 4_242,
  };
  const shape = {
    elementId: 4_242,
    min: [0, 0, 0] as [number, number, number],
    max: [2, 1, 4] as [number, number, number],
  };

  const corners = instanceCorners(placement, shape);
  assert.equal(corners.length, 8);
  // Local +X maps to world +Y, so the 2 ft length runs along Y from the origin.
  assert.deepEqual(corners[0], [10, 20, 3]);
  assert.deepEqual(corners[1], [10, 22, 3]);
  assert.deepEqual(corners[2], [9, 22, 3]);
  assert.deepEqual(corners[6], [9, 22, 7]);
});

test("decodes sketch edges and chains them into a ring regardless of stored order", () => {
  // Four edges of a 10 x 6 rectangle, written out of order and each written
  // twice in opposite directions, which is how the file stores them.
  const corners: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];
  const edges: [number, number, number, number][] = [
    [1, 2], [3, 0], [0, 1], [2, 3],
  ].map(([from, to]) => {
    const a = corners[from!]!;
    const b = corners[to!]!;
    return [a[0], a[1], b[0], b[1]];
  }) as [number, number, number, number][];

  const records = edges.flatMap((edge) => [edge, [edge[2], edge[3], edge[0], edge[1]]]);
  const data = new Uint8Array(18 + records.length * 84);
  const view = new DataView(data.buffer);
  data.set([0xff, 0xff, 0xff, 0xff, 0x10, 0x03, 0x01, 0x00, 0x00, 0x00], 0);
  view.setUint32(10, 400238, true);

  records.forEach((record, index) => {
    const at = 18 + index * 84;
    data.set([0x04, 0x00, 0x08, 0x01], at);
    const [x0, y0, x1, y1] = record as [number, number, number, number];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const put = (slot: number, value: number) => view.setFloat64(at + 4 + slot * 8, value, true);
    put(0, 0);
    put(1, length);
    put(2, x0);
    put(3, y0);
    put(4, 0);
    put(5, (x1 - x0) / length);
    put(6, (y1 - y0) / length);
    put(7, 0);
  });

  const curves = collectSketchCurves(data);
  assert.equal(curves.length, records.length);
  assert.ok(curves.every((curve) => curve.owner === 400238 && curve.kind === "line"));

  const rings = boundaryLoopsFor(400238, new Map([[400238, curves]]));
  assert.equal(rings.length, 1, "the reversed copies must not become rings of their own");
  assert.equal(rings[0]!.length, 4);
  // Same four corners, in ring order, whatever order the records were in.
  const plan = rings[0]!.map(([x, y]) => `${x},${y}`).sort();
  assert.deepEqual(plan, ["0,0", "0,6", "10,0", "10,6"]);
});

test("triangulates a sketch boundary without paving over its openings", () => {
  const outer: Point2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole: Point2[] = [[3, 3], [3, 6], [6, 6], [6, 3]];
  const vertices = [...outer, ...hole];
  const triangles = triangulate(outer, [hole]);
  let covered = 0;
  for (let index = 0; index < triangles.length; index += 3) {
    const p = vertices[triangles[index]!]!;
    const q = vertices[triangles[index + 1]!]!;
    const r = vertices[triangles[index + 2]!]!;
    covered += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }
  assert.equal(covered, ringArea(outer) - ringArea(hole));

  // Revit sketches wind either way, and the hole has to survive both.
  const reversed = triangulate([...outer].reverse(), [hole]);
  assert.equal(reversed.length, triangles.length);
});

test("keeps disjoint sketch regions apart instead of subtracting one from the other", () => {
  // Two separate wings and one opening in the first: ranked by area alone the
  // second wing would be treated as a hole in the first.
  const wingA: Point2[] = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const opening: Point2[] = [[5, 5], [5, 10], [10, 10], [10, 5]];
  const wingB: Point2[] = [[30, 0], [45, 0], [45, 15], [30, 15]];

  const groups = groupRings([wingA, wingB, opening]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.holes.length).sort(), [0, 1]);

  let covered = 0;
  for (const group of groups) {
    const vertices = [group.outer, ...group.holes].flat();
    const triangles = triangulate(group.outer, group.holes);
    for (let index = 0; index < triangles.length; index += 3) {
      const p = vertices[triangles[index]!]!;
      const q = vertices[triangles[index + 1]!]!;
      const r = vertices[triangles[index + 2]!]!;
      covered += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }
  }
  assert.equal(covered, ringArea(wingA) + ringArea(wingB) - ringArea(opening));
});

test("admits a small unanimous category cluster and rejects a small divided one", () => {
  // A building holds thousands of mullions but a dozen ramps, so a flat support
  // floor tuned on the large clusters silently excludes every small category.
  const ramps = Array.from({ length: 3 }, (_, index) => ({
    elementId: 5_000 + index,
    recordCode: 180,
    recordCount: 1,
  }));
  const ceilings = Array.from({ length: 4 }, (_, index) => ({
    elementId: 6_000 + index,
    recordCode: 62,
    recordCount: 1,
  }));
  const divided = Array.from({ length: 3 }, (_, index) => ({
    elementId: 7_000 + index,
    recordCode: 77,
    recordCount: 1,
  }));
  const resolved = new Map<number, number>([
    ...ramps.map((record) => [record.elementId, -2_000_180] as const),
    ...ceilings.map((record, index) => [record.elementId, index === 3 ? -2_000_032 : -2_000_038] as const),
    ...divided.map((record, index) => [record.elementId, index === 0 ? -2_000_011 : -2_000_038] as const),
  ]);

  const consensus = deriveRecordCodeCategories([...ramps, ...ceilings, ...divided], resolved);
  // Three elements that agree completely are evidence.
  assert.equal(consensus.get(recordCodeKey(180, 1))?.categoryId, -2_000_180);
  // Four at 75% are not, but four at 85%+ would be — this cluster sits below it.
  assert.equal(consensus.get(recordCodeKey(62, 1)), undefined);
  // Three split two-to-one are not evidence at any size.
  assert.equal(consensus.get(recordCodeKey(77, 1)), undefined);
});

test("draws an envelope whose category did not decode instead of dropping it", () => {
  const envelope = (elementId: number, recordCode: number, recordCount: number): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode,
    recordCount,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
  });
  const wall = envelope(1, 30, 5);
  // No decoded category and a record code outside the heuristic table.
  const unnamed = envelope(2, 4_242, 7);
  // A curtain-wall container, whose panels and mullions are drawn instead.
  const wrapper = envelope(3, 30, 9);
  // The facade that stands in the container's place. Without it the container
  // is not a container, and holding it back would just be a hole; see the test
  // below.
  const panel = (elementId: number): ElementBoundsRecord => ({
    ...envelope(elementId, 114, 1),
    categoryId: -2_000_170,
    boundsFeet: { min: { x: 1, y: 1, z: 1 }, max: { x: 3, y: 3, z: 9 } },
  });

  assert.equal(displayRole(unnamed), "unknown");
  const selection = selectDisplayBounds([wall, unnamed, wrapper, panel(4), panel(5)]);
  const drawn = selection.records.map((record) => record.elementId);
  // The envelope came from the same validated signature as the wall's, so a
  // missing label must not turn into a missing building element.
  assert.deepEqual(drawn, [1, 2, 4, 5]);
  assert.deepEqual(
    selection.openingWrappers.map((record) => record.elementId),
    [3],
    "the same proven wrapper id must also be excluded from native mesh admission",
  );
  assert.equal(selection.unclassifiedCount, 1);
  assert.equal(selection.omittedWrapperCount, 1);
  assert.equal(selection.omittedSheetCount, 0);
});

test("draws a curtain-wall container that has no facade standing in its place", () => {
  // The hold-back is a trade: one container hidden so its panels and mullions
  // stay visible. Where no panel or mullion was recovered there is nothing to
  // trade for, and the supplied model has 33 such records — 27 of them ordinary
  // walls the export names, suppressed by a rule that only assumed a facade was
  // there.
  const envelope = (elementId: number, recordCount: number): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 30,
    recordCount,
    categoryId: -2_000_011,
    categoryName: "Walls",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 1, z: 10 } },
  });
  const lonely = envelope(1, 9);
  const neighbour = envelope(2, 5);

  assert.equal(displayRole(lonely), "wrapper");
  const selection = selectDisplayBounds([lonely, neighbour]);
  assert.deepEqual(selection.records.map((record) => record.elementId), [1, 2]);
  assert.equal(selection.omittedWrapperCount, 0);
  // And it reaches a mesh rather than being skipped a second time downstream.
  const meshes = buildBoundsMeshes([lonely], { x: 0, y: 0, z: 0 });
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0]!.indices.length / 3, 12);
});

test("draws a named wall whose own analytic planes rebuilt a solid", () => {
  const wall: ElementBoundsRecord = {
    elementId: 308_954,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 30,
    recordCount: 9,
    categoryId: -2_000_011,
    categoryName: "Walls",
    typeName: "Interior Wall - 400mm",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 1, z: 10 } },
    solid: {
      elementId: 308_954,
      start: { x: 0, y: 0.5 },
      end: { x: 10, y: 0.5 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 1,
    },
  };
  const panel: ElementBoundsRecord = {
    ...wall,
    elementId: 4,
    recordCode: 114,
    recordCount: 1,
    categoryId: -2_000_170,
    categoryName: "Curtain Wall Panels",
    typeName: undefined,
    solid: undefined,
  };

  assert.equal(displayRole(wall), "wall");
  const selection = selectDisplayBounds([wall, panel]);
  assert.deepEqual(selection.records.map((record) => record.elementId), [308_954, 4]);
  assert.equal(selection.omittedWrapperCount, 0);
});

test("holds back a floor's own boundary sketch, drawn as a second slab", () => {
  // Revit keeps the sketch as an element one id below the floor: same
  // footprint, no thickness, no category. Extruding it put a sheet over every
  // floor in the supplied model.
  const sheet = (elementId: number, extra: Partial<ElementBoundsRecord>): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: { min: { x: 0, y: 0, z: 40 }, max: { x: 142, y: 156, z: 40.66 } },
    ...extra,
  });
  const floor = sheet(1495202, { categoryId: -2000032, categoryName: "Floors" });
  const sketch = sheet(1495201, {
    boundsFeet: { min: { x: 0, y: 0, z: 40.66 }, max: { x: 142, y: 156, z: 40.66 } },
    loops: [[[0, 0, 40.66], [142, 0, 40.66], [142, 156, 40.66], [0, 156, 40.66]]],
  });

  const selection = selectDisplayBounds([floor, sketch]);
  assert.deepEqual(selection.records.map((record) => record.elementId), [1495202]);
  assert.equal(selection.omittedSheetCount, 1);

  // The same ring under a decoded category is a real flat ceiling, and stays.
  const ceiling = { ...sketch, categoryId: -2000038, categoryName: "Ceilings" };
  const kept = selectDisplayBounds([floor, ceiling]);
  assert.equal(kept.records.length, 2);
  assert.equal(kept.omittedSheetCount, 0);
});

test("gives a stair run its own box from the companion record beside it", () => {
  // A run's record holds the run's plan and the whole stair's storey z-band. On
  // a switchback there are two runs and a landing inside one band, so each run
  // is drawn to the full storey while occupying half of it. The run's own
  // elevations are in an ordinary bounds record filed under its id + 1 — its
  // Sketch element — under record code 169671, which the decoder was already
  // reading and drawing as an anonymous element beside its oversized parent.
  const record = (elementId: number, code: number, minZ: number, maxZ: number): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: code,
    recordCount: 1,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    boundsFeet: { min: { x: 0, y: 0, z: minZ }, max: { x: 10, y: 4, z: maxZ } },
  });
  // The storey band, and the companion holding the flight's own rise.
  const run = record(2474571, 81, 0, 9.84);
  const companion = record(2474572, 169_671, 0, 4.92);

  const selection = selectDisplayBounds([run, companion]);
  // The companion is not an element: the export names none of the 111 in the
  // supplied model, and its box now belongs to the run.
  assert.deepEqual(selection.records.map((entry) => entry.elementId), [2474571]);
  assert.equal(selection.omittedSheetCount, 1);

  // A companion whose stair part was never recovered is its only trace.
  const orphan = selectDisplayBounds([companion, record(9, 81, 0, 9.84)]);
  assert.equal(orphan.records.length, 2);
  assert.equal(orphan.omittedSheetCount, 0);
});

test("draws an element's envelope rather than a fragment of its faces", () => {
  // Native faces used to outrank the envelope. Measured against the paired
  // export across every class that owns them the envelope is closer for 168 of
  // the 225 elements concerned — walls by 31.84 ft against 0.00 — because a
  // face set is usually a fragment of the element rather than a shape.
  const record: ElementBoundsRecord = {
    elementId: 2474572,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000919,
    categoryName: "Stairs Runs",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 4, z: 8 } },
    quads: [{
      elementId: 2474572,
      corners: [[0, 0, 0], [10, 0, 0], [10, 4, 0], [0, 4, 0]],
    }],
  } as ElementBoundsRecord;

  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  const heights = [];
  for (let vertex = 2; vertex < mesh.positions.length; vertex += 3) heights.push(mesh.positions[vertex]!);
  // The single flat face would be drawn 0.02 ft thick; the envelope is 8 ft.
  assert.ok(Math.abs(Math.max(...heights) - 8) < 1e-4, "drew the face instead of the envelope");
});

test("sweeps a railing along its path instead of filling its bounding box", () => {
  // A railing that runs around three sides of an atrium has an axis-aligned box
  // the size of the atrium; drawing that box lays a slab across the floor. The
  // export's box is identical, so no comparison against it registers the
  // problem — only looking at the model does.
  const record: ElementBoundsRecord = {
    elementId: 1856525,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000126,
    categoryName: "Stairs Railing",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 80, z: 3.6 } },
    railPath: {
      polylines: [[[0, 0, 0], [100, 0, 0]], [[100, 0, 0], [100, 80, 0]]],
      guardHeightFeet: 3.6,
    },
  };

  const [mesh] = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.ok(mesh);
  // Two segments, twelve triangles each, rather than one box of twelve.
  assert.equal(mesh.indices.length / 3, 24);

  // Nothing is drawn away from the path: every vertex sits within the rail's
  // own width of one of the two runs, so the middle of the atrium stays empty.
  const onPath = (x: number, y: number) =>
    (Math.abs(y) <= 0.1 && x >= -0.1 && x <= 100.1) || (Math.abs(x - 100) <= 0.1 && y >= -0.1 && y <= 80.1);
  for (let vertex = 0; vertex < mesh.positions.length; vertex += 3) {
    assert.ok(
      onPath(mesh.positions[vertex]!, mesh.positions[vertex + 1]!),
      `vertex ${mesh.positions[vertex]}, ${mesh.positions[vertex + 1]} is off the rail path`,
    );
  }
  // The guard rises from the path, so the drawn height is the guard height.
  const heights = [];
  for (let vertex = 2; vertex < mesh.positions.length; vertex += 3) heights.push(mesh.positions[vertex]!);
  assert.equal(Math.min(...heights), 0);
  // Float32 positions, so exact equality is not the test.
  assert.ok(Math.abs(Math.max(...heights) - 3.6) < 1e-4);
});

test("holds back a railing's top rail when its railing is in the scene", () => {
  // Revit records the top rail's envelope as the whole railing's and folds it
  // into the one IfcRailing on export, so drawing it lays a second plate along
  // a railing already there. The evidence is the duplicate footprint: a top
  // rail on a stair carries the railing's whole rise, so a thickness test would
  // keep exactly the ones that hide the most.
  const rail = (elementId: number, categoryId: number, maxZ: number): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId,
    boundsFeet: { min: { x: 0, y: 0, z: 10 }, max: { x: 175, y: 136, z: maxZ } },
  });
  const railing = rail(1856525, -2000126, 13.6);
  const topRail = rail(1857537, -2000946, 34.9);

  const selection = selectDisplayBounds([railing, topRail]);
  assert.deepEqual(selection.records.map((record) => record.elementId), [1856525]);
  assert.equal(selection.omittedSheetCount, 1);

  // A top rail whose railing was never recovered is the only trace of that
  // railing, so it stays.
  const orphan = selectDisplayBounds([topRail, rail(9, -2000032, 12)]);
  assert.equal(orphan.records.length, 2);
  assert.equal(orphan.omittedSheetCount, 0);

  // A stair railing's envelope follows its sloped path, so the corner match
  // can miss its own top rail by a few feet while the plans still lie on top
  // of each other — top rail 2087621 on the supplied model misses its railing
  // by 1.22 ft at the worst corner yet overlaps it by 99% of its plan area.
  const drifted: ElementBoundsRecord = {
    ...rail(1856525, -2000126, 13.6),
    boundsFeet: { min: { x: -2, y: -2, z: 10 }, max: { x: 173, y: 134, z: 13.6 } },
  };
  const held = selectDisplayBounds([drifted, topRail]);
  assert.deepEqual(held.records.map((record) => record.elementId), [1856525]);
  assert.equal(held.omittedSheetCount, 1);

  // A railing covering only a corner of the top rail's plan is a neighbour,
  // not the parent: the two orphaned top rails on the supplied model overlap
  // their nearest railing by at most 8%.
  const neighbour: ElementBoundsRecord = {
    ...rail(1856525, -2000126, 13.6),
    boundsFeet: { min: { x: 140, y: 110, z: 10 }, max: { x: 260, y: 200, z: 13.6 } },
  };
  const kept = selectDisplayBounds([neighbour, topRail]);
  assert.equal(kept.records.length, 2);
  assert.equal(kept.omittedSheetCount, 0);
});

test("a wall whose wrapper consumes every cell is all opening, not an envelope", () => {
  // Walls 331585 and 530175 on the supplied model are thin diagonal
  // storefront hosts fully covered by their curtain wrappers. When
  // cutSolidAroundWrappers returns no cells the wall must not fall through to
  // its envelope box: that redraws, as the axis-aligned box over the whole
  // diagonal, exactly the volume the wrapper carved away.
  const wall: ElementBoundsRecord = {
    elementId: 331585,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryId: -2000011,
    boundsFeet: { min: { x: 0, y: -0.33, z: 0 }, max: { x: 20, y: 0.33, z: 10 } },
    solids: [{
      elementId: 331585,
      start: { x: 0, y: 0 },
      end: { x: 20, y: 0 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 0.66,
    }],
  };
  const wrapper: ElementBoundsRecord = {
    elementId: 900001,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: { min: { x: -1, y: -1, z: -1 }, max: { x: 21, y: 1, z: 11 } },
  };
  const consumed = buildBoundsMeshes([wall], { x: 0, y: 0, z: 0 }, [wrapper]);
  const triangles = consumed.reduce((total, mesh) => total + mesh.indices.length / 3, 0);
  assert.equal(triangles, 0);

  // Without the wrapper the same wall still draws its rebuilt solid.
  const [kept] = buildBoundsMeshes([wall], { x: 0, y: 0, z: 0 });
  assert.ok(kept);
  assert.equal(kept.indices.length / 3, 12);
});

test("holds back a storey-sized plate that no category claims", () => {
  // Size alone proves nothing — real slabs are larger than these. Size with no
  // category is the discriminator, and it is what put 89 ft of sheet outside
  // the building.
  const plate = (elementId: number, extra: Partial<ElementBoundsRecord>): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 0xffff_ffff,
    recordCount: 4,
    boundsFeet: { min: { x: 0, y: 0, z: 10 }, max: { x: 304, y: 190, z: 10.44 } },
    ...extra,
  });
  const unnamed = plate(2474612, {});
  const namedSlab = plate(490040, { categoryId: -2000032, categoryName: "Floors", recordCode: 54, recordCount: 1 });

  const selection = selectDisplayBounds([unnamed, namedSlab]);
  assert.deepEqual(selection.records.map((record) => record.elementId), [490040]);
  assert.equal(selection.omittedSheetCount, 1);

  // A room-sized envelope with no category is still drawn: the point is not to
  // hide unnamed elements, only unnamed sheets. It needs an ordinary record code
  // to make that point, because the all-ones code the helper defaults to is now
  // its own discriminator — see `NO_CLASS_RECORD_CODE`, which holds back 20 of
  // the 24 plates this size rule was written for.
  const small = plate(2474613, {
    recordCode: 402_488,
    recordCount: 1,
    boundsFeet: { min: { x: 0, y: 0, z: 10 }, max: { x: 20, y: 20, z: 10.44 } },
  });
  const kept = selectDisplayBounds([small, namedSlab]);
  assert.equal(kept.records.length, 2);
  assert.equal(kept.omittedSheetCount, 0);
});

test("holds back an uncategorised record written under the no-class code", () => {
  // `0xffffffff` is not a corrupt record code: every record carrying it also
  // carries `0xffffffff` in the reserved word, so it is a deliberate "no class"
  // encoding. Of the 465 such records whose category decodes, 450 — 96.8% —
  // carry a drawing aid or an assembly container, against 1.3% of the 31,359
  // categorised records with an ordinary code; and of the 304 that reached the
  // scene the paired export gave mesh geometry to none.
  const record = (elementId: number, extra: Partial<ElementBoundsRecord>): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 0xffff_ffff,
    recordCount: 4,
    boundsFeet: { min: { x: 0, y: 0, z: 8.6 }, max: { x: 82, y: 81, z: 9 } },
    ...extra,
  });
  const noClass = record(1270487, {});
  const wall = record(290064, {
    recordCode: 30,
    recordCount: 5,
    categoryId: -2000011,
    categoryName: "Walls",
  });

  const selection = selectDisplayBounds([noClass, wall]);
  assert.deepEqual(selection.records.map((entry) => entry.elementId), [290064]);
  assert.equal(selection.omittedSheetCount, 1);

  // Anonymity is load-bearing. `Stairs Paths`, `Sketch Lines` and
  // `Stairs Sketch Boundary Lines` land on this code too, and the export names
  // 18 of 20, 1 of 1 and 12 of 12 of them as stairs, stair flights and a
  // covering — real elements that inherited a drawing aid's category. Dropping
  // the code by name would take them with it.
  const stairsPath = record(2130746, { categoryId: -2000133, categoryName: "Stairs Paths" });
  const kept = selectDisplayBounds([stairsPath, wall]);
  assert.equal(kept.records.length, 2);
  assert.equal(kept.omittedSheetCount, 0);

  // And an ordinary record code with no category is still drawn, because an
  // unnamed box in the right place beats a hole in the building.
  const unnamed = record(2140033, { recordCode: 402_488, recordCount: 1 });
  const drawn = selectDisplayBounds([unnamed, wall]);
  assert.equal(drawn.records.length, 2);
  assert.equal(drawn.omittedSheetCount, 0);
});

test("suppresses a stair assembly whose native run is outside the display subset", () => {
  const record = (
    elementId: number,
    extra: Partial<ElementBoundsRecord>,
  ): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 16, y: 13, z: 10 },
    },
    ...extra,
  });
  const assemblies = stairAssembliesWithRecoveredNativeRuns(
    [
      record(1280525, {
        categoryId: -2000120,
        categoryName: "Stairs",
        orientedBox: [
          [0, 0, 0], [16, 0, 0], [16, 13, 0], [0, 13, 0],
          [0, 0, 10], [16, 0, 10], [16, 13, 10], [0, 13, 10],
        ],
      }),
      // Flight 1280585 is intentionally represented only by native admission;
      // it need not be present in `displayBounds` for the aggregate to resolve.
      record(1280585, { categoryId: -2000919, categoryName: "Stairs Runs" }),
    ],
    [{ elementId: 1280585, stairsId: 1280525 }],
    new Set([1280585]),
    new Set(),
  );
  assert.deepEqual([...assemblies], [1280525]);
  assert.deepEqual(
    [...stairAssembliesWithRecoveredNativeRuns(
      [record(1280585, { categoryId: -2000919, categoryName: "Stairs Runs" })],
      [{ elementId: 1280585, stairsId: 1280525 }],
      new Set(),
      new Set(),
    )],
    [],
    "an unresolved child cannot erase its assembly fallback",
  );
});

test("identifies only unresolved stair and railing drawing aids as proxy helpers", () => {
  // A Revit Stairs element is an assembly container. The runs, landings and
  // supports remain independent scene elements, so its unresolved envelope
  // must not become one solid box around the whole staircase.
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000120,
    categoryName: "Stairs",
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000120,
    categoryName: "Stairs",
    stairTreads: [
      [[0, 0, 1], [0, 1, 1], [2, 1, 1], [2, 0, 1]],
    ],
  }), false);
  // The reported staircase boxes are uncategorised BaseRailingSym records.
  // Their native class marker identifies the baluster-set container even when
  // the BuiltInCategory token is absent.
  assert.equal(isStairOrRailingHelperProxy({}, 605), true);
  assert.equal(isStairOrRailingHelperProxy({
    orientedBox: [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
  }, 605), false);
  // TopRailType definitions that fail native closure are not physical boxes;
  // the owning railing remains the scene element.
  assert.equal(isStairOrRailingHelperProxy({}, 967), true);
  assert.equal(isStairOrRailingHelperProxy({
    railPath: { polylines: [[[0, 0, 0], [1, 0, 1]]], guardHeightFeet: 3 },
  }, 967), false);
  assert.equal(isStairOrRailingHelperProxy({}, 3462), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000954,
    categoryName: "Railing Rail Path Extension Lines",
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000938,
    categoryName: "Stairs Paths",
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000067,
    categoryName: "Stairs Sketch Boundary Lines",
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000067,
    categoryName: "Stairs Sketch Boundary Lines",
    stairTreads: [
      [[0, 0, 1], [0, 1, 1], [2, 1, 1], [2, 0, 1]],
    ],
  }), false);
  // A baluster record is the per-railing set container, not a baluster; its
  // fallback envelope is a solid wall standing in the railing's run.
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000127,
    categoryName: "Stairs Railing Baluster",
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000127,
    categoryName: "Stairs Railing Baluster",
    solid: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } as never,
  }), false);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000126,
    categoryName: "Stairs Railing",
  }), false);
  assert.equal(isStairOrRailingHelperProxy({
    categoryId: -2000180,
    categoryName: "Stairs Stringer Carriage",
  }), false);
  assert.equal(isStairOrRailingHelperProxy({
    categoryName: "Stairs Stringer Carriage",
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0.05, y: 0.08, z: 9.84 },
    },
  }), true);
  assert.equal(isStairOrRailingHelperProxy({
    categoryName: "Stairs Stringer Carriage",
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0.05, y: 0.08, z: 9.84 },
    },
    orientedBox: [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
  }), false);
});

test("classifies exact native ramp, top-rail, baluster, and footprint-roof evidence", () => {
  const blank = {
    recordCode: 0,
    recordCount: 0,
  };
  assert.equal(
    categoryFromNativeObjectEvidence(blank, new Set([3462])),
    -2_000_180,
  );
  assert.equal(
    categoryFromNativeObjectEvidence(blank, new Set([967])),
    -2_000_946,
  );
  assert.equal(
    categoryFromNativeObjectEvidence(
      {
        ...blank,
        orientedBox: [
          [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
          [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
        ],
      },
      new Set([605]),
    ),
    -2_000_127,
  );
  assert.equal(
    categoryFromNativeObjectEvidence(
      {
        recordCode: 58,
        recordCount: 1,
        parameters: [{
          parameterId: -1_001_705,
          name: "Maximum Ridge Height",
          value: 19.7,
        }],
      },
      undefined,
    ),
    -2_000_035,
  );
  assert.equal(
    categoryFromNativeObjectEvidence(
      { recordCode: 54, recordCount: 1, parameters: [{ parameterId: -1_001_705, name: "Maximum Ridge Height", value: 1 }] },
      undefined,
    ),
    undefined,
  );
  assert.equal(
    categoryFromNativeObjectEvidence(blank, new Set([605])),
    undefined,
  );
});

test("removes unplaced native definitions without removing instances or named elements", () => {
  const unnamed = { categoryId: undefined, categoryName: undefined };
  assert.equal(isNonSceneObjectDefinition(unnamed, new Set([974]), false), true);
  assert.equal(isNonSceneObjectDefinition(unnamed, new Set([0x0810]), false), true);
  assert.equal(isNonSceneObjectDefinition(unnamed, new Set([0x0810]), true), false);
  assert.equal(
    isNonSceneObjectDefinition(
      { categoryId: -2_000_023, categoryName: "Doors" },
      new Set([0x0810]),
      false,
    ),
    false,
  );
});

test("removes a dense family-local datum pile while preserving placed and level-related doors", () => {
  const record = (
    elementId: number,
    x: number,
    y: number,
    categoryName: string | undefined = "Doors",
  ): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryName,
    boundsFeet: {
      min: { x: x - 0.5, y: y - 0.5, z: 0 },
      max: { x: x + 0.5, y: y + 0.5, z: 7 },
    },
  });
  const building = Array.from({ length: 520 }, (_, index) =>
    record(index + 1, 100 + index, 80, "Walls"));
  const pile = Array.from({ length: 30 }, (_, index) =>
    record(1_000 + index, 0, 1.9, index % 2 ? "Doors" : undefined));
  const placed = record(2_000, 0, 1.5);
  const levelRelated = record(2_001, 1.5, 1.5, "Windows");

  const ids = residualDatumPileElementIds(
    [...building, ...pile, placed, levelRelated],
    new Set([placed.elementId]),
    new Set([levelRelated.elementId]),
  );
  assert.deepEqual([...ids].sort((a, b) => a - b), pile.map((item) => item.elementId));
});

test("does not call a small component or a few origin elements a datum pile", () => {
  const records: ElementBoundsRecord[] = Array.from({ length: 40 }, (_, index) => ({
    elementId: index + 1,
    stream: "component",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    categoryName: "Doors",
    boundsFeet: {
      min: { x: -1, y: -1, z: 0 },
      max: { x: 1, y: 1, z: 7 },
    },
  }));
  assert.equal(residualDatumPileElementIds(records, new Set(), new Set()).size, 0);

  const largeBuilding = Array.from({ length: 520 }, (_, index) => ({
    ...records[0]!,
    elementId: 100 + index,
    boundsFeet: {
      min: { x: 100 + index, y: 80, z: 0 },
      max: { x: 101 + index, y: 81, z: 7 },
    },
  }));
  assert.equal(
    residualDatumPileElementIds([...largeBuilding, ...records.slice(0, 5)], new Set(), new Set()).size,
    0,
  );
});

test("keeps stair companions and categoryless flat face hulls out of native mesh batches", () => {
  const makeRecord = (
    elementId: number,
    extra: Partial<ElementBoundsRecord> = {},
  ): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 4, y: 4, z: 4 },
    },
    ...extra,
  });
  const owner = makeRecord(100);
  const companion = makeRecord(101, { recordCode: 169671, recordCount: 1 });
  const orphanCompanion = makeRecord(201, { recordCode: 169671, recordCount: 1 });
  const flatFaceHull = makeRecord(300, {
    recordOffset: -1,
    boundsFeet: {
      min: { x: 0, y: 0, z: 7 },
      max: { x: 2, y: 3, z: 7 },
    },
    quads: [{
      elementId: 300,
      corners: [[0, 0, 7], [2, 0, 7], [2, 3, 7], [0, 3, 7]],
    }],
  });
  const namedFlatFaceHull = {
    ...flatFaceHull,
    elementId: 301,
    categoryId: -2_000_032,
    categoryName: "Floors",
  };

  assert.deepEqual(
    [...nonSceneNativeMeshHelperIds([
      owner,
      companion,
      orphanCompanion,
      flatFaceHull,
      namedFlatFaceHull,
    ])].sort((left, right) => left - right),
    [101, 300],
  );
});

test("filters excluded element triangles and preserves the batch material", () => {
  const mesh = {
    name: "mixed native batch",
    positions: new Float32Array(12),
    indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
    colors: new Float32Array(16),
    materialIndex: 4,
    elementIds: new Uint32Array([10, 20]),
    source: "native-brep" as const,
  };
  const filtered = excludeMeshElementIds([mesh], new Set([10]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.materialIndex, 4);
  assert.deepEqual([...filtered[0]!.indices], [1, 2, 3]);
  assert.deepEqual([...filtered[0]!.elementIds!], [20]);
  assert.deepEqual(excludeMeshElementIds([mesh], new Set([10, 20])), []);
});

test("suppresses only proven curtain assembly envelopes over resolved children", () => {
  const makeRecord = (
    elementId: number,
    extra: Partial<ElementBoundsRecord>,
  ): ElementBoundsRecord => ({
    elementId,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 4, y: 4, z: 8 },
    },
    ...extra,
  });
  const curtainWall = makeRecord(100, {
    categoryId: -2000011,
    categoryName: "Walls",
    recordCode: 30,
    recordCount: 10,
  });
  const gridCell = makeRecord(101, {
    recordCode: 34_702,
    recordCount: 1,
  });
  const panel = makeRecord(102, {
    categoryId: -2000170,
    categoryName: "Curtain Wall Panels",
    recordCode: 114,
    recordCount: 1,
    orientedBox: [
      [0, 0, 0], [1, 0, 0], [1, 0.1, 0], [0, 0.1, 0],
      [0, 0, 1], [1, 0, 1], [1, 0.1, 1], [0, 0.1, 1],
    ],
  });
  const aggregate = makeRecord(200, {
    categoryId: -2000171,
    categoryName: "Curtain Wall Mullions",
    recordCode: 0xffff_ffff,
    recordCount: 5,
  });
  const mullion = makeRecord(201, {
    categoryId: -2000171,
    categoryName: "Curtain Wall Mullions",
    recordCode: 116,
    recordCount: 1,
  });
  const ordinaryUnknown = makeRecord(300, {
    recordCode: 34_702,
    recordCount: 1,
  });
  const relations = [
    { ownerId: 100, elementId: 101 },
    { ownerId: 100, elementId: 102 },
    { ownerId: 200, elementId: 201 },
    { ownerId: 300, elementId: 300 },
  ];

  assert.deepEqual(
    [...curtainAssemblyHelperProxyIds(
      [curtainWall, gridCell, panel, aggregate, mullion, ordinaryUnknown],
      relations,
      new Set([102, 201]),
    )].sort((left, right) => left - right),
    [101, 200],
  );

  // If the facade child never reached the scene, the envelope remains the only
  // evidence and must not be removed.
  assert.equal(
    curtainAssemblyHelperProxyIds(
      [curtainWall, gridCell, panel],
      relations.slice(0, 2),
      new Set(),
    ).size,
    0,
  );
});

test("batches an uncategorised envelope under its own neutral role", () => {
  const record: ElementBoundsRecord = {
    elementId: 9,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 4_242,
    recordCount: 7,
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 8 } },
  };
  const meshes = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  assert.equal(meshes.length, 1);
  assert.match(meshes[0]!.name, /Uncategorised/);
  assert.equal(meshes[0]!.materialIndex, 0);
  assert.equal(meshes[0]!.indices.length / 3, 12);
});

test("draws every solid a multi-segment element was rebuilt from", () => {
  const solid = (startX: number, endX: number) => ({
    elementId: 11,
    start: { x: startX, y: 0 },
    end: { x: endX, y: 0 },
    baseElevation: 0,
    topElevation: 10,
    thickness: 0.5,
  });
  const record: ElementBoundsRecord = {
    elementId: 11,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    recordCode: 30,
    recordCount: 5,
    boundsFeet: { min: { x: 0, y: -1, z: 0 }, max: { x: 30, y: 1, z: 10 } },
    solid: solid(0, 20),
    solids: [solid(0, 20), solid(20, 30)],
  };
  const meshes = buildBoundsMeshes([record], { x: 0, y: 0, z: 0 });
  // Both runs are the element's own rebuilt geometry; drawing only the longest
  // leaves a gap in the wall where the shorter segment should be.
  assert.equal(meshes[0]!.indices.length / 3, 24);
  // Picking indexes by triangle, so every triangle still maps back to element 11.
  assert.equal(meshes[0]!.elementIds?.length, 24);
  assert.ok([...meshes[0]!.elementIds!].every((elementId) => elementId === 11));
});

test("seeds an object chain from markers when a page carries no bounds record", () => {
  const data = new Uint8Array(256);
  const view = new DataView(data.buffer);
  const start = 100;
  const objectLength = 64;
  view.setUint32(start, 290_064, true);
  view.setUint32(start + 12, objectLength, true);
  view.setUint16(start + 16, 0x08c6, true);
  view.setUint32(start + objectLength + 16, objectLength, true);
  // A marker-shaped pair whose candidate object has no matching length echo.
  view.setUint16(220, 0x08c6, true);

  assert.deepEqual(markerObjectSeeds(data), [start]);
  // A page with no bounds record used to go unwalked, taking every placement
  // and shared shape on it out of the model.
  const chained = chainElementObjects(data, markerObjectSeeds(data));
  assert.deepEqual(chained.map((object) => object.elementId), [290_064]);
});

test("frames the scene to the building rather than to a displaced outlier", () => {
  const envelope = (x: number, y: number): ElementBoundsRecord => ({
    elementId: 1,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: { min: { x, y, z: 0 }, max: { x: x + 4, y: y + 4, z: 10 } },
  });
  const building = Array.from({ length: 3_000 }, (_, index) =>
    envelope((index % 60) * 5, Math.floor(index / 60) * 5));
  // Three misparsed records thousands of feet away. Taking the absolute extent
  // puts the centre of the scene in empty ground, and the camera with it.
  const strays = [envelope(0, -4_000), envelope(50, -3_900), envelope(90, -3_800)];

  const absolute = boundsOfRecords([...building, ...strays]);
  const framing = framingBoundsOfRecords([...building, ...strays]);
  assert.equal(absolute.min.y, -4_000);
  assert.equal(framing.min.y, 0);
  assert.equal(framing.max.y, boundsOfRecords(building).max.y);
  // Nothing is discarded — this decides where the viewer looks, not what exists.
  assert.equal(framing.min.x, 0);
});

test("keeps the absolute extent when there are too few records to trim a tail", () => {
  const records: ElementBoundsRecord[] = Array.from({ length: 20 }, (_, index) => ({
    elementId: index,
    stream: "Partitions/325",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: { min: { x: index, y: 0, z: 0 }, max: { x: index + 1, y: 1, z: 1 } },
  }));
  assert.deepEqual(framingBoundsOfRecords(records), boundsOfRecords(records));
});

test("reads a shared shape whose bounds sit behind a longer field table", () => {
  // The AABB is framed as `42 + 6 * recordCount`, exactly as it is in the
  // element bounds record. Reading a fixed +48 is only the count == 1 case, and
  // every shape with a longer field table was rejected because of it.
  const count = 3;
  const at = 42 + count * 6;
  const data = new Uint8Array(at + 96 + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 290_064, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, count, true);
  view.setUint32(42, 3, true);
  const box = [-1, -2, -3, 4, 5, 6];
  for (let copy = 0; copy < 2; copy += 1) {
    for (let field = 0; field < 6; field += 1) {
      view.setFloat64(at + copy * 48 + field * 8, box[field]!, true);
    }
  }

  const local = readLocalBounds(data, {
    offset: 0, elementId: 290_064, objectLength: 6_179, marker: 0x08c6, typeCode: 0,
  });
  assert.ok(local);
  assert.deepEqual(local.min, [-1, -2, -3]);
  assert.deepEqual(local.max, [4, 5, 6]);
});

test("ignores a shape whose two bounds copies disagree", () => {
  const count = 2;
  const at = 42 + count * 6;
  const data = new Uint8Array(at + 96 + 20);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, count, true);
  view.setUint32(42, 3, true);
  for (let field = 0; field < 6; field += 1) {
    view.setFloat64(at + field * 8, field, true);
    view.setFloat64(at + 48 + field * 8, field + 1, true);
  }
  // The framed read is refused, so whatever the fixed +48 fallback returns, it
  // is not the disagreeing block — a shape is never built from bytes that
  // failed their own duplication check.
  const local = readLocalBounds(data, {
    offset: 0, elementId: 1, objectLength: 900, marker: 0x08c6, typeCode: 0,
  });
  assert.notDeepEqual(local?.min, [0, 1, 2]);
  assert.notDeepEqual(local?.max, [3, 4, 5]);
});

test("measures the object markers a file uses instead of assuming one", () => {
  // 0x08c6 is not the only object class in the stream. In the supplied project
  // 0x07ef heads the objects of thousands of elements that no other pass sees,
  // so the markers worth seeding from are read from the file.
  const data = new Uint8Array(512);
  const view = new DataView(data.buffer);
  const write = (start: number, elementId: number, marker: number, objectLength: number) => {
    view.setUint32(start, elementId, true);
    view.setUint32(start + 12, objectLength, true);
    view.setUint16(start + 16, marker, true);
    view.setUint32(start + objectLength + 16, objectLength, true);
  };
  write(0, 290_064, 0x08c6, 64);
  write(84, 290_210, 0x07ef, 64);
  // A marker with no matching length echo behind it is not an object.
  view.setUint16(300, 0x07ef, true);

  const markers = scanObjectMarkers(data);
  assert.equal(markers.get(0x08c6), 1);
  assert.equal(markers.get(0x07ef), 1);
  assert.deepEqual(
    [...markers.keys()].sort((a, b) => a - b),
    [0x07ef, 0x08c6],
  );
});

test("reads the tighter bounds copy when the two disagree", () => {
  // Requiring the copies to match rejected the record outright, which cost 994
  // walls. Against the paired export the second copy reproduces the exported
  // wall for 757 of 757 such objects, and a mismatched target matches none.
  const data = new Uint8Array(200);
  const view = new DataView(data.buffer);
  view.setUint32(0, 700_001, true);
  view.setUint16(16, 0x08c6, true);
  view.setUint32(18, 30, true);
  view.setUint32(26, 700_001, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, 5, true);
  view.setUint32(42, 3, true);
  // The stale copy encloses far more than the element does.
  const stale = [-400, -400, -400, 400, 400, 400];
  const real = [10.5, -20.25, 0, 11.5, -4.75, 13.5];
  stale.forEach((value, index) => view.setFloat64(72 + index * 8, value, true));
  real.forEach((value, index) => view.setFloat64(120 + index * 8, value, true));

  const record = detectDuplicatedBoundsRecord(data);
  assert.ok(record);
  assert.equal(record.duplicated, false);
  assert.deepEqual(record.boundsFeet, {
    min: { x: real[0], y: real[1], z: real[2] },
    max: { x: real[3], y: real[4], z: real[5] },
  });
});

test("prefers the tighter copy even when it is written first", () => {
  // Reading the second copy always was a wall rule. Held out against the
  // classes it was never fitted to it still wins, but it also admits a few
  // wild boxes — one 8,701 ft out. Taking whichever copy encloses less keeps
  // the same 95.9% within 0.05 ft and cuts the worst case tenfold.
  const data = new Uint8Array(200);
  const view = new DataView(data.buffer);
  view.setUint32(0, 700_002, true);
  view.setUint16(16, 0x08c6, true);
  view.setUint32(18, 116, true);
  view.setUint32(26, 700_002, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, 5, true);
  view.setUint32(42, 3, true);
  const real = [1, 2, 3, 2, 4, 9];
  const wild = [-900, -900, -900, 900, 900, 900];
  real.forEach((value, index) => view.setFloat64(72 + index * 8, value, true));
  wild.forEach((value, index) => view.setFloat64(120 + index * 8, value, true));

  const record = detectDuplicatedBoundsRecord(data);
  assert.ok(record);
  assert.deepEqual(record.boundsFeet, {
    min: { x: real[0], y: real[1], z: real[2] },
    max: { x: real[3], y: real[4], z: real[5] },
  });
});
