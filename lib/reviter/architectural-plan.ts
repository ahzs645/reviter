/** Architectural plan composition from persisted, level-aware RVT geometry. */
import { cachedDerivedRoomsForLevel, type DerivedRoomResult } from "./derived-rooms.ts";
import { floorPlateRecords } from "./export-svg.ts";
import type { ConvertResult, ElementBoundsRecord, Point3, WallArc, WallSolid } from "./types.ts";

const WALL_CATEGORY_IDS = new Set([-2_000_011, -2_000_170, -2_000_171]);
const DOOR_CATEGORY_ID = -2_000_023;
const WINDOW_CATEGORY_ID = -2_000_014;
const COLUMN_CATEGORY_IDS = new Set([-2_000_100, -2_000_133]);
const PLAN_CUT_HEIGHT_FEET = 4;
const OPEN_END_FLOOR_SEARCH_FEET = 3;
const OPEN_END_MINIMUM_WALL_LENGTH_FEET = 6;

type Point2 = [number, number];
type PlanBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type ArchitecturalPlanSvgOptions = {
  /** Overlay approximate, unnamed regions inferred from recovered barriers. */
  derivedRooms?: boolean | DerivedRoomResult;
  /** Rotate the drawing view clockwise in 90-degree steps without moving RVT geometry. */
  rotationQuarterTurns?: number;
  /** Nearby, adjoining split-level elevations to compose into the same map. */
  connectedLevelIds?: readonly number[];
};

export type ArchitecturalPlanSummary = {
  levelId: number;
  elevation: number;
  cutElevation: number;
  floors: number;
  walls: number;
  doors: number;
  windows: number;
  stairs: number;
  columns: number;
};

type ArchitecturalPlanRecords = ArchitecturalPlanSummary & {
  floorRecords: ElementBoundsRecord[];
  wallRecords: ElementBoundsRecord[];
  doorRecords: ElementBoundsRecord[];
  windowRecords: ElementBoundsRecord[];
  stairRecords: ElementBoundsRecord[];
  columnRecords: ElementBoundsRecord[];
  bounds: PlanBounds;
  nextElevation: number;
  levelPlans: Array<{
    levelId: number;
    elevation: number;
    nextElevation: number;
    floorRecords: ElementBoundsRecord[];
    stairRecords: ElementBoundsRecord[];
  }>;
};

const planCache = new WeakMap<ConvertResult, Map<number, ArchitecturalPlanRecords>>();
const connectedPlanCache = new WeakMap<ConvertResult, Map<string, ArchitecturalPlanRecords>>();
const svgCache = new WeakMap<ConvertResult, Map<string, Map<number, WeakMap<object, string>>>>();
const NO_DERIVED_REGIONS = {};

function intersectsElevation(record: ElementBoundsRecord, elevation: number) {
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  const shapes = [...solids, ...(record.arcs ?? [])];
  if (shapes.length) return shapes.some(
    (shape) => shape.baseElevation - 0.1 <= elevation && shape.topElevation + 0.1 >= elevation,
  );
  return record.boundsFeet.min.z - 0.1 <= elevation && record.boundsFeet.max.z + 0.1 >= elevation;
}

function intersectsBand(record: ElementBoundsRecord, low: number, high: number) {
  return record.boundsFeet.max.z >= low - 0.1 && record.boundsFeet.min.z < high + 0.1;
}

function recordBounds(record: ElementBoundsRecord): PlanBounds {
  const { min, max } = record.boundsFeet;
  return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
}

function overlaps(left: PlanBounds, right: PlanBounds, padding = 0) {
  return left.maxX >= right.minX - padding && left.minX <= right.maxX + padding &&
    left.maxY >= right.minY - padding && left.minY <= right.maxY + padding;
}

function floorBounds(records: readonly ElementBoundsRecord[]): PlanBounds {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const record of records) for (const loop of record.loops ?? []) for (const [x, y] of loop) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsIncludingRecords(bounds: PlanBounds, records: readonly ElementBoundsRecord[]): PlanBounds {
  return records.reduce((combined, record) => {
    const item = recordBounds(record);
    return {
      minX: Math.min(combined.minX, item.minX),
      minY: Math.min(combined.minY, item.minY),
      maxX: Math.max(combined.maxX, item.maxX),
      maxY: Math.max(combined.maxY, item.maxY),
    };
  }, bounds);
}

function treadIsInBand(tread: readonly Point3[], low: number, high: number) {
  const elevation = tread.reduce((sum, point) => sum + point[2], 0) / tread.length;
  return elevation >= low - 0.1 && elevation < high + 0.1;
}

function isDrawableStairRecord(record: ElementBoundsRecord, low: number, high: number) {
  // `Stairs` is the assembly container around runs and landings. Drawing it as
  // another stair duplicates the assembly and turns its broad AABB into a fake
  // flight. Only components with their own plan geometry belong in this map.
  return record.categoryName === "Stairs Landings" ||
    (record.categoryName === "Stairs Runs" &&
      Boolean(record.stairTreads?.some((tread) => treadIsInBand(tread, low, high))));
}

