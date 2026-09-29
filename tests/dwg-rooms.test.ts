import assert from "node:assert/strict";
import test from "node:test";

import {
  dwgBarrierSegments,
  roomRegions,
  simplifyRing,
  traceCellRings,
  treadLines,
} from "../lib/reviter/dwg-rooms.ts";
import type { Point2, RoomBarrier, RoomRegion, RoomSeed } from "../lib/reviter/dwg-rooms.ts";

const wall = (start: Point2, end: Point2, thickness = 0.4): RoomBarrier => ({ start, end, thickness, kind: "wall" });
const door = (start: Point2, end: Point2): RoomBarrier => ({ start, end, thickness: 0.4, kind: "door" });
const seed = (id: string, point: Point2, room = id): RoomSeed => ({ id, room, number: room, name: null, point });

/**
 * A 30 × 20 ft block: a corridor along the bottom (y 0–6) and two offices
 * above it (x 0–15 and 15–30), each entered through a 3 ft doorway left in
 * the corridor wall.
 */
function officesOffCorridor(options: { doors: boolean; outerGap?: boolean } = { doors: true }): RoomBarrier[] {
  const barriers = [
    wall([0, 0], [30, 0]),
    wall([30, 0], [30, 20]),
    wall([30, 20], [0, 20]),
    ...(options.outerGap ? [wall([0, 20], [0, 12]), wall([0, 9], [0, 0])] : [wall([0, 20], [0, 0])]),
    wall([15, 6], [15, 20]),
    // The corridor wall, broken at x 5–8 and 20–23 for the doors.
    wall([0, 6], [5, 6]),
    wall([8, 6], [20, 6]),
    wall([23, 6], [30, 6]),
  ];
  if (options.doors) barriers.push(door([5, 6], [8, 6]), door([20, 6], [23, 6]));
  return barriers;
}

/** Within 10 %: the raster rounds each face to a cell edge, and a thin wall seals at least 0.71 cell either side. */
function near(actual: number, expected: number, what: string) {
  assert.ok(Math.abs(actual - expected) <= expected * 0.1, `${what}: ${actual} vs ${expected.toFixed(1)}`);
}

const byRoom = (rooms: readonly RoomRegion[]) => new Map(rooms.map((room) => [room.room, room]));

test("offices off a corridor with door closures are each their own closed room", () => {
  const result = roomRegions({
    seeds: [seed("A", [7, 13]), seed("B", [22, 13]), seed("C", [15, 3])],
    barriers: officesOffCorridor({ doors: true }),
  });
  assert.equal(result.failures.length, 0);
  const rooms = byRoom(result.rooms);
  for (const key of ["A", "B", "C"]) {
    const room = rooms.get(key)!;
    assert.equal(room.diagnostics.closed, true, `${key} closed`);
    assert.equal(room.diagnostics.sharedComponent, 1);
    assert.deepEqual(room.diagnostics.competedWith, []);
    assert.ok(room.confidence >= 0.9, `${key} confidence ${room.confidence}`);
  }
  // Office interior ≈ 14.6 × 13.6 ft between wall faces; the raster sits
  // within a cell of each face.
  near(rooms.get("A")!.areaSquareFeet, 14.6 * 13.6, "A");
  near(rooms.get("C")!.areaSquareFeet, 29.6 * 5.6, "C");
  // An orthogonal room simplifies to its four corners.
  assert.equal(rooms.get("A")!.polygon.length, 4);
});

