import assert from "node:assert/strict";
import test from "node:test";

import { readLocalBounds, readLocalShape } from "../lib/reviter/instanced-geometry.ts";
import type { ElementObject } from "../lib/reviter/element-objects.ts";

const PLANE_BYTES = 105;
/** Head padding, so the table does not start at the object's first byte. */
const HEAD = 64;

type Face = {
  /** 0 = x, 1 = y, 2 = z. */
  axis: number;
  at: number;
  /** Deliberately wrong trim range, to prove the reader does not use it. */
  trim?: [number, number, number, number];
};

/**
 * A `0x0810` shape object holding one or more surface tables.
 *
 * Each table is a contiguous run of 105-byte plane records; a gap of one record
 * separates tables, which is how the casement's two tables sit in the file.
 */
function shapeObject(tables: Face[][]): Uint8Array {
  const records = tables.reduce((total, table) => total + table.length, 0) + (tables.length - 1);
  const data = new Uint8Array(HEAD + records * PLANE_BYTES + 32);
  const view = new DataView(data.buffer);
  const axes = [
    { u: [0, 1, 0], v: [0, 0, 1] },
    { u: [0, 0, 1], v: [1, 0, 0] },
    { u: [1, 0, 0], v: [0, 1, 0] },
  ];
  let at = HEAD;
  for (const [index, table] of tables.entries()) {
    if (index > 0) at += PLANE_BYTES;
    for (const face of table) {
      const origin = [0, 0, 0];
      origin[face.axis] = face.at;
      const { u, v } = axes[face.axis]!;
      data[at] = 1;
      for (let k = 0; k < 3; k += 1) {
        view.setFloat64(at + 1 + k * 8, origin[k]!, true);
        view.setFloat64(at + 25 + k * 8, u[k]!, true);
        view.setFloat64(at + 49 + k * 8, v[k]!, true);
      }
      const trim = face.trim ?? [-9.25, -8.75, 11.5, 12.25];
      for (let k = 0; k < 4; k += 1) view.setFloat64(at + 73 + k * 8, trim[k]!, true);
      at += PLANE_BYTES;
    }
  }
  return data;
}

const object = (data: Uint8Array, elementId = 1_812_290): ElementObject => ({
  offset: 0,
  elementId,
  objectLength: data.byteLength,
  marker: 0x0810,
  typeCode: 0,
});

/** Faces of one box, written as the file writes them: a pair plus its mid-plane. */
function boxFaces(box: [number, number, number, number, number, number]): Face[] {
  const faces: Face[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const low = box[axis]!;
    const high = box[axis + 3]!;
    faces.push({ axis, at: low }, { axis, at: (low + high) / 2 }, { axis, at: high });
  }
  return faces;
}

test("reads a window's box from its faces, not from its trim ranges", () => {
  // The supplied project's 0915 x 1220 fixed window: x +-1.5010, y -0.1542 to
  // 0.2395, z 3.0020 to 7.0046, all three axes carrying their own mid-plane.
  // Every trim range here is a neighbour's, which is the file's own failure mode
  // — the hull over the trimmed patches is 27.3 x 12.6 x 10.4 ft on a
  // 6.0 x 1.0 x 4.4 ft window — so a reader that used them would fail this.
  const data = shapeObject([boxFaces([-1.501, -0.1542, 3.002, 1.501, 0.2395, 7.0046])]);
  const shape = readLocalShape(data, object(data));
  assert.ok(shape);
  assert.deepEqual(shape.min.map((v) => Number(v.toFixed(4))), [-1.501, -0.1542, 3.002]);
  assert.deepEqual(shape.max.map((v) => Number(v.toFixed(4))), [1.501, 0.2395, 7.0046]);
  // The window's own solid, so `doorLeafFromShape` must not fold it.
  assert.equal(shape.leaf, true);
});

test("intersects a second surface table, which is what cuts the casement's sash", () => {
  // A casement's first table is the family's box including the sash swung open —
  // depth -0.1969 .. 1.5417 — and its second table is the sash itself at
  // +-0.1969. Two readings of one shape, so the tighter is not a guess.
  const data = shapeObject([
    boxFaces([-3, -0.1969, 3, 3, 1.5417, 7.4167]),
    boxFaces([-2.9167, -0.1969, 3.0833, 2.9167, 0.1969, 7.3333]),
  ]);
  const shape = readLocalShape(data, object(data, 1_404_625));
  assert.ok(shape);
  assert.ok(Math.abs(shape.min[1]! + 0.1969) < 1e-9, "depth from the tighter table");
  assert.ok(Math.abs(shape.max[1]! - 0.1969) < 1e-9, "the swung-open sash is cut away");
  // The sash is inset an inch into the frame, so the intersection is an inch
  // tight on the other two axes. That residual is 0.083 ft and is not corrected
  // per axis, because "take the tighter" then needs an exception.
  assert.ok(Math.abs(shape.max[0]! - 2.9167) < 1e-9);
  assert.ok(Math.abs(shape.max[2]! - 7.3333) < 1e-9);
});