function recordsForLevel(result: ConvertResult, levelId: number): ArchitecturalPlanRecords {
  let resultPlans = planCache.get(result);
  if (!resultPlans) { resultPlans = new Map(); planCache.set(result, resultPlans); }
  const cached = resultPlans.get(levelId);
  if (cached) return cached;

  const level = result.levels.find((candidate) => candidate.levelId === levelId);
  if (!level) throw new Error(`Revit level ${levelId} is not present in this model.`);
  const floors = floorPlateRecords(result, levelId);
  if (!floors.length) throw new Error(`Revit level ${levelId} contains no recovered Floors sketch boundaries.`);
  const floorPlanBounds = floorBounds(floors);
  const cutElevation = level.elevation + PLAN_CUT_HEIGHT_FEET;
  const sortedElevations = result.levels.map((candidate) => candidate.elevation).sort((a, b) => a - b);
  const nextElevation = sortedElevations.find((elevation) => elevation > level.elevation + 0.1)
    ?? level.elevation + 12;
  const members = new Set((result.nativeAssociatedLevelRelations ?? [])
    .filter((relation) => relation.levelId === levelId)
    .map((relation) => relation.elementId));
  const inPlan = (record: ElementBoundsRecord) => overlaps(recordBounds(record), floorPlanBounds, 3);
  const atCut = (record: ElementBoundsRecord) => inPlan(record) && intersectsElevation(record, cutElevation);
  const onLevelOrAtCut = (record: ElementBoundsRecord) => inPlan(record) &&
    (members.has(record.elementId) || intersectsElevation(record, cutElevation));

  const wallRecords = result.elementBounds.filter((record) =>
    WALL_CATEGORY_IDS.has(record.categoryId ?? 0) && atCut(record));
  const doorRecords = result.elementBounds.filter((record) =>
    record.categoryId === DOOR_CATEGORY_ID && onLevelOrAtCut(record));
  const windowRecords = result.elementBounds.filter((record) =>
    record.categoryId === WINDOW_CATEGORY_ID && onLevelOrAtCut(record));
  const stairRecords = result.elementBounds.filter((record) => isDrawableStairRecord(record, level.elevation, nextElevation) && inPlan(record) &&
    (members.has(record.elementId) || intersectsBand(record, level.elevation, nextElevation)));
  const columnRecords = result.elementBounds.filter((record) =>
    COLUMN_CATEGORY_IDS.has(record.categoryId ?? 0) && atCut(record));
  const bounds = boundsIncludingRecords(floorPlanBounds, [
    ...wallRecords,
    ...doorRecords,
    ...windowRecords,
    ...stairRecords,
    ...columnRecords,
  ]);
  const plan: ArchitecturalPlanRecords = {
    levelId,
    elevation: level.elevation,
    cutElevation,
    floors: floors.length,
    walls: wallRecords.length,
    doors: doorRecords.length,
    windows: windowRecords.length,
    stairs: stairRecords.length,
    columns: columnRecords.length,
    floorRecords: floors,
    wallRecords,
    doorRecords,
    windowRecords,
    stairRecords,
    columnRecords,
    bounds,
    nextElevation,
    levelPlans: [{
      levelId,
      elevation: level.elevation,
      nextElevation,
      floorRecords: floors,
      stairRecords,
    }],
  };
  resultPlans.set(levelId, plan);
  return plan;
}

function uniqueRecords(records: readonly ElementBoundsRecord[]) {
  return [...new Map(records.map((record) => [record.elementId, record])).values()];
}

function recordsForPlan(
  result: ConvertResult,
  primaryLevelId: number,
  connectedLevelIds: readonly number[] = [primaryLevelId],
): ArchitecturalPlanRecords {
  const elevations = new Map(result.levels.flatMap((level) =>
    level.levelId == null ? [] : [[level.levelId, level.elevation] as const]));
  const levelIds = [...new Set([primaryLevelId, ...connectedLevelIds])]
    .filter((levelId) => elevations.has(levelId))
    .sort((left, right) => elevations.get(left)! - elevations.get(right)!);
  if (levelIds.length === 1) return recordsForLevel(result, primaryLevelId);
  const key = `${primaryLevelId}:${levelIds.join(",")}`;
  let resultPlans = connectedPlanCache.get(result);
  if (!resultPlans) { resultPlans = new Map(); connectedPlanCache.set(result, resultPlans); }
  const cached = resultPlans.get(key);
  if (cached) return cached;
  const parts = levelIds.map((levelId) => recordsForLevel(result, levelId));
  const primary = parts.find((part) => part.levelId === primaryLevelId) ?? parts[0]!;
  const floorRecords = uniqueRecords(parts.flatMap((part) => part.floorRecords));
  const wallRecords = uniqueRecords(parts.flatMap((part) => part.wallRecords));
  const doorRecords = uniqueRecords(parts.flatMap((part) => part.doorRecords));
  const windowRecords = uniqueRecords(parts.flatMap((part) => part.windowRecords));
  const stairRecords = uniqueRecords(parts.flatMap((part) => part.stairRecords));
  const columnRecords = uniqueRecords(parts.flatMap((part) => part.columnRecords));
  const bounds = parts.reduce<PlanBounds>((combined, part) => ({
    minX: Math.min(combined.minX, part.bounds.minX),
    minY: Math.min(combined.minY, part.bounds.minY),
    maxX: Math.max(combined.maxX, part.bounds.maxX),
    maxY: Math.max(combined.maxY, part.bounds.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const plan: ArchitecturalPlanRecords = {
    levelId: primary.levelId,
    elevation: primary.elevation,
    cutElevation: primary.cutElevation,
    floors: floorRecords.length,
    walls: wallRecords.length,
    doors: doorRecords.length,
    windows: windowRecords.length,
    stairs: stairRecords.length,
    columns: columnRecords.length,
    floorRecords,
    wallRecords,
    doorRecords,
    windowRecords,
    stairRecords,
    columnRecords,
    bounds,
    nextElevation: parts.at(-1)!.nextElevation,
    levelPlans: parts.flatMap((part) => part.levelPlans),
  };
  resultPlans.set(key, plan);
  return plan;
}

export function architecturalPlanSummary(
  result: ConvertResult,
  levelId: number,
  options: Pick<ArchitecturalPlanSvgOptions, "connectedLevelIds"> = {},
): ArchitecturalPlanSummary {
  const plan = recordsForPlan(result, levelId, options.connectedLevelIds);
  return {
    levelId: plan.levelId,
    elevation: plan.elevation,
    cutElevation: plan.cutElevation,
    floors: plan.floors,
    walls: plan.walls,
    doors: plan.doors,
    windows: plan.windows,
    stairs: plan.stairs,
    columns: plan.columns,
  };
}

function xy(point: Point3): Point2 { return [point[0], point[1]]; }

function distinctPlanPoints(record: ElementBoundsRecord): Point2[] {
  const points = record.orientedBox?.map(([x, y]) => [x, y] as Point2) ?? [];
  const unique = new Map(points.map((point) => [`${point[0].toFixed(6)},${point[1].toFixed(6)}`, point]));
  if (unique.size >= 3) return convexHull([...unique.values()]);
  const { min, max } = record.boundsFeet;
  return [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]];
}

function convexHull(points: Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 3) return sorted;
  const cross = (origin: Point2, a: Point2, b: Point2) =>
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: Point2[] = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point); }
  const upper: Point2[] = [];
  for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return [...lower, ...upper];
}

