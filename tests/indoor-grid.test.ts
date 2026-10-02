import test from "node:test";
import assert from "node:assert/strict";
import { buildIndoorGrid } from "../lib/reviter/indoor-grid.ts";
import {
  nativeRouteBlocker,
  containsRoomPoint,
  type DirectoryRoom,
  type RoomPoint,
} from "../lib/reviter/room-directory.ts";
const rectangle = (x: number, y: number, w: number, h: number): RoomPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const room = (key: string, polygon: RoomPoint[]): DirectoryRoom => ({
  key,
  levelId: 1,
  building: "01",
  name: "Hallway",
  polygonFeet: polygon,
  labelPointFeet: [1, 1],
  confidence: 1,
});
const terminals = [
  { id: "a", roomKey: "r", point: [1, 5] as RoomPoint, maxSnapFeet: 1 },
  { id: "b", roomKey: "r", point: [9, 5] as RoomPoint, maxSnapFeet: 1 },
];
const connected = (grid: ReturnType<typeof buildIndoorGrid>) => {
  const q = ["a"],
    seen = new Set(q);
  for (let i = 0; i < q.length; i++)
    for (const b of grid.branches) {
      const next = b.from === q[i] ? b.to : b.to === q[i] ? b.from : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        q.push(next);
      }
    }
  return seen.has("b");
};
test("thin walls block full grid edges and long portal segments across intermediate bins", () => {
  const barrier = rectangle(5, 0, 0.02, 10),
    r = room("r", rectangle(0, 0, 10, 10));
  assert.equal(
    connected(
      buildIndoorGrid(
        [r],
        [],
        terminals,
        { walls: [{ polygon: barrier }], columns: [] },
        [],
      ),
    ),
    false,
  );
  assert.equal(
    nativeRouteBlocker(
      { walls: [{ polygon: rectangle(15, 0, 0.01, 5) }], columns: [] },
      [],
    )([0, 2], [30, 2]),
    true,
  );
});
test("a verified opening permits only its precise wall footprint", () => {
  const r = room("r", rectangle(0, 0, 10, 10)),
    barriers = {
      walls: [{ polygon: rectangle(4.9, 0, 0.2, 10) }],
      columns: [],
    };
  const opening = {
    rooms: ["r", "r"] as [string, string],
    point: [5, 5] as RoomPoint,
    from: [4, 5] as RoomPoint,
    to: [6, 5] as RoomPoint,
    halfWidth: 1,
    halfHeight: 1,
    footprint: rectangle(4, 4, 2, 2),
  };
  assert.equal(
    connected(buildIndoorGrid([r], [], terminals, barriers, [opening])),
    true,
  );
  assert.equal(nativeRouteBlocker(barriers, [opening])([4, 2], [6, 2]), true);
});
test("void holes and staff masks veto overlapping circulation; corners cannot join", () => {
  const r = {
    ...room("r", rectangle(0, 0, 10, 10)),
    floorOpeningsFeet: [rectangle(4, 0, 2, 10)],
  };
  assert.equal(
    connected(
      buildIndoorGrid([r], [], terminals, { walls: [], columns: [] }, []),
    ),
    false,
  );
  assert.equal(
    connected(
      buildIndoorGrid(
        [room("r", rectangle(0, 0, 10, 10))],
        [room("staff", rectangle(4, 0, 2, 10))],
        terminals,
        { walls: [], columns: [] },
        [],
      ),
    ),
    false,
  );
});
test("grid links preserve hole detours and rejects unsupported arrival snaps", () => {
  const r = {
    ...room("r", rectangle(0, 0, 10, 10)),
    holesFeet: [rectangle(4, 4, 2, 2)],
  };
  const grid = buildIndoorGrid(
    [r],
    [],
    terminals,
    { walls: [], columns: [] },
    [],
  );
  assert.equal(connected(grid), true);
  for (const branch of grid.branches)
    for (let i = 1; i < branch.points.length; i++) {
      const a = branch.points[i - 1]!,
        b = branch.points[i]!;
      for (let t = 0; t <= 1; t += 0.05)
        assert.equal(
          containsRoomPoint(
            [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            r.holesFeet[0]!,
          ),
          false,
        );
    }
  const invalid = buildIndoorGrid(
    [r],
    [],
    [{ id: "outside", roomKey: "r", point: [20, 20], maxSnapFeet: 1 }],
    { walls: [], columns: [] },
    [],
  );
  assert.deepEqual(invalid.missing, ["outside"]);
  assert.deepEqual(
    buildIndoorGrid([r], [], terminals, { walls: [], columns: [] }, [])
      .branches,
    grid.branches,
  );
});

test("neighbour terminals connect directly instead of detouring through a distant root", () => {
  const r = room("r", rectangle(0, 0, 30, 30));
  const ts = [
    { id: "root", roomKey: "r", point: [1, 1] as RoomPoint, maxSnapFeet: 1 },
    { id: "b", roomKey: "r", point: [24, 20] as RoomPoint, maxSnapFeet: 1 },
    { id: "c", roomKey: "r", point: [24, 26] as RoomPoint, maxSnapFeet: 1 },
  ];
  for (const order of [ts, [...ts].reverse()]) {
    const grid = buildIndoorGrid(
      [r],
      [],
      order,
      { walls: [], columns: [] },
      [],
    );
    const direct = grid.branches.find(
      (b) => [b.from, b.to].sort().join() === "b,c",
    );
    assert.ok(direct);
    const length = direct.points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum +
          Math.hypot(p[0] - direct.points[i]![0], p[1] - direct.points[i]![1]),
        0,
      );
    assert.ok(
      length <= 6.6,
      `Nearby destinations should not follow a rooted-tree detour: ${length}`,
    );
  }
});

