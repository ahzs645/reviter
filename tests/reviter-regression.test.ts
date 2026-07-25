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
  categoryDisplayName,
  collectCategoryTokens,
  deriveRecordCodeCategories,
  recordCodeKey,
  resolveElementCategories,
} from "../lib/reviter/native-categories.ts";
import { decodeArcWall2023Record, decodeRvtMaterialDefinitions, decoderPlanForVersion } from "../lib/reviter/native-decoder.ts";
import { makeGlb, makeIfcCenterlines } from "../lib/reviter/exports.ts";
import { compareRvtToIfc } from "../lib/reviter/regression.ts";
import { buildBoundsMeshes, displayRole, selectDisplayBounds } from "../lib/reviter/scene.ts";
import type { ConvertResult, ElementBoundsRecord, IfcReferenceManifest, RvtRegressionInput } from "../lib/reviter/types.ts";

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
  const declare = (className: string, tag: number, parent: string, version: number, fields: number) => {
    name(className);
    word(tag | 0x8000);
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
      { className: "HostObjAttr", tag: 0x006f, parent: "Symbol", version: 3 },
      { className: "ArcWall", tag: 0x01c3, parent: "VWall", version: 2 },
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
    ["none", "none"],
    ["none", "none"],
  ]);

  const summary = summariseCoverage(streams);
  assert.deepEqual(
    { full: summary.fullStreams, partial: summary.partialStreams, undecoded: summary.undecodedStreams },
    { full: 1, partial: 1, undecoded: 2 },
  );
  // Largest stream first, so the biggest unread payload is never buried.
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

  assert.equal(displayRole(unnamed), "unknown");
  const selection = selectDisplayBounds([wall, unnamed, wrapper]);
  const drawn = selection.records.map((record) => record.elementId);
  // The envelope came from the same validated signature as the wall's, so a
  // missing label must not turn into a missing building element.
  assert.deepEqual(drawn, [1, 2]);
  assert.equal(selection.unclassifiedCount, 1);
  assert.equal(selection.omittedWrapperCount, 1);
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
