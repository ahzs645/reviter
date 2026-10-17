import assert from "node:assert/strict";
import test from "node:test";
import { drawingBackedSealFixture, rect } from "./fixtures/drawing-backed-seal.ts";
import { createNativeProvisionalCornerSealIndex, setDrawingBackedRowMemoEnabled } from "../lib/reviter/native-provisional-corner-seals.ts";
import { nativeDerivedFrameHash } from "../lib/reviter/native-derived-frame-returns.ts";

test("touching foreign material keeps the original zero-area decision", () => {
  setDrawingBackedRowMemoEnabled(false);
  const f = drawingBackedSealFixture({extraSection: rect(1.12, -0.51, 1.3, -0.49)});
  f.rehash();
  assert.ok(createNativeProvisionalCornerSealIndex(f.data).partsAt(0.1).length);
});

test("a one-trillionth-foot positive foreign overlap retains the original physical refusal", () => {
  setDrawingBackedRowMemoEnabled(false);
  const f = drawingBackedSealFixture({extraSection: rect(1.04, -0.51, 1.04 + 1e-12, -0.49)});
  f.rehash();
  assert.throws(() => createNativeProvisionalCornerSealIndex(f.data), /foreign material|foreign native material|foreign body/);
});

test("a true thin original slab hole remains unsupported after rebinding the unchanged guard inputs", () => {
  setDrawingBackedRowMemoEnabled(false);
  const f = drawingBackedSealFixture(), row = f.data.nativeProvisionalCornerSeals!.rows[0]!;
  f.data.walkingSupport!.floors[0]!.partsFeet![0]!.push(rect(1.04, -0.51, 1.04 + 1e-12, -0.49)[0]![0]!);
  row.sourceFloorPartsSha256 = nativeDerivedFrameHash(row.sourceFloorBindings);
  f.rehash();
  assert.throws(() => createNativeProvisionalCornerSealIndex(f.data), /unsupported native floor|original opening/);
});

test("a new constructor observes a foreign part edited in place", () => {
  setDrawingBackedRowMemoEnabled(false);
  const part = rect(2.4, -0.51, 2.5, -0.49), f = drawingBackedSealFixture({extraSection: part});
  f.rehash();
  assert.ok(createNativeProvisionalCornerSealIndex(f.data).partsAt(0.1).length);
  for (const point of part[0]![0]!) point[0] -= 1.4;
  const material = f.data.nativeMaterialSections!, seals = f.data.nativeProvisionalCornerSeals!;
  material.geometrySha256 = nativeDerivedFrameHash([material.version, material.sourceModelSha256, material.levels]);
  seals.sourceMaterialGeometrySha256 = material.geometrySha256;
  seals.completeOriginalPhysicalOwnerCensusSha256 = nativeDerivedFrameHash(seals.foreignBodies);
  f.rehash();
  assert.throws(() => createNativeProvisionalCornerSealIndex(f.data), /foreign material|foreign native material|foreign body/);
});
