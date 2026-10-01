import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareIndoorDataset,
  sha256Bytes,
} from "../lib/reviter/indoor-pipeline.ts";
import {
  createProjectPackage,
  readProjectPackage,
} from "../lib/reviter/project-package.ts";
import type {
  RoomDirectoryData,
  DirectoryRoom,
} from "../lib/reviter/room-directory.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
const modelFile = new File(["original"], "Synthetic.rvt");
const model = {
  fileName: modelFile.name,
  origin: { x: 0, y: 0, z: 0 },
  levels: [
    { levelId: 1, elevation: 0, candidates: 1, name: "Floor 1" },
    { levelId: 2, elevation: 10, candidates: 1, name: "Floor 2" },
  ],
  elementBounds: [],
  nativeAssociatedLevelRelations: [
    { elementId: 100, levelId: 1 },
    { elementId: 200, levelId: 2 },
  ],
  nativeStairAssemblies: [],
} as unknown as ConvertResult;
const room = (key: string, x: number, levelId = 1): DirectoryRoom => ({
  key,
  number: key,
  building: "01",
  name: "Corridor",
  levelId,
  confidence: 1,
  polygonFeet: [
    [x, 0],
    [x + 10, 0],
    [x + 10, 10],
    [x, 10],
  ],
  labelPointFeet: [x + 5, 5],
});
const data: RoomDirectoryData = {
  format: "reviter-room-annotations",
  version: 1,
  coordinateSystem: "revit-model-feet",
  model: { fileName: modelFile.name },
  annotations: [room("a", 0), room("b", 10), room("upper", 0, 2)],
  georeference: {
    format: "reviter-georeference",
    version: 1,
    modelFileName: modelFile.name,
    coordinateSystem: "WGS84",
    method: "fixed-scale",
    points: [
      {
        id: "p",
        name: "Origin",
        modelFeet: [0, 0],
        levelId: 1,
        geographic: { longitude: -122, latitude: 53 },
      },
      {
        id: "q",
        name: "Second",
        modelFeet: [100, 0],
        levelId: 1,
        geographic: { longitude: -121.999545, latitude: 53 },
      },
    ],
  },
};
test("prepared v2 archive binds graph to original bytes and exact room reviews", async () => {
  const hash = await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer())),
    indoor = await prepareIndoorDataset(model, data, hash);
  const result = await readProjectPackage(
    await createProjectPackage(modelFile, data, { indoor }),
  );
  assert.equal(result.manifest.version, 2);
  assert.deepEqual(result.indoor, JSON.parse(JSON.stringify(indoor)));
  assert.deepEqual(result.rooms, data);
  assert.equal(await result.model.text(), "original");
  await assert.rejects(
    createProjectPackage(
      modelFile,
      { ...data, annotations: [...data.annotations, room("added", 20)] },
      { indoor },
    ),
    /stale/,
  );
});
test("campus display grouping does not connect coincident rooms on native floors", async () => {
  const d = await prepareIndoorDataset(
    model,
    {
      ...data,
      campusStoreys: [
        {
          id: "same-storey",
          name: "Campus first floor",
          levelIds: [1, 2],
          evidence: "user-reported",
        },
      ],
    },
    "a".repeat(64),
  );
  assert.equal(d.floors.length, 1);
  assert.ok(d.edges.length > 0);
  assert.ok(
    d.edges.every(
      (e) =>
        d.nodes.find((n) => n.id === e.from)!.levelId ===
        d.nodes.find((n) => n.id === e.to)!.levelId,
    ),
  );
  assert.ok(
    d.issues.some(
      (i) => i.roomKey === "upper" && i.code === "isolated-arrival",
    ),
  );
});
test("metadata review names do not change original circulation classification on regeneration", async () => {
  const reviews = {
    version: 1,
    records: {
      a: { name: "New display name", notes: "Preserve source label" },
    },
    edges: {},
  };
  const d = await prepareIndoorDataset(
    model,
    { ...data, indoorReviews: reviews },
    "a".repeat(64),
  );
  assert.equal(d.records.find((r) => r.key === "a")!.name, "New display name");
  assert.equal(d.records.find((r) => r.key === "a")!.circulation, true);
  assert.equal(data.annotations[0]!.name, "Corridor");
});
test("accessibility reviews require unchanged endpoint geometry when regenerated", async () => {
  const hash = "a".repeat(64),
    first = await prepareIndoorDataset(model, data, hash),
    e = first.edges[0]!;
  const reviews = {
    version: 1,
    records: {},
    edges: {
      [e.id]: {
        accessible: "yes",
        geometryKey: JSON.stringify([
          hash,
          e.from,
          e.to,
          e.roomKeys,
          e.pointsFeet,
        ]),
      },
    },
  };
  const again = await prepareIndoorDataset(
    model,
    { ...data, indoorReviews: reviews },
    hash,
  );
  assert.equal(again.edges.find((x) => x.id === e.id)!.accessible, "yes");
  const stale = await prepareIndoorDataset(
    model,
    {
      ...data,
      indoorReviews: {
        ...reviews,
        edges: { [e.id]: { accessible: "yes", geometryKey: "stale" } },
      },
    },
    hash,
  );
  assert.equal(stale.edges.find((x) => x.id === e.id)!.accessible, "unknown");
  assert.ok(stale.issues.some((i) => i.code === "connection-review-stale"));
});

test("prepared display retains precise unmatched native doors without authorizing links", async () => {
  const door = {elementId: 100, categoryId: -2000023, boundsFeet: {min: {x: 40, y: 40, z: 0}, max: {x: 44, y: 41, z: 8}}, orientedBox: [[40,40,0],[44,40,0],[44,41,0],[40,41,0]]};
  const d = await prepareIndoorDataset({...model, elementBounds: [door]} as unknown as ConvertResult, data, await sha256Bytes(new Uint8Array(await modelFile.arrayBuffer())));
  assert.equal(d.doors?.length, 1);
  assert.equal(d.doors![0]!.nativeElementId, 100);
  assert.equal(d.doors![0]!.levelId, 1);
  assert.deepEqual(d.doors![0]!.pointFeet, [42,40.5]);
  assert.equal(d.doors![0]!.footprintFeet?.length, 4);
  assert.equal(d.doors![0]!.state, "unmatched");
  assert.equal(d.edges.filter(e => e.kind === "door").length, 0);
});
