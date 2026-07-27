/**
 * A stair run's box from its own sketch curves.
 *
 * 12 of this model's stair flights reach a record whose only geometry is a hull
 * over the facets attributed to them, and every one of the 12 owns **exactly one
 * facet** — one plane's trim rectangle, right by luck for 6 and a fragment for the
 * other 6. Each also owns 39–119 sketch curves that close into exactly one
 * four-corner ring, and the ring is **flat**, so it has no elevations to be
 * extruded between: the rise is in the tread and riser edges the ring did not
 * consume. The whole curve set's box reproduces the export's to a median 0.164 ft,
 * against the facet hull's 3.084 ft, and 12 of 12 against the nearest single
 * product.
 *
 * Two details are the whole rule, and each has a failure it exists to prevent:
 *
 * - **own id only.** Ring assembly may take the `id - 1` Sketch companion's edges
 *   too, because it joins them geometrically; a hull cannot, because it takes
 *   their extremes. 1500325's own curves read z 14.436–19.849 ft, which is the
 *   export's 14.4–19.7 to a tenth of a foot; with its companion's they read
 *   0.000–24.278, a storey and a half of invented run.
 * - **the bands must meet.** Identical elements stack floor on floor, so a
 *   neighbour's curve set matches in plan and is a storey out in z — the same trap
 *   the railing sweep fell into. Eleven ceilings and a floor own such a set and
 *   were already drawn correctly from their own record.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ringRecordRise } from "../lib/reviter/convert.ts";
import { bandsMeet, sketchCurveBounds } from "../lib/reviter/sketch-curves.ts";

import type { CurveBounds, SketchCurve } from "../lib/reviter/sketch-curves.ts";

/** One straight edge between two model points, as the decoder yields it. */
const edge = (
  owner: number,
  start: [number, number, number],
  end: [number, number, number],
): SketchCurve => ({ offset: 0, owner, kind: "line", start, end, interior: [] });

const box = (bounds: NonNullable<ReturnType<typeof sketchCurveBounds>>) =>
  [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];

// Stair run 1500325 and the Sketch element below it, at the coordinates the
// supplied model writes. The run's flat ring corner and one riser edge carrying
// the rise are enough to reproduce both readings.
const RUN = 1_500_325;
const runCurves: SketchCurve[] = [
  edge(RUN, [243.6064, 869.4766, 14.4357], [248.1996, 869.4766, 14.4357]),
  edge(RUN, [248.1996, 869.4766, 14.4357], [248.1996, 879.3191, 19.8491]),
];
const companionCurves: SketchCurve[] = [
  edge(RUN - 1, [238.3571, 869.4766, 0.0], [248.1996, 884.8309, 24.2782]),
];

test("reads a stair run's box from the curves filed under its own id", () => {
  const bounds = sketchCurveBounds(RUN, new Map([[RUN, runCurves]]));
  assert.ok(bounds);
  assert.deepEqual(box(bounds), [243.6064, 869.4766, 14.4357, 248.1996, 879.3191, 19.8491]);
});

test("ignores the id - 1 Sketch companion, which ring assembly may take", () => {
  // The companion's single edge spans 0.000–24.278 ft in z. A hull that took it
  // would give this run a 24 ft rise where the export gives 5.4.
  const bounds = sketchCurveBounds(
    RUN,
    new Map([[RUN, runCurves], [RUN - 1, companionCurves]]),
  );
  assert.ok(bounds);
  assert.equal(bounds.min.z, 14.4357);
  assert.equal(bounds.max.z, 19.8491);
});

test("returns null when the element owns no curves of its own", () => {
  assert.equal(sketchCurveBounds(RUN, new Map()), null);
  assert.equal(sketchCurveBounds(RUN, new Map([[RUN, []]])), null);
  // The companion alone is not the element's own reading.
  assert.equal(sketchCurveBounds(RUN, new Map([[RUN - 1, companionCurves]])), null);
});

test("accepts a curve band that touches the record's, which is the stair case", () => {
  // 1500325's facet hull spans 4.593–14.436 ft and its curves 14.436–19.849, so
  // the two readings meet exactly at 14.436 and nowhere else. Six of the 12 runs
  // touch this way — the facet sits at the run's base — so a rule requiring
  // strict overlap would reject half the population it exists for.
  const record = { min: { x: 245.903, y: 879.3191, z: 4.5932 }, max: { x: 251.3164, y: 879.3191, z: 14.4357 } };
  const curves = sketchCurveBounds(RUN, new Map([[RUN, runCurves]]))!;
  assert.equal(bandsMeet(curves, record), true);
});

test("rejects a curve set a storey below the record — the stacked twin", () => {
  // Ceiling 1408775: its record sits at z 39.698 ft and the curves it is nearest
  // to at 24.278, a gap of 15.42 ft. The other ten ceilings read the same, and a
  // floor reads a 3.28 ft gap. All twelve are already drawn correctly from their
  // own record, so accepting the curves moved each of them by exactly that gap.
  const record = { min: { x: -256.1405, y: -33.3512, z: 39.6982 }, max: { x: -250.8963, y: -27.5861, z: 39.6982 } };
  const curves = { min: { x: -256.0264, y: -33.3512, z: 24.2782 }, max: { x: -250.8963, y: -27.5861, z: 24.2782 } };
  assert.equal(bandsMeet(curves, record), false);
  // Plan agreement cannot catch it: the twin's footprint is the same rectangle to
  // a tenth of a foot, which is why the test is on z alone.
  assert.ok(Math.abs(curves.max.x - record.max.x) < 0.01);
  assert.ok(Math.abs(curves.min.y - record.min.y) < 0.01);
});

