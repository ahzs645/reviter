/**
 * The curved-wall rule.
 *
 * A straight wall is three plane records at a 105-byte stride — centre, then the
 * two faces half a thickness out. A curved wall is written the same way in
 * cylinder records at their own 137-byte stride, and the test that it *is* one
 * is arithmetic rather than positional: the middle radius must be the mean of
 * the outer two. These tests hold that gate to its word, because a rule that
 * accepts any three consecutive cylinders would invent arcs out of unrelated
 * surfaces.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { wallArcsFor } from "../lib/reviter/native-geometry.ts";
import { collectSurfaces, type CylinderPatch } from "../lib/reviter/surfaces.ts";

const STRIDE = 137;

function cylinder(offset: number, radius: number, over: Partial<CylinderPatch> = {}): CylinderPatch {
  return {
    kind: "cylinder",
    offset,
    origin: { x: 10, y: 20, z: 0 },
    xDir: { x: 1, y: 0, z: 0 },
    yDir: { x: 0, y: 1, z: 0 },
    zDir: { x: 0, y: 0, z: 1 },
    radius,
    uMin: 0,
    uMax: Math.PI / 2,
    vMin: 0,
    vMax: 10,
    ...over,
  };
}

/** Centre 10.05, faces at 9.72 and 10.38 — element 305688's own numbers. */
function triple(base = 0): CylinderPatch[] {
  return [
    cylinder(base, 10.05),
    cylinder(base + STRIDE, 9.72),
    cylinder(base + 2 * STRIDE, 10.38),
  ];
}

test("a stride-137 triple with a centre radius becomes an arc", () => {
  const arcs = wallArcsFor(305688, triple());
  assert.equal(arcs.length, 1);
  const arc = arcs[0]!;
  assert.equal(arc.elementId, 305688);
  assert.equal(arc.radius, 10.05);
  assert.ok(Math.abs(arc.thickness - 0.66) < 1e-9, `thickness ${arc.thickness}`);
  assert.equal(arc.startAngle, 0);
  assert.ok(Math.abs(arc.endAngle - Math.PI / 2) < 1e-12);
  assert.equal(arc.baseElevation, 0);
  assert.equal(arc.topElevation, 10);
});

test("the middle radius must be the mean of the outer two", () => {
  // Same three records, but the centre is not the centreline: three cylinders
  // that merely sit next to each other in the blob.
  const wrong = [cylinder(0, 8), cylinder(STRIDE, 9.72), cylinder(2 * STRIDE, 10.38)];
  assert.deepEqual(wallArcsFor(1, wrong), []);
});

test("the records must be consecutive at the cylinder stride", () => {
  const gapped = [
    cylinder(0, 10.05),
    cylinder(STRIDE + 1, 9.72),
    cylinder(2 * STRIDE + 1, 10.38),
  ];
  assert.deepEqual(wallArcsFor(1, gapped), []);
});

test("two triples in one blob give two arcs", () => {
  const arcs = wallArcsFor(1, [...triple(0), ...triple(3 * STRIDE)]);
  assert.equal(arcs.length, 2);
});

test("a zero-thickness triple is not a wall", () => {
  const flat = [cylinder(0, 10), cylinder(STRIDE, 10), cylinder(2 * STRIDE, 10)];
  assert.deepEqual(wallArcsFor(1, flat), []);
});

test("a sweep of zero is not an arc", () => {
  const still = triple().map((c) => ({ ...c, uMax: c.uMin }));
  assert.deepEqual(wallArcsFor(1, still), []);
});

test("the record's own basis is carried through, not assumed to be world axes", () => {
  const rotated = triple().map((c) => ({
    ...c,
    xDir: { x: 0, y: 1, z: 0 },
    yDir: { x: -1, y: 0, z: 0 },
  }));
  const arc = wallArcsFor(1, rotated)[0]!;
  assert.deepEqual(arc.xDir, { x: 0, y: 1 });
  assert.deepEqual(arc.yDir, { x: -1, y: 0 });
});

test("the sweep is ordered, so a reversed range still reads as the same arc", () => {
  const reversed = triple().map((c) => ({ ...c, uMin: Math.PI / 2, uMax: 0 }));
  const arc = wallArcsFor(1, reversed)[0]!;
  assert.equal(arc.startAngle, 0);
  assert.ok(Math.abs(arc.endAngle - Math.PI / 2) < 1e-12);
});

