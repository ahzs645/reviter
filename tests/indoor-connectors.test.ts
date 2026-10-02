import test from "node:test";
import assert from "node:assert/strict";
import {
  validateIndoorConnectorReview,
  supportedIndoorConnectors,
  type IndoorConnectorReview,
} from "../lib/reviter/indoor-connectors.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
const sha = "a".repeat(64);
const rooms: DirectoryRoom[] = [1, 2, 3].map((i) => ({
  key: `room${i}`,
  building: "01",
  levelId: i,
  name: "Lift lobby",
  polygonFeet: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  labelPointFeet: [5, 5],
  confidence: 1,
}));
const model = {
  elementBounds: [900, 101, 102, 103].map((elementId) => ({ elementId })),
  levels: [1, 2, 3].map((levelId) => ({ levelId })),
  nativeAssociatedLevelRelations: [1, 2, 3].map((i) => ({
    elementId: 100 + i,
    levelId: i,
  })),
} as unknown as ConvertResult;
const review = (): IndoorConnectorReview => ({
  version: 1,
  modelSha256: sha,
  connectors: [
    {
      id: "lift",
      kind: "elevator",
      nativeElementId: 900,
      evidence: "Explicit reviewed native lift thresholds",
      accessible: "unknown",
      direction: "both",
      entrances: [1, 2, 3].map((i) => ({
        roomKey: `room${i}`,
        levelId: i,
        nativeElementId: 100 + i,
        pointFeet: [5, 5],
      })),
    },
  ],
});
test("explicit connector metadata binds native threshold identities and served floors", () => {
  const r = review();
  validateIndoorConnectorReview(r);
  assert.equal(
    supportedIndoorConnectors(model, rooms, sha, r).accepted.length,
    1,
  );
  r.connectors[0]!.entrances[1]!.nativeElementId = 101;
  assert.equal(
    supportedIndoorConnectors(model, rooms, sha, r).accepted.length,
    0,
  );
});
test("connector reviews reject stale model bytes, unsupported anchors and inferred elements", () => {
  assert.throws(
    () => supportedIndoorConnectors(model, rooms, "b".repeat(64), review()),
    /different model/,
  );
  const r = review();
  r.connectors[0]!.entrances[0]!.pointFeet = [12, 5];
  assert.equal(
    supportedIndoorConnectors(model, rooms, sha, r).rejected.length,
    1,
  );
  const n = review();
  n.connectors[0]!.nativeElementId = 777;
  assert.equal(
    supportedIndoorConnectors(model, rooms, sha, n).rejected.length,
    1,
  );
});
test("escalators require explicit one-way direction and cannot be confirmed step-free", () => {
  const r = review();
  r.connectors[0]!.kind = "escalator";
  r.connectors[0]!.entrances.pop();
  assert.throws(() => validateIndoorConnectorReview(r), /direction/);
  r.connectors[0]!.direction = "from-to";
  validateIndoorConnectorReview(r);
  r.connectors[0]!.accessible = "yes";
  assert.throws(() => validateIndoorConnectorReview(r), /accessibility/);
});

test("user-reviewed wall shafts require native enclosure and slab support at every stop", () => {
  const wall = (
    elementId: number,
    start: [number, number],
    end: [number, number],
  ) => ({
    elementId,
    categoryId: -2000011,
    categoryName: "Walls",
    solids: [
      {
        start: { x: start[0], y: start[1] },
        end: { x: end[0], y: end[1] },
        baseElevation: 0,
        topElevation: 25,
        thickness: 0.5,
      },
    ],
  });
  const m = {
    levels: [
      { levelId: 1, elevation: 0 },
      { levelId: 2, elevation: 10 },
      { levelId: 3, elevation: 20 },
    ],
    elementBounds: [
      wall(900, [0, 0], [0, 8]),
      wall(901, [0, 8], [8, 8]),
      wall(902, [0, 0], [8, 0]),
      ...[1, 2, 3].map((i) => ({
        elementId: 100 + i,
        categoryId: -2000032,
        boundsFeet: {
          min: { x: 0, y: 0, z: (i - 1) * 10 - 0.5 },
          max: { x: 15, y: 10, z: (i - 1) * 10 },
        },
        loops: [
          [
            [0, 0, 0],
            [15, 0, 0],
            [15, 10, 0],
            [0, 10, 0],
          ],
        ],
      })),
    ],
  } as unknown as ConvertResult;
  const rs = rooms.map((r, i) => ({ ...r, building: i === 0 ? "01" : "02" }));
  const r = review();
  r.connectors[0]!.reviewedShaft = {
    pinId: "user-pin",
    pointFeet: [4, 4],
    wallElementIds: [900, 901, 902],
  };
  r.connectors[0]!.entrances.forEach((e) => (e.pointFeet = [9, 4]));
  assert.equal(
    supportedIndoorConnectors(m, rs, sha, r).accepted.length,
    1,
    "physical shaft can cross source building labels",
  );
  r.connectors[0]!.entrances[2]!.nativeElementId = 102;
  assert.equal(
    supportedIndoorConnectors(m, rs, sha, r).accepted.length,
    0,
    "wrong slab elevation",
  );
  r.connectors[0]!.entrances[2]!.nativeElementId = 103;
  r.connectors[0]!.entrances[2]!.pointFeet = [4, 9];
  assert.equal(
    supportedIndoorConnectors(m, rs, sha, r).accepted.length,
    0,
    "exit cannot cross a solid shaft wall",
  );
  r.connectors[0]!.entrances[2]!.pointFeet = [9, 4];
  r.connectors[0]!.reviewedShaft.pointFeet = [50, 50];
  assert.equal(
    supportedIndoorConnectors(m, rs, sha, r).accepted.length,
    0,
    "nearby walls do not establish a shaft",
  );
  r.connectors[0]!.reviewedShaft.pointFeet = [4, 4];
  const hole = structuredClone(m);
  hole.elementBounds
    .find((e) => e.elementId === 102)!
    .loops!.push([
      [8, 3, 10],
      [10, 3, 10],
      [10, 5, 10],
      [8, 5, 10],
    ]);
  assert.equal(
    supportedIndoorConnectors(hole, rs, sha, r).accepted.length,
    0,
    "exit cannot sit in a floor void",
  );
  const roof = structuredClone(m);
  roof.elementBounds
    .filter((e) => e.categoryId === -2000011)
    .forEach((e) => (e.solids![0]!.topElevation = 20));
  assert.equal(
    supportedIndoorConnectors(roof, rs, sha, r).accepted.length,
    0,
    "shaft ending at roof does not serve that slab",
  );
  r.connectors[0]!.reviewedShaft.wallElementIds = [900, 901, 103];
  assert.equal(
    supportedIndoorConnectors(m, rs, sha, r).accepted.length,
    0,
    "floor is not a shaft wall",
  );
});
