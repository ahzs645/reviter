import assert from "node:assert/strict";
import test from "node:test";

import {
  REFERENCE_RELEASE,
  activeRelease,
  applyReleaseMarkers,
  registerReleaseMarker,
  releaseDecodersApply,
  releaseMemo,
  resetReleaseMarkers,
} from "../lib/reviter/release-markers.ts";
import { REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-gelement.ts";
import { BOUNDS_RECORD_MARKER, detectDuplicatedBoundsRecords } from "../lib/reviter/bounds-records.ts";
// Imported for its registration of `MaterialElem`, so the registry holds more
// than the one class the two imports above share.
import { REVIT_2027_MATERIAL_ELEMENT_MARKER } from "../lib/reviter/material-records.ts";
import type { SchemaStream, SchemaStreamClass } from "../lib/reviter/schema-reader.ts";

/** A schema stream declaring only the classes a test names, at the indices it gives. */
function schemaWith(classes: Record<string, number>): SchemaStream {
  const list = Object.entries(classes).map(([name, index]) => ({
    index,
    name,
    properties: [],
  }) as unknown as SchemaStreamClass);
  return {
    byteLength: 0,
    consumedBytes: 0,
    terminatorBytes: 8,
    trailingBytes: 0,
    classes: list,
    classesByIndex: new Map(list.map((schemaClass) => [schemaClass.index, schemaClass])),
    topLevelClassCount: list.length,
    propertyCount: 0,
    unresolvedReferences: [],
    inlineIndexMismatches: [],
  };
}

/** Every class the registry needs, at the 2027 index, so a resolution is complete. */
function completeSchema(overrides: Record<string, number> = {}): SchemaStream {
  // Resolve once against an empty schema to learn the registered names from
  // the `missing` list, then declare them all.
  const probe = applyReleaseMarkers(schemaWith({}), 2025);
  const classes: Record<string, number> = {};
  for (const name of probe.missing) classes[name] = 1;
  resetReleaseMarkers();
  // Any index will do for the names a test does not override; the ones it
  // does override are what the assertions read.
  return schemaWith({ ...classes, ...overrides });
}

test("with no resolution the constants hold their 2027 values and only 2027 passes the gate", () => {
  resetReleaseMarkers();
  assert.equal(activeRelease(), REFERENCE_RELEASE);
  assert.equal(REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, 2246);
  assert.equal(BOUNDS_RECORD_MARKER, 0x08c6);
  assert.equal(releaseDecodersApply(2027), true);
  assert.equal(releaseDecodersApply(2025), false);
  assert.equal(releaseDecodersApply(null), false);
});

test("a schema that declares every registered class moves the constants and opens the gate for that release", () => {
  const resolution = applyReleaseMarkers(completeSchema({ GElement: 2166 }), 2025);
  try {
    assert.equal(resolution.resolved, true);
    assert.deepEqual(resolution.missing, []);
    assert.equal(resolution.release, 2025);
    // The measured 2025 index for GElement, read through two different
    // importers: the live binding reaches both.
    assert.equal(REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, 2166);
    assert.equal(BOUNDS_RECORD_MARKER, 2166);
    assert.ok(resolution.shifted.some((entry) => entry.className === "GElement" && entry.index === 2166));
    assert.equal(releaseDecodersApply(2025), true);
    assert.equal(releaseDecodersApply(2027), false);
  } finally {
    resetReleaseMarkers();
  }
  assert.equal(REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, 2246);
  assert.equal(releaseDecodersApply(2027), true);
});

test("a schema missing any registered class leaves the 2027 defaults and names what was missing", () => {
  assert.equal(REVIT_2027_MATERIAL_ELEMENT_MARKER, 0x0ad3);
  const partial = completeSchema({ GElement: 2166 });
  partial.classes = partial.classes.filter((schemaClass) => schemaClass.name !== "MaterialElem");
  const resolution = applyReleaseMarkers(partial, 2025);
  try {
    assert.equal(resolution.resolved, false);
    assert.deepEqual(resolution.missing, ["MaterialElem"]);
    assert.equal(REVIT_2027_MATERIAL_ELEMENT_MARKER, 0x0ad3);
    assert.equal(resolution.release, REFERENCE_RELEASE);
    assert.equal(REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT, 2246);
    assert.equal(releaseDecodersApply(2025), false);
  } finally {
    resetReleaseMarkers();
  }
});

test("no schema or no release resolves nothing", () => {
  assert.equal(applyReleaseMarkers(null, 2025).resolved, false);
  assert.equal(applyReleaseMarkers(completeSchema(), null).resolved, false);
  assert.equal(releaseDecodersApply(2027), true);
  resetReleaseMarkers();
});

test("a registered constant applies on resolution and a memoised table rebuilds with it", () => {
  let value = registerReleaseMarker("GElement", 2246, (next) => { value = next; });
  const table = releaseMemo(() => new Set([value]));
  assert.ok(table().has(2246));
  applyReleaseMarkers(completeSchema({ GElement: 2166 }), 2025);
  try {
    assert.equal(value, 2166);
    assert.ok(table().has(2166));
    assert.ok(!table().has(2246));
  } finally {
    resetReleaseMarkers();
  }
  assert.equal(value, 2246);
  assert.ok(table().has(2246));
});

test("the bounds signature is found under the resolved marker and not under the 2027 one", () => {
  // One synthetic record laid out as bounds-records.ts documents, tagged
  // with the 2025 GElement index.
  const marker = 2166;
  const record = new Uint8Array(200);
  const view = new DataView(record.buffer);
  view.setUint32(0, 123_456, true);
  view.setUint16(16, marker, true);
  view.setUint32(18, 0x22, true);
  view.setUint32(26, 123_456, true);
  view.setUint32(34, 0x0008_8004, true);
  view.setUint32(38, 1, true);
  view.setUint32(42, 3, true);
  const bounds = [0, 0, 0, 10, 4, 12];
  for (let copy = 0; copy < 2; copy += 1) {
    bounds.forEach((coordinate, axis) => view.setFloat64(48 + copy * 48 + axis * 8, coordinate, true));
  }
  resetReleaseMarkers();
  assert.equal(detectDuplicatedBoundsRecords(record).length, 0);
  applyReleaseMarkers(completeSchema({ GElement: marker }), 2025);
  try {
    const found = detectDuplicatedBoundsRecords(record);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.elementId, 123_456);
    assert.deepEqual(found[0]!.boundsFeet.max, { x: 10, y: 4, z: 12 });
  } finally {
    resetReleaseMarkers();
  }
});
