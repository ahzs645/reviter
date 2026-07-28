import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027AnalyticSurface,
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-surfaces.ts";

function writePoint(
  view: DataView,
  byteOffset: number,
  values: readonly number[],
): number {
  for (const value of values) {
    view.setFloat64(byteOffset, value, true);
    byteOffset += 8;
  }
  return byteOffset;
}

function surfaceBase(view: DataView, byteOffset = 0): number {
  byteOffset = writePoint(view, byteOffset, [-2, -3, 4, 5]);
  view.setUint8(byteOffset, 1);
  return byteOffset + 1;
}

test("decodes the exact Revit 2027 Plane base-to-derived body", () => {
  const data = new Uint8Array(105);
  const view = new DataView(data.buffer);
  let cursor = surfaceBase(view);
  cursor = writePoint(view, cursor, [1, 2, 3]);
  cursor = writePoint(view, cursor, [1, 0, 0]);
  cursor = writePoint(view, cursor, [0, 1, 0]);
  assert.equal(cursor, data.byteLength);

  const decoded = decodeRevit2027AnalyticSurface(
    data,
    0,
    data.byteLength,
    2027,
    REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok || decoded.value.kind !== "plane") return;
  assert.deepEqual(decoded.value.surface.envelope, {
    firstCorner: [-2, -3],
    secondCorner: [4, 5],
  });
  assert.equal(decoded.value.surface.orientFlag, true);
  assert.deepEqual(decoded.value.origin, [1, 2, 3]);
  assert.deepEqual(decoded.value.xVector, [1, 0, 0]);
  assert.deepEqual(decoded.value.yVector, [0, 1, 0]);
  assert.equal(decoded.value.endOffset, 105);
});

for (const fixture of [
  {
    label: "ConeSurf",
    slot: REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
    scalar: Math.PI / 6,
    kind: "cone",
  },
  {
    label: "CylSurf",
    slot: REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
    scalar: 12.5,
    kind: "cylinder",
  },
] as const) {
  test(`decodes the exact Revit 2027 ${fixture.label} body`, () => {
    const data = new Uint8Array(137);
    const view = new DataView(data.buffer);
    let cursor = surfaceBase(view);
    cursor = writePoint(view, cursor, [10, 20, 30]);
    cursor = writePoint(view, cursor, [1, 0, 0]);
    cursor = writePoint(view, cursor, [0, 1, 0]);
    cursor = writePoint(view, cursor, [0, 0, 1]);
    view.setFloat64(cursor, fixture.scalar, true);

    const decoded = decodeRevit2027AnalyticSurface(
      data,
      0,
      data.byteLength,
      2027,
      fixture.slot,
    );
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.value.kind, fixture.kind);
    if (decoded.value.kind === "cone") {
      assert.equal(decoded.value.halfAngle, fixture.scalar);
    } else if (decoded.value.kind === "cylinder") {
      assert.equal(decoded.value.radius, fixture.scalar);
    }
    assert.equal(decoded.value.endOffset, 137);
  });
}

test("decodes the exact Revit 2027 SurfRev body and profile queue property", () => {
  const data = new Uint8Array(135);
  const view = new DataView(data.buffer);
  let cursor = surfaceBase(view);
  cursor = writePoint(view, cursor, [10, 20, 30]);
  cursor = writePoint(view, cursor, [1, 0, 0]);
  cursor = writePoint(view, cursor, [0, 1, 0]);
  cursor = writePoint(view, cursor, [0, 0, 1]);
  view.setInt32(cursor, 56, true);
  view.setInt16(cursor + 4, 2213, true);
  cursor += 6;
  assert.equal(cursor, data.byteLength);

  const decoded = decodeRevit2027AnalyticSurface(
    data,
    0,
    data.byteLength,
    2027,
    REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok || decoded.value.kind !== "surface-of-revolution") return;
  assert.deepEqual(decoded.value.center, [10, 20, 30]);
  assert.deepEqual(decoded.value.xVector, [1, 0, 0]);
  assert.deepEqual(decoded.value.yVector, [0, 1, 0]);
  assert.deepEqual(decoded.value.zVector, [0, 0, 1]);
  assert.deepEqual(decoded.value.profileCurve, {
    token: 56,
    sourceClassSlot: 2213,
    byteOffset: 129,
    endOffset: 135,
  });
  assert.deepEqual(decoded.value.queuedProperties, [
    decoded.value.profileCurve,
  ]);
  assert.equal(decoded.value.endOffset, 135);
});

test("fails closed for release, source slot, boolean, truncation, and NaN", () => {
  const plane = new Uint8Array(105);
  const view = new DataView(plane.buffer);
  surfaceBase(view);

  assert.equal(
    decodeRevit2027AnalyticSurface(
      plane,
      0,
      plane.byteLength,
      2026,
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027AnalyticSurface(plane, 0, plane.byteLength, 2027, 9999).ok,
    false,
  );
  plane[32] = 2;
  assert.equal(
    decodeRevit2027AnalyticSurface(
      plane,
      0,
      plane.byteLength,
      2027,
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    ).ok,
    false,
  );
  plane[32] = 0;
  assert.equal(
    decodeRevit2027AnalyticSurface(
      plane,
      0,
      104,
      2027,
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    ).ok,
    false,
  );
  view.setFloat64(33, Number.NaN, true);
  assert.equal(
    decodeRevit2027AnalyticSurface(
      plane,
      0,
      plane.byteLength,
      2027,
      REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
    ).ok,
    false,
  );
});
