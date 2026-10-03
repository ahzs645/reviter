import test from "node:test";
import assert from "node:assert/strict";
import { bindConnectorAreaArrivals } from "../lib/reviter/connector-area-arrivals.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
const sha = "a".repeat(64);
const area = {
  key: "shaft",
  name: "Elevator",
  levelId: 1,
  status: "active",
  polygonFeet: [
    [0, 0],
    [8, 0],
    [8, 11],
    [0, 11],
  ],
} as DirectoryRoom;
const fixture = () =>
  ({
    source: { modelSha256: sha },
    records: [
      {
        key: "shaft",
        levelId: 1,
        elevationFeet: 0,
        building: "09",
        access: "unknown",
        walkable: true,
        properties: {},
      },
      {
        key: "lobby",
        levelId: 1,
        elevationFeet: 0,
        building: "09",
        access: "unknown",
        walkable: true,
        properties: {},
      },
    ],
    nodes: [
      { id: "stop", roomKey: "lobby", levelId: 1, pointFeet: [5, 14, 0] },
    ],
    connectors: [
      {
        id: "lift",
        sourceModelSha256: sha,
        reviewedShaft: { pointFeet: [4, 6] },
        entrances: [
          { areaKey: "shaft", roomKey: "lobby", levelId: 1, nodeId: "stop" },
        ],
      },
    ],
    edges: [],
    issues: [
      { code: "isolated-arrival", roomKey: "shaft" },
      { code: "access-review", roomKey: "shaft" },
    ],
  }) as unknown as IndoorDataset;
test("an explicitly reviewed elevator label arrives at its lobby without adding a car walking edge", () => {
  const d = fixture(),
    before = JSON.stringify({ rooms: [area], edges: d.edges, nodes: d.nodes });
  assert.equal(bindConnectorAreaArrivals(d, [area]), 1);
  assert.equal(d.records[0]!.arrivalNodeId, "stop");
  assert.deepEqual(
    d.issues.map((i) => i.code),
    ["access-review"],
  );
  assert.equal(
    JSON.stringify({ rooms: [area], edges: d.edges, nodes: d.nodes }),
    before,
  );
});
test("foreign, restricted, unsupported-height and ambiguous shaft destinations cannot be bound", () => {
  for (const mutate of [
    (d: IndoorDataset) => {
      d.connectors![0]!.sourceModelSha256 = "foreign";
    },
    (d: IndoorDataset) => {
      d.records[0]!.access = "staff";
    },
    (d: IndoorDataset) => {
      d.records[1]!.access = "staff";
    },
    (d: IndoorDataset) => {
      d.records[0]!.elevationFeet = 3;
    },
    (d: IndoorDataset) => {
      d.connectors![0]!.reviewedShaft!.pointFeet = [20, 20];
    },
    (d: IndoorDataset) => {
      d.connectors!.push(structuredClone(d.connectors![0]!));
    },
  ]) {
    const d = fixture();
    mutate(d);
    assert.equal(bindConnectorAreaArrivals(d, [area]), 0);
    assert.equal(d.records[0]!.arrivalNodeId, undefined);
  }
  const d = fixture();
  d.records[0]!.arrivalNodeId = "existing-real-entrance";
  assert.equal(bindConnectorAreaArrivals(d, [area]), 0);
  assert.equal(d.records[0]!.arrivalNodeId, "existing-real-entrance");
});
