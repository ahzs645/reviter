import assert from "node:assert/strict";
import test from "node:test";

import {
  floorPlateRecords,
  floorPlateLevels,
  makeFloorPlateSvg,
  makePlanSvg,
  planSegments,
} from "../lib/reviter/export-svg.ts";
import {
  architecturalPlanSummary,
  makeArchitecturalFloorSvg,
} from "../lib/reviter/architectural-plan.ts";
import { connectedFloorPlanGroups } from "../lib/reviter/connected-floor-plans.ts";
import { cachedDerivedRoomsForLevel, deriveRoomsForLevel } from "../lib/reviter/derived-rooms.ts";
import type { ConvertResult, ElementBoundsRecord, Segment } from "../lib/reviter/types.ts";

function record(elementId: number, x: number): ElementBoundsRecord {
  return {
    elementId,
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    boundsFeet: {
      min: { x, y: 0, z: 0 },
      max: { x: x + 1, y: 1, z: 1 },
    },
  };
}

function floorRecord(elementId: number, x: number): ElementBoundsRecord {
  return {
    ...record(elementId, x),
    categoryId: -2_000_032,
    categoryName: "Floors",
    loops: [
      [
        [x, 0, 0], [x + 4, 0, 0], [x + 4, 4, 0], [x, 4, 0],
      ],
      [
        [x + 1, 1, 0], [x + 2, 1, 0], [x + 2, 2, 0], [x + 1, 2, 0],
      ],
    ],
  };
}

function roomTestFloor(elementId: number): ElementBoundsRecord {
  return {
    ...record(elementId, 0),
    categoryId: -2_000_032,
    categoryName: "Floors",
    loops: [[
      [0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0],
    ]],
  };
}

function dividingWall(elementId: number): ElementBoundsRecord {
  return {
    ...record(elementId, 10),
    categoryId: -2_000_011,
    categoryName: "Walls",
    solid: {
      elementId,
      start: { x: 10, y: 0 },
      end: { x: 10, y: 10 },
      baseElevation: 0,
      topElevation: 10,
      thickness: 0.5,
    },
  };
}

function straightWall(elementId: number, start: [number, number], end: [number, number]): ElementBoundsRecord {
  const wall = dividingWall(elementId);
  wall.solid = { ...wall.solid!, start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] } };
  wall.boundsFeet = { min: { x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]), z: 0 }, max: { x: Math.max(start[0], end[0]), y: Math.max(start[1], end[1]), z: 10 } };
  return wall;
}