test("without door closures the rooms compete and meet at the doorways", () => {
  const result = roomRegions({
    seeds: [seed("A", [7, 13]), seed("B", [22, 13]), seed("C", [15, 3])],
    barriers: officesOffCorridor({ doors: false }),
  });
  const rooms = byRoom(result.rooms);
  const a = rooms.get("A")!; const c = rooms.get("C")!;
  assert.equal(a.diagnostics.closed, false);
  assert.equal(a.diagnostics.sharedComponent, 3);
  assert.deepEqual(a.diagnostics.competedWith, ["C"]);
  assert.equal(a.diagnostics.componentOpen, false);
  // The split falls in the doorway, so neither room takes much of the other.
  near(a.areaSquareFeet, 14.6 * 13.6, "A");
  near(c.areaSquareFeet, 29.6 * 5.6, "C");
  assert.ok(a.confidence < 0.9 && a.confidence >= 0.5, `A confidence ${a.confidence}`);
});

test("a gap in the outside wall is a leak to the exterior, not a room the size of the site", () => {
  const result = roomRegions({
    seeds: [seed("A", [7, 13]), seed("B", [22, 13]), seed("C", [15, 3])],
    barriers: officesOffCorridor({ doors: true, outerGap: true }),
    window: { minX: -40, minY: -40, maxX: 70, maxY: 60 },
  });
  const a = byRoom(result.rooms).get("A")!;
  assert.equal(a.diagnostics.componentOpen, true);
  assert.equal(a.diagnostics.touchesExterior, true);
  assert.equal(a.diagnostics.closed, false);
  assert.ok(a.areaSquareFeet < 14.6 * 13.6 + 20, `A area ${a.areaSquareFeet}`);
  assert.ok(a.confidence <= 0.4);
  // B, behind closed walls, is unaffected.
  assert.equal(byRoom(result.rooms).get("B")!.diagnostics.closed, true);
});

test("a seed inside a wall is nudged to the nearest free cell", () => {
  const result = roomRegions({
    seeds: [seed("A", [15.05, 13])],
    barriers: officesOffCorridor({ doors: true }),
  });
  const a = result.rooms[0]!;
  assert.ok(a.diagnostics.nudgedFeet > 0 && a.diagnostics.nudgedFeet < 1, `nudged ${a.diagnostics.nudgedFeet}`);
  assert.equal(a.diagnostics.closed, true);
  near(a.areaSquareFeet, 14.6 * 13.6, "A");
});

test("two labels in one room split it and are flagged; two seeds of one room make one room", () => {
  const split = roomRegions({
    seeds: [seed("A1", [4, 13]), seed("A2", [11, 13]), seed("C", [15, 3])],
    barriers: officesOffCorridor({ doors: true }),
  });
  const rooms = byRoom(split.rooms);
  assert.equal(rooms.get("A1")!.diagnostics.sharedComponent, 2);
  assert.equal(rooms.get("A1")!.diagnostics.closed, false);
  assert.deepEqual(rooms.get("A1")!.diagnostics.competedWith, ["A2"]);
  const total = rooms.get("A1")!.areaSquareFeet + rooms.get("A2")!.areaSquareFeet;
  near(total, 14.6 * 13.6, "A1 + A2");

  const merged = roomRegions({
    seeds: [seed("t", [4, 13], "A"), seed("x", [11, 13], "A")],
    barriers: officesOffCorridor({ doors: true }),
  });
  assert.equal(merged.rooms.length, 1);
  assert.deepEqual(merged.rooms[0]!.seedIds, ["t", "x"]);
  assert.equal(merged.rooms[0]!.diagnostics.closed, true);
});

test("a free-standing core inside a room becomes a hole", () => {
  const barriers = [
    wall([0, 0], [20, 0]), wall([20, 0], [20, 20]), wall([20, 20], [0, 20]), wall([0, 20], [0, 0]),
    wall([8, 8], [12, 8]), wall([12, 8], [12, 12]), wall([12, 12], [8, 12]), wall([8, 12], [8, 8]),
  ];
  const result = roomRegions({ seeds: [seed("A", [3, 3])], barriers });
  const room = result.rooms[0]!;
  assert.equal(room.holes.length, 1);
  near(room.areaSquareFeet, 19.6 * 19.6 - 4.4 * 4.4, "ring");
});

