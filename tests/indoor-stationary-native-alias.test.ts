import assert from "node:assert/strict";
import test from "node:test";
import type {
  IndoorDataset,
  IndoorNode,
  IndoorRecord,
} from "../lib/reviter/indoor-contract.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { certifiedStationaryNativeAlias } from "../lib/reviter/indoor-stationary-native-alias.ts";

function setup() {
  const a = {
    id: "arrival:landing",
    roomKey: "landing",
    levelId: 1,
    surfaceId: "landing-floor",
    kind: "arrival",
    pointFeet: [2, 2, 0],
  } as IndoorNode;
  const b = {
    ...a,
    id: "stair:landing",
    kind: "stair",
    pointFeet: [...a.pointFeet],
  } as IndoorNode;
  const owner = {
    key: "landing",
    walkable: true,
    access: "unknown",
  } as IndoorRecord;
  const cell = {
    id: "native-cell",
    roomKeys: [owner.key],
    levelIds: [1],
    elevationFeet: 0,
  } as NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number];
  const parts = nativeRationalOverlay("union", [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ],
  ]);
  return { a, b, owner, cell, parts };
}
const checked = (s: ReturnType<typeof setup>) =>
  certifiedStationaryNativeAlias(s.a, s.b, s.cell, s.parts, s.owner);

test("exact same-point landing node identities need no travelled accessibility approval", () => {
  const s = setup(),
    before = JSON.stringify([s.a, s.b, s.owner, s.cell]);
  assert.equal(checked(s), true);
  assert.equal(JSON.stringify([s.a, s.b, s.owner, s.cell]), before);
});

test("near-coincident, short real motion and height changes cannot receive identity certification", () => {
  for (const delta of [Number.EPSILON * 2, 1e-10, 1e-8, 0.001, 0.1]) {
    const s = setup();
    s.b.pointFeet[0] += delta;
    assert.equal(checked(s), false, `actual displacement ${delta}`);
  }
  const s = setup();
  s.b.pointFeet[2] = 1e-12;
  assert.equal(checked(s), false);
});

test("other owner, nominal floor, surface or original floor height remains unconfirmed", () => {
  const mutations = [
    (s: ReturnType<typeof setup>) => {
      s.b.roomKey = "other";
    },
    (s: ReturnType<typeof setup>) => {
      s.b.levelId = 2;
    },
    (s: ReturnType<typeof setup>) => {
      s.b.surfaceId = "nearby-surface";
    },
    (s: ReturnType<typeof setup>) => {
      s.cell.levelIds = [2];
    },
    (s: ReturnType<typeof setup>) => {
      s.cell.roomKeys = ["other"];
    },
    (s: ReturnType<typeof setup>) => {
      s.cell.elevationFeet = 0.001;
    },
    (s: ReturnType<typeof setup>) => {
      s.owner.access = "staff";
    },
    (s: ReturnType<typeof setup>) => {
      s.owner.walkable = false;
    },
  ];
  for (const mutation of mutations) {
    const s = setup();
    mutation(s);
    assert.equal(checked(s), false);
  }
});

test("a real original floor aperture, its boundary or absent physical support vetoes the identity", () => {
  const s = setup();
  s.parts = nativeRationalOverlay("difference", s.parts, [
    [
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
    ],
  ]);
  assert.equal(checked(s), false);
  s.a.pointFeet = [1, 2, 0];
  s.b.pointFeet = [1, 2, 0];
  assert.equal(checked(s), false, "hole boundary cannot supply alias support");
  s.parts = [];
  assert.equal(checked(s), false);
});
