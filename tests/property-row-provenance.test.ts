/**
 * Which palette rows are a read, and which are the decoder's inference.
 *
 * The distinction is not cosmetic. On the supplied project on 2026-08-19,
 * 60.1% of categorised products carried a record-code consensus category rather
 * than their own token, and 7.2% of bodies were an axis-aligned envelope rather
 * than a shape. A palette that renders those alongside a persisted parameter in
 * the same grey text tells the reader the decoder is more certain than it is,
 * and the reader has no way to find out otherwise.
 *
 * These are the rules behind that rendering, tested on the record shapes rather
 * than through React, so a future change to the palette cannot quietly promote
 * an inference to a fact.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { propertyRowsFor } from "../app/studio/format.ts";
import { boundsDimensions } from "../lib/reviter/viewer.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import type { PropertyProvenance, PropertyRow } from "../app/studio/types.ts";

function record(overrides: Partial<ElementBoundsRecord> = {}): ElementBoundsRecord {
  return {
    elementId: 10,
    stream: "Partitions/1",
    chunkIndex: 2,
    rawOffset: 10,
    recordOffset: 20,
    categoryId: -2_000_011,
    categoryName: "Walls",
    categorySource: "native-token",
    renderGeometryProvenance: "native",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 1, z: 3 } },
    ...overrides,
  } as ElementBoundsRecord;
}

function rowsOf(overrides: Partial<ElementBoundsRecord> = {}): Map<string, PropertyRow> {
  const element = record(overrides);
  const rows = propertyRowsFor(element, boundsDimensions(element.boundsFeet));
  return new Map(rows.map((row) => [row.key, row]));
}

function provenanceOf(key: string, overrides: Partial<ElementBoundsRecord> = {}): PropertyProvenance {
  const row = rowsOf(overrides).get(key);
  assert.ok(row, `expected a "${key}" row`);
  return row.provenance;
}

test("nothing is rendered for an element with no bounds", () => {
  assert.deepEqual(propertyRowsFor(null, null), []);
});

test("every row states a provenance", () => {
  for (const row of rowsOf({
    typeName: "Exterior Wall - 200mm",
    typeId: 20,
    parameters: [{ parameterId: -1_001_105, name: "Unconnected Height", value: 3 }],
  }).values()) {
    assert.ok(
      ["decoded", "inferred", "edited"].includes(row.provenance),
      `${row.key} carries no provenance`,
    );
  }
});

test("a category read from the element's own token is decoded", () => {
  for (const source of ["native-token", "native-object"] as const) {
    assert.equal(provenanceOf("category", { categorySource: source }), "decoded");
    assert.equal(provenanceOf("category-id", { categorySource: source }), "decoded");
  }
});

test("a category taken from a record-code consensus is inferred", () => {
  // The majority case in the supplied building, and the one most likely to be
  // wrong on a model whose record codes cluster differently.
  assert.equal(provenanceOf("category", { categorySource: "record-code-consensus" }), "inferred");
  assert.equal(provenanceOf("category-id", { categorySource: "record-code-consensus" }), "inferred");
});

test("a native face mesh and a tagged paired body are decoded geometry", () => {
  for (const provenance of ["native", "reference-assisted"] as const) {
    assert.equal(provenanceOf("geometry", { renderGeometryProvenance: provenance }), "decoded");
    assert.equal(provenanceOf("evidence", { renderGeometryProvenance: provenance }), "decoded");
  }
});

test("a rebuilt, clipped or fallen-back body is inferred geometry", () => {
  for (const provenance of [
    "reconstructed",
    "bounds-fallback",
    "boundary-clipped-proxy",
    "not-rendered-helper",
  ] as const) {
    assert.equal(
      provenanceOf("geometry", { renderGeometryProvenance: provenance }),
      "inferred",
      `${provenance} geometry claimed to be decoded`,
    );
    assert.equal(provenanceOf("evidence", { renderGeometryProvenance: provenance }), "inferred");
  }
});

test("identity, persisted parameters and source location are decoded", () => {
  const rows = rowsOf({
    typeName: "Exterior Wall - 200mm",
    typeId: 20,
    parameters: [{ parameterId: -1_001_105, name: "Unconnected Height", value: 3 }],
  });
  for (const key of [
    "element-id",
    "type",
    "type-element",
    "parameter--1001105",
    "bounding-size",
    "minimum-z",
    "stream",
    "chunk",
    "record-offset",
  ]) {
    const row = rows.get(key);
    assert.ok(row, `expected a "${key}" row`);
    assert.equal(row.provenance, "decoded", `${key} should be a read`);
  }
});

test("an inferred category does not make the element's identity inferred", () => {
  // The failure this guards against is a blanket rule: an element whose
  // category was guessed still has an id, a bounds record and a source offset
  // that were read, and marking those as derived would be its own dishonesty.
  const rows = rowsOf({ categorySource: "record-code-consensus" });
  assert.equal(rows.get("category")?.provenance, "inferred");
  assert.equal(rows.get("element-id")?.provenance, "decoded");
  assert.equal(rows.get("stream")?.provenance, "decoded");
});
