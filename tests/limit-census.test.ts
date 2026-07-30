import assert from "node:assert/strict";
import test from "node:test";

import {
  limitCensus,
  limitCensusWarning,
  noteLimit,
  resetLimitCensus,
} from "../lib/reviter/limit-census.ts";
import { assembleRings } from "../lib/reviter/sketch-curves.ts";
import { surfaceQuadsFor } from "../lib/reviter/native-geometry.ts";
import { standardsReaderSupports } from "../lib/reviter/reader-support.ts";
import type { PlanePatch } from "../lib/reviter/surfaces.ts";
import type { SketchCurve } from "../lib/reviter/sketch-curves.ts";

test("a conversion that stays inside every fitted limit reports nothing", () => {
  // This is the ordinary case, and it is why these limits were invisible: on
  // the building they were measured against none of them ever binds.
  resetLimitCensus();
  assert.deepEqual(limitCensus(), []);
  assert.equal(limitCensusWarning(), null);
});

test("a limit that binds is counted and named", () => {
  resetLimitCensus();
  noteLimit("max-treads");
  noteLimit("max-treads");
  noteLimit("max-quad-span-feet");
  const census = limitCensus();
  assert.deepEqual(
    census.map((entry) => [entry.limit, entry.rejections]),
    [["max-treads", 2], ["max-quad-span-feet", 1]],
  );
  const warning = limitCensusWarning();
  assert.match(warning ?? "", /fitted to a single reference building/);
  assert.match(warning ?? "", /max-treads/);
});

test("the census is per conversion, so a previous model's tally cannot leak", () => {
  resetLimitCensus();
  noteLimit("max-coordinate");
  assert.equal(limitCensus().length, 1);
  resetLimitCensus();
  assert.deepEqual(limitCensus(), []);
});

test("a planar face wider than the accepted quad span reports rather than vanishing", () => {
  resetLimitCensus();
  const wide: PlanePatch = {
    kind: "plane",
    offset: 0,
    origin: { x: 0, y: 0, z: 0 },
    uDir: { x: 1, y: 0, z: 0 },
    vDir: { x: 0, y: 0, z: 1 },
    uMin: 0,
    uMax: 5_000, // a site-scale plane: beyond the 2,000 ft limit
    vMin: 0,
    vMax: 10,
  };
  assert.deepEqual(surfaceQuadsFor(7, [wide]), []);
  assert.deepEqual(
    limitCensus().map((entry) => entry.limit),
    ["max-quad-span-feet"],
  );
});

test("ring assembly reports when it stops at the curve limit", () => {
  resetLimitCensus();
  // 4,001 distinct segments: one more than `MAX_CURVES_PER_ELEMENT` accepts.
  const curves: SketchCurve[] = Array.from({ length: 4_001 }, (_, index) => ({
    offset: index,
    owner: 3,
    kind: "line" as const,
    start: [index * 2, 0, 0] as [number, number, number],
    end: [index * 2 + 1, 0, 0] as [number, number, number],
    interior: [],
  }));
  assembleRings(curves);
  assert.deepEqual(
    limitCensus().map((entry) => entry.limit),
    ["max-curves-per-element"],
  );
  resetLimitCensus();
});

test("the standards-aware reader's range is stated once and read from both ends", () => {
  // The vendored Rust/WASM reader declares 2016–2026 and traps on a 2027 file,
  // so this gate is load-bearing rather than stale — but the range belongs in
  // one place instead of four.
  assert.equal(standardsReaderSupports(2016), true);
  assert.equal(standardsReaderSupports(2026), true);
  assert.equal(standardsReaderSupports(2015), false);
  assert.equal(standardsReaderSupports(2027), false);
  assert.equal(standardsReaderSupports(Number.NaN), false);
});
