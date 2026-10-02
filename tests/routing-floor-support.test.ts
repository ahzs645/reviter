import test from "node:test";
import assert from "node:assert/strict";
import { routingFloorPlateRecords } from "../lib/reviter/routing-floor-support.ts";
import { nativeArrivalFloorSupport } from "../lib/reviter/indoor-arrival-recovery.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const slab = (id: number, top = 0): ElementBoundsRecord => ({
  elementId: id,
  categoryId: -2000032,
  stream: "test",
  chunkIndex: 0,
  rawOffset: 0,
  recordOffset: 0,
  boundsFeet: {
    min: { x: 0, y: 0, z: top - 1 },
    max: { x: 10, y: 10, z: top },
  },
  loops: [
    [
      [0, 0, top - 1],
      [10, 0, top - 1],
      [10, 10, top - 1],
      [0, 10, top - 1],
    ],
    [
      [4, 4, top - 1],
      [4, 6, top - 1],
      [6, 6, top - 1],
      [6, 4, top - 1],
    ],
  ],
});
test("an orphan slab is found by physical top elevation, retaining its exact opening", () => {
  const floor = slab(1),
    model = { elementBounds: [floor, slab(2, 12)] };
  const found = routingFloorPlateRecords(model, 0);
  assert.deepEqual(
    found.map((f) => f.elementId),
    [1],
  );
  assert.equal(found[0], floor);
  const support = nativeArrivalFloorSupport({
    floors: found.map((f) =>
      f.loops!.map((loop) => loop.map((p) => [p[0], p[1]])),
    ),
  });
  assert.equal(support!([2, 2], [2, 2]), true);
  assert.equal(
    support!([5, 5], [5, 5]),
    false,
    "the atrium must stay unsupported",
  );
  assert.deepEqual(
    routingFloorPlateRecords(model, 12).map((f) => f.elementId),
    [2],
  );
});
test("sloping profiles, bounds-only slabs, foreign categories and another storey cannot fabricate support", () => {
  const slope = slab(1);
  slope.loops![0]![1]![2] = 0.5;
  const boundsOnly = slab(2);
  delete boundsOnly.loops;
  const roof = { ...slab(3), categoryId: -2000035 };
  const invalid = slab(4);
  invalid.loops![0]![0]![0] = NaN;
  const degenerate = slab(5);
  degenerate.loops = [
    [
      [0, 0, 0],
      [1, 1, 0],
    ],
  ];
  assert.deepEqual(
    routingFloorPlateRecords(
      {
        elementBounds: [
          slope,
          boundsOnly,
          roof,
          invalid,
          degenerate,
          slab(6, 3.28084),
        ],
      },
      0,
    ),
    [],
  );
  assert.deepEqual(
    routingFloorPlateRecords({ elementBounds: [slab(7)] }, NaN),
    [],
  );
});
