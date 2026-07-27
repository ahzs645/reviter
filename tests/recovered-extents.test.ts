import assert from "node:assert/strict";
import test from "node:test";

import {
  clipPolylinesToBand,
  completeFlatSketchRecord,
  modalSketchThickness,
} from "../lib/reviter/recovered-extents.ts";
import type { ElementBoundsRecord, Point3 } from "../lib/reviter/types.ts";

const FLOORS = -2000032;
const CEILINGS = -2000038;
const RAMPS = -2000180;
const SPAN = 0.001;

function record(
  elementId: number,
  categoryId: number,
  minZ: number,
  maxZ: number,
  { synthesised = true } = {},
): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/x",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: synthesised ? -1 : 0,
    categoryId,
    boundsFeet: { min: { x: 0, y: 0, z: minZ }, max: { x: 10, y: 20, z: maxZ } },
  };
}

// ---------------------------------------------------------------- rail ribbons

test("a rail path below the railing's own envelope is trimmed, not clamped", () => {
  // The measured case: a stair railing's path starts about one riser below the
  // railing, so its first vertex sits under the envelope base. Trimming
  // interpolates the crossing; clamping would drag the first tread sideways.
  const path: Point3[][] = [[[0, 0, -1], [10, 0, 9]]];
  const { polylines, clipped } = clipPolylinesToBand(path, 0, 12);
  assert.equal(clipped, true);
  assert.equal(polylines.length, 1);
  const [start, end] = polylines[0]!;
  assert.deepEqual(end, [10, 0, 9]);
  // z = 0 is one tenth along the run, so x must move with it.
  assert.ok(Math.abs(start![0] - 1) < 1e-9, `start x ${start![0]}`);
  assert.equal(start![2], 0);
});

test("a path inside the band is returned unchanged", () => {
  const path: Point3[][] = [[[0, 0, 1], [10, 0, 5]], [[10, 0, 5], [10, 20, 5]]];
  const { polylines, clipped } = clipPolylinesToBand(path, 0, 12);
  assert.equal(clipped, false);
  assert.deepEqual(polylines, path);
});

test("a path that leaves the band and comes back is split rather than bridged", () => {
  // Bridging would draw a rail through the gap; two runs is the honest reading.
  const path: Point3[][] = [[[0, 0, 1], [1, 0, -1], [2, 0, 1], [3, 0, 1]]];
  const { polylines } = clipPolylinesToBand(path, 0, 12);
  assert.equal(polylines.length, 2);
  assert.equal(polylines[0]!.at(-1)![2], 0);
  assert.equal(polylines[1]![0]![2], 0);
  assert.deepEqual(polylines[1]!.at(-1), [3, 0, 1]);
});

test("a segment that crosses the whole band is trimmed at both ends", () => {
  // Both endpoints are outside, so a per-vertex walk sees nothing inside and
  // would return the segment untouched. The clip is per segment for that reason.
  const path: Point3[][] = [[[0, 0, -5], [10, 0, 20]]];
  const { polylines, clipped } = clipPolylinesToBand(path, 0, 10);
  assert.equal(clipped, true);
  assert.equal(polylines.length, 1);
  for (const line of polylines) {
    for (const [, , z] of line) {
      assert.ok(z >= -1e-9 && z <= 10 + 1e-9, `z ${z} left the band`);
    }
  }
  // -5 -> 20 over 10 ft of run, so z = 0 is a fifth along and z = 10 three fifths.
  assert.ok(Math.abs(polylines[0]![0]![0] - 2) < 1e-9);
  assert.ok(Math.abs(polylines[0]![1]![0] - 6) < 1e-9);
});

test("a path wholly outside the band leaves the original alone", () => {
  // Refusing to return nothing matters: a railing with no ribbon at all would
  // silently lose its geometry instead of falling back to its envelope.
  const path: Point3[][] = [[[0, 0, 40], [10, 0, 41]]];
  const { polylines } = clipPolylinesToBand(path, 0, 10);
  assert.equal(polylines.length, 1);
  assert.deepEqual(polylines[0], [[0, 0, 40], [10, 0, 41]]);
});

// ------------------------------------------------------------ sketch thickness

test("a category's thickness is the mode of the records that carry one", () => {
  const records = [
    ...Array.from({ length: 12 }, (_, index) => record(1000 + index, FLOORS, 0, 0.6562)),
    record(2000, FLOORS, 0, 9.8425), // one bad record must not move the mode
    ...Array.from({ length: 9 }, (_, index) => record(3000 + index, CEILINGS, 0, 0.1706)),
  ];
  const modes = modalSketchThickness(records, new Set([FLOORS, CEILINGS, RAMPS]), SPAN);
  assert.equal(modes.get(FLOORS), 0.6562);
  assert.equal(modes.get(CEILINGS), 0.1706);
  assert.equal(modes.has(RAMPS), false);
});

test("a category with no agreement publishes no thickness", () => {
  // This is the clause that keeps the rule off ramps: a ramp's record height is
  // its rise, so its spans all differ and there is nothing for a mode to find.
  const spans = [3.7744, 3.7752, 3.7747, 3.786, 3.7847, 3.79, 3.8, 3.81, 3.82];
  const records = spans.map((span, index) => record(4000 + index, RAMPS, 0, span));
  assert.equal(modalSketchThickness(records, new Set([RAMPS]), SPAN).size, 0);
});

test("a category with too few records publishes no thickness", () => {
  const records = Array.from({ length: 7 }, (_, index) => record(5000 + index, FLOORS, 0, 0.6562));
  assert.equal(modalSketchThickness(records, new Set([FLOORS]), SPAN).size, 0);
});

test("the thickness hangs below the flat record, because the face is the top", () => {
  const flat = record(6000, FLOORS, 24.278, 24.278);
  assert.equal(completeFlatSketchRecord(flat, 0.6562, SPAN), true);
  assert.equal(flat.boundsFeet.max.z, 24.278);
  assert.ok(Math.abs(flat.boundsFeet.min.z - 23.6218) < 1e-9, `base ${flat.boundsFeet.min.z}`);
  // The plan is untouched: the thickness is the only thing the record lacked.
  assert.deepEqual(flat.boundsFeet.min.x, 0);
  assert.deepEqual(flat.boundsFeet.max.y, 20);
});

test("a record that already has a thickness is left alone", () => {
  const solid = record(6001, FLOORS, 23.6218, 24.278);
  assert.equal(completeFlatSketchRecord(solid, 0.1706, SPAN), false);
  assert.equal(solid.boundsFeet.min.z, 23.6218);
});

test("a real duplicated-bounds record that reads flat is the element's own statement", () => {
  const real = record(6002, FLOORS, 24.278, 24.278, { synthesised: false });
  assert.equal(completeFlatSketchRecord(real, 0.6562, SPAN), false);
  assert.equal(real.boundsFeet.min.z, 24.278);
});
