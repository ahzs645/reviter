import assert from "node:assert/strict";
import test from "node:test";

import { detectElemTableLayout, parseElemTable } from "../lib/reviter/elem-table.ts";
import { detectDuplicatedBoundsRecord, detectDuplicatedBoundsRecords } from "../lib/reviter/bounds-records.ts";
import { gzipOffsets } from "../lib/reviter/revit-container.ts";
import { parseSchemaTags } from "../lib/reviter/schema.ts";
import { parsePartitionNames } from "../lib/reviter/partition-names.ts";
import { segmentScaleFor } from "../lib/reviter/segment-scan.ts";
import {
  categoryDisplayName,
  collectCategoryTokens,
  deriveRecordCodeCategories,
  recordCodeKey,
  resolveElementCategories,
} from "../lib/reviter/native-categories.ts";
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

test("labels IFC proxies with the decoded Revit category without retyping them", () => {
  const base = boundsResult();
  const record = base.elementBounds[0]!;
  record.categoryId = -2_000_011;
  record.categoryName = "Walls";
  record.categorySource = "native-token";
  const ifc = makeIfcCenterlines(base);
  assert.match(ifc, /IFCBUILDINGELEMENTPROXY\('[^']*',#\d+,'Walls 290618'/);
  assert.match(ifc, /Native Revit category -2000011 \(Walls\), evidence: native-token/);
  // The envelope is still an envelope, so it must not be promoted to IFCWALL.
  assert.equal(/IFCWALL[^T]/.test(ifc), false);
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

test("inventories tagged serializable classes from the embedded schema", () => {
  const encoder = new TextEncoder();
  const build = (entries: [string, number | null][]) => {
    const parts: number[] = [];
    for (const [name, tag] of entries) {
      const bytes = encoder.encode(name);
      parts.push(bytes.length & 0xff, bytes.length >> 8, ...bytes);
      const word = tag == null ? 0 : tag | 0x8000;
      parts.push(word & 0xff, word >> 8);
    }
    return new Uint8Array(parts);
  };

  const classes = parseSchemaTags(build([
    ["ArcWall", 0x01c3],
    ["HostObjAttr", 0x006f],
    // An untagged class is a mixin or embedded type, not a top-level record.
    ["GeomStep", null],
    // A repeat is a reference back to the first declaration.
    ["ArcWall", 0x01c3],
  ]));

  assert.deepEqual(classes.map(({ name, tag }) => ({ name, tag })), [
    { name: "ArcWall", tag: 0x01c3 },
    { name: "HostObjAttr", tag: 0x006f },
  ]);
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
