import assert from "node:assert/strict";
import test from "node:test";

import type { ElementObject } from "../lib/reviter/element-objects.ts";
import type { NativeMaterialDefinition } from "../lib/reviter/material-records.ts";
import {
  bindRevit2027FaceGStyleMaterialFallback,
  decodeRevit2027GStyleElementRecord,
  REVIT_2027_GSTYLE_ELEMENT_MARKER,
  REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH,
  REVIT_2027_GSTYLE_SOURCE_CLASS_SLOT,
  scanRevit2027GStyleElementRecords,
} from "../lib/reviter/revit-2027-gstyle-material.ts";

function fixture(
  {
    elementId = 900,
    materialElementId = 26n,
    sourceClassSlot = REVIT_2027_GSTYLE_SOURCE_CLASS_SLOT,
    screenSized = 0,
  }: {
    elementId?: number;
    materialElementId?: bigint;
    sourceClassSlot?: number;
    screenSized?: number;
  } = {},
): { bytes: Uint8Array; object: ElementObject } {
  const bytes = new Uint8Array(176);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, elementId, true);
  view.setUint32(12, REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH, true);
  view.setUint16(16, REVIT_2027_GSTYLE_ELEMENT_MARKER, true);
  view.setUint32(18, 0, true);
  view.setBigUint64(54, BigInt(elementId), true);
  view.setInt32(121, -1, true);
  view.setUint16(125, sourceClassSlot, true);
  view.setBigInt64(127, -2000011n, true);
  view.setBigInt64(135, -1n, true);
  view.setInt32(143, 1, true);
  view.setBigInt64(147, -3000010n, true);
  view.setBigInt64(155, materialElementId, true);
  view.setInt32(163, 1, true);
  view.setUint32(167, 0xffd23936, true);
  bytes[171] = screenSized;
  view.setUint32(172, REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH, true);
  return {
    bytes,
    object: {
      offset: 0,
      elementId,
      objectLength: REVIT_2027_GSTYLE_ELEMENT_OBJECT_LENGTH,
      marker: REVIT_2027_GSTYLE_ELEMENT_MARKER,
      typeCode: 0,
    },
  };
}

function material(
  elementId: number,
  name = `Material ${elementId}`,
): NativeMaterialDefinition {
  return {
    elementId,
    name,
    recordOffset: 0,
    objectLength: 100,
    objectMarker: 0x0ad3,
    evidence: "framed-material-element-name",
  };
}

test("decodes the queued GStyle material field after GStyleElem static fields", () => {
  const { bytes, object } = fixture();
  const decoded = decodeRevit2027GStyleElementRecord(bytes, object, 2027);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.elementId, 900);
  assert.equal(decoded.value.categoryElementId, -2000011n);
  assert.equal(decoded.value.linePatternElementId, -3000010n);
  assert.equal(decoded.value.materialElementId, 26n);
  assert.equal(decoded.value.color, 0xffd23936);
  assert.equal(decoded.value.isScreenSized, false);
});

test("rejects the release, layout, source slot, flag, and echo independently", () => {
  const base = fixture();
  assert.equal(
    decodeRevit2027GStyleElementRecord(base.bytes, base.object, 2026).ok,
    false,
  );

  const wrongLength = fixture();
  wrongLength.object.objectLength = 180;
  assert.equal(
    decodeRevit2027GStyleElementRecord(
      wrongLength.bytes,
      wrongLength.object,
      2027,
    ).ok,
    false,
  );

  const wrongSlot = fixture({ sourceClassSlot: 2292 });
  assert.equal(
    decodeRevit2027GStyleElementRecord(
      wrongSlot.bytes,
      wrongSlot.object,
      2027,
    ).ok,
    false,
  );

  const wrongFlag = fixture({ screenSized: 2 });
  assert.equal(
    decodeRevit2027GStyleElementRecord(
      wrongFlag.bytes,
      wrongFlag.object,
      2027,
    ).ok,
    false,
  );

  const wrongEcho = fixture();
  new DataView(wrongEcho.bytes.buffer).setUint32(172, 155, true);
  assert.equal(
    decodeRevit2027GStyleElementRecord(
      wrongEcho.bytes,
      wrongEcho.object,
      2027,
    ).ok,
    false,
  );
});

