import assert from "node:assert/strict";
import test from "node:test";

import { clipSolidToEnvelope, solidBelongsToEnvelope } from "../lib/reviter/solid-clip.ts";
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