test("the arc's own points lie a half thickness either side of the radius", () => {
  const arc = wallArcsFor(1, triple())[0]!;
  const inner = arc.radius - arc.thickness / 2;
  const outer = arc.radius + arc.thickness / 2;
  assert.ok(Math.abs(inner - 9.72) < 1e-9);
  assert.ok(Math.abs(outer - 10.38) < 1e-9);
});

test("fewer than three cylinders can never form a triple", () => {
  assert.deepEqual(wallArcsFor(1, triple().slice(0, 2)), []);
  assert.deepEqual(wallArcsFor(1, []), []);
});

/** One 137-byte cylinder record, laid out as `surfaces.ts` documents it. */
function cylinderBytes(xDir: number[], yDir: number[], zDir: number[], radius: number) {
  const data = new Uint8Array(137);
  const view = new DataView(data.buffer);
  data[0] = 0x01;
  [-68.28, 337, 0].forEach((value, index) => view.setFloat64(1 + index * 8, value, true));
  xDir.forEach((value, index) => view.setFloat64(25 + index * 8, value, true));
  yDir.forEach((value, index) => view.setFloat64(49 + index * 8, value, true));
  zDir.forEach((value, index) => view.setFloat64(73 + index * 8, value, true));
  view.setFloat64(97, radius, true);
  // uMin, vMin, uMax, vMax: a 4.7-degree sweep, 13.78 ft tall.
  [2.5007, 0, 2.5831, 13.779527559055119].forEach((value, index) =>
    view.setFloat64(105 + index * 8, value, true),
  );
  return data;
}

test("a mirrored (left-handed) cylinder record is a cylinder, not a plane", () => {
  // Element 961081's own frame: xDir × yDir = -zDir. Requiring +1 used to
  // reject it, and the plane reader then took zDir as its trim and the radius
  // as vMax.
  const surfaces = collectSurfaces(cylinderBytes([1, 0, 0], [0, -1, 0], [0, 0, 1], 31.868));
  assert.equal(surfaces.length, 1);
  const surface = surfaces[0]!;
  assert.equal(surface.kind, "cylinder");
  if (surface.kind !== "cylinder") return;
  assert.equal(surface.radius, 31.868);
  assert.ok(Math.abs(surface.uMax - 2.5831) < 1e-12);
  // A right-handed record still reads, and a non-basis zDir still does not.
  assert.equal(collectSurfaces(cylinderBytes([1, 0, 0], [0, 1, 0], [0, 0, 1], 31.868))[0]?.kind, "cylinder");
  assert.notEqual(collectSurfaces(cylinderBytes([1, 0, 0], [0, 1, 0], [1, 0, 0], 31.868))[0]?.kind, "cylinder");
});

test("a clockwise frame is normalised to the same points, counter-clockwise", () => {
  const mirrored = triple().map((c) => ({ ...c, yDir: { x: 0, y: -1, z: 0 }, uMin: 0.2, uMax: 1.1 }));
  const arc = wallArcsFor(1, mirrored)[0]!;
  assert.ok(arc.xDir.x * arc.yDir.y - arc.xDir.y * arc.yDir.x > 0, "right-handed in plan");
  assert.ok(arc.endAngle > arc.startAngle);
  const at = (angle: number, xDir: { x: number; y: number }, yDir: { x: number; y: number }) => [
    Math.cos(angle) * xDir.x + Math.sin(angle) * yDir.x,
    Math.cos(angle) * xDir.y + Math.sin(angle) * yDir.y,
  ];
  // The record's own sweep 0.2 → 1.1 through (1,0),(0,-1) covers the same
  // points as the normalised arc's sweep, end for end.
  const recordStart = at(0.2, { x: 1, y: 0 }, { x: 0, y: -1 });
  const recordEnd = at(1.1, { x: 1, y: 0 }, { x: 0, y: -1 });
  const arcStart = at(arc.startAngle, arc.xDir, arc.yDir);
  const arcEnd = at(arc.endAngle, arc.xDir, arc.yDir);
  assert.ok(Math.hypot(arcEnd[0]! - recordStart[0]!, arcEnd[1]! - recordStart[1]!) < 1e-12);
  assert.ok(Math.hypot(arcStart[0]! - recordEnd[0]!, arcStart[1]! - recordEnd[1]!) < 1e-12);
});
