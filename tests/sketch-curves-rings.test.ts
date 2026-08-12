/**
 * Ring assembly has to survive edge sets that are not a clean cycle.
 *
 * The module's own header says storage order is not ring order, so the edges
 * arrive shuffled. Two things then decide whether a boundary survives: whether
 * a wrong turn at a junction can be taken back, and whether the duplicate key
 * agrees with the tolerance the walk actually joins at. Both are exercised
 * here at every input position, because "which order the records came in" is
 * not something a model file lets us choose.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { assembleRings, boundaryLoopsFor } from "../lib/reviter/sketch-curves.ts";

import type { Point3, SketchCurve } from "../lib/reviter/sketch-curves.ts";

const ELEMENT = 1;

const line = (start: Point3, end: Point3): SketchCurve => ({
  offset: 0,
  owner: ELEMENT,
  kind: "line",
  start,
  end,
  interior: [],
});

/** A unit square walked anticlockwise, one edge per record. */
const square = (): SketchCurve[] => [
  line([0, 0, 0], [10, 0, 0]),
  line([10, 0, 0], [10, 10, 0]),
  line([10, 10, 0], [0, 10, 0]),
  line([0, 10, 0], [0, 0, 0]),
];

/** An edge that leaves the square's corner and goes nowhere. */
const spur = () => line([10, 0, 0], [15, 0, 0]);

const ringsOf = (curves: SketchCurve[]) =>
  boundaryLoopsFor(ELEMENT, new Map([[ELEMENT, curves]]));

const corners = (ring: Point3[]) => ring.map(([x, y]) => `${x},${y}`).sort();

const SQUARE_CORNERS = ["0,0", "0,10", "10,0", "10,10"];

/** `curves` with `extra` spliced in at `at`, so every arrival order is tried. */
const insertedAt = (curves: SketchCurve[], extra: SketchCurve, at: number) => [
  ...curves.slice(0, at),
  extra,
  ...curves.slice(at),
];

test("a clean square closes into one four-corner ring", () => {
  const rings = ringsOf(square());
  assert.equal(rings.length, 1);
  assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS);
});

test("a spur off a corner cannot destroy the boundary, whatever its position", () => {
  const failures: string[] = [];
  for (let at = 0; at <= 4; at += 1) {
    const rings = ringsOf(insertedAt(square(), spur(), at));
    if (rings.length !== 1 || rings[0]!.length !== 4) {
      failures.push(`spur at ${at}: ${rings.length} ring(s), ${rings[0]?.length ?? 0} verts`);
      continue;
    }
    assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS, `spur at ${at}`);
  }
  assert.deepEqual(failures, [], "every arrival order must still recover the square");
});

test("a dead end releases the edges it consumed for a later seed", () => {
  // The spur is the first record, so it is also the first seed. Its own walk
  // must not strand it: whichever seed reaches the junction has to be able to
  // back out of the stub and take the corner instead.
  const rings = ringsOf([spur(), ...square()]);
  assert.equal(rings.length, 1);
  assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS);
});

test("two spurs off the same corner still leave one square", () => {
  const rings = ringsOf(
    insertedAt(insertedAt(square(), spur(), 1), line([10, 0, 0], [10, -5, 0]), 1),
  );
  assert.equal(rings.length, 1);
  assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS);
});

test("an exact reversed duplicate is deduplicated, whatever its position", () => {
  const duplicate = () => line([10, 0, 0], [0, 0, 0]);
  for (let at = 0; at <= 4; at += 1) {
    const rings = ringsOf(insertedAt(square(), duplicate(), at));
    assert.equal(rings.length, 1, `duplicate at ${at}`);
    assert.equal(rings[0]!.length, 4, `duplicate at ${at}`);
    assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS, `duplicate at ${at}`);
  }
});

test("a duplicate inside the join tolerance is deduplicated too", () => {
  // 1e-6 ft apart: a hundred times closer than the 1e-4 ft the walk joins at,
  // so the walk considers these the same edge and the key has to as well.
  const nudged = () => line([10, 0.000001, 0], [0, -0.000001, 0]);
  const failures: string[] = [];
  for (let at = 0; at <= 4; at += 1) {
    const rings = ringsOf(insertedAt(square(), nudged(), at));
    if (rings.length !== 1 || rings[0]!.length !== 4) {
      failures.push(`near-duplicate at ${at}: ${rings.length} ring(s), ${rings[0]?.length ?? 0} verts`);
    }
  }
  assert.deepEqual(failures, [], "a duplicate within the join tolerance must not survive dedup");
});