test("rotated corridors retain straight runs and right-angle bends without crossing pillars", () => {
  const angle = (27 * Math.PI) / 180;
  const rotate = ([x, y]: RoomPoint): RoomPoint => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
  const r = room("r", rectangle(0, 0, 30, 8).map(rotate));
  const ts = [
    { id: "a", roomKey: "r", point: rotate([2, 4]), maxSnapFeet: 1 },
    { id: "b", roomKey: "r", point: rotate([28, 4]), maxSnapFeet: 1 },
  ];
  const clear = buildIndoorGrid([r], [], ts, { walls: [], columns: [] }, []);
  assert.equal(connected(clear), true);
  assert.ok(clear.branches[0]!.points.length <= 3);
  const barriers = {
    walls: [],
    columns: [{ polygon: rectangle(13, 2, 3, 4).map(rotate) }],
  };
  const grid = buildIndoorGrid([r], [], ts, barriers, []);
  assert.equal(connected(grid), true);
  const blocked = nativeRouteBlocker(barriers, []);
  for (const branch of grid.branches)
    for (let i = 1; i < branch.points.length; i++) {
      const a = branch.points[i - 1]!,
        b = branch.points[i]!;
      assert.equal(blocked(a, b), false);
      const localAngle = Math.atan2(b[1] - a[1], b[0] - a[0]) - angle;
      assert.ok(Math.abs(Math.sin(2 * localAngle)) < 1e-8);
    }
});

test("subcell floor openings cannot be crossed between otherwise usable cell centres", () => {
  const r = {
    ...room("r", rectangle(0, 0, 10, 10)),
    floorOpeningsFeet: [rectangle(5, 0, 0.02, 10)],
  };
  assert.equal(
    connected(
      buildIndoorGrid([r], [], terminals, { walls: [], columns: [] }, []),
    ),
    false,
  );
});
test("clearance preference moves a long near-wall journey into the corridor without certifying width", () => {
  const r = room("r", rectangle(0, 0, 60, 8));
  const grid = buildIndoorGrid(
    [r],
    [],
    [
      { id: "a", roomKey: "r", point: [2, 0.8], maxSnapFeet: 1 },
      { id: "b", roomKey: "r", point: [58, 0.8], maxSnapFeet: 1 },
    ],
    { walls: [], columns: [] },
    [],
  );
  const branch = grid.branches[0]!;
  assert.ok(
    branch.points.some((p) => p[1] > 2),
    JSON.stringify(branch.points),
  );
  assert.equal(branch.routingQuality.clearanceCertified, false);
  assert.ok(branch.routingQuality.estimatedRasterClearanceFeet > 0);
  assert.ok(branch.routingQuality.turnCount <= 4);
});

test("doorway terminals snap to their room side outside native wall material", () => {
  const left = room("left", rectangle(0, 0, 5.1, 10));
  const right = room("right", rectangle(4.9, 0, 5.1, 10));
  const barriers = { walls: [{ polygon: rectangle(4.9, 0, 0.2, 10) }], columns: [] };
  const opening = {
    rooms: ["left", "right"] as [string, string], point: [5, 5] as RoomPoint,
    from: [4.95, 5] as RoomPoint, to: [5.05, 5] as RoomPoint,
    halfWidth: 1, halfHeight: 1, footprint: rectangle(4.8, 4, 0.4, 2),
  };
  for (const r of [left, right]) {
    const point = r.key === "left" ? opening.from : opening.to;
    const grid = buildIndoorGrid([r], [], [
      { id: "portal", roomKey: r.key, point, maxSnapFeet: 1.2 },
      { id: "arrival", roomKey: r.key, point: [r.key === "left" ? 2 : 8, 5], maxSnapFeet: 1 },
    ], barriers, [opening]);
    const anchor = grid.positions.get("portal")!;
    assert.ok(anchor, r.key);
    assert.equal(nativeRouteBlocker(barriers, [])(anchor, anchor), false);
    assert.ok(r.key === "left" ? anchor[0] < 4.9 : anchor[0] > 5.1);
    for (const branch of grid.branches)
      for (const endpoint of [branch.points[0]!, branch.points.at(-1)!])
        assert.equal(nativeRouteBlocker(barriers, [])(endpoint, endpoint), false);
    assert.deepEqual(grid.missing, []);
  }
});