test("declines a door's shape, whose leaf reaches the floor", () => {
  // A door family writes x as `-w, 0.0001, +w` — its mid-plane 0.0001 ft off the
  // mean — y as `-t, 0, +R` with the swing radius unpartnered, and z from 0,
  // because a leaf stands on the floor. Each of those alone refuses the window
  // reading; the door reader keeps the class at 99.2% / 99.1% and 195 doors were
  // measured going to 0.0% when the mid-plane test was dropped.
  // The door reader works off the trim ranges rather than the face origins — the
  // widest range symmetric about the origin is the leaf width, the longest is the
  // height — so this fixture carries the door's real ones.
  const trim: [number, number, number, number] = [-1.8635, 0, 1.8635, 7.628];
  const doorFaces: Face[] = [
    { axis: 0, at: -1.8635, trim }, { axis: 0, at: 0.0001, trim }, { axis: 0, at: 1.8635, trim },
    { axis: 1, at: -0.0417, trim }, { axis: 1, at: 0, trim }, { axis: 1, at: 3.8937, trim },
    { axis: 2, at: 0, trim }, { axis: 2, at: 3.814, trim }, { axis: 2, at: 7.628, trim },
  ];
  const data = shapeObject([doorFaces]);
  const shape = readLocalShape(data, object(data, 2_492_276));
  assert.ok(shape, "the door reader still answers");
  // The door reading: the leaf's own thickness is the nearest y-normal plane,
  // never the swing radius behind it.
  assert.ok(Math.abs(shape.max[1]! - 0.0417) < 1e-9);
  assert.ok(Math.abs(shape.min[1]! + 0.0417) < 1e-9);

  // The same faces lifted onto a sill are read as a window, so the sill is what
  // the gate turns on rather than the family.
  const lifted = shapeObject([doorFaces.map((f) => (f.axis === 2 ? { ...f, at: f.at + 3 } : f))]);
  const asWindow = readLocalShape(lifted, object(lifted));
  assert.ok(asWindow);
  // Still declined: the x and y triples have no mid-plane of their own.
  assert.ok(Math.abs(asWindow.max[1]! - 0.0417) < 1e-9, "the mid-plane test still refuses it");
});

test("refuses a shape whose bounds block reads as six subnormal doubles", () => {
  // `boundsOffsetWithin` derives the block from the field count, so the fixed
  // `+48` fallback only runs once that framing check has failed — and there +48
  // lands on the field table: six subnormals that are finite, ordered, and
  // enclose nothing. 368 of the 3,699 objects reaching the fallback read this
  // way, 12 of them the shape a placement points at, each drawn as eight
  // identical corners.
  const data = new Uint8Array(256);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2_466_705, true);
  for (let k = 0; k < 6; k += 1) {
    // A subnormal double: tiny, finite, and ordered correctly against its peers.
    view.setUint32(48 + k * 8, 4 + k, true);
  }
  assert.equal(readLocalBounds(data, {
    offset: 0, elementId: 2_466_705, objectLength: 32_869, marker: 0x08c6, typeCode: 0,
  }), null);

  // A box flat on one axis is still a shape: 4,077 of the 14,876 framed reads,
  // whose duplicated block proves the offset, are flat on exactly one axis, so
  // flatness is not evidence of a bad read and only a box degenerate on every
  // axis is refused.
  const flat = new Uint8Array(256);
  const flatView = new DataView(flat.buffer);
  flatView.setUint32(34, 0x0008_8004, true);
  flatView.setUint32(38, 1, true);
  flatView.setUint32(42, 3, true);
  const box = [-2, 0, -1, 2, 0, 4];
  for (let copy = 0; copy < 2; copy += 1) {
    for (let k = 0; k < 6; k += 1) flatView.setFloat64(48 + copy * 48 + k * 8, box[k]!, true);
  }
  const shape = readLocalBounds(flat, {
    offset: 0, elementId: 7, objectLength: 900, marker: 0x08c6, typeCode: 0,
  });
  assert.ok(shape);
  assert.deepEqual(shape.min, [-2, 0, -1]);
});
