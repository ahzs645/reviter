import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareNativeCirculationGeometry,
  attachNativeCirculationCellRoutes,
} from "../lib/reviter/native-circulation-geometry.ts";
import { containsRoomPoint } from "../lib/reviter/room-directory.ts";
import type {
  IndoorDataset,
  IndoorRecord,
} from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const owner = (key: string, ring: Point[]): IndoorRecord => ({
  key,
  number: key,
  name: "Corridor",
  building: "B",
  levelId: 1,
  elevationFeet: 0,
  elevationEvidence: "native",
  surfaceId: "B:1:0",
  circulation: true,
  stair: false,
  walkable: true,
  access: "unknown",
  confidence: 1,
  ringsFeet: [ring],
  properties: {},
});
const inside = (point: Point, rings: Point[][]) =>
  containsRoomPoint(point, rings[0]!) &&
  !rings.slice(1).some((h) => containsRoomPoint(point, h));
function setup() {
  const floor = {
    elementId: 100,
    categoryId: -2000032,
    boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 20, y: 10, z: 0 } },
    loops: [rect(0, 0, 20, 10).map((p) => [p[0], p[1], 0])],
  };
  const model = {
    elementBounds: [floor],
    levels: [{ levelId: 1, elevation: 0 }],
    nativeAssociatedLevelRelations: [],
  } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: "a".repeat(64) },
    records: [owner("hall", rect(0.5, 0.5, 19.5, 9.5))],
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }],
    walls: [],
    doors: [],
    nodes: [],
    edges: [],
    alignment: { horizontalMetresPerFoot: 0.3048 },
    report: { components: 0, largestComponentArrivals: 0 },
  } as unknown as IndoorDataset;
  return { model, data };
}
test("complete native floor cells replace an inset trace without changing room identities", () => {
  const { model, data } = setup(),
    before = JSON.stringify([model, data]);
  const result = prepareNativeCirculationGeometry(model, data);
  assert.equal(result.geometry.cells.length, 1);
  assert.ok(
    inside([0.1, 5], result.geometry.cells[0]!.ringsFeet),
    "native floor beyond the old contour is recovered",
  );
  assert.equal(JSON.stringify([model, data]), before);
  assert.deepEqual(result.geometry.cells[0]!.nativeFloorIds, [100]);
});
test("native holes, columns, private rooms and low stair projections stay excluded", () => {
  const { model, data } = setup();
  model.elementBounds[0]!.loops!.push(
    rect(11, 4, 12, 5).map((p) => [p[0], p[1], 0]),
  );
  model.elementBounds.push({
    elementId: 101,
    categoryId: -2000100,
    solid: {
      start: { x: 5, y: 4 },
      end: { x: 5, y: 6 },
      thickness: 2,
      baseElevation: 0,
      topElevation: 10,
    },
  } as never);
  model.elementBounds.push({
    elementId: 102,
    stairTreads: [rect(7, 4, 9, 6).map((p) => [p[0], p[1], 1])],
  } as never);
  data.records.push({
    ...owner("private", rect(15, 0, 20, 5)),
    circulation: false,
    access: "staff",
  });
  const cells = prepareNativeCirculationGeometry(model, data).geometry.cells;
  assert.equal(cells.length, 1);
  for (const p of [
    [11.5, 4.5],
    [5, 5],
    [8, 5],
    [17, 2],
  ] as Point[])
    assert.ok(!cells.some((c) => inside(p, c.ringsFeet)), `Excluded ${p}`);
  assert.ok(cells.some((c) => inside([0.1, 5], c.ringsFeet)));
});
test("all native doors divide cells, while a large unlabelled slab and wrong-storey support are rejected", () => {
  const { model, data } = setup();
  data.records = [
    owner("left", rect(0.5, 0.5, 9.5, 9.5)),
    owner("right", rect(10.5, 0.5, 19.5, 9.5)),
  ];
  for (const [i, y0, y1] of [
    [0, 0, 4],
    [1, 6, 10],
  ])
    model.elementBounds.push({
      elementId: 110 + i!,
      categoryId: -2000011,
      solid: {
        start: { x: 10, y: y0 },
        end: { x: 10, y: y1 },
        thickness: 0.4,
        baseElevation: 0,
        topElevation: 10,
      },
    } as never);
  data.doors = [
    {
      id: "closed",
      nativeElementId: 115,
      levelId: 1,
      pointFeet: [10, 5],
      footprintFeet: rect(9.7, 4, 10.3, 6),
      roomKeys: ["left", "right"],
      state: "connected",
    },
  ];
  const cells = prepareNativeCirculationGeometry(model, data).geometry.cells;
  assert.equal(cells.length, 2);
  assert.ok(
    !cells.some(
      (c) => inside([5, 5], c.ringsFeet) && inside([15, 5], c.ringsFeet),
    ),
    "door portal alone joins the two physical sides",
  );
  const other = setup();
  other.data.records[0]!.ringsFeet = [rect(1, 1, 3, 3)];
  assert.equal(
    prepareNativeCirculationGeometry(other.model, other.data).geometry.cells
      .length,
    0,
  );
  other.data.records[0]!.ringsFeet = [rect(0.5, 0.5, 19.5, 9.5)];
  const wrongStorey = structuredClone(other.model);
  wrongStorey.elementBounds[0]!.boundsFeet.max.z = 10;
  assert.equal(
    prepareNativeCirculationGeometry(wrongStorey, other.data).geometry.cells
      .length,
    0,
  );
});
test("native cell graph rebuild preserves fixed door/connector coordinates and excludes flight areas", () => {
  const { model, data } = setup();
  model.elementBounds.push({
    elementId: 102,
    stairTreads: [rect(7, 3, 9, 7).map((p) => [p[0], p[1], 1])],
  } as never);
  data.nodes = [
    {
      id: "a",
      roomKey: "hall",
      kind: "connector",
      levelId: 1,
      pointFeet: [2, 5, 0],
    },
    {
      id: "b",
      roomKey: "hall",
      kind: "portal",
      levelId: 1,
      pointFeet: [18, 5, 0],
    },
  ] as never;
  data.circulationGeometry = prepareNativeCirculationGeometry(
    model,
    data,
  ).geometry;
  const nodes = JSON.stringify(data.nodes),
    oldEdges = JSON.stringify(data.edges);
  assert.ok(attachNativeCirculationCellRoutes(data) > 0);
  assert.equal(JSON.stringify(data.nodes), nodes);
  assert.equal(oldEdges, "[]");
  for (const edge of data.edges) {
    assert.deepEqual(
      edge.pointsFeet[0],
      data.nodes.find((n) => n.id === edge.from)!.pointFeet,
    );
    assert.deepEqual(
      edge.pointsFeet.at(-1),
      data.nodes.find((n) => n.id === edge.to)!.pointFeet,
    );
    assert.equal(edge.accessible, "unknown");
    assert.ok(
      edge.pointsFeet.every((p) => !inside([p[0], p[1]], [rect(7, 3, 9, 7)])),
    );
  }
});