test("a spur and a near-duplicate together still leave the square", () => {
  const rings = ringsOf([
    ...square().slice(0, 1),
    line([10, 0.000001, 0], [0, -0.000001, 0]),
    spur(),
    ...square().slice(1),
  ]);
  assert.equal(rings.length, 1);
  assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS);
});

test("two disjoint squares are recovered as two rings, spurs and all", () => {
  const shifted = square().map((curve) =>
    line(
      [curve.start[0] + 100, curve.start[1], 0],
      [curve.end[0] + 100, curve.end[1], 0],
    ),
  );
  const rings = ringsOf([...insertedAt(square(), spur(), 1), ...shifted]);
  assert.equal(rings.length, 2);
  assert.deepEqual(corners(rings[0]!), SQUARE_CORNERS);
  assert.deepEqual(corners(rings[1]!), ["100,0", "100,10", "110,0", "110,10"]);
});

test("a circle of four arcs keeps its tessellation, including the reversed ones", () => {
  const at = (angle: number): Point3 => [5 * Math.cos(angle), 5 * Math.sin(angle), 0];
  const arc = (from: number, to: number): SketchCurve => ({
    offset: 0,
    owner: ELEMENT,
    kind: "arc",
    start: at(from),
    end: at(to),
    interior: [1, 2, 3].map((step) => at(from + ((to - from) * step) / 4)),
  });
  const quarter = (index: number) => arc((index * Math.PI) / 2, ((index + 1) * Math.PI) / 2);
  const flip = (curve: SketchCurve): SketchCurve => ({
    ...curve,
    start: curve.end,
    end: curve.start,
    interior: [...curve.interior].reverse(),
  });
  // Two quarters stored against the other face, and out of ring order.
  const rings = assembleRings([quarter(0), flip(quarter(2)), quarter(1), flip(quarter(3))]);
  assert.equal(rings.length, 1);
  // Four corners and three interior points each, none dropped or duplicated.
  assert.equal(rings[0]!.length, 16);
  for (const [x, y] of rings[0]!) assert.ok(Math.abs(Math.hypot(x, y) - 5) < 1e-9);
  // Ring order: consecutive vertices step one sixteenth of a turn, and every
  // step goes the same way round — whichever way the walk happened to pick.
  const step = (2 * Math.PI) / 16;
  const turns = rings[0]!.map((p, index) => {
    const q = rings[0]![(index + 1) % 16]!;
    const turn = Math.atan2(q[1], q[0]) - Math.atan2(p[1], p[0]);
    return Math.atan2(Math.sin(turn), Math.cos(turn));
  });
  const direction = Math.sign(turns[0]!);
  for (const [index, turn] of turns.entries()) {
    assert.ok(Math.abs(turn - direction * step) < 1e-9, `vertex ${index} is out of ring order`);
  }
});

test("tessellation can be declined and the corners still close", () => {
  const at = (angle: number): Point3 => [5 * Math.cos(angle), 5 * Math.sin(angle), 0];
  const arc = (from: number, to: number): SketchCurve => ({
    offset: 0,
    owner: ELEMENT,
    kind: "arc",
    start: at(from),
    end: at(to),
    interior: [1, 2, 3].map((step) => at(from + ((to - from) * step) / 4)),
  });
  const rings = assembleRings(
    [0, 1, 2, 3].map((index) => arc((index * Math.PI) / 2, ((index + 1) * Math.PI) / 2)),
    { tessellateArcs: false },
  );
  assert.equal(rings.length, 1);
  assert.equal(rings[0]!.length, 4);
});

test("an open chain that never closes yields no ring", () => {
  const rings = ringsOf([
    line([0, 0, 0], [10, 0, 0]),
    line([10, 0, 0], [10, 10, 0]),
    line([10, 10, 0], [0, 10, 0]),
  ]);
  assert.deepEqual(rings, []);
});