test("separate doorway footprints cannot authorize travelling through solid wall between them", () => {
  const barriers = { walls: [{ polygon: rectangle(0, 0, 10, 1) }], columns: [] };
  const opening = (x: number) => ({
    rooms: ["a", "b"] as [string, string], point: [x, 0.5] as RoomPoint,
    from: [x, -1] as RoomPoint, to: [x, 2] as RoomPoint,
    halfWidth: 0.5, halfHeight: 1, footprint: rectangle(x - 0.5, -0.1, 1, 1.2),
  });
  const blocked = nativeRouteBlocker(barriers, [opening(0), opening(10)]);
  assert.equal(blocked([-1, 0.5], [11, 0.5]), true);
  assert.equal(blocked([0, -1], [0, 2]), false);
  assert.equal(blocked([0, 0.5], [10, 0.5]), true);
});

test("cell centres cannot bridge an unsupported subcell gap in source floor coverage", () => {
  const left = room("left", rectangle(0, 0, 4.98, 10));
  const right = room("right", rectangle(5.02, 0, 4.98, 10));
  const grid = buildIndoorGrid([left, right], [], [
    { id: "a", roomKey: "left", point: [1, 5], maxSnapFeet: 1 },
    { id: "b", roomKey: "right", point: [9, 5], maxSnapFeet: 1 },
  ], { walls: [], columns: [] }, []);
  assert.equal(connected(grid), false);
});

test("a thin private mask with its own hole cannot be skipped between grid centres", () => {
  const r=room("r",rectangle(0,0,10,10));
  const mask={...room("private",rectangle(4.99,0,0.02,10)),holesFeet:[rectangle(4.995,9,0.01,0.5)]};
  const grid=buildIndoorGrid([r],[mask],terminals,{walls:[],columns:[]},[]);
  assert.equal(connected(grid),false);
});

test("a doorway anchor does not snap sideways beyond its verified clear width", () => {
  const r=room("r",rectangle(0,0,4.9,10));
  const footprint=rectangle(4.8,4.7,0.4,0.6);
  const grid=buildIndoorGrid([r],[],[
    {id:"portal",roomKey:"r",point:[4.9,4.7],maxSnapFeet:2,nativeClearWidthFootprint:footprint},
    {id:"arrival",roomKey:"r",point:[2,5],maxSnapFeet:1},
  ],{walls:[{polygon:rectangle(4.9,0,.2,10)}],columns:[]},[{rooms:["r","r"],point:[5,5],from:[4.9,4.7],to:[5.1,4.7],halfWidth:1,halfHeight:1,footprint}]);
  const anchor=grid.positions.get("portal")!;
  assert.ok(anchor);
  assert.ok(anchor[1]>=4.7&&anchor[1]<=5.3,"native doorway width contains approved side anchor");
  assert.deepEqual(grid.missing,[]);
});

test("native jamb direction survives a host wall deeper than its clear width, including rotated plans", () => {
  for (const angle of [0, .47]) {
    const rotate = ([x,y]:RoomPoint):RoomPoint => [x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
    const r = room("r", rectangle(7.1,0,5,10).map(rotate)), footprint=rectangle(4,4,3,2).map(rotate);
    const ts=[{id:"portal",roomKey:"r",point:rotate([7.1,5]),maxSnapFeet:2,nativeClearWidthFootprint:footprint},
      {id:"arrival",roomKey:"r",point:rotate([10,5]),maxSnapFeet:1}];
    const barriers={walls:[{polygon:rectangle(4,0,3,10).map(rotate)}],columns:[]};
    const opening={rooms:["r","other"] as [string,string],point:rotate([5.5,5]),from:rotate([4,5]),to:rotate([7,5]),halfWidth:2,halfHeight:2,footprint};
    const legacy=buildIndoorGrid([r],[],ts,barriers,[opening]);
    assert.ok(legacy.missing.includes("portal"),"the longest-side heuristic wrongly clamps approach depth");
    const grid=buildIndoorGrid([r],[],[{...ts[0]!,nativeDoorNormal:rotate([1,0])},ts[1]!],barriers,[opening]);
    assert.ok(!grid.missing.includes("portal"));
    const p=grid.positions.get("portal")!,local=[p[0]*Math.cos(angle)+p[1]*Math.sin(angle),-p[0]*Math.sin(angle)+p[1]*Math.cos(angle)];
    assert.ok(local[0]!>7,"the side anchor belongs outside the host material");
    assert.ok(local[1]!>=4&&local[1]!<=6,"approach remains within the modeled jamb width");
    const blocked=nativeRouteBlocker(barriers,[opening]);
    for(const branch of grid.branches)for(let i=1;i<branch.points.length;i++)assert.equal(blocked(branch.points[i-1]!,branch.points[i]!),false);
  }
});