test("regeneration replaces derived branches while preserving original links", () => {
  const { model, data } = setup();
  data.nodes = [
    {
      id: "a",
      roomKey: "hall",
      kind: "connector",
      levelId: 1,
      pointFeet: [2, 5, 0],
    },
    {
      id: "b",
      roomKey: "hall",
      kind: "portal",
      levelId: 1,
      pointFeet: [18, 5, 0],
    },
  ] as never;
  data.circulationGeometry = prepareNativeCirculationGeometry(
    model,
    data,
  ).geometry;
  assert.ok(attachNativeCirculationCellRoutes(data) > 0);
  const initial = structuredClone(data.edges);
  data.edges[0]!.pointsFeet = [
    [2, 5, 0],
    [200, 200, 0],
    [18, 5, 0],
  ];
  attachNativeCirculationCellRoutes(data);
  assert.deepEqual(
    data.edges,
    initial,
    "regeneration must not retain obsolete geometry with a matching cell ID",
  );
  data.circulationGeometry.cells = [];
  attachNativeCirculationCellRoutes(data);
  assert.deepEqual(data.edges, [], "no derived links survive removed cells");
});
test("separate native slab shells and nested voids retain their own geometry", async () => {
  const { nativeFloorPolygons } = await import(
    "../lib/reviter/routing-floor-support.ts"
  );
  const as3 = (r: Point[]) =>
    r.map((p) => [p[0], p[1], 0] as [number, number, number]);
  const parts = nativeFloorPolygons({
    loops: [
      as3(rect(0, 0, 10, 10)),
      as3(rect(20, 0, 30, 10)),
      as3(rect(2, 2, 8, 8)),
      as3(rect(4, 4, 6, 6)),
    ],
  });
  assert.equal(parts.length, 3);
  assert.ok(
    parts.some((r) => inside([25, 5], r)),
    "second shell is floor, not a false hole",
  );
  assert.ok(
    !parts.some((r) => inside([3, 3], r)),
    "nested opening stays empty",
  );
  assert.ok(
    parts.some((r) => inside([5, 5], r)),
    "native island within the opening is retained",
  );
});
test("low native slab fixtures block all separate footprints while a high ceiling remains clear", () => {
  const { model, data } = setup();
  model.elementBounds.push({
    elementId: 140,
    categoryId: -2000032,
    boundsFeet: { min: { x: 2, y: 2, z: 2.5 }, max: { x: 12, y: 5, z: 3 } },
    loops: [rect(2, 2, 4, 4), rect(10, 2, 12, 4)].map((r) =>
      r.map((p) => [p[0], p[1], 0]),
    ),
  } as never);
  model.elementBounds.push({
    elementId: 141,
    categoryId: -2000032,
    boundsFeet: { min: { x: 0, y: 0, z: 10 }, max: { x: 20, y: 10, z: 11 } },
    loops: [rect(0, 0, 20, 10).map((p) => [p[0], p[1], 10])],
  } as never);
  const result = prepareNativeCirculationGeometry(model, data);
  for (const p of [
    [3, 3],
    [11, 3],
  ] as Point[])
    assert.ok(!result.geometry.cells.some((c) => inside(p, c.ringsFeet)));
  assert.ok(result.geometry.cells.some((c) => inside([6, 6], c.ringsFeet)));
  assert.equal(result.geometry.fixtures?.length, 2);
  assert.ok(
    result.geometry.fixtures?.every(
      (f) => f.nativeElementId === 140 && f.heightFeet === 3,
    ),
  );
});
test("a sub-width seam cannot merge native circulation with a large unlabelled slab", () => {
  const { model, data } = setup();
  model.elementBounds[0]!.boundsFeet.max.x = 40;
  model.elementBounds[0]!.loops = [
    [
      [0, 0, 0],
      [20, 0, 0],
      [20, 4.8, 0],
      [22, 4.8, 0],
      [22, 0, 0],
      [40, 0, 0],
      [40, 10, 0],
      [22, 10, 0],
      [22, 5.2, 0],
      [20, 5.2, 0],
      [20, 10, 0],
      [0, 10, 0],
    ],
  ];
  const result = prepareNativeCirculationGeometry(model, data);
  assert.ok(
    result.geometry.cells.some((c) => inside([0.1, 5], c.ringsFeet)),
    "real native face is restored beyond inset contour",
  );
  assert.ok(
    !result.geometry.cells.some((c) => inside([30, 5], c.ringsFeet)),
    "unlabelled wing is not authorized",
  );
  assert.ok(
    !result.geometry.cells.some((c) => inside([21, 5], c.ringsFeet)),
    "0.4-foot seam is not a walking passage",
  );
});
test("physical recovery uses persisted native angled wall end caps", async () => {
  const { nativeWalkingRegion } = await import(
    "../lib/reviter/native-circulation-links.ts"
  );
  const { model, data } = setup();
  model.elementBounds.push({
    elementId: 150,
    categoryId: -2000011,
    solid: {
      start: { x: 5, y: 2 },
      end: { x: 5, y: 8 },
      thickness: 0.4,
      baseElevation: 0,
      topElevation: 3,
      startCorners: [
        { x: 4.8, y: 1.5 },
        { x: 5.2, y: 2.5 },
      ],
      endCorners: [
        { x: 4.8, y: 8 },
        { x: 5.2, y: 8 },
      ],
    },
  } as never);
  const region = nativeWalkingRegion(model, data, 0, true);
  assert.ok(
    region.barriers.some((r) => inside([4.85, 1.8], r)),
    "native cap wedge is not lost to a rectangular approximation",
  );
});
test("unverified circulation trace holes do not carve native floor beside walls", () => {
  const { model, data } = setup();
  data.records[0]!.ringsFeet.push(rect(1, 2, 3.5, 9));
  data.records[0]!.properties.floorOpeningsFeet = [rect(12, 4, 13, 5)];
  const cells = prepareNativeCirculationGeometry(model, data).geometry.cells;
  assert.ok(
    cells.some((c) => inside([2, 5], c.ringsFeet)),
    "native supported floor replaces false traced hole",
  );
  assert.ok(
    !cells.some((c) => inside([12.5, 4.5], c.ringsFeet)),
    "explicit reviewed opening is still excluded",
  );
});
test("independent native overlay preserves exact diagonal faces, slab holes and thin barriers", async () => {
  const {
    nativeFloorDifference,
    nativeFloorUnion,
    clearanceSeparatedNativeCells,
  } = await import("../lib/reviter/native-circulation-clearance.ts");
  const floor = [rect(0, 0, 20, 10), rect(14, 4, 16, 6)];
  const free = nativeFloorDifference(floor, [
    [
      [
        [2, 2],
        [8, 8],
        [8.3, 7.7],
        [2.3, 1.7],
      ],
    ],
    [rect(10, 0, 10.01, 10)],
  ]);
  assert.ok(!free.some((r) => inside([15, 5], r)));
  assert.ok(!free.some((r) => inside([10.005, 5], r)));
  assert.ok(!free.some((r) => inside([5.1, 5], r)));
  assert.ok(free.some((r) => inside([1, 1], r)));
  assert.ok(nativeFloorUnion(free).some((r) => inside([19, 9], r)));
  assert.deepEqual(
    clearanceSeparatedNativeCells([rect(0, 0, 1, 1)]),
    [],
    "an empty clearance core is not an invalid polygon",
  );
});
test("an upper-storey slab is not exported as a fixture cap on the lower display plane", () => {
  const { model, data } = setup();
  model.elementBounds.push({
    elementId: 140,
    categoryId: -2000032,
    boundsFeet: { min: { x: 2, y: 2, z: 2.5 }, max: { x: 12, y: 5, z: 3 } },
    loops: [rect(2, 2, 12, 5).map((p) => [p[0], p[1], 3])],
  } as never);
  data.records.push({
    ...data.records[0],
    key: "upper",
    elevationFeet: 3,
    ringsFeet: [rect(2, 2, 12, 5)],
  });
  const result = prepareNativeCirculationGeometry(model, data);
  assert.ok(
    !result.geometry.fixtures?.some(
      (f) => f.nativeElementId === 140 && f.elevationFeet === 0,
    ),
  );
});
