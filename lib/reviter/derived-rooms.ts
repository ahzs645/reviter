/** Approximate floor regions inferred from native slabs and recovered vertical barriers. */
import type { ConvertResult, ElementBoundsRecord, WallArc, WallSolid } from "./types.ts";

const REVIT_FLOORS_CATEGORY_ID = -2_000_032;
const BARRIER_CATEGORY_IDS = new Set([-2_000_011, -2_000_170, -2_000_171]);
const MIN_CELL_SIZE_FEET = 0.35;
const MAX_CELL_SIZE_FEET = 1;
const MAX_GRID_CELLS = 750_000;
const DEFAULT_MIN_REGION_AREA_SQUARE_FEET = 25;
const PLAN_CUT_HEIGHT_FEET = 4;

type Point2 = [number, number];
type Segment2 = { start: Point2; end: Point2; thickness: number };

export type DerivedRoom = {
  id: number;
  areaSquareFeet: number;
  /** A label point guaranteed to be within the raster region. */
  centroid: Point2;
  /** Simplified grid-derived boundary loops in world-space Revit feet. */
  loops: Point2[][];
};

export type DerivedRoomResult = {
  levelId: number;
  approximate: true;
  source: "vertical-barrier-grid";
  cellSizeFeet: number;
  planCutElevationFeet: number;
  barrierElementCount: number;
  /** @deprecated Kept for compatibility with earlier exports. */
  wallElementCount: number;
  rooms: DerivedRoom[];
};

export type DerivedRoomOptions = {
  minRoomAreaSquareFeet?: number;
};

const resultCache = new WeakMap<ConvertResult, Map<string, DerivedRoomResult>>();

function levelMembers(result: ConvertResult, levelId: number): Set<number> {
  return new Set((result.nativeAssociatedLevelRelations ?? [])
    .filter((relation) => relation.levelId === levelId)
    .map((relation) => relation.elementId));
}

function floorRecords(result: ConvertResult, members: ReadonlySet<number>) {
  return result.elementBounds.filter((record) =>
    members.has(record.elementId) &&
    record.categoryId === REVIT_FLOORS_CATEGORY_ID &&
    record.loops?.some((loop) => loop.length >= 3));
}

function pointInLoop(x: number, y: number, loop: readonly [number, number, number][]) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const a = loop[index]!;
    const b = loop[previous]!;
    if ((a[1] > y) !== (b[1] > y) &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pointInFloor(x: number, y: number, records: readonly ElementBoundsRecord[]) {
  return records.some((record) => {
    let inside = false;
    for (const loop of record.loops ?? []) {
      if (loop.length >= 3 && pointInLoop(x, y, loop)) inside = !inside;
    }
    return inside;
  });
}

function floorBounds(records: readonly ElementBoundsRecord[]) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const record of records) for (const loop of record.loops ?? []) for (const [x, y] of loop) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function distanceToSegment(x: number, y: number, start: Point2, end: Point2) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start[0], y - start[1]);
  const t = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared));
  return Math.hypot(x - (start[0] + t * dx), y - (start[1] + t * dy));
}

function solidSegment(solid: WallSolid): Segment2 {
  return { start: [solid.start.x, solid.start.y], end: [solid.end.x, solid.end.y], thickness: solid.thickness };
}

function arcSegments(arc: WallArc, cellSize: number): Segment2[] {
  const sweep = arc.endAngle - arc.startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep * arc.radius) / Math.max(cellSize, 0.25)));
  const points: Point2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = arc.startAngle + (sweep * step) / steps;
    points.push([
      arc.centre.x + arc.radius * (Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x),
      arc.centre.y + arc.radius * (Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y),
    ]);
  }
  return points.slice(1).map((point, index) => ({ start: points[index]!, end: point, thickness: arc.thickness }));
}

function nativeSegments(record: ElementBoundsRecord, cellSize: number): Segment2[] {
  const segments: Segment2[] = [];
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  for (const solid of solids) segments.push(solidSegment(solid));
  for (const arc of record.arcs ?? []) segments.push(...arcSegments(arc, cellSize));
  return segments;
}

