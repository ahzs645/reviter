import test from "node:test";
import assert from "node:assert/strict";
import { prepareIndoorDataset } from "../lib/reviter/indoor-pipeline.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { RoomDirectoryData } from "../lib/reviter/room-directory.ts";
const sha = "a".repeat(64);
const walls = [
  [0, 0, 0, 11],
  [8, 0, 8, 11],
  [0, 0, 3, 0],
  [7, 0, 8, 0],
  [0, 11, 3, 11],
  [7, 11, 8, 11],
];
const model = {
  fileName: "Synthetic.rvt",
  origin: { x: 0, y: 0, z: 0 },
  levels: [
    { levelId: 1, elevation: 0, name: "Level 1" },
    { levelId: 2, elevation: 17.72, name: "Level 2" },
  ],
  nativeStairAssemblies: [],
  meshes: [],
  nativeAssociatedLevelRelations: [
    { elementId: 100, levelId: 1 },
    { elementId: 101, levelId: 2 },
  ],
  elementBounds: [
    ...walls.map(([x, y, ex, ey], i) => ({
      elementId: i + 1,
      categoryId: -2000011,
      solids: [
        {
          start: { x, y },
          end: { x: ex, y: ey },
          thickness: 0.65,
          baseElevation: 0,
          topElevation: 27,
        },
      ],
      boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 11, z: 27 } },
    })),
    ...[0, 17.72].map((z, i) => ({
      elementId: 100 + i,
      categoryId: -2000032,
      boundsFeet: {
        min: { x: -5, y: -5, z: z - 0.5 },
        max: { x: 20, y: 20, z },
      },
      loops: [
        [
          [-5, -5, z],
          [20, -5, z],
          [20, 20, z],
          [-5, 20, z],
        ],
      ],
    })),
  ],
} as unknown as ConvertResult;
const rooms = {
  format: "reviter-room-annotations",
  version: 1,
  coordinateSystem: "revit-model-feet",
  model: { fileName: "Synthetic.rvt" },
  annotations: [
    ...[1, 2].map((levelId) => ({
      key: `lobby${levelId}`,
      levelId,
      building: "09",
      name: "Corridor",
      confidence: 1,
      polygonFeet: [
        [0, 12],
        [20, 12],
        [20, 20],
        [0, 20],
      ],
      labelPointFeet: [5.23, 14],
    })),
    {
      key: "shaft",
      levelId: 1,
      building: "09",
      name: "Elevator",
      confidence: 1,
      polygonFeet: [
        [0.5, 0.5],
        [7.5, 0.5],
        [7.5, 10.5],
        [0.5, 10.5],
      ],
      labelPointFeet: [4.267, 6.869],
    },
  ],
  georeference: {
    format: "reviter-georeference",
    version: 1,
    modelFileName: "Synthetic.rvt",
    coordinateSystem: "WGS84",
    method: "fixed-scale",
    points: [
      {
        id: "a",
        name: "Origin",
        modelFeet: [0, 0],
        levelId: 1,
        geographic: { longitude: -122, latitude: 53 },
      },
      {
        id: "b",
        name: "Second",
        modelFeet: [100, 0],
        levelId: 1,
        geographic: { longitude: -121.999545, latitude: 53 },
      },
    ],
  },
  indoorConnectors: {
    version: 1,
    modelSha256: sha,
    connectors: [
      {
        id: "lift",
        kind: "elevator",
        nativeElementId: 1,
        evidence: "User-identified native shaft and two lobby slabs",
        accessible: "unknown",
        direction: "both",
        reviewedShaft: {
          pinId: "shaft-pin",
          pointFeet: [4.267, 6.869],
          wallElementIds: [1, 2, 3, 4, 5, 6],
        },
        entrances: [
          {
            roomKey: "lobby1",
            areaKey: "shaft",
            levelId: 1,
            nativeElementId: 100,
            pointFeet: [5.23, 14],
          },
          {
            roomKey: "lobby2",
            levelId: 2,
            nativeElementId: 101,
            pointFeet: [5.23, 14],
          },
        ],
      },
    ],
  },
} as RoomDirectoryData;
test("full native preparation retains an explicit shaft label as a destination at the supported lobby", async () => {
  const before = JSON.stringify(rooms),
    d = await prepareIndoorDataset(model, rooms, sha);
  const c = d.connectors!.find((c) => c.id === "lift")!;
  assert.ok(c);
  assert.equal(c.entrances[0]!.areaKey, "shaft");
  assert.equal(
    d.records.find((r) => r.key === "shaft")!.arrivalNodeId,
    c.entrances[0]!.nodeId,
  );
  assert.ok(d.edges.some((e) => e.connectorId === "lift"));
  assert.ok(
    !d.issues.some(
      (i) => i.roomKey === "shaft" && i.code === "isolated-arrival",
    ),
  );
  assert.equal(JSON.stringify(rooms), before);
});