test("DWG-only closure is compared with the final region", () => {
  const dwg = officesOffCorridor({ doors: true }).map((barrier) => ({ ...barrier, thickness: 0, kind: "dwg" as const }));
  const result = roomRegions({ seeds: [seed("A", [7, 13]), seed("C", [15, 3])], barriers: dwg });
  const a = byRoom(result.rooms).get("A")!;
  assert.equal(a.diagnostics.closedByDwg, true);
  assert.equal(a.diagnostics.closedByRvt, false);
  assert.equal(a.diagnostics.dwgRegionIoU, 1);
});

test("ring tracing keeps diagonal-touching cells apart and simplification keeps a 58° wall", () => {
  // Two cells touching at a corner: (0,0) and (1,1) on a 3-column grid.
  const rings = traceCellRings([0, 4], 3);
  assert.equal(rings.length, 2);
  for (const ring of rings) assert.equal(ring.length, 4);

  const angle = (58 * Math.PI) / 180;
  const staircase: Point2[] = [];
  for (let step = 0; step <= 40; step += 1) {
    const x = Math.floor(step * Math.cos(angle) * 4) / 4;
    const y = Math.floor(step * Math.sin(angle) * 4) / 4;
    staircase.push([x, y]);
  }
  const ring: Point2[] = [...staircase, [staircase.at(-1)![0] + 10, staircase.at(-1)![1]], [10, 0]];
  const simplified = simplifyRing(ring, 0.4);
  assert.ok(simplified.length <= 5, `kept ${simplified.length} points`);
  const [a, b] = [simplified.find((p) => p[0] === 0 && p[1] === 0), simplified.find((p) => p[1] > 30 && p[0] < 25)];
  assert.ok(a && b);
  const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  assert.ok(Math.abs(bearing - 58) < 1.5, `bearing ${bearing}`);
});

test("DWG linework: door swings become closures, treads, small arcs and circles are dropped", () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const treads = Array.from({ length: 8 }, (_, index) => ({
    kind: "line" as const, start: [0, index * 0.9] as Point2, end: [4, index * 0.9] as Point2,
  }));
  const { barriers, report } = dwgBarrierSegments([
    { kind: "line", start: [0, 0], end: [20, 0] },
    { kind: "line", start: [0, 1], end: [20, 1] },
    { kind: "line", start: [5, 5], end: [5.05, 5] },
    ...treads,
    { kind: "arc", centre: [10, 10], radius: 3, startAngle: 0, endAngle: Math.PI / 2 },
    { kind: "arc", centre: [10, 10], radius: 0.5, startAngle: 0, endAngle: Math.PI },
    { kind: "arc", centre: [0, 0], radius: 40, startAngle: 0, endAngle: 0.2 },
    { kind: "circle", centre: [3, 3], radius: 1 },
  ], identity, { feetPerUnit: 1, minSegmentFeet: 0.15 });
  assert.equal(report.doorSwings, 1);
  assert.equal(report.doorClosures, 2);
  assert.equal(report.droppedArcs, 1);
  assert.equal(report.droppedCircles, 1);
  assert.equal(report.droppedShort, 1);
  assert.equal(report.droppedTreads, 8);
  assert.equal(report.wallArcs, 1);
  // Two walls, the chorded wall arc, and the two door radii.
  const closures = barriers.filter((barrier) => barrier.start[0] === 10 && barrier.start[1] === 10);
  assert.equal(closures.length, 2);
  assert.ok(barriers.every((barrier) => barrier.kind === "dwg"));

  // A wall's two faces are not a tread run.
  assert.equal(treadLines([
    { start: [0, 0], end: [4, 0] }, { start: [0, 0.4], end: [4, 0.4] },
  ]).size, 0);
});

