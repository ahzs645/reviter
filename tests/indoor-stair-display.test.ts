import test from "node:test";
import assert from "node:assert/strict";
import { prepareIndoorStairDisplay } from "../lib/reviter/indoor-stair-display.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type {
  IndoorDataset,
  IndoorRecord,
} from "../lib/reviter/indoor-contract.ts";

const model = {
  // Native level is nominal zero, but the real slab/flight endpoint is at 3.28.
  levels: [{ levelId: 311, elevation: 0 }],
  nativeStairAssemblies: [{ stairElementId: 100, runAndLandingIds: [101] }],
  elementBounds: [
    {
      elementId: 101,
      boundsFeet: {
        min: { x: 0, y: 0, z: 3.28 },
        max: { x: 7, y: 8, z: 14.28 },
      },
      stairTreadThicknessFeet: 0.16404199475065617,
      stairTreads: [
        [
          [0, 0, 3.28],
          [2, 0, 3.28],
          [2, 1, 3.28],
          [0, 1, 3.28],
        ],
        [
          [2, 1, 7],
          [4, 3, 7],
          [3, 4, 7],
          [1, 2, 7],
        ],
        [
          [5, 7, 14.28],
          [7, 7, 14.28],
          [7, 8, 14.28],
          [5, 8, 14.28],
        ],
      ],
    },
  ],
} as unknown as ConvertResult;
const stair = {
  key: "stair",
  levelId: 311,
  elevationFeet: 3.28,
  stair: true,
  walkable: true,
  ringsFeet: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  ],
} as IndoorRecord;
const dataset = {
  source: { modelSha256: "same-model" },
  records: [stair],
} as IndoorDataset;
test("native curved flight continues beyond source area at its recovered physical floor endpoint", () => {
  const before = structuredClone(dataset);
  const display = prepareIndoorStairDisplay(model, dataset);
  assert.equal(display.flights.length, 1);
  assert.equal(display.flights[0]!.treads.length, 3);
  assert.equal(
    display.flights[0]!.treads[0]!.thicknessFeet,
    0.16404199475065617,
  );
  assert.deepEqual(display.flights[0]!.treads[2]!.ringFeet, [
    [5, 7],
    [7, 7],
    [7, 8],
    [5, 8],
  ]);
  assert.deepEqual(dataset, before); // No source boundary/arrival/route repair implied.
});
test("overhead unrelated floors, rooms, voids and duplicate ownership do not acquire a flight", () => {
  assert.equal(
    prepareIndoorStairDisplay(model, {
      ...dataset,
      records: [{ ...stair, elevationFeet: 8 }],
    }).flights.length,
    0,
  );
  assert.equal(
    prepareIndoorStairDisplay(model, {
      ...dataset,
      records: [{ ...stair, stair: false }],
    }).flights.length,
    0,
  );
  assert.equal(
    prepareIndoorStairDisplay(model, {
      ...dataset,
      records: [{ ...stair, walkable: false }],
    }).flights.length,
    0,
  );
  assert.equal(
    prepareIndoorStairDisplay(model, {
      ...dataset,
      records: [stair, { ...stair, key: "duplicate" }],
    }).flights.length,
    0,
  );
  assert.equal(
    prepareIndoorStairDisplay(model, {
      ...dataset,
      records: [
        {
          ...stair,
          ringsFeet: [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
            ],
          ],
        },
      ],
    }).flights.length,
    0,
  );
});

test("reviewed treads in a shared corridor are display-only and retain native heights", () => {
  const shared = {
    ...dataset,
    records: [{ ...stair, stair: false, circulation: true }],
  };
  const source = [
    { key: stair.key, stairDisplayOnlyFlightIds: [100] },
  ] as import("../lib/reviter/room-directory.ts").DirectoryRoom[];
  const before = structuredClone(shared);
  const display = prepareIndoorStairDisplay(model, shared, source);
  assert.equal(display.flights.length, 1);
  assert.equal(display.flights[0]!.displayOnly, true);
  assert.equal(display.flights[0]!.treads.length, 3);
  assert.deepEqual(shared, before);
  source[0]!.stairDisplayOnlyFlightIds = [999];
  assert.equal(
    prepareIndoorStairDisplay(model, shared, source).flights.length,
    0,
  );
});
test("stair display retains native slab holes as occluders without inferring openings from treads", () => {
  const withSlab=structuredClone(model);
  withSlab.elementBounds!.push({
    elementId:200,categoryId:-2000032,
    boundsFeet:{min:{x:-1,y:-1,z:2.8},max:{x:8,y:9,z:3.28}},
    loops:[[[ -1,-1,3.28],[8,-1,3.28],[8,9,3.28],[-1,9,3.28]],[[0,0,3.28],[2,0,3.28],[2,1,3.28],[0,1,3.28]]],
  } as NonNullable<ConvertResult['elementBounds']>[number]);
  const before=structuredClone(dataset);
  const display=prepareIndoorStairDisplay(withSlab,dataset);
  assert.equal(display.flights[0]!.floorOccluders!.length,1);
  assert.equal(display.flights[0]!.floorOccluders![0]!.nativeElementId,200);
  assert.equal(display.flights[0]!.floorOccluders![0]!.ringsFeet.length,2);
  assert.deepEqual(dataset,before);
});
