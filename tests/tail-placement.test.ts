import assert from "node:assert/strict";
import test from "node:test";

import { readInstancePlacement } from "../lib/reviter/instanced-geometry.ts";
import type { ElementObject } from "../lib/reviter/element-objects.ts";

/**
 * An element object carrying its own placement, laid out the way the supplied
 * model's `0x07ef` objects are: a 3x3 basis, a world origin, and the element id
 * of the shared geometry object, ending 125 bytes before the object does.
 */
function objectWithPlacement(options: {
  objectLength: number;
  basisAt: number;
  basis: number[];
  origin: [number, number, number];
  geometryId: number;
  familyWordAt34?: number;
}): { data: Uint8Array; object: ElementObject } {
  const data = new Uint8Array(options.objectLength + 64);
  const view = new DataView(data.buffer);
  view.setUint32(0, 303_358, true);
  view.setUint16(16, 0x07ef, true);
  if (options.familyWordAt34 != null) view.setUint32(34, options.familyWordAt34, true);
  options.basis.forEach((value, index) => view.setFloat64(options.basisAt + index * 8, value, true));
  options.origin.forEach((value, index) => view.setFloat64(options.basisAt + 72 + index * 8, value, true));
  view.setUint32(options.basisAt + 96, options.geometryId, true);
  return {
    data,
    object: { offset: 0, elementId: 303_358, objectLength: options.objectLength, marker: 0x07ef, typeCode: 0 },
  };
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** A 45° rotation about z, which is where columns-are-axes stops agreeing with rows. */
const ROTATED = [0.7071067811865476, -0.7071067811865475, 0, 0.7071067811865475, 0.7071067811865476, 0, 0, 0, 1];

test("reads the placement an element carries in its own object", () => {
  // 3,929 elements the export names were never missing from the file: their
  // object holds the same three fields as a 300-byte instance object, and
  // readInstancePlacement rejected anything that was not exactly 300 long.
  const { data, object } = objectWithPlacement({
    objectLength: 567,
    basisAt: 418,
    basis: ROTATED,
    origin: [130.106571, 23.490549, 14.435696],
    geometryId: 1_464_725,
  });
  const placement = readInstancePlacement(data, object);
  assert.ok(placement, "the placement was not found");
  assert.equal(placement.elementId, 303_358);
  assert.equal(placement.geometryId, 1_464_725);
  assert.deepEqual(placement.basis, ROTATED);
  assert.ok(Math.abs(placement.origin[0] - 130.106571) < 1e-9);
});

test("finds the basis wherever it starts, because the offset is not fixed", () => {
  // +418 for 22,511 objects, +412 for 2,323, +414 for 1,442.
  for (const [objectLength, basisAt] of [[567, 418], [561, 412], [563, 414]] as const) {
    const { data, object } = objectWithPlacement({
      objectLength, basisAt, basis: IDENTITY, origin: [1, 2, 3], geometryId: 99,
    });
    assert.ok(readInstancePlacement(data, object), `missed a basis at +${basisAt}`);
  }
});

test("will not take a shared geometry object for a placement", () => {
  // A shape whose tail happens to hold an orthonormal basis would lose its own
  // box. A shared shape is told apart by carrying a bounds sub-record, and that
  // is tested before the tail is searched.
  const { data, object } = objectWithPlacement({
    objectLength: 3_684,
    basisAt: 3_684 - 149,
    basis: IDENTITY,
    origin: [1, 2, 3],
    geometryId: 99,
    familyWordAt34: 0x0008_8004,
  });
  const view = new DataView(data.buffer);
  view.setUint32(38, 1, true);
  view.setUint32(42, 3, true);
  assert.equal(readInstancePlacement(data, object), null);
});

test("rejects a basis that is not a right-handed orthonormal set", () => {
  const cases: [string, number[]][] = [
    ["scaled", [2, 0, 0, 0, 1, 0, 0, 0, 1]],
    ["sheared", [1, 0, 0, 0.5, 1, 0, 0, 0, 1]],
    ["mirrored", [1, 0, 0, 0, 1, 0, 0, 0, -1]],
  ];
  for (const [name, basis] of cases) {
    const { data, object } = objectWithPlacement({
      objectLength: 567, basisAt: 418, basis, origin: [1, 2, 3], geometryId: 99,
    });
    assert.equal(readInstancePlacement(data, object), null, `accepted a ${name} basis`);
  }
});

test("requires a live geometry reference behind the basis", () => {
  // An orthonormal basis alone fires on 99.7% of one other object class; the
  // reference immediately behind it is what makes the read specific.
  const missing = objectWithPlacement({
    objectLength: 567, basisAt: 418, basis: IDENTITY, origin: [1, 2, 3], geometryId: 0,
  });
  assert.equal(readInstancePlacement(missing.data, missing.object), null);

  const wide = objectWithPlacement({
    objectLength: 567, basisAt: 418, basis: IDENTITY, origin: [1, 2, 3], geometryId: 7,
  });
  new DataView(wide.data.buffer).setUint32(418 + 100, 1, true);
  assert.equal(readInstancePlacement(wide.data, wide.object), null);
});
