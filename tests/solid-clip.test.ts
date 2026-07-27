import assert from "node:assert/strict";
import test from "node:test";

import {
  clipSolidBandToEnvelope,
  clipSolidToEnvelope,
  extendSolidToEnvelope,
  shrinkSolidIntoEnvelope,
  solidBelongsToEnvelope,
} from "../lib/reviter/solid-clip.ts";
import type { WallSolid } from "../lib/reviter/native-geometry.ts";
import type { Bounds3 } from "../lib/reviter/types.ts";

const solid = (x0: number, y0: number, x1: number, y1: number): WallSolid => ({
  elementId: 290860,
  start: { x: x0, y: y0, z: 0 },
  end: { x: x1, y: y1, z: 0 },
  thickness: 1.148,
  baseElevation: 0,
  topElevation: 10,
} as WallSolid);

const envelope = (minX: number, minY: number, maxX: number, maxY: number): Bounds3 => ({
  min: { x: minX, y: minY, z: 0 },
  max: { x: maxX, y: maxY, z: 10 },
});

test("shortens a solid that runs past the element's own envelope", () => {
  // A wall's solid is its trim range — the wall as modelled, before Revit's
  // join trimming. The record is the wall as built, and for walls that carry a
  // real one it reproduces the export's box corner for corner. 33 of 110
  // IfcWall solids run longer than the wall's own location line, by a median of
  // 6.07 ft.
  const run = solid(-30, 0, 10, 0);
  assert.equal(clipSolidToEnvelope(run, envelope(-20, -1, 5, 1)), true);
  assert.ok(Math.abs(run.start.x - -20) < 1e-9);
  assert.ok(Math.abs(run.end.x - 5) < 1e-9);
  // Only the plan is clipped; the elevations and thickness are the solid's own.
  assert.equal(run.topElevation, 10);
  assert.equal(run.thickness, 1.148);
});

test("leaves a solid alone when it already fits", () => {
  const run = solid(-10, 0, 4, 0);
  assert.equal(clipSolidToEnvelope(run, envelope(-20, -1, 5, 1)), false);
  assert.equal(run.start.x, -10);
  assert.equal(run.end.x, 4);
});

test("clips a solid at an angle along its own direction", () => {
  const run = solid(0, 0, 20, 20);
  assert.equal(clipSolidToEnvelope(run, envelope(0, 0, 5, 5)), true);
  // The clipped run stays on the original line, so orientation survives.
  assert.ok(Math.abs(run.end.x - run.end.y) < 1e-9);
  assert.ok(Math.abs(run.end.x - 5) < 1e-9);
});

test("disowns a solid that shares no point with the element's own envelope", () => {
  // 1500873's bounds record reproduces its export box corner for corner and the
  // solid attributed to it sits 243 ft away, which no amount of clipping can
  // shorten into the wall. The record is the checked reading — it matches the
  // export for 99.4% of the walls that carry one — so the solid is the
  // attribution that went to the wrong element.
  assert.equal(solidBelongsToEnvelope(solid(100, 100, 120, 100), envelope(-20, -1, 5, 1)), false);
  // A run that crosses the envelope with neither end inside it is the element's:
  // that is the ordinary as-modelled overrun the clip absorbs.
  assert.equal(solidBelongsToEnvelope(solid(-30, 0, 30, 0), envelope(-20, -1, 5, 1)), true);
  // Either end inside is enough.
  assert.equal(solidBelongsToEnvelope(solid(0, 0, 40, 0), envelope(-20, -1, 5, 1)), true);
  assert.equal(solidBelongsToEnvelope(solid(-40, 0, 0, 0), envelope(-20, -1, 5, 1)), true);
  // An angled run that passes beside the envelope without meeting it is not.
  assert.equal(solidBelongsToEnvelope(solid(-30, 10, 30, 10), envelope(-20, -1, 5, 1)), false);
});

test("keeps a solid whose miss is numeric rather than a disagreement", () => {
  // Two solids in the supplied project miss their envelope by 1e-4 ft, which is
  // a rounded corner. The slack is 0.05 ft — well above that and far below the
  // 0.197 ft of the thinnest wall in the model.
  assert.equal(solidBelongsToEnvelope(solid(5.0001, 0, 30, 0), envelope(-20, -1, 5, 1)), true);
  assert.equal(solidBelongsToEnvelope(solid(5.04, 0, 30, 0), envelope(-20, -1, 5, 1)), true);
  assert.equal(solidBelongsToEnvelope(solid(5.3, 0, 30, 0), envelope(-20, -1, 5, 1)), false);
});

test("extends a solid to the join extension its envelope holds", () => {
  // The trim range is the wall as modelled and Revit extends a wall's *body* at
  // a join to the far face of the wall it meets, without moving the location
  // line — so the rebuilt wall stops short. Over the 4,008 axis-aligned
  // solid-drawn walls the shortfall spikes at 45, 50, 60, 75, 100, 120, 150 and
  // 200 mm: exactly half of this model's wall types.
  const run = solid(-10, 0, 4, 0);
  assert.equal(extendSolidToEnvelope(run, envelope(-20, -1, 5, 1)), true);
  assert.ok(Math.abs(run.start.x - -20) < 1e-9);
  assert.ok(Math.abs(run.end.x - 5) < 1e-9);
  // Only the run moves. The thickness and elevations are the solid's own.
  assert.equal(run.thickness, 1.148);
  assert.equal(run.topElevation, 10);
});