function wallPolygon(solid: WallSolid): Point2[] {
  const dx = solid.end.x - solid.start.x; const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy) || 1; const px = -dy / length * solid.thickness / 2;
  const py = dx / length * solid.thickness / 2;
  return [
    [solid.start.x + px, solid.start.y + py], [solid.end.x + px, solid.end.y + py],
    [solid.end.x - px, solid.end.y - py], [solid.start.x - px, solid.start.y - py],
  ];
}

type ExposedWallEnd = {
  elementIds: number[];
  end: "start" | "end";
  point: Point2;
  inward: Point2;
  thickness: number;
};

function distanceBetween(left: Point2, right: Point2) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function distanceToSegment(point: Point2, start: Point2, end: Point2) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distanceBetween(point, start);
  const fraction = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return distanceBetween(point, [start[0] + dx * fraction, start[1] + dy * fraction]);
}

function pointInLoop(point: Point2, loop: readonly Point3[]) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index, index += 1) {
    const [x, y] = loop[index]!; const [previousX, previousY] = loop[previous]!;
    if (
      (y > point[1]) !== (previousY > point[1]) &&
      point[0] < (previousX - x) * (point[1] - y) / (previousY - y) + x
    ) inside = !inside;
  }
  return inside;
}

type IndexedFloorLoop = {
  loop: readonly Point3[];
  minX: number; minY: number; maxX: number; maxY: number;
};
type IndexedFloors = { loops: IndexedFloorLoop[] }[];

const indexedFloorCache = new WeakMap<readonly ElementBoundsRecord[], IndexedFloors>();

function indexedFloors(floors: readonly ElementBoundsRecord[]): IndexedFloors {
  const cached = indexedFloorCache.get(floors);
  if (cached) return cached;
  const indexed = floors.map((record) => ({
    loops: (record.loops ?? []).filter((loop) => loop.length >= 3).map((loop) => {
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (const [x, y] of loop) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return { loop, minX, minY, maxX, maxY };
    }),
  }));
  indexedFloorCache.set(floors, indexed);
  return indexed;
}

function pointOnFloor(point: Point2, floors: IndexedFloors) {
  return floors.some((record) => {
    let inside = false;
    for (const { loop, minX, minY, maxX, maxY } of record.loops) {
      if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue;
      if (pointInLoop(point, loop)) inside = !inside;
    }
    return inside;
  });
}

function floorNear(point: Point2, floors: IndexedFloors) {
  if (pointOnFloor(point, floors)) return true;
  for (const radius of [0.5, 1.5, OPEN_END_FLOOR_SEARCH_FEET]) {
    for (let index = 0; index < 16; index += 1) {
      const angle = index * Math.PI / 8;
      if (pointOnFloor([
        point[0] + Math.cos(angle) * radius,
        point[1] + Math.sin(angle) * radius,
      ], floors)) return true;
    }
  }
  return false;
}

function wallSolids(records: readonly ElementBoundsRecord[]) {
  return records.flatMap((record) => {
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    return solids.map((solid) => ({ elementId: record.elementId, solid }));
  });
}

/**
 * Uniform grid over wall solids so an endpoint's join test only visits nearby
 * segments instead of every wall on the plan. Each solid is inserted into all
 * cells its join-tolerance-expanded segment box covers, so a single lookup at
 * the query point's cell is exhaustive for that tolerance.
 */
type WallSolidGrid = {
  cellSize: number;
  cells: Map<string, ReturnType<typeof wallSolids>>;
};