/** Principal-axis fallback preserves diagonal placed walls/panels instead of snapping them to XY. */
function fallbackSegment(record: ElementBoundsRecord): Segment2 | null {
  const corners: Point2[] = record.orientedBox?.map(([x, y]) => [x, y]) ?? [];
  if (corners.length >= 3) {
    const cx = corners.reduce((sum, point) => sum + point[0], 0) / corners.length;
    const cy = corners.reduce((sum, point) => sum + point[1], 0) / corners.length;
    let xx = 0; let xy = 0; let yy = 0;
    for (const [x, y] of corners) { const dx = x - cx; const dy = y - cy; xx += dx * dx; xy += dx * dy; yy += dy * dy; }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const ux = Math.cos(angle); const uy = Math.sin(angle); const vx = -uy; const vy = ux;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, y] of corners) { const dx = x - cx; const dy = y - cy; const u = dx * ux + dy * uy; const v = dx * vx + dy * vy; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const length = maxU - minU; const thickness = maxV - minV;
    if (length >= 0.5 && thickness <= 5 && length / Math.max(thickness, 0.01) >= 1.5) return {
      start: [cx + minU * ux, cy + minU * uy], end: [cx + maxU * ux, cy + maxU * uy], thickness: Math.max(thickness, 0.2),
    };
  }
  const { min, max } = record.boundsFeet;
  const width = max.x - min.x; const height = max.y - min.y;
  const narrow = Math.min(width, height); const long = Math.max(width, height);
  if (narrow > 4 || long < 0.5 || long / Math.max(narrow, 0.01) < 2) return null;
  return width >= height
    ? { start: [min.x, (min.y + max.y) / 2], end: [max.x, (min.y + max.y) / 2], thickness: Math.max(narrow, 0.2) }
    : { start: [(min.x + max.x) / 2, min.y], end: [(min.x + max.x) / 2, max.y], thickness: Math.max(narrow, 0.2) };
}

function intersectsCut(record: ElementBoundsRecord, elevation: number) {
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  const arcs = record.arcs ?? [];
  if (solids.length || arcs.length) return [...solids, ...arcs].some(
    (shape) => shape.baseElevation - 0.1 <= elevation && shape.topElevation + 0.1 >= elevation,
  );
  return record.boundsFeet.min.z - 0.1 <= elevation && record.boundsFeet.max.z + 0.1 >= elevation;
}

function simplifyLoop(loop: Point2[], tolerance: number) {
  if (loop.length < 4) return loop;
  const simplified: Point2[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index + loop.length - 1) % loop.length]!;
    const point = loop[index]!;
    const next = loop[(index + 1) % loop.length]!;
    if ((previous[0] === point[0] && point[0] === next[0]) ||
      (previous[1] === point[1] && point[1] === next[1])) continue;
    simplified.push(point);
  }
  if (simplified.length < 5) return simplified;
  const closed = [...simplified, simplified[0]!];
  const keep = new Uint8Array(closed.length); keep[0] = 1; keep[closed.length - 1] = 1;
  const ranges: Array<[number, number]> = [[0, closed.length - 1]];
  while (ranges.length) {
    const [from, to] = ranges.pop()!; let farthest = -1; let distance = tolerance;
    for (let index = from + 1; index < to; index += 1) {
      const candidate = distanceToSegment(closed[index]![0], closed[index]![1], closed[from]!, closed[to]!);
      if (candidate > distance) { distance = candidate; farthest = index; }
    }
    if (farthest >= 0) { keep[farthest] = 1; ranges.push([from, farthest], [farthest, to]); }
  }
  return closed.filter((_, index) => keep[index] && index < closed.length - 1);
}

function traceLoops(cells: readonly number[], columns: number, cellSize: number, minX: number, minY: number) {
  const member = new Set(cells); const outgoing = new Map<string, Point2[]>();
  const add = (start: Point2, end: Point2) => { const key = `${start[0]},${start[1]}`; const ends = outgoing.get(key) ?? []; ends.push(end); outgoing.set(key, ends); };
  for (const cell of cells) {
    const x = cell % columns; const y = Math.floor(cell / columns);
    if (!member.has(cell - columns)) add([x, y], [x + 1, y]);
    if (x === columns - 1 || !member.has(cell + 1)) add([x + 1, y], [x + 1, y + 1]);
    if (!member.has(cell + columns)) add([x + 1, y + 1], [x, y + 1]);
    if (x === 0 || !member.has(cell - 1)) add([x, y + 1], [x, y]);
  }
  const loops: Point2[][] = [];
  while (outgoing.size) {
    const [firstKey, firstEnds] = outgoing.entries().next().value as [string, Point2[]];
    const start = firstKey.split(",").map(Number) as Point2; const loop: Point2[] = [start];
    let cursor = firstEnds.pop()!; if (!firstEnds.length) outgoing.delete(firstKey); let guard = 0;
    while ((cursor[0] !== start[0] || cursor[1] !== start[1]) && guard < cells.length * 8) {
      loop.push(cursor); const key = `${cursor[0]},${cursor[1]}`; const ends = outgoing.get(key); if (!ends?.length) break;
      cursor = ends.pop()!; if (!ends.length) outgoing.delete(key); guard += 1;
    }
    if (cursor[0] === start[0] && cursor[1] === start[1] && loop.length >= 4) loops.push(simplifyLoop(loop, 0.7).map(([x, y]) => [minX + x * cellSize, minY + y * cellSize]));
  }
  return loops;
}