test("extends against the drawn box's corners, not the centreline", () => {
  // A drawn box corner sits half a thickness off the centreline along the run's
  // normal, and for a wall at 45° the extreme-x and extreme-y corners are at
  // opposite ends. A wall already filling its own envelope must not grow.
  const half = 1.148 / 2;
  const diagonal = solid(0, 0, 10, 10);
  const tight = envelope(-half * Math.SQRT1_2, -half * Math.SQRT1_2,
    10 + half * Math.SQRT1_2, 10 + half * Math.SQRT1_2);
  assert.equal(extendSolidToEnvelope(diagonal, tight), false);
  assert.equal(diagonal.end.x, 10);
});

test("never lets the extension shrink a run", () => {
  // The reach is signed, and an end whose corner is already outside the envelope
  // reads negative. Letting that through made this an unguarded shrink and cut
  // four multi-body walls from 0.373 ft out to 1.278 ft.
  const over = solid(0, 0, 20, 0);
  assert.equal(extendSolidToEnvelope(over, envelope(0, -1, 5, 1)), false);
  assert.equal(over.end.x, 20);
});

test("declines an extension longer than the run it extends", () => {
  // A 0.97 ft stub stretched 5.46 ft is not a join. The cap is the run's own
  // length, which is a bound taken from the solid rather than fitted to the
  // export; it removes all 16 such ends and costs 3 of 4,883 exact walls.
  const stub = solid(0, 0, 1, 0);
  assert.equal(extendSolidToEnvelope(stub, envelope(-50, -1, 50, 1)), true);
  assert.ok(Math.abs(stub.start.x - -1) < 1e-9);
  assert.ok(Math.abs(stub.end.x - 2) < 1e-9);
});

test("shrinks a diagonal wall's box into its own envelope", () => {
  // `clipSolidToEnvelope` clips the centreline, and for a wall at an angle that
  // leaves two box corners outside: 332243's drawn box read 9.91 x 15.32 ft
  // against an envelope and an export box that both read 9.36 x 16.21.
  const half = 1.148 / 2;
  const diagonal = solid(0, 0, 10, 10);
  // The envelope of the same rectangle, one foot of run shorter.
  const shorter = 10 - Math.SQRT1_2;
  const box = envelope(-half * Math.SQRT1_2, -half * Math.SQRT1_2,
    shorter + half * Math.SQRT1_2, shorter + half * Math.SQRT1_2);
  assert.equal(shrinkSolidIntoEnvelope(diagonal, box), true);
  assert.ok(Math.abs(diagonal.end.x - shorter) < 1e-6);
  assert.ok(Math.abs(diagonal.end.y - shorter) < 1e-6);
  assert.equal(diagonal.thickness, 1.148);
});

test("declines to shrink into an envelope holding more than this one slab", () => {
  // The premise is that the envelope is this slab's own box. Where it is a union
  // — a wall the exporter writes as two swept bodies — the two solved lengths
  // disagree and the shrink declines: unguarded it cut four such walls from
  // 0.373 ft out to 1.278 ft.
  const run = solid(0, 0, 10, 0);
  const union = envelope(-0.6, -0.6, 10.6, 30);
  assert.equal(shrinkSolidIntoEnvelope(run, union), false);
  assert.equal(run.end.x, 10);
  // And a wall that already fills its own box is left alone.
  const fitted = solid(0, 0, 10, 0);
  assert.equal(shrinkSolidIntoEnvelope(fitted, envelope(0, -1.148 / 2, 10, 1.148 / 2)), false);
  assert.equal(fitted.end.x, 10);
});

test("intersects the solid's elevation band with the element's own record", () => {
  // The plan rules' argument on the axis nothing was checking. Of the 5,312
  // solid-drawn records with a real bounds block, exactly three have a solid
  // reaching outside the record in z, and all three are wrong by 6.6-9.2 ft:
  // 1192647's record and its export box both read 0.66 ft tall against a solid
  // drawn 9.84.
  const tall = solid(0, 0, 10, 0);
  assert.equal(clipSolidBandToEnvelope(tall, {
    min: { x: -1, y: -1, z: 4 },
    max: { x: 11, y: 1, z: 6 },
  }), true);
  assert.equal(tall.baseElevation, 4);
  assert.equal(tall.topElevation, 6);
  // It can only narrow, and it leaves a band that already fits alone.
  const fitted = solid(0, 0, 10, 0);
  assert.equal(clipSolidBandToEnvelope(fitted, envelope(-1, -1, 11, 1)), false);
  assert.equal(fitted.baseElevation, 0);
  assert.equal(fitted.topElevation, 10);
  // A band that would collapse is a disagreement to report, not a height to
  // invent.
  const disjoint = solid(0, 0, 10, 0);
  assert.equal(clipSolidBandToEnvelope(disjoint, {
    min: { x: -1, y: -1, z: 40 },
    max: { x: 11, y: 1, z: 50 },
  }), false);
  assert.equal(disjoint.topElevation, 10);
});

test("leaves a solid alone rather than inventing a length for it", () => {
  // Wholly outside its own envelope is a disagreement to report, not a length
  // to make up, and a run that would clip to nothing keeps its geometry.
  const away = solid(100, 100, 120, 100);
  assert.equal(clipSolidToEnvelope(away, envelope(-20, -1, 5, 1)), false);
  assert.equal(away.start.x, 100);

  const grazing = solid(4.99, 0, 30, 0);
  assert.equal(clipSolidToEnvelope(grazing, envelope(-20, -1, 5, 1)), false);
  assert.equal(grazing.end.x, 30);
});
