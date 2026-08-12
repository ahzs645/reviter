/**
 * What a DWG is allowed to ask the plan reader to do.
 *
 * A DWG is opened straight from whatever the user dropped on the page, and
 * every count and coordinate in these tests is read from the file with no
 * checking beyond "is it a number". Two of them used to be enough to end the
 * tab on their own: a block reference declaring a nine-million-copy array, and
 * a bulge that drives an arc's radius to infinity and the whole SVG with it.
 *
 * Each test here is a file that a text editor and five minutes can produce, and
 * each one asserts both halves of the fix — that the read finishes quickly with
 * something drawable, and that the limit which bound says so in the census
 * rather than leaving the drawing quietly short.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DRAWING_ENTITIES,
  convertDwgEntities,
  convertDwgEntity,
  dwgBlockDefinitions,
} from "../lib/reviter/dwg-entities.ts";
import { dwgEntityIsFinite, dwgSectionSvg, entityBounds } from "../lib/reviter/dwg-plan.ts";
import { limitCensus, resetLimitCensus } from "../lib/reviter/limit-census.ts";

/** A one-unit horizontal line at the origin, as a block's whole contents. */
const unitLine = [{
  type: "LINE",
  layer: "0",
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 1, y: 0 },
}];

const database = (blocks: Record<string, unknown[]>) => ({
  tables: {
    BLOCK_RECORD: {
      entries: [
        { name: "*Model_Space", handle: "22", entities: [] },
        ...Object.entries(blocks).map(([name, entities]) => ({ name, entities })),
      ],
    },
  },
});

const limitsHit = () => limitCensus().map((entry) => entry.limit);

test("a block reference declaring a nine-million-copy grid is clamped, not expanded", () => {
  resetLimitCensus();
  const blocks = dwgBlockDefinitions(database({ TICK: unitLine }));
  // The measured hang: 3,000 x 3,000 is 9,000,000 entities in 21 seconds.
  const out = convertDwgEntities([{
    type: "INSERT", layer: "A", name: "TICK",
    insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0,
    columnCount: 3_000, rowCount: 3_000, columnSpacing: 1, rowSpacing: 1,
  }], { blocks });

  // The bound is the count, not the clock: 4,096 copies of a one-line block is
  // the cap, and 9,000,000 was the alternative. Nothing here is timed, because
  // a wall-clock assertion on a shared machine tests the machine.
  assert.ok(out.length <= 4_096, `bounded to the copy cap, got ${out.length}`);
  assert.ok(out.length > 0, "the reference still draws what it can");
  assert.deepEqual(limitsHit(), ["max-block-array-copies"], "the clamp is reported");
});

test("a single-row array of nine million is bounded too", () => {
  // Both a per-axis span and a total are needed: 1 x 9,000,000 costs exactly
  // what 3,000 x 3,000 costs, and a per-axis cap alone would not see it.
  resetLimitCensus();
  const blocks = dwgBlockDefinitions(database({ TICK: unitLine }));
  const out = convertDwgEntities([{
    type: "INSERT", layer: "A", name: "TICK",
    insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0,
    columnCount: 1, rowCount: 9_000_000, rowSpacing: 1,
  }], { blocks });

  assert.ok(out.length <= 4_096, `bounded, got ${out.length}`);
  assert.deepEqual(limitsHit(), ["max-block-array-copies"]);
});

test("an array a drafter would actually stamp is untouched and unreported", () => {
  // The cap has to be invisible on real work, or it is just a different bug.
  resetLimitCensus();
  const blocks = dwgBlockDefinitions(database({ BAY: unitLine }));
  const out = convertDwgEntities([{
    type: "INSERT", layer: "A", name: "BAY",
    insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0,
    columnCount: 40, rowCount: 12, columnSpacing: 9, rowSpacing: 20,
  }], { blocks });

  assert.equal(out.length, 480, "every copy of a 40 x 12 parking grid is drawn");
  assert.deepEqual(limitsHit(), [], "nothing is reported when nothing bound");
});

test("nested references cannot multiply past the drawing's entity budget", () => {
  /*
   * Depth alone was bounded and breadth alone is now bounded, but eight levels
   * of legal arrays still multiply: this is 64 copies at each of four levels,
   * which is 16.7 million entities inside `MAX_BLOCK_DEPTH` and inside every
   * per-reference cap. The budget is what stops it, and it has to stop it from
   * inside the nesting rather than after the outer loop returns.
   */
  resetLimitCensus();
  const grid = (name: string) => [{
    type: "INSERT", name, insertionPoint: { x: 0, y: 0 },
    xScale: 1, yScale: 1, rotation: 0,
    columnCount: 64, rowCount: 64, columnSpacing: 1, rowSpacing: 1,
  }];
  const blocks = dwgBlockDefinitions(database({
    L3: unitLine, L2: grid("L3"), L1: grid("L2"),
  }));
  const out = convertDwgEntities(grid("L1"), { blocks, maxEntities: 20_000 });

  // 16.7 million were reachable and 20,000 came back: the budget is enforced
  // from inside the nesting, not after the outermost loop has already run.
  assert.equal(out.length, 20_000, "expansion stops exactly on the budget");
  assert.deepEqual(limitsHit(), ["max-drawing-entities"]);
});