test("scans only exact framed GStyleElem records", () => {
  const exact = fixture({ elementId: 901 });
  const result = scanRevit2027GStyleElementRecords(exact.bytes, 2027);
  assert.equal(result.framedStyleElements, 1);
  assert.equal(result.decodedStyleElements, 1);
  assert.equal(result.records[0]?.elementId, 901);
  assert.equal(result.failures.size, 0);

  assert.equal(
    scanRevit2027GStyleElementRecords(exact.bytes, 2026)
      .decodedStyleElements,
    0,
  );
});

test("uses Face GStyle before Geometry GStyle and binds only a decoded material", () => {
  const face = decodeRevit2027GStyleElementRecord(
    fixture({ elementId: 100, materialElementId: 26n }).bytes,
    fixture({ elementId: 100, materialElementId: 26n }).object,
    2027,
  );
  const geometryFixture = fixture({
    elementId: 200,
    materialElementId: 29n,
  });
  const geometry = decodeRevit2027GStyleElementRecord(
    geometryFixture.bytes,
    geometryFixture.object,
    2027,
  );
  assert.equal(face.ok, true);
  assert.equal(geometry.ok, true);
  if (!face.ok || !geometry.ok) return;

  const result = bindRevit2027FaceGStyleMaterialFallback(
    {
      renderStyleElementId: -1n,
      faceGStyleElementId: 100n,
      geometryGStyleElementId: 200n,
    },
    [face.value, geometry.value],
    [material(26), material(29)],
  );
  assert.equal(result.status, "exact-material");
  if (result.status !== "exact-material") return;
  assert.equal(result.source, "face-gstyle");
  assert.equal(result.materialElementId, 26);
});

test("admits the exact release-2027 non-category system render style", () => {
  const styleFixture = fixture({ elementId: 100, materialElementId: 26n });
  const style = decodeRevit2027GStyleElementRecord(
    styleFixture.bytes,
    styleFixture.object,
    2027,
  );
  assert.equal(style.ok, true);
  if (!style.ok) return;
  const result = bindRevit2027FaceGStyleMaterialFallback(
    {
      renderStyleElementId: -4000010n,
      faceGStyleElementId: 100n,
      geometryGStyleElementId: 200n,
    },
    [style.value],
    [material(26)],
  );
  assert.equal(result.status, "exact-material");
});

test("does not apply node GStyle fallback to an uncertified render style", () => {
  const result = bindRevit2027FaceGStyleMaterialFallback(
    {
      renderStyleElementId: -2n,
      faceGStyleElementId: 100n,
      geometryGStyleElementId: 200n,
    },
    [],
    [],
  );
  assert.deepEqual(result, {
    status: "not-applicable",
    reason: "face-render-style-does-not-enter-node-gstyle-fallback",
  });
});

test("reports missing style and material carriers without guessing", () => {
  const missingStyle = bindRevit2027FaceGStyleMaterialFallback(
    {
      renderStyleElementId: -1n,
      faceGStyleElementId: 100n,
      geometryGStyleElementId: 200n,
    },
    [],
    [],
  );
  assert.equal(missingStyle.status, "unresolved-gstyle");

  const styleFixture = fixture({
    elementId: 100,
    materialElementId: 567932n,
  });
  const style = decodeRevit2027GStyleElementRecord(
    styleFixture.bytes,
    styleFixture.object,
    2027,
  );
  assert.equal(style.ok, true);
  if (!style.ok) return;
  const missingMaterial = bindRevit2027FaceGStyleMaterialFallback(
    {
      renderStyleElementId: -1n,
      faceGStyleElementId: 100n,
      geometryGStyleElementId: -1n,
    },
    [style.value],
    [],
  );
  assert.equal(missingMaterial.status, "unresolved-material");
});
