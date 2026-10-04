import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedRoomInteriors } from "../lib/reviter/reviewed-room-presentation.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
const rectangle = (
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number][][] => [
  [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ],
];
function fixture() {
  const sourceModelSha256 = "a".repeat(64),
    rings = rectangle(0.4, 0.4, 10, 9.6),
    walls = [
      rectangle(0, 0, 10.4, 0.4),
      rectangle(0, 0.4, 0.4, 10),
      rectangle(0.4, 9.6, 9.8, 10),
      rectangle(10, 0.4, 10.4, 10),
    ].map((ringsFeet, i) => ({
      kind: "wall",
      levelId: 1,
      nativeElementId: i + 1,
      approximate: false,
      ringsFeet,
    }));
  const data = {
    source: { modelSha256: sourceModelSha256 },
    nativeLevels: [{ id: 1, elevationFeet: 0 }],
    walls,
    doors: [],
    records: [
      {
        key: "office",
        number: "Office",
        levelId: 1,
        walkable: true,
        circulation: false,
        stair: false,
        ringsFeet: rings,
      },
    ],
  } as unknown as IndoorDataset;
  const closure = {
    nativeWallId: 3,
    reachFeet: 0.2,
    ringsFeet: rectangle(9.798, 9.6, 10.002, 10),
  };
  const review = {
    version: 1, sourceModelSha256, kind: "manual-native-wall-face-review", displayClosures: [closure],
  };
  const annotations = [
    {
      key: "office",
      levelId: 1,
      polygonFeet: rings[0],
      labelPointFeet: [5, 5],
      manualBoundaryReview: review,
    },
  ] as unknown as RoomDirectoryData["annotations"];
  const model = {
    meshes: [],
    elementBounds: [
      {
        elementId: 3,
        solid: {
          start: { x: 0.4, y: 9.8 },
          end: { x: 9.8, y: 9.8 },
          thickness: 0.4,
        },
      },
    ],
  } as unknown as ConvertResult;
  const floors = new Map([["office", [rectangle(0, 0, 10.4, 10)]]]);
  return { data, annotations, model, floors, review };
}
test("reviewed native facade seam creates a display block without altering walls or routes", () => {
  const f = fixture(),
    before = JSON.stringify(f);
  const result = reviewedRoomInteriors(
    f.data,
    f.annotations,
    f.model,
    f.floors,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].boundarySource, "reviewed-native-wall-enclosure");
  assert.ok(result[0].reviewProof);
  assert.equal(JSON.stringify(f), before);
});
test("reject stale model, oversized closure and moved wall-axis closure", () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) =>
      (f.review.sourceModelSha256 =
        "b".repeat(64)),
    (f: ReturnType<typeof fixture>) =>
      (f.review.displayClosures[0].reachFeet = 6),
    (f: ReturnType<typeof fixture>) =>
      (f.review.displayClosures[0].ringsFeet = rectangle(
        5,
        5,
        5.2,
        5.4,
      )),
  ]) {
    const f = fixture();
    mutation(f);
    assert.deepEqual(
      reviewedRoomInteriors(f.data, f.annotations, f.model, f.floors),
      [],
    );
  }
});
test("reject incomplete native floor support and ambiguous room labels", () => {
  const f = fixture();
  f.floors.set("office", [rectangle(0, 0, 6, 10)]);
  assert.deepEqual(
    reviewedRoomInteriors(f.data, f.annotations, f.model, f.floors),
    [],
  );
  const g = fixture();
  g.annotations.push({
    key: "other",
    levelId: 1,
    labelPointFeet: [7, 7],
  } as unknown as RoomDirectoryData["annotations"][number]);
  assert.deepEqual(
    reviewedRoomInteriors(g.data, g.annotations, g.model, g.floors),
    [],
  );
});