function emptyResult(levelId: number, cut: number): DerivedRoomResult {
  return { levelId, approximate: true, source: "vertical-barrier-grid", cellSizeFeet: MIN_CELL_SIZE_FEET, planCutElevationFeet: cut, barrierElementCount: 0, wallElementCount: 0, rooms: [] };
}

/**
 * Infer floor regions closed by recovered walls/curtain boundaries. The slab
 * perimeter is deliberately not a barrier: an un-walled slab produces zero
 * regions instead of being misreported as a room.
 */
export function deriveRoomsForLevel(result: ConvertResult, levelId: number, options: DerivedRoomOptions = {}): DerivedRoomResult {
  const level = result.levels.find((candidate) => candidate.levelId === levelId);
  const cut = (level?.elevation ?? 0) + PLAN_CUT_HEIGHT_FEET;
  const members = levelMembers(result, levelId); const floors = floorRecords(result, members);
  if (!floors.length) return emptyResult(levelId, cut);
  const barriers = result.elementBounds.filter((record) => BARRIER_CATEGORY_IDS.has(record.categoryId ?? 0) && intersectsCut(record, cut));
  const bounds = floorBounds(floors); const width = Math.max(MIN_CELL_SIZE_FEET, bounds.maxX - bounds.minX); const height = Math.max(MIN_CELL_SIZE_FEET, bounds.maxY - bounds.minY);
  let cellSize = Math.min(MAX_CELL_SIZE_FEET, Math.max(MIN_CELL_SIZE_FEET, Math.max(width, height) / 900));
  let padding = cellSize * 3; let minX = bounds.minX - padding; let minY = bounds.minY - padding; let columns = Math.ceil((width + padding * 2) / cellSize); let rows = Math.ceil((height + padding * 2) / cellSize);
  if (columns * rows > MAX_GRID_CELLS) { cellSize = Math.min(MAX_CELL_SIZE_FEET, Math.sqrt(((width + 6) * (height + 6)) / MAX_GRID_CELLS)); padding = cellSize * 3; minX = bounds.minX - padding; minY = bounds.minY - padding; columns = Math.ceil((width + padding * 2) / cellSize); rows = Math.ceil((height + padding * 2) / cellSize); }
  const inside = new Uint8Array(columns * rows); const blocked = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { const x = minX + (column + 0.5) * cellSize; const y = minY + (row + 0.5) * cellSize; if (pointInFloor(x, y, floors)) inside[row * columns + column] = 1; }
  const mark = ({ start, end, thickness }: Segment2) => {
    const radius = Math.max(thickness / 2, cellSize * 0.28);
    const c0 = Math.max(0, Math.floor((Math.min(start[0], end[0]) - radius - minX) / cellSize)); const c1 = Math.min(columns - 1, Math.floor((Math.max(start[0], end[0]) + radius - minX) / cellSize));
    const r0 = Math.max(0, Math.floor((Math.min(start[1], end[1]) - radius - minY) / cellSize)); const r1 = Math.min(rows - 1, Math.floor((Math.max(start[1], end[1]) + radius - minY) / cellSize));
    for (let row = r0; row <= r1; row += 1) for (let column = c0; column <= c1; column += 1) { const x = minX + (column + 0.5) * cellSize; const y = minY + (row + 0.5) * cellSize; if (distanceToSegment(x, y, start, end) <= radius) blocked[row * columns + column] = 1; }
  };
  for (const barrier of barriers) {
    const exact = nativeSegments(barrier, cellSize); for (const segment of exact) mark(segment);
    const fallback = fallbackSegment(barrier);
    if (fallback) { const fallbackLength = Math.hypot(fallback.end[0] - fallback.start[0], fallback.end[1] - fallback.start[1]); const exactSpan = exact.reduce((longest, segment) => Math.max(longest, Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1])), 0); if (!exact.length || exactSpan < fallbackLength * 0.7) mark(fallback); }
  }
  // Flood the padded exterior through every non-barrier cell. Only components
  // not reached from that exterior can be classified as enclosed floor regions.
  const exterior = new Uint8Array(columns * rows); const queue: number[] = [];
  const seed = (index: number) => { if (!blocked[index] && !exterior[index]) { exterior[index] = 1; queue.push(index); } };
  for (let column = 0; column < columns; column += 1) { seed(column); seed((rows - 1) * columns + column); }
  for (let row = 1; row < rows - 1; row += 1) { seed(row * columns); seed(row * columns + columns - 1); }
  for (let cursor = 0; cursor < queue.length; cursor += 1) { const cell = queue[cursor]!; const column = cell % columns; const row = Math.floor(cell / columns); const neighbours = [row ? cell - columns : -1, column < columns - 1 ? cell + 1 : -1, row < rows - 1 ? cell + columns : -1, column ? cell - 1 : -1]; for (const neighbour of neighbours) if (neighbour >= 0 && !blocked[neighbour] && !exterior[neighbour]) { exterior[neighbour] = 1; queue.push(neighbour); } }
  const visited = new Uint8Array(columns * rows); const minimumArea = options.minRoomAreaSquareFeet ?? DEFAULT_MIN_REGION_AREA_SQUARE_FEET; const candidates: Array<{ cells: number[]; centroid: Point2; areaSquareFeet: number }> = [];
  for (let seedIndex = 0; seedIndex < inside.length; seedIndex += 1) {
    if (!inside[seedIndex] || blocked[seedIndex] || exterior[seedIndex] || visited[seedIndex]) continue;
    const component = [seedIndex]; const cells: number[] = []; visited[seedIndex] = 1; let sumX = 0; let sumY = 0;
    for (let cursor = 0; cursor < component.length; cursor += 1) { const cell = component[cursor]!; const column = cell % columns; const row = Math.floor(cell / columns); if (inside[cell]) { cells.push(cell); sumX += minX + (column + 0.5) * cellSize; sumY += minY + (row + 0.5) * cellSize; } const neighbours = [row ? cell - columns : -1, column < columns - 1 ? cell + 1 : -1, row < rows - 1 ? cell + columns : -1, column ? cell - 1 : -1]; for (const neighbour of neighbours) if (neighbour >= 0 && !blocked[neighbour] && !exterior[neighbour] && !visited[neighbour]) { visited[neighbour] = 1; component.push(neighbour); } }
    const areaSquareFeet = cells.length * cellSize * cellSize; if (areaSquareFeet < minimumArea) continue;
    const mean: Point2 = [sumX / cells.length, sumY / cells.length]; let labelCell = cells[0]!; let labelDistance = Infinity;
    for (const cell of cells) { const column = cell % columns; const row = Math.floor(cell / columns); const x = minX + (column + 0.5) * cellSize; const y = minY + (row + 0.5) * cellSize; const distance = (x - mean[0]) ** 2 + (y - mean[1]) ** 2; if (distance < labelDistance) { labelDistance = distance; labelCell = cell; } }
    candidates.push({ cells, centroid: [minX + (labelCell % columns + 0.5) * cellSize, minY + (Math.floor(labelCell / columns) + 0.5) * cellSize], areaSquareFeet });
  }
  candidates.sort((left, right) => right.centroid[1] - left.centroid[1] || left.centroid[0] - right.centroid[0]);
  return { levelId, approximate: true, source: "vertical-barrier-grid", cellSizeFeet: cellSize, planCutElevationFeet: cut, barrierElementCount: barriers.length, wallElementCount: barriers.length, rooms: candidates.map((candidate, index) => ({ id: index + 1, areaSquareFeet: candidate.areaSquareFeet, centroid: candidate.centroid, loops: traceLoops(candidate.cells, columns, cellSize, minX, minY) })).filter((room) => room.loops.length) };
}

/** Cache immutable conversion results per level so Report and map share one analysis. */
export function cachedDerivedRoomsForLevel(result: ConvertResult, levelId: number, options: DerivedRoomOptions = {}) {
  const key = `${levelId}:${options.minRoomAreaSquareFeet ?? DEFAULT_MIN_REGION_AREA_SQUARE_FEET}`;
  let cache = resultCache.get(result); if (!cache) { cache = new Map(); resultCache.set(result, cache); }
  const cached = cache.get(key); if (cached) return cached;
  const derived = deriveRoomsForLevel(result, levelId, options); cache.set(key, derived); return derived;
}