test("a sheet whose walls fit the atrium's base floor takes its siblings' level; parts keep their own", async () => {
  const { emissionLevel } = await import("../scripts/build-dwg-rooms.ts");
  const base = {
    sheetId: 37, building: "10", dwgFloor: "4 (Atrium)", status: "registered" as const,
    elevationFeet: 3.28, transform: { matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }, inlierRatio: 0.51,
  };
  const atrium = { ...base, title: "10 TandL Atrium LVL 4", revitLevelId: 1487816, siblingLevelsByFloor: { 4: ["level_r402367"] } };
  assert.deepEqual(emissionLevel(atrium), { levelId: 402367, source: "siblings", sheetLevelId: 1487816 });
  // Its own level among the siblings' (the wings of that floor): kept.
  const wing = { ...base, title: "10 TandL 4000W", revitLevelId: 402367, siblingLevelsByFloor: { 4: ["level_r1487816", "level_r402367"] } };
  assert.equal(emissionLevel(wing).levelId, 402367);
  // A split part inherits its parent's floor name, so it is not overridden.
  assert.equal(emissionLevel({ ...atrium, part: 1 }).levelId, 1487816);
});

test("DWG → Pascal metres → Revit feet composes into one affine map", async () => {
  const { dwgToFeet } = await import("../scripts/build-dwg-rooms.ts");
  const { pascalPlanToFeet } = await import("../lib/reviter/room-annotations.ts");
  const frame = {
    kind: "reviter-pascal-frame" as const, version: 1 as const, metresPerFoot: 0.3048 as const,
    originFeet: { x: -1.5, y: 287.3, z: -7.2 }, planSign: -1 as const,
  };
  // 03 CJMH LVL 2's registration: mirrored, 90°.
  const matrix = { a: 4.46617427e-8, b: -0.000999999999, c: -0.000999999999, d: -4.46617427e-8, e: 18.67762765, f: 457.7118704 };
  const feet = dwgToFeet(matrix, frame);
  const dwg: Point2 = [272370, 21522];
  const metres: Point2 = [matrix.a * dwg[0] + matrix.c * dwg[1] + matrix.e, matrix.b * dwg[0] + matrix.d * dwg[1] + matrix.f];
  const expected = pascalPlanToFeet(frame, metres);
  const actual = [feet.a * dwg[0] + feet.c * dwg[1] + feet.e, feet.b * dwg[0] + feet.d * dwg[1] + feet.f];
  assert.ok(Math.hypot(actual[0]! - expected[0], actual[1]! - expected[1]) < 1e-9);
  // Mirror in DWG→Pascal and the negated plan axis cancel: DWG→feet is a rotation.
  assert.ok(feet.a * feet.d - feet.b * feet.c > 0);
});

test("the extract CLI attaches a rooms sidecar to Pascal and IFC exports only", async () => {
  const { parseExtractArguments } = await import("../scripts/extract-geometry.ts");
  assert.equal(parseExtractArguments(["m.rvt", "--out", "m.pascal.json", "--rooms", "r.json"]).rooms, "r.json");
  assert.equal(parseExtractArguments(["m.rvt", "--out", "m.ifc", "--rooms", "r.json"]).rooms, "r.json");
  assert.throws(() => parseExtractArguments(["m.rvt", "--out", "m.glb", "--rooms", "r.json"]), /--rooms/);
});

test("a label drawn against a wall still gets its share of a corridor it shares", () => {
  // A 60 × 6 ft corridor, numbered twice: one tag mid-width, one hard against the wall.
  const barriers = [wall([0, 0], [60, 0]), wall([60, 0], [60, 6]), wall([60, 6], [0, 6]), wall([0, 6], [0, 0])];
  const result = roomRegions({ seeds: [seed("A", [15, 3]), seed("B", [45, 0.55])], barriers });
  const rooms = byRoom(result.rooms);
  const a = rooms.get("A")!.areaSquareFeet; const b = rooms.get("B")!.areaSquareFeet;
  assert.ok(b > 0.35 * (a + b) && a > 0.35 * (a + b), `A ${a}, B ${b}`);
});
