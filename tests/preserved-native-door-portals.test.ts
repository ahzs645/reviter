import test from "node:test";
import assert from "node:assert/strict";
import { preservedNativeDoorPortals } from "../lib/reviter/preserved-native-door-portals.ts";
import {
  preserveOriginalNativeDoorPortals,
  directoryDoorReviews,
} from "../lib/reviter/directory-navigation.ts";
import {
  nativeWalkingRegion,
  supportedWalkingPath,
} from "../lib/reviter/native-circulation-links.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const sha = "a".repeat(64);
const records = ["hall", "storage"].map((key, i) => ({
  key,
  number: key,
  name: i ? "Storage" : "Corridor",
  building: "01",
  levelId: 1,
  elevationFeet: 0,
  walkable: true,
  access: "unknown",
  properties: {},
  ringsFeet: [rect(i ? 12 : 0, 0, 8, 10)],
}));
const door = {
  id: "door:1:30",
  nativeElementId: 30,
  hostWallNativeElementId: 20,
  levelId: 1,
  state: "connected",
  roomKeys: ["hall", "storage"],
  pointFeet: [10, 5],
  footprintFeet: rect(9.8, 3, 0.4, 4),
  normalFeet: [1, 0],
};
const nodes = records.map((r, i) => ({
  id: door.id + ":" + i,
  kind: "portal",
  roomKey: r.key,
  building: "01",
  levelId: 1,
  surfaceId: r.key,
  pointFeet: [i ? 10.4 : 9.6, 5, 0],
  geographic: [0, 0],
}));
const edge = {
  id: door.id,
  nativeElementId: 30,
  from: nodes[0]!.id,
  to: nodes[1]!.id,
  kind: "door",
  lengthMetres: 0.25,
  roomKeys: ["hall", "storage"],
  pointsFeet: nodes.map((n) => n.pointFeet),
  enabled: true,
  accessible: "unknown",
  evidence: "native-door",
};
const original = {
  source: { modelSha256: sha },
  records,
  nodes,
  doors: [door],
  edges: [edge, { ...edge, id: "old-outline-walk", kind: "walk" }],
} as unknown as IndoorDataset;
const current = {
  ...original,
  nativeLevels: [{ id: 1, name: "Floor1", elevationFeet: 0 }],
  walls: [],
  nodes: [],
  doors: [{ ...door, state: "unmatched", roomKeys: [] }],
  edges: [],
  nativeIndoorEnvelopes: {
    version: 1,
    sourceModelSha256: sha,
    geometrySha256: "b".repeat(64),
    levels: [
      {
        levelId: 1,
        elevationFeet: 0,
        partsFeet: [[rect(0, 0, 9.7, 10)]],
        sourceElementIds: [10],
        cutElevationsFeet: [4],
        evidenceSha256: "c".repeat(64),
      },
    ],
  },
} as unknown as IndoorDataset;
test("native main-enclosure promotion preserves unchanged physical portal metadata without old walks or unsupported approaches", () => {
  const before = JSON.stringify([original, current]);
  const receipt = preservedNativeDoorPortals(current, original);
  assert.equal(receipt.length, 1);
  assert.deepEqual(receipt[0]!.edge, edge);
  assert.deepEqual(receipt[0]!.nodes, nodes);
  assert.equal(
    receipt.some((p) => p.edge.kind === "walk"),
    false,
  );
  assert.equal(JSON.stringify([original, current]), before);
  const m = {
    origin: { x: 0, y: 0, z: 0 },
    levels: [{ levelId: 1, elevation: 0 }],
    elementBounds: [
      {
        elementId: 10,
        categoryId: -2000032,
        boundsFeet: {
          min: { x: 0, y: 0, z: -0.5 },
          max: { x: 20, y: 10, z: 0 },
        },
        loops: [rect(0, 0, 20, 10).map((p) => [...p, 0])],
      },
    ],
  } as unknown as ConvertResult;
  assert.equal(
    supportedWalkingPath(nativeWalkingRegion(m, current, 0, true), [
      [10.4, 5, 0],
      [15, 5, 0],
    ]),
    false,
    "preserved physical metadata cannot manufacture an unsupported entry recess",
  );
  const staff = structuredClone(current);
  staff.records[1]!.access = "staff";
  assert.equal(preservedNativeDoorPortals(staff, original).length, 0);
  const moved = structuredClone(current);
  moved.doors![0]!.pointFeet[0] += 0.01;
  assert.equal(preservedNativeDoorPortals(moved, original).length, 0);
  const disabled = structuredClone(original);
  disabled.edges[0]!.enabled = false;
  assert.equal(preservedNativeDoorPortals(current, disabled).length, 0);
  assert.throws(
    () =>
      preservedNativeDoorPortals(current, {
        ...original,
        source: { ...original.source, modelSha256: "d".repeat(64) },
      }),
    /another native model/,
  );
});
test("an original door review remains only an identity seed when promotion removes its entry recess", () => {
  const rooms = [
    {
      key: "hall",
      number: "hall",
      name: "Corridor",
      confidence: 1,
      levelId: 1,
      polygonFeet: rect(0, 0, 9.8, 10),
      labelPointFeet: [5, 5] as [number, number],
    },
    {
      key: "storage",
      number: "storage",
      name: "Storage",
      confidence: 1,
      levelId: 1,
      polygonFeet: rect(10.2, 0, 9.8, 10),
      labelPointFeet: [15, 5] as [number, number],
    },
  ];
  const nativeDoor = {
    id: 30,
    point: [10, 5] as [number, number],
    halfWidth: 0.2,
    halfHeight: 2,
    footprint: door.footprintFeet as [number, number][],
    normal: [1, 0] as [number, number],
  };
  const old = directoryDoorReviews(rooms, [nativeDoor]);
  assert.equal(old[0]!.state, "connected");
  const promoted = directoryDoorReviews(
    [rooms[0]!, { ...rooms[1]!, polygonFeet: rect(15, 0, 5, 10) }],
    [nativeDoor],
  );
  assert.equal(promoted[0]!.state, "unmatched");
  assert.deepEqual(
    preserveOriginalNativeDoorPortals(old, promoted)[0]!.portal,
    old[0]!.portal,
  );
  const altered = structuredClone(promoted);
  altered[0]!.door.point[0] += 0.01;
  assert.equal(
    preserveOriginalNativeDoorPortals(old, altered)[0]!.portal,
    undefined,
  );
});