function wallSolidGrid(candidates: ReturnType<typeof wallSolids>): WallSolidGrid {
  const maxThickness = candidates.reduce(
    (largest, candidate) => Math.max(largest, candidate.solid.thickness), 0);
  const margin = Math.max(0.45, maxThickness + 0.15) + 0.05;
  const cellSize = Math.max(8, margin * 2);
  const cells = new Map<string, ReturnType<typeof wallSolids>>();
  for (const candidate of candidates) {
    const { start, end } = candidate.solid;
    const minX = Math.min(start.x, end.x) - margin; const maxX = Math.max(start.x, end.x) + margin;
    const minY = Math.min(start.y, end.y) - margin; const maxY = Math.max(start.y, end.y) + margin;
    for (let cellX = Math.floor(minX / cellSize); cellX <= Math.floor(maxX / cellSize); cellX += 1) {
      for (let cellY = Math.floor(minY / cellSize); cellY <= Math.floor(maxY / cellSize); cellY += 1) {
        const key = `${cellX},${cellY}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(candidate); else cells.set(key, [candidate]);
      }
    }
  }
  return { cellSize, cells };
}

function nearbyWallSolids(grid: WallSolidGrid, point: Point2) {
  return grid.cells.get(
    `${Math.floor(point[0] / grid.cellSize)},${Math.floor(point[1] / grid.cellSize)}`,
  ) ?? [];
}

function joinedWallEnd(
  point: Point2,
  inward: Point2,
  owner: WallSolid,
  candidates: ReturnType<typeof wallSolids>,
) {
  for (const candidate of candidates) {
    if (candidate.solid === owner) continue;
    const start: Point2 = [candidate.solid.start.x, candidate.solid.start.y];
    const end: Point2 = [candidate.solid.end.x, candidate.solid.end.y];
    const tolerance = Math.max(0.45,
      (owner.thickness + candidate.solid.thickness) / 2 + 0.15);
    if (distanceToSegment(point, start, end) > tolerance) continue;

    const startDistance = distanceBetween(point, start);
    const endDistance = distanceBetween(point, end);
    const nearestDistance = Math.min(startDistance, endDistance);
    if (nearestDistance > tolerance) return true;
    const other = startDistance <= endDistance ? end : start;
    const length = distanceBetween(point, other);
    if (length <= 1e-6) continue;
    const away: Point2 = [(other[0] - point[0]) / length, (other[1] - point[1]) / length];
    // A wall on another connected storey can occupy the same plan line and
    // share the same endpoint. It is a vertical stack, not a 2D join. Ignore
    // only that same-direction overlap; corners and outward continuations join.
    if (inward[0] * away[0] + inward[1] * away[1] > 0.985) continue;
    return true;
  }
  return false;
}

function exposedWallEnds(
  records: readonly ElementBoundsRecord[],
  floors: readonly ElementBoundsRecord[],
): ExposedWallEnd[] {
  const candidates = wallSolids(records);
  const grid = wallSolidGrid(candidates);
  const floorIndex = indexedFloors(floors);
  const exposed: ExposedWallEnd[] = [];
  for (const { elementId, solid } of candidates) {
    const start: Point2 = [solid.start.x, solid.start.y];
    const end: Point2 = [solid.end.x, solid.end.y];
    const length = distanceBetween(start, end);
    if (length < OPEN_END_MINIMUM_WALL_LENGTH_FEET) continue;
    const direction: Point2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    for (const candidate of [
      { end: "start" as const, point: start, inward: direction },
      { end: "end" as const, point: end, inward: [-direction[0], -direction[1]] as Point2 },
    ]) {
      if (floorNear(candidate.point, floorIndex)) continue;
      if (joinedWallEnd(candidate.point, candidate.inward, solid, nearbyWallSolids(grid, candidate.point))) continue;
      const duplicate = exposed.find((item) => distanceBetween(item.point, candidate.point) <= 0.25);
      if (duplicate) {
        duplicate.elementIds.push(elementId);
        duplicate.thickness = Math.max(duplicate.thickness, solid.thickness);
        continue;
      }
      exposed.push({
        elementIds: [elementId],
        end: candidate.end,
        point: candidate.point,
        inward: candidate.inward,
        thickness: solid.thickness,
      });
    }
  }
  return exposed;
}

function arcPoints(arc: WallArc): Point2[] {
  const sweep = arc.endAngle - arc.startAngle;
  const steps = Math.max(8, Math.ceil(Math.abs(sweep * arc.radius) / 1.5));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = arc.startAngle + sweep * index / steps;
    return [
      arc.centre.x + arc.radius * (Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x),
      arc.centre.y + arc.radius * (Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y),
    ];
  });
}

function principalFrame(points: readonly Point2[]) {
  const center: Point2 = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
  let xx = 0; let xyValue = 0; let yy = 0;
  for (const point of points) { const dx = point[0] - center[0]; const dy = point[1] - center[1]; xx += dx * dx; xyValue += dx * dy; yy += dy * dy; }
  const angle = 0.5 * Math.atan2(2 * xyValue, xx - yy);
  let u: Point2 = [Math.cos(angle), Math.sin(angle)]; let v: Point2 = [-u[1], u[0]];
  const extent = (axis: Point2) => points.reduce<[number, number]>((range, point) => {
    const value = (point[0] - center[0]) * axis[0] + (point[1] - center[1]) * axis[1];
    return [Math.min(range[0], value), Math.max(range[1], value)];
  }, [Infinity, -Infinity]);
  let uExtent = extent(u); let vExtent = extent(v);
  if (vExtent[1] - vExtent[0] > uExtent[1] - uExtent[0]) {
    [u, v] = [v, [-u[0], -u[1]]]; [uExtent, vExtent] = [vExtent, uExtent];
  }
  return { center, u, v, halfWidth: (uExtent[1] - uExtent[0]) / 2, halfDepth: (vExtent[1] - vExtent[0]) / 2 };
}

/**
 * Door leaves and swing arcs are diagrammatic geometry synthesized outside the
 * persisted door envelope. Include their full radius in the drawing bounds so
 * an outward-facing door at the edge of a plan can never be clipped.
 */
function boundsIncludingDoorSwings(bounds: PlanBounds, records: readonly ElementBoundsRecord[]): PlanBounds {
  const expanded = { ...bounds };
  for (const record of records) {
    const points = distinctPlanPoints(record);
    if (points.length < 3) continue;
    const frame = principalFrame(points);
    const width = Math.max(0.2, frame.halfWidth * 2);
    const pivot: Point2 = [
      frame.center[0] - frame.u[0] * frame.halfWidth,
      frame.center[1] - frame.u[1] * frame.halfWidth,
    ];
    // The actual path is a quarter arc, but the complete radius box is cheap
    // and robust to either handedness recovered from a door record.
    expanded.minX = Math.min(expanded.minX, pivot[0] - width);
    expanded.minY = Math.min(expanded.minY, pivot[1] - width);
    expanded.maxX = Math.max(expanded.maxX, pivot[0] + width);
    expanded.maxY = Math.max(expanded.maxY, pivot[1] + width);
  }
  return expanded;
}

function renderPoint(point: Point2, bounds: PlanBounds): Point2 {
  return [point[0] - bounds.minX, bounds.maxY - point[1]];
}

function path(points: readonly Point2[], bounds: PlanBounds, close = true) {
  return points.map((point, index) => {
    const [x, y] = renderPoint(point, bounds); return `${index ? "L" : "M"} ${x} ${y}`;
  }).join(" ") + (close ? " Z" : "");
}

function floorLayer(records: readonly ElementBoundsRecord[], bounds: PlanBounds) {
  return records.map((record) => {
    const d = (record.loops ?? []).filter((loop) => loop.length >= 3)
      .map((loop) => path(loop.map(xy), bounds)).join(" ");
    return `<path data-revit-element-id="${record.elementId}" d="${d}"/>`;
  }).join("");
}

function wallLayer(records: readonly ElementBoundsRecord[], bounds: PlanBounds) {
  return records.map((record) => {
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    const polygons = solids.map((solid) => `<path d="${path(wallPolygon(solid), bounds)}"/>`).join("");
    const arcs = (record.arcs ?? []).map((arc) =>
      `<path class="arc-body" d="${path(arcPoints(arc), bounds, false)}" stroke-width="${Math.max(arc.thickness, 0.12)}"/><path class="arc-centreline" d="${path(arcPoints(arc), bounds, false)}"/>`,
    ).join("");
    if (polygons || arcs) return `<g data-revit-element-id="${record.elementId}">${polygons}${arcs}</g>`;
    return `<path data-revit-element-id="${record.elementId}" d="${path(distinctPlanPoints(record), bounds)}"/>`;
  }).join("");
}

function exposedWallEndLayer(ends: readonly ExposedWallEnd[], bounds: PlanBounds) {
  return ends.map((item) => {
    const outward: Point2 = [-item.inward[0], -item.inward[1]];
    const normal: Point2 = [-item.inward[1], item.inward[0]];
    const halfCap = Math.max(0.45, item.thickness * 0.85);
    const stem = Math.max(0.35, item.thickness * 0.6);
    const left: Point2 = [item.point[0] - normal[0] * halfCap, item.point[1] - normal[1] * halfCap];
    const right: Point2 = [item.point[0] + normal[0] * halfCap, item.point[1] + normal[1] * halfCap];
    const tip: Point2 = [item.point[0] + outward[0] * stem, item.point[1] + outward[1] * stem];
    const [leftX, leftY] = renderPoint(left, bounds);
    const [rightX, rightY] = renderPoint(right, bounds);
    const [pointX, pointY] = renderPoint(item.point, bounds);
    const [tipX, tipY] = renderPoint(tip, bounds);
    return `<path class="confirmed-open-end" data-revit-element-ids="${item.elementIds.join(",")}" data-wall-end="${item.end}" d="M ${leftX} ${leftY} L ${rightX} ${rightY} M ${pointX} ${pointY} L ${tipX} ${tipY}"/>`;
  }).join("");
}

function openingLayer(records: readonly ElementBoundsRecord[], bounds: PlanBounds, kind: "door" | "window") {
  return records.map((record) => {
    const points = distinctPlanPoints(record); const frame = principalFrame(points);
    const opening = `<path class="opening" d="${path(points, bounds)}"/>`;
    if (kind === "window") {
      const offset = Math.max(0.06, frame.halfDepth * 0.35);
      const line = (side: number) => path([
        [frame.center[0] - frame.u[0] * frame.halfWidth + frame.v[0] * offset * side, frame.center[1] - frame.u[1] * frame.halfWidth + frame.v[1] * offset * side],
        [frame.center[0] + frame.u[0] * frame.halfWidth + frame.v[0] * offset * side, frame.center[1] + frame.u[1] * frame.halfWidth + frame.v[1] * offset * side],
      ], bounds, false);
      return `<g data-revit-element-id="${record.elementId}">${opening}<path d="${line(-1)}"/><path d="${line(1)}"/></g>`;
    }
    const width = Math.max(0.2, frame.halfWidth * 2);
    const pivot: Point2 = [frame.center[0] - frame.u[0] * frame.halfWidth, frame.center[1] - frame.u[1] * frame.halfWidth];
    const closed: Point2 = [frame.center[0] + frame.u[0] * frame.halfWidth, frame.center[1] + frame.u[1] * frame.halfWidth];
    const opened: Point2 = [pivot[0] + frame.v[0] * width, pivot[1] + frame.v[1] * width];
    const [pivotX, pivotY] = renderPoint(pivot, bounds); const [closedX, closedY] = renderPoint(closed, bounds);
    const [openX, openY] = renderPoint(opened, bounds);
    return `<g data-revit-element-id="${record.elementId}">${opening}<path class="leaf" d="M ${pivotX} ${pivotY} L ${openX} ${openY}"/><path class="swing" d="M ${closedX} ${closedY} A ${width} ${width} 0 0 0 ${openX} ${openY}"/></g>`;
  }).join("");
}

/**
 * Standard stair plan convention: a line up the centre of the run whose
 * arrowhead points in the direction of ascent, labelled UP at the low end.
 * Drawn only when enough treads survive to make the direction trustworthy.
 */
function runDirectionArrow(treads: readonly (readonly Point3[])[], bounds: PlanBounds) {
  if (treads.length < 3) return "";
  const centroid = (tread: readonly Point3[]): [Point2, number] => [[
    tread.reduce((sum, point) => sum + point[0], 0) / tread.length,
    tread.reduce((sum, point) => sum + point[1], 0) / tread.length,
  ], tread.reduce((sum, point) => sum + point[2], 0) / tread.length];
  const ordered = treads.map(centroid).sort((a, b) => a[1] - b[1]);
  const from = ordered[0]![0]; const to = ordered.at(-1)![0];
  const runLength = distanceBetween(from, to);
  if (runLength < 2) return "";
  const [fromX, fromY] = renderPoint(from, bounds);
  const [toX, toY] = renderPoint(to, bounds);
  const unitX = (toX - fromX) / runLength; const unitY = (toY - fromY) / runLength;
  const barb = Math.min(1.3, runLength * 0.22);
  const leftX = toX - unitX * barb - unitY * barb * 0.55;
  const leftY = toY - unitY * barb + unitX * barb * 0.55;
  const rightX = toX - unitX * barb + unitY * barb * 0.55;
  const rightY = toY - unitY * barb - unitX * barb * 0.55;
  const labelX = fromX - unitX * barb; const labelY = fromY - unitY * barb;
  return `<path class="run-direction" d="M ${fromX} ${fromY} L ${toX} ${toY}"/>` +
    `<path class="run-direction-head" d="M ${toX} ${toY} L ${leftX} ${leftY} L ${rightX} ${rightY} Z"/>` +
    `<text class="run-direction-label" x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="central">UP</text>`;
}

function stairLayer(records: readonly ElementBoundsRecord[], bounds: PlanBounds, low: number, high: number) {
  return records.map((record) => {
    const points = distinctPlanPoints(record);
    if (record.categoryName === "Stairs Landings") {
      return `<path class="landing" data-revit-element-id="${record.elementId}" d="${path(points, bounds)}"/>`;
    }
    const treads = (record.stairTreads ?? []).filter((tread) => treadIsInBand(tread, low, high));
    if (treads.length) {
      const risers = new Map<string, [Point3, Point3]>();
      for (const tread of treads) {
        const start = tread[1]; const end = tread[2];
        const a = `${start[0].toFixed(4)},${start[1].toFixed(4)}`;
        const b = `${end[0].toFixed(4)},${end[1].toFixed(4)}`;
        risers.set(a < b ? `${a}|${b}` : `${b}|${a}`, [start, end]);
      }
      return `<g data-revit-element-id="${record.elementId}" data-recovered-tread-fragments="${treads.length}" data-plan-risers="${risers.size}">${treads.map((tread) => {
      const treadPath = path(tread.map(xy), bounds);
      return `<path class="tread-surface" d="${treadPath}"/>`;
    }).join("")}${[...risers.values()].map(([start, end]) => `<path class="riser" d="${path([xy(start), xy(end)], bounds, false)}"/>`).join("")}${runDirectionArrow(treads, bounds)}</g>`;
    }
    return "";
  }).join("");
}

/**
 * Sheet furniture: a north needle (red half points to project north, rotating
 * with the view) and a graphic scale bar that stays truthful under any screen
 * zoom, both drawn outside the rotated plan content.
 */
function planAnnotationLayer(
  width: number,
  height: number,
  scale: number,
  rotationQuarterTurns: number,
  footer: number,
) {
  const margin = Math.max(2, scale * 0.02);
  const roundLengths = [5, 10, 20, 25, 50, 100, 200, 500];
  const target = scale * 0.16;
  const barFeet = roundLengths.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best, roundLengths[0]!);
  const segment = barFeet / 4;
  const barHeight = Math.max(0.7, scale * 0.007);
  const barY = height + footer * 0.62;
  const segments = Array.from({ length: 4 }, (_, index) =>
    `<rect x="${margin + segment * index}" y="${barY}" width="${segment}" height="${barHeight}" fill="${index % 2 ? "#fffdf7" : "#111827"}"/>`).join("");
  const barLabels = `<text x="${margin}" y="${barY - barHeight * 0.9}" text-anchor="start">0</text>` +
    `<text x="${margin + barFeet}" y="${barY - barHeight * 0.9}" text-anchor="end">${barFeet}′</text>`;

  const radius = Math.min(Math.max(1.6, scale * 0.015), footer * 0.38);
  const northX = width - margin - radius; const northY = height + footer * 0.5;
  const angle = rotationQuarterTurns * Math.PI / 2;
  const letterX = northX + Math.sin(angle) * radius * 1.8;
  const letterY = northY - Math.cos(angle) * radius * 1.8;
  const needle = `<g class="north"><g transform="translate(${northX} ${northY}) rotate(${rotationQuarterTurns * 90})">` +
    `<circle r="${radius}"/>` +
    `<path d="M 0 ${-radius * 0.85} L ${radius * 0.34} ${radius * 0.4} L 0 ${radius * 0.14} L ${-radius * 0.34} ${radius * 0.4} Z" fill="#b91c1c"/>` +
    `</g><text x="${letterX}" y="${letterY}" text-anchor="middle" dominant-baseline="central">N</text></g>`;
  return `<g class="plan-annotations" aria-hidden="true"><g class="scale-bar">${segments}${barLabels}</g>${needle}</g>`;
}

function roomLayer(rooms: DerivedRoomResult | null, bounds: PlanBounds, scale: number) {
  if (!rooms) return "";
  const paths = rooms.rooms.map((room) => `<path class="${room.closure}" data-derived-floor-region-id="${room.id}" data-derived-room-key="${room.key}" d="${room.loops.map((loop) => path(loop, bounds)).join(" ")}"/>`).join("");
  const labels = [...rooms.rooms].sort((a, b) => b.areaSquareFeet - a.areaSquareFeet).slice(0, 60)
    .map((room) => { const [x, y] = renderPoint(room.centroid, bounds); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">F${room.id}</text>`; }).join("");
  return `<g class="rooms" fill-rule="evenodd">${paths}</g><g class="room-labels" font-size="${scale / 170}">${labels}</g>`;
}

/** Compose a readable architectural plan without inventing Revit Rooms or annotations. */
export function makeArchitecturalFloorSvg(
  result: ConvertResult,
  levelId: number,
  options: ArchitecturalPlanSvgOptions = {},
): string {
  const plan = recordsForPlan(result, levelId, options.connectedLevelIds);
  const rotation = ((Math.round(options.rotationQuarterTurns ?? 0) % 4) + 4) % 4;
  const derivedRooms = options.derivedRooms === true
    ? cachedDerivedRoomsForLevel(result, levelId)
    : options.derivedRooms || null;
  const planKey = `${levelId}:${plan.levelPlans.map((part) => part.levelId).join(",")}`;
  let levelCache = svgCache.get(result); if (!levelCache) { levelCache = new Map(); svgCache.set(result, levelCache); }
  let rotations = levelCache.get(planKey); if (!rotations) { rotations = new Map(); levelCache.set(planKey, rotations); }
  let variants = rotations.get(rotation); if (!variants) { variants = new WeakMap(); rotations.set(rotation, variants); }
  const cacheKey = derivedRooms ?? NO_DERIVED_REGIONS; const cached = variants.get(cacheKey); if (cached) return cached;

  const padding = 2.5;
  const renderedBounds = boundsIncludingDoorSwings(plan.bounds, plan.doorRecords);
  const bounds = { minX: renderedBounds.minX - padding, minY: renderedBounds.minY - padding, maxX: renderedBounds.maxX + padding, maxY: renderedBounds.maxY + padding };
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX); const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const width = rotation % 2 ? sourceHeight : sourceWidth; const height = rotation % 2 ? sourceWidth : sourceHeight;
  const contentTransform = rotation === 1 ? `translate(${sourceHeight} 0) rotate(90)`
    : rotation === 2 ? `translate(${sourceWidth} ${sourceHeight}) rotate(180)`
      : rotation === 3 ? `translate(0 ${sourceWidth}) rotate(270)` : "";
  // Architectural line-weight hierarchy (ISO 128-style tiers, expressed in
  // screen pixels under non-scaling strokes): cut elements read heaviest,
  // drawn symbols medium, projections light. The cut-wall poché itself does
  // the tonal work, so strokes stay restrained even on a fitted campus plan.
  const scale = Math.max(sourceWidth, sourceHeight); const fineStroke = Math.max(0.025, scale / 4_200);
  const cutStroke = 1.35; const projectionStroke = 0.8;
  // Symbol linework (door leaves, swings, glazing, risers) scales with the
  // drawing like ink on paper, so a fitted campus plan stays quiet and a
  // zoomed room shows proper symbol weight. Cut structure stays pixel-crisp.
  const leafPen = Math.max(0.12, fineStroke * 2.2);
  const symbolPen = Math.max(0.08, fineStroke * 1.5);
  const swingDash = `${fineStroke * 5} ${fineStroke * 3.5}`;
  const connected = plan.levelPlans.length > 1;
  const openEnds = exposedWallEnds(plan.wallRecords, plan.floorRecords);
  const floorFills = ["#f6f3eb", "#edf2ed", "#f2eee5", "#eaf0f2"];
  const floorGroups = plan.levelPlans.map((part, index) =>
    `<g class="floors" data-source-revit-level-id="${part.levelId}" data-source-elevation-feet="${part.elevation}" style="--floor-fill:${floorFills[index % floorFills.length]}">${floorLayer(part.floorRecords, bounds)}</g>`,
  ).join("");
  const stairGroups = plan.levelPlans.map((part) =>
    `<g data-source-revit-level-id="${part.levelId}">${stairLayer(part.stairRecords, bounds, part.elevation, part.nextElevation)}</g>`,
  ).join("");
  // A footer band below the drawing keeps sheet furniture (scale bar, north
  // needle) clear of plan geometry that reaches the drawing edge.
  const footer = Math.max(4, scale * 0.05);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + footer}" role="img" aria-labelledby="architectural-plan-title architectural-plan-desc" data-plan-min-x-feet="${bounds.minX}" data-plan-min-y-feet="${bounds.minY}" data-plan-max-x-feet="${bounds.maxX}" data-plan-max-y-feet="${bounds.maxY}" data-plan-footer-feet="${footer}" data-revit-level-id="${levelId}" data-revit-level-ids="${plan.levelPlans.map((part) => part.levelId).join(",")}" data-connected-level-count="${plan.levelPlans.length}" data-view-rotation-degrees="${rotation * 90}" data-plan-cut-elevation-feet="${plan.cutElevation}" data-floor-count="${plan.floors}" data-wall-count="${plan.walls}" data-door-count="${plan.doors}" data-window-count="${plan.windows}" data-stair-count="${plan.stairs}" data-confirmed-open-end-count="${openEnds.length}">
  <title id="architectural-plan-title">${connected ? "Connected split-level architectural plan" : `Architectural floor map for Revit level ${levelId}`}</title>
  <desc id="architectural-plan-desc">Recovered floor outlines, walls, doors, windows, stairs and columns ${connected ? `across ${plan.levelPlans.length} adjoining elevations from ${plan.levelPlans[0]!.elevation.toFixed(3)} to ${plan.levelPlans.at(-1)!.elevation.toFixed(3)} feet` : `at ${plan.elevation.toFixed(3)} feet`}. T-shaped open-end marks identify long wall endpoints with no adjoining wall or nearby recovered floor. Door swings and uncategorized fallback footprints are approximate.</desc>
  <style>
    .floors{fill:var(--floor-fill,#f6f3eb);stroke:#9aa4a6;stroke-width:${projectionStroke};vector-effect:non-scaling-stroke}
    .rooms{fill:#e7c89c;fill-opacity:.34;stroke:#c18a49;stroke-width:${projectionStroke};vector-effect:non-scaling-stroke}
    .rooms .near-closed{fill:#f3b36f;fill-opacity:.22;stroke:#d9823b;stroke-dasharray:${fineStroke * 5} ${fineStroke * 3}}
    .room-labels{fill:#875623;font:700 ${scale / 170}px system-ui,sans-serif;pointer-events:none;paint-order:stroke;stroke:#fffdf7;stroke-width:${scale / 850}}
    .walls{fill:#1f2937;fill-opacity:.94;stroke:#111827;stroke-width:${cutStroke};stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .walls path{vector-effect:non-scaling-stroke}
    .walls .arc-body{fill:none;stroke:#1f2937;stroke-opacity:.94;vector-effect:none}
    .walls .arc-centreline{fill:none;stroke:#111827;stroke-width:${cutStroke * 0.7};vector-effect:non-scaling-stroke}
    .open-edges{fill:none;stroke:#8b6f52;stroke-width:${symbolPen};stroke-linecap:round;opacity:.82;pointer-events:none}
    .columns{fill:#374151;stroke:#111827;stroke-width:${cutStroke * 0.9};vector-effect:non-scaling-stroke}
    .doors .opening,.windows .opening{fill:#fffdf7;stroke:#fffdf7;stroke-width:${cutStroke * 1.3};vector-effect:non-scaling-stroke}
    .doors .leaf{fill:none;stroke:#374151;stroke-width:${leafPen};stroke-linecap:round}
    .doors .swing{fill:none;stroke:#64748b;stroke-width:${symbolPen};stroke-dasharray:${swingDash};stroke-linecap:round}
    .windows path:not(.opening){fill:none;stroke:#334155;stroke-width:${symbolPen}}
    .stairs{fill:none;stroke:#1f2937;stroke-width:${symbolPen}}
    .stairs .tread-surface{fill:#f8fafc;stroke:none}.stairs .riser{stroke-width:${symbolPen}}
    .stairs .landing{fill:#f1f5f9;stroke:#1f2937;stroke-width:${symbolPen}}
    .stairs .run-direction{fill:none;stroke:#111827;stroke-width:${leafPen};stroke-linecap:round}
    .stairs .run-direction-head{fill:#111827;stroke:none}
    .stairs .run-direction-label{fill:#111827;font:600 ${Math.max(2, scale / 240)}px system-ui,sans-serif;paint-order:stroke;stroke:#fffdf7;stroke-width:${Math.max(0.5, scale / 1_100)};pointer-events:none}
    .plan-annotations{pointer-events:none}
    .plan-annotations text{fill:#111827;font:600 ${Math.max(2, scale / 220)}px system-ui,sans-serif;paint-order:stroke;stroke:#fffdf7;stroke-width:${Math.max(0.5, scale / 1_000)}}
    .plan-annotations .scale-bar rect{stroke:#111827;stroke-width:${projectionStroke};vector-effect:non-scaling-stroke}
    .plan-annotations .north circle{fill:#fffdf7;stroke:#111827;stroke-width:${projectionStroke};vector-effect:non-scaling-stroke}
    .plan-annotations .north path{stroke:#111827;stroke-width:${projectionStroke};stroke-linejoin:round;vector-effect:non-scaling-stroke}
  </style>
  <rect width="100%" height="100%" fill="#fffdf7"/>
  <g${contentTransform ? ` transform="${contentTransform}"` : ""}>
  <g fill-rule="evenodd">${floorGroups}</g>
  ${roomLayer(derivedRooms, bounds, scale)}
  <g class="walls">${wallLayer(plan.wallRecords, bounds)}</g>
  <g class="open-edges" data-confirmed-open-end-count="${openEnds.length}">${exposedWallEndLayer(openEnds, bounds)}</g>
  <g class="columns">${plan.columnRecords.map((record) => `<path data-revit-element-id="${record.elementId}" d="${path(distinctPlanPoints(record), bounds)}"/>`).join("")}</g>
  <g class="windows">${openingLayer(plan.windowRecords, bounds, "window")}</g>
  <g class="doors">${openingLayer(plan.doorRecords, bounds, "door")}</g>
  <g class="stairs">${stairGroups}</g>
  </g>
  ${planAnnotationLayer(width, height, scale, rotation, footer)}
</svg>`;
  variants.set(cacheKey, svg); return svg;
}