test("the smallest floor of a gap that still rejects the twins", () => {
  // The separation is a plateau, not a fit: the 12 runs overlap by 0.00–8.95 ft
  // and the 12 twins are 3.28–15.42 ft apart, so any permitted gap from 0 to
  // 3.2 ft selects the same 12 and rejects the same 12. Zero is what ships.
  const at = (z: number) => ({ min: { x: 0, y: 0, z }, max: { x: 1, y: 1, z } });
  assert.equal(bandsMeet(at(0), at(0)), true);
  assert.equal(bandsMeet(at(0), at(3.28)), false);
  assert.equal(bandsMeet(at(0), at(-3.28)), false);
});

test("is symmetric, since neither reading is privileged", () => {
  const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 5 } };
  const b = { min: { x: 0, y: 0, z: 4 }, max: { x: 1, y: 1, z: 9 } };
  assert.equal(bandsMeet(a, b), bandsMeet(b, a));
  assert.equal(bandsMeet(a, b), true);
});

test("an arc's interior points are in the box, so a curved run is not clipped", () => {
  const arc: SketchCurve = {
    offset: 0,
    owner: RUN,
    kind: "arc",
    start: [0, 0, 0],
    end: [2, 0, 4],
    interior: [[1, 0, 9]],
  };
  const bounds = sketchCurveBounds(RUN, new Map([[RUN, [arc]]]));
  assert.ok(bounds);
  assert.equal(bounds.max.z, 9);
});

/*
 * The same reading, for a run whose record *is* its ring.
 *
 * The route above rescues a run whose record is a facet hull. A run with no
 * duplicated-bounds record at all takes a different path — a record synthesised
 * from its boundary ring — and there the ring is the only elevation available,
 * so the run was extruded from its base to its base. 1842441 was drawn
 * 16.90 × 17.06 × **0.00** ft where the export writes 16.90 × 17.10 × **9.68**,
 * with its plan already exact to 0.02 ft, and 1844215 was flat enough to fail
 * the display gate outright and not be drawn at all.
 *
 * `ringRecordRise` asks the same curve set with the same two guards. Measured on
 * the supplied model it fires on **2 of 38,960 records**, both stair runs the
 * export names, taking them from 4.84 and 2.21 ft out to **0.08 ft**, and moves
 * nothing else — the specificity matters more than the percentage here, because
 * a rule that adds extent can only be judged by what it touches.
 */
const at = (
  [minX, minY, minZ]: [number, number, number],
  [maxX, maxY, maxZ]: [number, number, number],
): CurveBounds => ({ min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } });

// Stair run 1842441, at the coordinates the supplied model writes: a flat ring at
// the run's base, and a curve set carrying the rise.
const RUN_RING = at([-16.7717, 120.8238, 0], [0.1268, 137.8809, 0]);
const RUN_CURVES = at([-16.7717, 120.8238, 0], [0.1268, 137.8809, 9.8425]);

test("takes a flat ring's rise from the element's own curve set", () => {
  const bounds = ringRecordRise(RUN_RING, RUN_CURVES);
  assert.equal(bounds.min.z, 0);
  assert.equal(bounds.max.z, 9.8425);
});

test("keeps the ring's plan, not the curve set's extremes", () => {
  // A curve set's box is a hull over every edge the element owns, including the
  // ones ring assembly rejected; the ring is the outline verified in plan
  // against the export. Where they differ the ring wins.
  const wider = at([-20, 118, 0], [4, 140, 9.8425]);
  const bounds = ringRecordRise(RUN_RING, wider);
  assert.equal(bounds.min.x, RUN_RING.min.x);
  assert.equal(bounds.max.y, RUN_RING.max.y);
  assert.equal(bounds.max.z, 9.8425);
});

test("leaves a ring that already carries elevations alone", () => {
  // Only a ring with no rise at all asks the curves; a ring with two elevations
  // is the element's own statement about itself.
  const solid = at([0, 0, 10], [10, 10, 12]);
  assert.equal(ringRecordRise(solid, RUN_CURVES), solid);
});

test("declines a curve set that is itself flat — the two ramps here", () => {
  // 1586431 and 2081718: every curve in their neighbourhood sits at one
  // elevation, so there is no rise to borrow and the record stays as it was.
  // They are why this is 2 records rather than 3.
  const ramp = at([-65.42, 334.73, 0], [-34.02, 356.97, 0]);
  assert.equal(ringRecordRise(ramp, at([-65.42, 334.73, 0], [-34.02, 356.97, 0])), ramp);
});

test("declines a curve band a storey away — the stacked twin again", () => {
  const twin = at([-16.7717, 120.8238, 9.8425], [0.1268, 137.8809, 19.685]);
  assert.equal(ringRecordRise(RUN_RING, twin).max.z, 0);
});

test("declines an element with no curves of its own", () => {
  assert.equal(ringRecordRise(RUN_RING, null), RUN_RING);
});