test("the entity budget counts one truncation, not one per entity refused", () => {
  resetLimitCensus();
  const raw = Array.from({ length: 500 }, (_, index) => ({
    type: "LINE", layer: "0",
    startPoint: { x: index, y: 0 }, endPoint: { x: index + 1, y: 0 },
  }));
  const out = convertDwgEntities(raw, { maxEntities: 10 });
  assert.equal(out.length, 10);
  assert.deepEqual(
    limitCensus().map((entry) => [entry.limit, entry.rejections]),
    [["max-drawing-entities", 1]],
    "490 refused entities are one reached limit, not 490 warnings",
  );
});

test("the shipped budget is the documented one", () => {
  // The corpus drawing holds 202,501 model-space entities before its blocks
  // expand; the default is about five times that.
  assert.equal(MAX_DRAWING_ENTITIES, 1_000_000);
});

test("a bulge that drives the radius to infinity leaves the chord, not an Infinity", () => {
  /*
   * `radius = chord / (2 * sin(|included| / 2))`, and a bulge past about 5e15
   * takes `atan` to exactly pi/2, the included angle to a full turn, and the
   * sine to 1.2e-16. On a chord this long that is division into infinity. The
   * arc is unrecoverable either way; the chord it was drawn across is not.
   */
  resetLimitCensus();
  const entity = convertDwgEntity({
    type: "LWPOLYLINE", layer: "0",
    vertices: [{ x: -1e300, y: 0 }, { x: 1e300, y: 0 }],
    bulges: [1e300],
  });

  assert.ok(entity, "the polyline survives as its straight run");
  assert.ok(dwgEntityIsFinite(entity), "and carries no infinite coordinate");
  assert.deepEqual(entity.points, [[-1e300, 0], [1e300, 0]]);
  assert.deepEqual(limitsHit(), ["non-finite-drawing-geometry"]);
});

test("an entity that cannot be made finite is refused where it is produced", () => {
  resetLimitCensus();
  // An ellipse whose minor axis overflows: both fields are finite on their own.
  const entity = convertDwgEntity({
    type: "ELLIPSE", layer: "0",
    center: { x: 0, y: 0 },
    majorAxisEndPoint: { x: 1e300, y: 0 },
    axisRatio: 1e300,
  });
  assert.equal(entity, null, "refused rather than handed on to the renderer");
  assert.deepEqual(limitsHit(), ["non-finite-drawing-geometry"]);
});

test("bounds look plausible for an infinite arc, which is why the SVG must not", () => {
  /*
   * This is the shape of the original failure. `entityBounds` drops non-finite
   * coordinates as it grows its box, so a poisoned entity contributes nothing
   * to the extent and the drawing's bounds stay exactly as measured-looking as
   * they were — the reference appeared to work right up to the point the
   * browser refused to parse `d="MInfinity 0AInfinity Infinity 0 0 1 …"` and
   * rendered nothing at all, with no warning anywhere to say why.
   */
  const poisoned = {
    type: "ARC", layer: "0",
    centre: [0, 0] as const, radius: Number.POSITIVE_INFINITY,
    startAngle: 0, endAngle: Math.PI / 2,
  };
  assert.equal(entityBounds(poisoned), null, "bounds simply ignore the infinity");
  assert.equal(dwgEntityIsFinite(poisoned), false);

  resetLimitCensus();
  const svg = dwgSectionSvg(
    [poisoned, { type: "LINE", layer: "0", points: [[0, 0], [10, 10]] }],
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  );
  assert.doesNotMatch(svg, /Infinity|NaN/u, "no unparseable number reaches the document");
  assert.match(svg, /M0 0L10 10/u, "and the good linework still draws");
  assert.deepEqual(limitsHit(), ["non-finite-drawing-geometry"]);
});

test("an all-infinity bounds box cannot take the document down either", () => {
  // `unionBounds` starts from this box and a caller can forward it unchecked;
  // `viewBox="Infinity …"` is rejected before any linework is read.
  resetLimitCensus();
  const svg = dwgSectionSvg([{ type: "LINE", layer: "0", points: [[0, 0], [1, 1]] }], {
    minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
  });
  assert.doesNotMatch(svg, /Infinity|NaN/u);
  assert.deepEqual(limitsHit(), ["non-finite-drawing-geometry"]);
});

test("an ordinary drawing still round-trips with nothing reported", () => {
  // The regression guard for all of the above: a drawing that stays inside
  // every bound must come out exactly as it did before, and say nothing.
  resetLimitCensus();
  const blocks = dwgBlockDefinitions(database({ DOOR: unitLine }));
  const out = convertDwgEntities([
    { type: "LINE", layer: "WALL", startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
    { type: "CIRCLE", layer: "SYM", center: { x: 5, y: 5 }, radius: 2 },
    {
      type: "LWPOLYLINE", layer: "WALL",
      vertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }], bulges: [1],
    },
    { type: "INSERT", layer: "A", name: "DOOR", insertionPoint: { x: 2, y: 2 } },
  ], { blocks });

  assert.equal(out.length, 4);
  assert.ok(out.every(dwgEntityIsFinite));
  const bounds = { minX: 0, minY: -3, maxX: 10, maxY: 7 };
  const svg = dwgSectionSvg(out, bounds);
  assert.doesNotMatch(svg, /Infinity|NaN/u);
  assert.match(svg, /data-dwg-layer="WALL"/u);
  assert.deepEqual(limitsHit(), [], "no limit bound on an ordinary drawing");
});
