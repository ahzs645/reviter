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
import type { CylinderPatch } from "../lib/reviter/surfaces.ts";

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
