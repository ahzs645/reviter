import assert from "node:assert/strict";
import test from "node:test";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import {
  closedBoundaryDoors,
  type NativeDoorBoundaryClosures,
} from "../lib/reviter/native-door-boundary-closures.ts";

type P = [number, number];
const model = "a".repeat(64);
const ring = (x0: number, y0: number, x1: number, y1: number): P[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** Door 10 (1.96 ft wide, 1 ft deep) between a straight jamb 20 on the left
 * and jamb 21 on the right; the closure extends the threshold to the right
 * jamb's far face point at x = 2.1. */
function fixture(rightJamb: P[][], closureRight = 2.1002) {
  const door = {
    id: "door:1:10",
    nativeElementId: 10,
    levelId: 1,
    pointFeet: [0.98, 0.5],
    normalFeet: [0, 1],
    footprintFeet: ring(0, 0, 1.96, 1),
    roomKeys: ["a", "b"],
    state: "connected",
  };
  const walls = [
    {
      levelId: 1,
      nativeElementId: 20,
      kind: "wall",
      approximate: false,
      ringsFeet: [ring(-1, 0, 0.1, 1)],
    },
    {
      levelId: 1,
      nativeElementId: 21,
      kind: "wall",
      approximate: false,
      ringsFeet: rightJamb,
    },
  ];
  const data = {
    source: { modelSha256: model },
    nativeLevels: [{ id: 1, elevationFeet: 0 }],
    walkingSupport: {
      version: 1,
      sourceModelSha256: model,
      floors: [
        {
          nativeElementId: 30,
          elevationFeet: 0,
          ringsFeet: [ring(-4, -4, 4, 4)],
        },
      ],
    },
    records: [],
    walls,
    doors: [door],
    edges: [
      {
        id: door.id,
        enabled: true,
        kind: "door",
        nativeElementId: 10,
        roomKeys: door.roomKeys,
      },
    ],
  } as unknown as IndoorDataset;
  const value: NativeDoorBoundaryClosures = {
    version: 1,
    sourceModelSha256: model,
    doors: [
      {
        id: "closure:10",
        levelId: 1,
        nativeElementId: 10,
        originalDoor: {
          pointFeet: [0.98, 0.5],
          normalFeet: [0, 1],
          footprintFeet: ring(0, 0, 1.96, 1),
          roomKeys: ["a", "b"],
        },
        footprintFeet: ring(0, 0, closureRight, 1),
        jambEvidence: walls.map((w) => ({
          nativeElementId: w.nativeElementId,
          ringsFeet: structuredClone(w.ringsFeet),
        })),
        evidenceSha256: "b".repeat(64),
        notes: "Measured native jamb correction.",
      },
    ],
  };
  return { data, value };
}
const outcome = (run: () => unknown) => {
  try {
    return { value: run() };
  } catch (error) {
    return { error: (error as Error).message };
  }
};
const both = (data: IndoorDataset, value: NativeDoorBoundaryClosures) =>
  outcome(() => closedBoundaryDoors(data, 1, value));
// Face from (2, 0) to (2.1, 1): the threshold end at x = 2.1 meets it only by
// entering the jamb (a 0.05 sq ft triangle, more than the old 0.002 overlap).
const oblique: P[][] = [
  [
    [2, 0],
    [3, 0],
    [3, 1],
    [2.1, 1],
  ],
];
// Oblique the other way: face from (2.1, 0) to (2, 1).
const obliqueReversed: P[][] = [
  [
    [2.1, 0],
    [3, 0],
    [3, 1],
    [2, 1],
  ],
];

test("a threshold end may enter an oblique named jamb within its tangent limit", () => {
  for (const [jamb, right] of [
    [oblique, 2.1002],
    [obliqueReversed, 2.1002],
  ] as const) {
    const { data, value } = fixture(jamb as P[][], right);
    const before = structuredClone(data);
    const r = both(data, value);
    assert.equal(r.error, undefined);
    assert.deepEqual(
      (r.value as { footprintFeet: P[] }[])[0]!.footprintFeet,
      value.doors[0]!.footprintFeet,
    );
    assert.deepEqual(data, before, "the original doorway is unchanged");
  }
});

test("an extension piece beyond a jamb, or past the tangent limit, is still refused", () => {
  // A thin oblique jamb (faces x = 2 + 0.1y and x = 2.07 + 0.1y): the end at
  // x = 2.1 meets it over 0.7 ft of depth, but the extension also crosses it
  // and leaves a piece beyond its far face, cut off from the doorway.
  const thin: P[][] = [
    [
      [2, 0],
      [2.07, 0],
      [2.17, 1],
      [2.1, 1],
    ],
  ];
  const beyond = both(
    ...(Object.values(fixture(thin)) as [
      IndoorDataset,
      NativeDoorBoundaryClosures,
    ]),
  );
  assert.match(beyond.error ?? "", /penetrates a jamb/);
  // Reaching x = 2.1502 needs a 0.19 ft tangent extension: over the default
  // 0.15 ft limit.
  const far = both(
    ...(Object.values(fixture(oblique, 2.1502)) as [
      IndoorDataset,
      NativeDoorBoundaryClosures,
    ]),
  );
  assert.match(far.error ?? "", /tangent extension/);
  // A foreign wall in the extension is still refused.
  const { data, value } = fixture(oblique);
  (data.walls as unknown[]).push({
    levelId: 1,
    nativeElementId: 99,
    kind: "column",
    approximate: false,
    ringsFeet: [ring(1.97, 0.2, 1.99, 0.8)],
  });
  assert.match(both(data, value).error ?? "", /foreign wall or column/);
});
