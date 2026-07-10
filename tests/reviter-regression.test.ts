import assert from "node:assert/strict";
import test from "node:test";

import { detectElemTableLayout, parseElemTable } from "../lib/reviter/elem-table.ts";
import { detectDuplicatedBoundsRecord } from "../lib/reviter/convert.ts";
import { makeIfcCenterlines } from "../lib/reviter/exports.ts";
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

test("emits rendered IFC solids from RVT element bounds", () => {
  const result: ConvertResult = {
    ok: true,
    fileName: "sample.rvt",
    byteLength: 1,
    meshes: [],
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