function resultFixture(): ConvertResult {
  return {
    ok: true,
    fileName: "model.rvt",
    byteLength: 1,
    meshes: [{
      name: "drawn",
      positions: new Float32Array(),
      indices: new Uint32Array(),
      colors: new Float32Array(),
      materialIndex: 0,
      elementIds: new Uint32Array([1, 2]),
    }],
    materials: [],
    segments: [],
    elementBounds: [record(1, 0), record(2, 10), record(3, 20)],
    nativeProfiles: [],
    decoderCoverage: {} as ConvertResult["decoderCoverage"],
    origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 21, y: 1, z: 1 } },
    levels: [
      { levelId: 100, elevation: 0, candidates: 2, source: "assoc-level-id" },
      { levelId: 200, elevation: 10, candidates: 1, source: "assoc-level-id" },
    ],
    stats: {} as ConvertResult["stats"],
    warnings: [],
    method: "partition-bounds-recovery",
    nativeAssociatedLevelRelations: [
      { elementId: 1, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
      { elementId: 2, levelId: 200 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
      { elementId: 3, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
    ],
  };
}

test("isolates a floor by persisted level membership and drawn element id", () => {
  const result = resultFixture();
  const segments = planSegments(result, { levelId: 100 });
  assert.equal(segments.length, 4);
  assert.ok(segments.every((segment) => segment.x0 <= 1 && segment.x1 <= 1));
  const svg = makePlanSvg(result, { levelId: 100 });
  assert.match(svg, /data-revit-level-id="100"/u);
  assert.equal((svg.match(/<path /gu) ?? []).length, 4);
});

test("whole-model SVG bounds do not overflow the argument stack", () => {
  const result = resultFixture();
  result.segments = Array.from({ length: 100_000 }, (_, index): Segment => ({
    x0: index,
    y0: 0,
    z0: 0,
    x1: index + 1,
    y1: 1,
    z1: 0,
  }));
  assert.match(makePlanSvg(result), /viewBox="0 0 100000 1"/u);
});

test("draws actual Revit floor sketch loops and keeps openings", () => {
  const result = resultFixture();
  result.elementBounds.push(floorRecord(4, 30), floorRecord(5, 40));
  result.nativeAssociatedLevelRelations!.push(
    { elementId: 4, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
    { elementId: 5, levelId: 200 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
  );
  assert.deepEqual(floorPlateRecords(result, 100).map((floor) => floor.elementId), [4]);
  assert.deepEqual(
    floorPlateLevels(result).map(({ levelId, floorCount }) => ({ levelId, floorCount })),
    [{ levelId: 100, floorCount: 1 }, { levelId: 200, floorCount: 1 }],
  );
  const svg = makeFloorPlateSvg(result, 100);
  assert.match(svg, /data-revit-floor-count="1"/u);
  assert.match(svg, /data-revit-element-id="4"/u);
  assert.match(svg, /fill-rule="evenodd"/u);
  assert.equal((svg.match(/ Z/gu) ?? []).length, 2);
});

test("composes adjoining split levels but keeps vertically stacked storeys separate", () => {
  const result = resultFixture();
  result.levels = [
    { levelId: 100, elevation: 0, candidates: 1, source: "assoc-level-id" },
    { levelId: 200, elevation: 3, candidates: 1, source: "assoc-level-id" },
    { levelId: 300, elevation: 10, candidates: 1, source: "assoc-level-id" },
  ];
  const floorAt = (elementId: number, levelId: number, elevation: number, x: number) => {
    const floor = roomTestFloor(elementId);
    floor.loops = [[
      [x, 0, elevation], [x + 10, 0, elevation],
      [x + 10, 10, elevation], [x, 10, elevation],
    ]];
    floor.boundsFeet = {
      min: { x, y: 0, z: elevation },
      max: { x: x + 10, y: 10, z: elevation + 0.5 },
    };
    result.elementBounds.push(floor);
    result.nativeAssociatedLevelRelations!.push(
      { elementId, levelId } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
    );
  };
  floorAt(10, 100, 0, 0);
  floorAt(20, 200, 3, 10.5);
  floorAt(30, 300, 10, 0);

  const groups = connectedFloorPlanGroups(result);
  assert.deepEqual(groups.map((group) => group.levelIds), [[100, 200], [300]]);
  assert.equal(groups[0]!.primaryLevelId, 100);
  assert.equal(groups[0]!.connections.length, 1);

  const summary = architecturalPlanSummary(result, 100, { connectedLevelIds: [100, 200] });
  assert.equal(summary.floors, 2);
  const svg = makeArchitecturalFloorSvg(result, 100, { connectedLevelIds: [100, 200] });
  assert.match(svg, /data-revit-level-ids="100,200"/u);
  assert.match(svg, /data-connected-level-count="2"/u);
  assert.match(svg, /data-source-revit-level-id="200"/u);
});

test("composes a level-aware architectural map from recovered RVT elements", () => {
  const result = resultFixture();
  const floor = roomTestFloor(10);
  const wall = straightWall(11, [0, 5], [20, 5]);
  const placed = (elementId: number, categoryId: number, categoryName: string, x: number): ElementBoundsRecord => ({
    ...record(elementId, x),
    categoryId,
    categoryName,
    orientedBox: [
      [x, 4.8, 0], [x + 3, 4.8, 0], [x + 3, 5.2, 0], [x, 5.2, 0],
      [x, 4.8, 7], [x + 3, 4.8, 7], [x + 3, 5.2, 7], [x, 5.2, 7],
    ],
    boundsFeet: { min: { x, y: 4.8, z: 0 }, max: { x: x + 3, y: 5.2, z: 7 } },
  });
  const door = placed(12, -2_000_023, "Doors", 2);
  const window = placed(13, -2_000_014, "Windows", 8);
  window.boundsFeet.min.z = 3;
  const stair = placed(14, -2_000_121, "Stairs Runs", 13);
  stair.boundsFeet.max.z = 10;
  stair.stairTreads = [[
    [13, 4, 1], [14, 4, 1], [14, 6, 1], [13, 6, 1],
  ]];
  const column = placed(15, -2_000_100, "Columns", 17);
  column.boundsFeet.max.x = 18;
  const stairContainer = placed(16, -2_000_120, "Stairs", 12);
  stairContainer.boundsFeet.max.z = 10;
  result.elementBounds.push(floor, wall, door, window, stair, column, stairContainer);
  result.nativeAssociatedLevelRelations!.push(
    { elementId: floor.elementId, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
  );

  assert.deepEqual(architecturalPlanSummary(result, 100), {
    levelId: 100,
    elevation: 0,
    cutElevation: 4,
    floors: 1,
    walls: 1,
    doors: 1,
    windows: 1,
    stairs: 1,
    columns: 1,
  });
  const svg = makeArchitecturalFloorSvg(result, 100);
  assert.match(svg, /data-wall-count="1"/u);
  assert.match(svg, /data-door-count="1"/u);
  assert.match(svg, /class="windows"/u);
  assert.match(svg, /class="swing"/u);
  assert.match(svg, /class="riser"/u);
  assert.match(svg, /class="columns"/u);
  assert.doesNotMatch(svg, /data-revit-element-id="16"/u);
  assert.match(svg, /\.walls\{fill:#e0e7e5;stroke:#344b50;stroke-width:/u);
  assert.doesNotMatch(svg, /\.walls\{fill:#263f46/u);

  const rotated = makeArchitecturalFloorSvg(result, 100, { rotationQuarterTurns: 1 });
  assert.match(rotated, /viewBox="0 0 15 25"/u);
  assert.match(rotated, /data-view-rotation-degrees="90"/u);
  assert.match(rotated, /transform="translate\(15 0\) rotate\(90\)"/u);
});

test("omits an unresolved stair run rather than inventing treads", () => {
  const result = resultFixture();
  const floor = roomTestFloor(10);
  const unresolved = record(20, 4);
  unresolved.categoryId = -2_000_121;
  unresolved.categoryName = "Stairs Runs";
  unresolved.boundsFeet = { min: { x: 4, y: 2, z: 0 }, max: { x: 16, y: 8, z: 10 } };
  const otherStorey = { ...unresolved, elementId: 21, stairTreads: [[
    [5, 3, 20], [6, 3, 20], [6, 4, 20], [5, 4, 20],
  ]] };
  result.elementBounds.push(floor, unresolved, otherStorey);
  result.nativeAssociatedLevelRelations!.push(
    { elementId: floor.elementId, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
  );

  assert.equal(architecturalPlanSummary(result, 100).stairs, 0);
  const svg = makeArchitecturalFloorSvg(result, 100);
  assert.doesNotMatch(svg, /data-revit-element-id="20"/u);
  assert.doesNotMatch(svg, /data-revit-element-id="21"/u);
});

test("derives approximate floor regions only when recovered barriers fully enclose them", () => {
  const result = resultFixture();
  result.elementBounds.push(roomTestFloor(10), dividingWall(11),
    straightWall(12, [0, 0], [20, 0]), straightWall(13, [20, 0], [20, 10]),
    straightWall(14, [20, 10], [0, 10]), straightWall(15, [0, 10], [0, 0]));
  result.nativeAssociatedLevelRelations!.push(
    { elementId: 10, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number],
  );
  const derived = deriveRoomsForLevel(result, 100);
  assert.equal(derived.approximate, true);
  assert.equal(derived.source, "vertical-barrier-grid");
  assert.equal(derived.barrierElementCount, 5);
  assert.equal(derived.rooms.length, 2);
  assert.ok(derived.rooms.every((room) => room.areaSquareFeet > 80));

  const plainSvg = makeFloorPlateSvg(result, 100);
  assert.doesNotMatch(plainSvg, /data-derived-floor-region-count/u);
  const roomSvg = makeFloorPlateSvg(result, 100, { derivedRooms: true });
  assert.match(roomSvg, /data-derived-floor-region-count="2"/u);
  assert.match(roomSvg, /data-derived-floor-region-source="vertical-barrier-grid"/u);
  assert.match(roomSvg, />F1</u);
});

test("does not mistake a bare slab for an enclosed room", () => {
  const result = resultFixture();
  result.elementBounds.push(roomTestFloor(10));
  result.nativeAssociatedLevelRelations!.push({ elementId: 10, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number]);
  assert.equal(deriveRoomsForLevel(result, 100).rooms.length, 0);
});

test("uses curtain boundaries at the plan cut and ignores barriers on another storey", () => {
  const result = resultFixture();
  const perimeter = [
    straightWall(12, [0, 0], [20, 0]), straightWall(13, [20, 0], [20, 10]),
    straightWall(14, [20, 10], [0, 10]), straightWall(15, [0, 10], [0, 0]),
  ];
  perimeter[0]!.categoryId = -2_000_170;
  const highWall = straightWall(16, [10, 0], [10, 10]);
  highWall.solid!.baseElevation = 20;
  highWall.solid!.topElevation = 30;
  highWall.boundsFeet.min.z = 20;
  highWall.boundsFeet.max.z = 30;
  result.elementBounds.push(roomTestFloor(10), ...perimeter, highWall);
  result.nativeAssociatedLevelRelations!.push({ elementId: 10, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number]);
  const derived = deriveRoomsForLevel(result, 100);
  assert.equal(derived.barrierElementCount, 4);
  assert.equal(derived.rooms.length, 1);
});

test("preserves diagonal oriented barrier fallbacks", () => {
  const result = resultFixture();
  const orientedWall = (elementId: number, start: [number, number], end: [number, number]): ElementBoundsRecord => {
    const dx = end[0] - start[0]; const dy = end[1] - start[1]; const length = Math.hypot(dx, dy);
    const nx = -dy / length * 0.25; const ny = dx / length * 0.25;
    const plan: [number, number][] = [
      [start[0] + nx, start[1] + ny], [end[0] + nx, end[1] + ny],
      [end[0] - nx, end[1] - ny], [start[0] - nx, start[1] - ny],
    ];
    return {
      ...record(elementId, 0), categoryId: -2_000_011,
      boundsFeet: { min: { x: Math.min(...plan.map((p) => p[0])), y: Math.min(...plan.map((p) => p[1])), z: 0 }, max: { x: Math.max(...plan.map((p) => p[0])), y: Math.max(...plan.map((p) => p[1])), z: 10 } },
      orientedBox: plan.flatMap(([x, y]) => [[x, y, 0], [x, y, 10]] as [number, number, number][]),
    };
  };
  const diamond: [number, number][] = [[10, 1], [19, 5], [10, 9], [1, 5]];
  result.elementBounds.push(roomTestFloor(10), ...diamond.map((point, index) => orientedWall(20 + index, point, diamond[(index + 1) % diamond.length]!)));
  result.nativeAssociatedLevelRelations!.push({ elementId: 10, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number]);
  const derived = deriveRoomsForLevel(result, 100);
  assert.equal(derived.rooms.length, 1);
  assert.ok(derived.rooms[0]!.areaSquareFeet > 50);
  assert.ok(derived.rooms[0]!.loops[0]!.length < 100, "grid contour points should be simplified");
  assert.equal(cachedDerivedRoomsForLevel(result, 100), cachedDerivedRoomsForLevel(result, 100));
});

test("surfaces a short leaking wall opening as a reviewable near-room", () => {
  const result = resultFixture();
  result.elementBounds.push(
    roomTestFloor(10),
    straightWall(12, [0, 0], [9.25, 0]),
    straightWall(13, [10.75, 0], [20, 0]),
    straightWall(14, [20, 0], [20, 10]),
    straightWall(15, [20, 10], [0, 10]),
    straightWall(16, [0, 10], [0, 0]),
  );
  result.nativeAssociatedLevelRelations!.push({ elementId: 10, levelId: 100 } as NonNullable<ConvertResult["nativeAssociatedLevelRelations"]>[number]);
  const derived = deriveRoomsForLevel(result, 100);
  const candidate = derived.rooms.find((room) => room.closure === "near-closed");
  assert.ok(candidate, "the leaky enclosure should remain visible for review");
  assert.ok(candidate.gapIds.length > 0);
  assert.ok(derived.gaps.some((gap) => candidate.gapIds.includes(gap.id) && gap.widthFeet <= 2));
  assert.match(candidate.key, /^room-100-near-closed-/);
});
