/**
 * Room regions for DWG room labels, on one Revit level.
 *
 * The UNBC model has no native Rooms, but a registered survey DWG puts a room
 * number (and usually a name) in the middle of almost every room. This module
 * turns those label points into room boundaries: it rasterises everything that
 * separates one room from the next, then floods outwards from every label at
 * once, so that each label claims the floor it reaches first.
 *
 * ## Barriers
 *
 * Three kinds, all in Revit model feet on one plan (the caller decides which
 * elements cut the level):
 *
 * - `wall`: RVT wall bodies (healed location line ± half thickness), curtain
 *   panels and mullions. The model's walls run straight through door
 *   openings, but some partitions stop short on purpose (an opening modelled
 *   as a gap), and curtain walls close only as well as their panels were
 *   recovered.
 * - `door`: a closure across each door's opening, so an open door does not
 *   join two rooms.
 * - `dwg`: the registered DWG's own wall linework (the drawing the labels were
 *   placed in), which fills most of the RVT's gaps. It is drawn from single
 *   lines, so it is rasterised at the minimum width that still seals a
 *   4-connected flood. Door swings, fixtures and stair treads should be
 *   removed first; {@link dwgBarrierSegments} does that.
 *
 * ## The flood
 *
 * A seeded watershed on the free-space distance transform: every cell's
 * priority is its clearance from the nearest barrier, capped at half a neck
 * width (`neckWidthFeet`, 4 ft), and the labelled regions grow through the
 * widest cells first. Floor wider than a neck is one level, flooded
 * breadth-first from every label at once, so labels sharing a corridor or an
 * open-plan area split it by distance. Narrower places — an unclosed doorway,
 * a wall gap — are crossed only after all the wide floor either side is
 * claimed, so two labels in one barrier-closed space meet at the neck that
 * joined their rooms. A label drawn against a wall first climbs the clearance
 * to open floor, so it is not starved by a neighbour that reached the room's
 * middle before it. The exterior is a competitor too: cells on the window's
 * edge, and cells outside the caller's `bound` (the level's slabs, say), start
 * as exterior, so a room that leaks outside is cut at the leak rather than
 * swallowing the site.
 *
 * ## Output
 *
 * Each room's cells are closed and opened by one cell (filling the slits a
 * drawn door leaf leaves, dropping one-cell spurs), traced into rings (outer
 * counter-clockwise, holes clockwise), simplified with Douglas–Peucker so
 * the 32°/58°/122° wings keep their angles, and returned with diagnostics saying how the region was
 * bounded: `closed` (its barrier-closed component holds no other room and no
 * exterior), how many rooms shared its component, which rooms it touches with
 * no barrier in between, and whether the RVT walls alone or the DWG linework
 * alone would have closed it (with the DWG-only region's overlap).
 *
 * Pure and deterministic. {@link roomRegions} takes plain barriers and seeds;
 * the adapters at the end ({@link levelRoomBarriers}, {@link levelFloorBound},
 * {@link dwgPrimitivesWithin}, {@link dwgBarrierSegments}) build those from a
 * `ConvertResult` and flattened DWG entities.
 */
import type { DwgBounds, DwgEntity } from "./dwg-plan.ts";
import { distanceTransform } from "./dwg-registration.ts";
import type { ConvertResult, ElementBoundsRecord, WallArc } from "./types.ts";

export type Point2 = [number, number];

export type RoomBarrierKind = "wall" | "door" | "dwg";

export type RoomBarrier = {
  start: Point2;
  end: Point2;
  /** Full thickness in feet; 0 for a drawn line. */
  thickness: number;
  kind: RoomBarrierKind;
};

/**
 * One label point. Seeds sharing a `room` are one room (a tag plus loose text
 * repeating its number elsewhere in the same room, say); distinct `room`s are
 * distinct rooms even when their numbers are equal.
 */
export type RoomSeed = {
  id: string;
  room: string;
  number: string;
  name?: string | null;
  point: Point2;
};

export type PlanBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type RoomRegionInput = {
  seeds: readonly RoomSeed[];
  barriers: readonly RoomBarrier[];
  /**
   * Polygons (outer ring then holes each, feet) covering the floor. A free
   * cell outside all of them starts as exterior. Omit to bound the flood by
   * the window's edge only.
   */
  bound?: readonly (readonly Point2[])[][] | null;
  /** The raster's extent; defaults to the seeds' and barriers' extent plus the margin. */
  window?: PlanBounds;
};

export type RoomRegionOptions = {
  /** Raster cell, feet. 0.4 ft ≈ 0.12 m. */
  cellSizeFeet?: number;
  /** Padding around the default window, feet. */
  marginFeet?: number;
  /** A seed inside a barrier moves to the nearest free cell within this, feet. */
  maxNudgeFeet?: number;
  /** Douglas–Peucker tolerance, feet; defaults to one and a half cells. */
  simplifyToleranceFeet?: number;
  /** Holes smaller than this are dropped, square feet. */
  minHoleAreaSquareFeet?: number;
  /**
   * Openings narrower than this are necks: the flood crosses them only after
   * all wider floor it can reach is claimed. Wider floor is shared out by
   * distance. Feet; 4 ft ≈ 1.2 m, wider than a single door.
   */
  neckWidthFeet?: number;
  /** Largest DWG-only region worth comparing against, square feet. */
  maxCompareAreaSquareFeet?: number;
  /** Refuse rasters with more cells than this. */
  maxCells?: number;
};

export type RoomRegionDiagnostics = {
  /** The room's barrier-closed component holds no other room and no exterior. */
  closed: boolean;
  /** Rooms (this one included) whose seeds share its barrier-closed component. */
  sharedComponent: number;
  /** The component contains exterior cells (window edge or outside the bound). */
  componentOpen: boolean;
  /** Rooms this region meets with no barrier in between: where the flood competed. */
  competedWith: string[];
  /** The region meets exterior cells with no barrier in between. */
  touchesExterior: boolean;
  /** How far the seed had to move off a barrier, feet (0 when it did not). */
  nudgedFeet: number;
  /** The seed sat outside the caller's bound, which was lifted for its component. */
  outsideBound: boolean;
  /** Disconnected pieces the region came out as (only the largest is kept). */
  pieces: number;
  /** Area of the barrier-closed component, square feet. */
  componentAreaSquareFeet: number;
  /** Would the RVT walls and door closures alone have closed this room? */
  closedByRvt: boolean;
  /** Would the DWG linework alone have closed this room? */
  closedByDwg: boolean;
  /** Intersection over union with the DWG-only region, when that is closed and not huge. */
  dwgRegionIoU: number | null;
};

export type RoomRegion = {
  room: string;
  number: string;
  name: string | null;
  seedIds: string[];
  /** Outer ring, feet, counter-clockwise, no closing repeat. */
  polygon: Point2[];
  holes: Point2[][];
  areaSquareFeet: number;
  /** The first seed's point, moved off any barrier it sat in. */
  labelPoint: Point2;
  diagnostics: RoomRegionDiagnostics;
  /** 0–1; see {@link roomConfidence}. */
  confidence: number;
};

export type RoomRegionFailure = { room: string; number: string; seedIds: string[]; reason: string };

export type RoomRegionResult = {
  cellSizeFeet: number;
  grid: { columns: number; rows: number; minX: number; minY: number };
  rooms: RoomRegion[];
  failures: RoomRegionFailure[];
  stats: {
    cells: number;
    barrierCells: number;
    exteriorCells: number;
    claimedCells: number;
    unclaimedFreeCells: number;
  };
};

const DEFAULTS = {
  cellSizeFeet: 0.4,
  marginFeet: 6,
  maxNudgeFeet: 3,
  minHoleAreaSquareFeet: 4,
  maxCompareAreaSquareFeet: 20_000,
  neckWidthFeet: 4,
  maxCells: 40_000_000,
};

/** Label codes in the flood: 0 unclaimed, 1 exterior, 2 + i room i. */
const UNCLAIMED = 0;
const EXTERIOR = 1;
const ROOM_BASE = 2;

// ─── Raster ──────────────────────────────────────────────────────────────────

type Grid = { columns: number; rows: number; minX: number; minY: number; cell: number };

function gridFor(input: RoomRegionInput, cell: number, margin: number, maxCells: number): Grid {
  let bounds = input.window;
  if (!bounds) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const add = (point: readonly [number, number]) => {
      minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    };
    for (const seed of input.seeds) add(seed.point);
    for (const barrier of input.barriers) { add(barrier.start); add(barrier.end); }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    bounds = { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
  }
  const columns = Math.max(3, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(3, Math.ceil((bounds.maxY - bounds.minY) / cell));
  if (columns * rows > maxCells) {
    throw new Error(`Room raster of ${columns} × ${rows} cells exceeds ${maxCells}; use a larger cell or a smaller window.`);
  }
  return { columns, rows, minX: bounds.minX, minY: bounds.minY, cell };
}

function distanceToSegment(x: number, y: number, start: Point2, end: Point2): number {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start[0], y - start[1]);
  const t = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared));
  return Math.hypot(x - (start[0] + t * dx), y - (start[1] + t * dy));
}

/**
 * Mark every cell whose centre is within the barrier's half thickness, never
 * less than √2/2 of a cell so a thin or diagonal line still seals a
 * 4-connected flood.
 */
function markSegment(mask: Uint8Array, grid: Grid, barrier: RoomBarrier): void {
  const { columns, rows, minX, minY, cell } = grid;
  const radius = Math.max(barrier.thickness / 2, cell * 0.71);
  const { start, end } = barrier;
  const c0 = Math.max(0, Math.floor((Math.min(start[0], end[0]) - radius - minX) / cell));
  const c1 = Math.min(columns - 1, Math.floor((Math.max(start[0], end[0]) + radius - minX) / cell));
  const r0 = Math.max(0, Math.floor((Math.min(start[1], end[1]) - radius - minY) / cell));
  const r1 = Math.min(rows - 1, Math.floor((Math.max(start[1], end[1]) + radius - minY) / cell));
  for (let row = r0; row <= r1; row += 1) {
    const y = minY + (row + 0.5) * cell;
    for (let column = c0; column <= c1; column += 1) {
      const x = minX + (column + 0.5) * cell;
      if (distanceToSegment(x, y, start, end) <= radius) mask[row * columns + column] = 1;
    }
  }
}

/** Even-odd scanline fill of one polygon (outer + holes) at cell centres. */
function fillPolygon(mask: Uint8Array, grid: Grid, rings: readonly (readonly Point2[])[]): void {
  const { columns, rows, minX, minY, cell } = grid;
  let low = Infinity; let high = -Infinity;
  for (const ring of rings) for (const point of ring) { low = Math.min(low, point[1]); high = Math.max(high, point[1]); }
  const r0 = Math.max(0, Math.floor((low - minY) / cell));
  const r1 = Math.min(rows - 1, Math.ceil((high - minY) / cell));
  const crossings: number[] = [];
  for (let row = r0; row <= r1; row += 1) {
    const y = minY + (row + 0.5) * cell;
    crossings.length = 0;
    for (const ring of rings) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const a = ring[index]!; const b = ring[previous]!;
        if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = Math.max(0, Math.ceil((crossings[index]! - minX) / cell - 0.5));
      const to = Math.min(columns - 1, Math.floor((crossings[index + 1]! - minX) / cell - 0.5));
      for (let column = from; column <= to; column += 1) mask[row * columns + column] = 1;
    }
  }
}

/** 4-connected components of free cells; returns the component id per cell (-1 on barriers). */
function components(blocked: Uint8Array, columns: number, rows: number): { id: Int32Array; count: number } {
  const id = new Int32Array(columns * rows).fill(-1);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < id.length; start += 1) {
    if (blocked[start] || id[start] !== -1) continue;
    id[start] = count;
    stack.push(start);
    while (stack.length) {
      const cellIndex = stack.pop()!;
      const column = cellIndex % columns;
      const neighbours = [
        cellIndex >= columns ? cellIndex - columns : -1,
        cellIndex < id.length - columns ? cellIndex + columns : -1,
        column > 0 ? cellIndex - 1 : -1,
        column < columns - 1 ? cellIndex + 1 : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && !blocked[next] && id[next] === -1) { id[next] = count; stack.push(next); }
      }
    }
    count += 1;
  }
  return { id, count };
}

/** Nearest free cell to `start` by breadth-first search, within `maxSteps` cells; -1 if none. */
function nearestFree(blocked: Uint8Array, columns: number, rows: number, start: number, maxSteps: number): number {
  if (!blocked[start]) return start;
  const startColumn = start % columns; const startRow = Math.floor(start / columns);
  let best = -1; let bestDistance = Infinity;
  for (let radius = 1; radius <= maxSteps; radius += 1) {
    for (let row = startRow - radius; row <= startRow + radius; row += 1) {
      if (row < 0 || row >= rows) continue;
      for (let column = startColumn - radius; column <= startColumn + radius; column += 1) {
        if (column < 0 || column >= columns) continue;
        if (Math.max(Math.abs(row - startRow), Math.abs(column - startColumn)) !== radius) continue;
        const index = row * columns + column;
        if (blocked[index]) continue;
        const distance = (row - startRow) ** 2 + (column - startColumn) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      }
    }
    // Every cell in a later ring is at least `radius + 1` away.
    if (best >= 0 && bestDistance <= (radius + 1) ** 2) return best;
  }
  return best;
}

// ─── Seeded watershed ────────────────────────────────────────────────────────

/**
 * Grow the labels through free cells, widest clearance first, with every
 * clearance above `capCells` treated as equal. `labels` holds the markers on
 * entry (seeds and exterior) and every claimed cell on exit.
 */
function watershed(labels: Int32Array, blocked: Uint8Array, clearance: Float64Array, columns: number, capCells: number): void {
  const levels = 4; // buckets per cell of clearance
  let maxBucket = 0;
  const bucketOf = new Int32Array(labels.length);
  for (let index = 0; index < labels.length; index += 1) {
    if (blocked[index]) continue;
    // Everything at least a neck's half-width from a barrier is one level,
    // flooded breadth-first, so labels sharing open floor split it by
    // distance; only narrower places are ordered by their clearance.
    const bucket = Math.floor(Math.min(Math.sqrt(clearance[index]!), capCells) * levels);
    bucketOf[index] = bucket;
    if (bucket > maxBucket) maxBucket = bucket;
  }
  const queues: number[][] = Array.from({ length: maxBucket + 1 }, () => []);
  const heads = new Int32Array(maxBucket + 1);
  let current = 0;
  const push = (index: number) => {
    const bucket = bucketOf[index]!;
    queues[bucket]!.push(index);
    if (bucket > current) current = bucket;
  };
  for (let index = 0; index < labels.length; index += 1) if (labels[index] !== UNCLAIMED && !blocked[index]) push(index);
  const total = labels.length;
  for (;;) {
    while (current >= 0 && heads[current]! >= queues[current]!.length) {
      queues[current] = []; heads[current] = 0; current -= 1;
    }
    if (current < 0) break;
    const cellIndex = queues[current]![heads[current]!]!;
    heads[current] += 1;
    const label = labels[cellIndex]!;
    const column = cellIndex % columns;
    const up = cellIndex - columns; const down = cellIndex + columns;
    if (up >= 0 && !blocked[up] && labels[up] === UNCLAIMED) { labels[up] = label; push(up); }
    if (down < total && !blocked[down] && labels[down] === UNCLAIMED) { labels[down] = label; push(down); }
    if (column > 0 && !blocked[cellIndex - 1] && labels[cellIndex - 1] === UNCLAIMED) { labels[cellIndex - 1] = label; push(cellIndex - 1); }
    if (column < columns - 1 && !blocked[cellIndex + 1] && labels[cellIndex + 1] === UNCLAIMED) { labels[cellIndex + 1] = label; push(cellIndex + 1); }
  }
}

// ─── Vectorising ─────────────────────────────────────────────────────────────

/**
 * A morphological close then open (3 × 3 square, so rectangles keep their
 * corners) of a region, done
 * in its own bounding box. Closing fills the one- and two-cell slits a drawn
 * door leaf or jamb tick cuts into a room; opening drops one-cell spurs where
 * a flood crept along a wall. Neither crosses a barrier a cell or more thick,
 * and cells another room holds are never added.
 */
export function smoothRegion(
  cells: readonly number[],
  labels: Int32Array,
  label: number,
  columns: number,
  rows: number,
): number[] {
  let c0 = Infinity; let c1 = -Infinity; let r0 = Infinity; let r1 = -Infinity;
  for (const cellIndex of cells) {
    const column = cellIndex % columns; const row = Math.floor(cellIndex / columns);
    c0 = Math.min(c0, column); c1 = Math.max(c1, column); r0 = Math.min(r0, row); r1 = Math.max(r1, row);
  }
  c0 = Math.max(0, c0 - 2); r0 = Math.max(0, r0 - 2); c1 = Math.min(columns - 1, c1 + 2); r1 = Math.min(rows - 1, r1 + 2);
  const width = c1 - c0 + 1; const height = r1 - r0 + 1;
  let mask = new Uint8Array(width * height);
  for (const cellIndex of cells) mask[(Math.floor(cellIndex / columns) - r0) * width + (cellIndex % columns - c0)] = 1;
  const original = mask;
  const step = (source: Uint8Array, dilate: boolean) => {
    const out = new Uint8Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        let any = false; let all = true;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const inside = x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height;
            const value = inside ? source[at + dy * width + dx]! : 0;
            if (value) any = true; else all = false;
          }
        }
        out[at] = (dilate ? any : all) ? 1 : 0;
      }
    }
    return out;
  };
  mask = step(step(mask, true), false); // close
  for (let at = 0; at < mask.length; at += 1) {
    if (!mask[at] || original[at]) continue;
    const other = labels[(Math.floor(at / width) + r0) * columns + (at % width) + c0]!;
    if (other !== label && other >= ROOM_BASE) mask[at] = 0;
  }
  const closed = mask;
  mask = step(step(mask, false), true); // open
  const result: number[] = [];
  for (let at = 0; at < mask.length; at += 1) {
    if (mask[at] && closed[at]) result.push((Math.floor(at / width) + r0) * columns + (at % width) + c0);
  }
  // A region too thin to survive opening keeps its raw cells.
  return result.length ? result : [...cells];
}

const DIRECTIONS: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E N W S

/**
 * Boundary rings of a cell set, in grid-vertex coordinates. The region is on
 * the left of every edge, so outer rings run counter-clockwise and holes
 * clockwise. At a vertex where two cells touch only diagonally the trace takes
 * the sharpest left turn, which keeps 4-connected pieces in separate rings.
 */
export function traceCellRings(cells: readonly number[], columns: number): Point2[][] {
  const member = new Set(cells);
  const vertexColumns = columns + 1;
  const outgoing = new Map<number, number>();
  const add = (x: number, y: number, direction: number) => {
    const key = y * vertexColumns + x;
    outgoing.set(key, (outgoing.get(key) ?? 0) | (1 << direction));
  };
  for (const cell of cells) {
    const x = cell % columns; const y = Math.floor(cell / columns);
    if (!member.has(cell - columns) || y === 0) add(x, y, 0); // bottom edge, eastward
    if (x === columns - 1 || !member.has(cell + 1)) add(x + 1, y, 1); // right edge, northward
    if (!member.has(cell + columns)) add(x + 1, y + 1, 2); // top edge, westward
    if (x === 0 || !member.has(cell - 1)) add(x, y + 1, 3); // left edge, southward
  }
  const rings: Point2[][] = [];
  const keys = [...outgoing.keys()].sort((a, b) => a - b);
  const take = (key: number, direction: number) => {
    const mask = outgoing.get(key)! & ~(1 << direction);
    if (mask) outgoing.set(key, mask); else outgoing.delete(key);
  };
  for (const startKey of keys) {
    while (outgoing.get(startKey)) {
      const startX = startKey % vertexColumns; const startY = Math.floor(startKey / vertexColumns);
      const available = outgoing.get(startKey)!;
      const firstDirection = [0, 1, 2, 3].find((direction) => available & (1 << direction))!;
      const ring: Point2[] = [];
      let x = startX; let y = startY; let direction = firstDirection;
      for (let guard = 0; guard <= cells.length * 4 + 4; guard += 1) {
        ring.push([x, y]);
        take(y * vertexColumns + x, direction);
        x += DIRECTIONS[direction]![0]; y += DIRECTIONS[direction]![1];
        const key = y * vertexColumns + x;
        const options = outgoing.get(key) ?? 0;
        // Sharpest left first; the ring closes when that choice is the edge it started on.
        const order = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4];
        let next = -1;
        for (const candidate of order) {
          if (key === startKey && candidate === firstDirection) { next = -2; break; }
          if (options & (1 << candidate)) { next = candidate; break; }
        }
        if (next < 0) break;
        direction = next;
      }
      rings.push(ring);
    }
  }
  return rings;
}

function ringArea(ring: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!; const b = ring[(index + 1) % ring.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function pointInRing(point: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index]!; const b = ring[previous]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Drop vertices on a straight run. */
function dropCollinear(ring: readonly Point2[]): Point2[] {
  const out: Point2[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index + ring.length - 1) % ring.length]!;
    const point = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const cross = (point[0] - previous[0]) * (next[1] - point[1]) - (point[1] - previous[1]) * (next[0] - point[0]);
    if (Math.abs(cross) > 1e-12) out.push(point);
  }
  return out;
}

function douglasPeucker(points: readonly Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const ranges: [number, number][] = [[0, points.length - 1]];
  while (ranges.length) {
    const [from, to] = ranges.pop()!;
    let farthest = -1; let distance = tolerance;
    for (let index = from + 1; index < to; index += 1) {
      const candidate = distanceToSegment(points[index]![0], points[index]![1], points[from]!, points[to]!);
      if (candidate > distance) { distance = candidate; farthest = index; }
    }
    if (farthest >= 0) { keep[farthest] = 1; ranges.push([from, farthest], [farthest, to]); }
  }
  return points.filter((_, index) => keep[index]);
}

/**
 * Douglas–Peucker on a closed ring: split at the vertex farthest from the
 * first, simplify both chains, rejoin. Staircases left by a diagonal wall
 * collapse onto its true angle rather than being snapped to the axes.
 */
export function simplifyRing(ring: readonly Point2[], tolerance: number): Point2[] {
  const clean = dropCollinear(ring);
  if (clean.length <= 4) return clean;
  let far = 0; let farDistance = -1;
  for (let index = 1; index < clean.length; index += 1) {
    const distance = Math.hypot(clean[index]![0] - clean[0]![0], clean[index]![1] - clean[0]![1]);
    if (distance > farDistance) { farDistance = distance; far = index; }
  }
  const first = douglasPeucker(clean.slice(0, far + 1), tolerance);
  const second = douglasPeucker([...clean.slice(far), clean[0]!], tolerance);
  const joined = [...first.slice(0, -1), ...second.slice(0, -1)];
  const result = dropCollinear(joined);
  return result.length >= 3 && Math.abs(ringArea(result)) > 0 ? result : clean;
}

// ─── Confidence ──────────────────────────────────────────────────────────────

/**
 * How sure the pipeline is that the polygon is this label's room:
 *
 * - 0.9 for a barrier-closed room of its own; 0.65 for one that had to share
 *   its component with other labels but not with the exterior; 0.4 when its
 *   component reaches the exterior;
 * - +0.1 when the DWG linework alone encloses almost the same region (IoU ≥ 0.85);
 * - −0.15 when the region itself touches the exterior;
 * - −0.1 when the seed had to be moved off a barrier by more than half a foot;
 * - −0.3 for a sliver (under 10 ft²).
 */
export function roomConfidence(diagnostics: RoomRegionDiagnostics, areaSquareFeet: number): number {
  let value = diagnostics.closed ? 0.9 : diagnostics.componentOpen ? 0.4 : 0.65;
  if (diagnostics.dwgRegionIoU != null && diagnostics.dwgRegionIoU >= 0.85) value += 0.1;
  if (diagnostics.touchesExterior) value -= 0.15;
  if (diagnostics.nudgedFeet > 0.5) value -= 0.1;
  if (areaSquareFeet < 10) value -= 0.3;
  return Math.round(Math.max(0.05, Math.min(1, value)) * 100) / 100;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

type RoomGroup = { room: string; number: string; name: string | null; seeds: RoomSeed[] };

function groupSeeds(seeds: readonly RoomSeed[]): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  for (const seed of seeds) {
    const group = groups.get(seed.room);
    if (group) {
      group.seeds.push(seed);
      if (!group.name && seed.name) group.name = seed.name;
    } else {
      groups.set(seed.room, { room: seed.room, number: seed.number, name: seed.name ?? null, seeds: [seed] });
    }
  }
  return [...groups.values()];
}

/** Compute one region per room from its seeds; see the module comment. */
export function roomRegions(input: RoomRegionInput, options: RoomRegionOptions = {}): RoomRegionResult {
  const cell = options.cellSizeFeet ?? DEFAULTS.cellSizeFeet;
  const grid = gridFor(input, cell, options.marginFeet ?? DEFAULTS.marginFeet, options.maxCells ?? DEFAULTS.maxCells);
  const { columns, rows, minX, minY } = grid;
  const total = columns * rows;

  const rvtMask = new Uint8Array(total);
  const dwgMask = new Uint8Array(total);
  for (const barrier of input.barriers) markSegment(barrier.kind === "dwg" ? dwgMask : rvtMask, grid, barrier);
  const blocked = new Uint8Array(total);
  let barrierCells = 0;
  for (let index = 0; index < total; index += 1) {
    if (rvtMask[index] || dwgMask[index]) { blocked[index] = 1; barrierCells += 1; }
  }

  // Exterior: the window's edge, and anything outside the bound.
  const exterior = new Uint8Array(total);
  const outsideBound = new Uint8Array(total);
  if (input.bound?.length) {
    const inside = new Uint8Array(total);
    for (const polygon of input.bound) if (polygon.length && polygon[0]!.length >= 3) fillPolygon(inside, grid, polygon);
    for (let index = 0; index < total; index += 1) if (!inside[index]) { outsideBound[index] = 1; exterior[index] = 1; }
  }
  const edge = (index: number) => {
    const column = index % columns;
    return index < columns || index >= total - columns || column === 0 || column === columns - 1;
  };
  for (let index = 0; index < total; index += 1) if (edge(index)) exterior[index] = 1;

  const groups = groupSeeds(input.seeds);
  const failures: RoomRegionFailure[] = [];
  const labels = new Int32Array(total);
  const combined = components(blocked, columns, rows);
  const clearanceInput = new Float64Array(total);
  for (let index = 0; index < total; index += 1) clearanceInput[index] = blocked[index]!;
  const clearance = distanceTransform(clearanceInput, columns, rows); // squared, cells²
  const capCells = (options.neckWidthFeet ?? DEFAULTS.neckWidthFeet) / 2 / cell;

  // Seeds: off any barrier, then onto the raster as markers.
  const maxSteps = Math.max(1, Math.round((options.maxNudgeFeet ?? DEFAULTS.maxNudgeFeet) / cell));
  const seedCells = new Map<string, { cell: number; nudgedFeet: number; point: Point2 }>();
  const liveGroups: { group: RoomGroup; label: number }[] = [];
  // Barriers plus cells another room's seed already holds: two rooms never share a marker.
  const taken = blocked.slice();
  for (const group of groups) {
    const cells: number[] = [];
    for (const seed of group.seeds) {
      const column = Math.floor((seed.point[0] - minX) / cell);
      const row = Math.floor((seed.point[1] - minY) / cell);
      if (column < 1 || row < 1 || column >= columns - 1 || row >= rows - 1) continue;
      const start = row * columns + column;
      const free = nearestFree(taken, columns, rows, start, maxSteps);
      if (free < 0) continue;
      const moved: Point2 = free === start
        ? [seed.point[0], seed.point[1]]
        : [minX + (free % columns + 0.5) * cell, minY + (Math.floor(free / columns) + 0.5) * cell];
      seedCells.set(seed.id, { cell: free, nudgedFeet: Math.hypot(moved[0] - seed.point[0], moved[1] - seed.point[1]), point: moved });
      cells.push(free);
    }
    if (!cells.length) {
      failures.push({
        room: group.room, number: group.number, seedIds: group.seeds.map((seed) => seed.id),
        reason: "every seed is outside the raster or has no free cell within the nudge radius",
      });
      continue;
    }
    const label = ROOM_BASE + liveGroups.length;
    liveGroups.push({ group, label });
    // A seed on exterior ground still gets its room. A label drawn close to a
    // wall climbs to open floor first, claiming its path, so it enters the
    // flood where its room is widest instead of being starved at the wall.
    for (const start of cells) {
      let cellIndex = start;
      labels[cellIndex] = label; taken[cellIndex] = 1;
      for (let steps = 0; steps < 4 * capCells + 4 && Math.sqrt(clearance[cellIndex]!) < capCells; steps += 1) {
        const column = cellIndex % columns;
        let best = -1; let bestClearance = clearance[cellIndex]!;
        for (const next of [cellIndex - columns, cellIndex + columns, column > 0 ? cellIndex - 1 : -1, column < columns - 1 ? cellIndex + 1 : -1]) {
          if (next < 0 || next >= total || blocked[next] || taken[next]) continue;
          if (clearance[next]! > bestClearance) { bestClearance = clearance[next]!; best = next; }
        }
        if (best < 0) break;
        cellIndex = best;
        labels[cellIndex] = label; taken[cellIndex] = 1;
      }
    }
  }

  // A seed on ground the bound leaves out (a floor with no slab modelled)
  // lifts the bound from its whole barrier-closed component, so the room is
  // not born inside the exterior. The window's edge still bounds it.
  const unbounded = new Uint8Array(combined.count);
  const seedOutsideBound = new Set<string>();
  for (const [seedId, placed] of seedCells) {
    if (!outsideBound[placed.cell]) continue;
    seedOutsideBound.add(seedId);
    const component = combined.id[placed.cell]!;
    if (component >= 0) unbounded[component] = 1;
  }
  let exteriorCells = 0;
  for (let index = 0; index < total; index += 1) {
    const component = combined.id[index]!;
    if (outsideBound[index] && !edge(index) && component >= 0 && unbounded[component]) exterior[index] = 0;
    if (exterior[index] && !blocked[index] && labels[index] === UNCLAIMED) { labels[index] = EXTERIOR; exteriorCells += 1; }
  }

  watershed(labels, blocked, clearance, columns, capCells);

  // Components of the RVT-only and DWG-only rasters, for the diagnostics.
  const rvtOnly = components(rvtMask, columns, rows);
  const dwgOnly = components(dwgMask, columns, rows);
  const componentFacts = (id: Int32Array, count: number) => {
    const open = new Uint8Array(count);
    const size = new Int32Array(count);
    for (let index = 0; index < total; index += 1) {
      const component = id[index]!;
      if (component < 0) continue;
      size[component]! += 1;
      if (exterior[index]) open[component] = 1;
    }
    return { open, size };
  };
  const combinedFacts = componentFacts(combined.id, combined.count);
  const rvtFacts = componentFacts(rvtOnly.id, rvtOnly.count);
  const dwgFacts = componentFacts(dwgOnly.id, dwgOnly.count);
  const roomsIn = (id: Int32Array) => {
    const map = new Map<number, Set<number>>();
    for (const { group, label } of liveGroups) {
      for (const seed of group.seeds) {
        const placed = seedCells.get(seed.id);
        if (!placed) continue;
        const component = id[placed.cell]!;
        if (component < 0) continue;
        const set = map.get(component) ?? new Set<number>();
        set.add(label);
        map.set(component, set);
      }
    }
    return map;
  };
  const combinedRooms = roomsIn(combined.id);
  const rvtRooms = roomsIn(rvtOnly.id);
  const dwgRooms = roomsIn(dwgOnly.id);

  // Cells per label, and which labels each region touches without a barrier.
  const cellsByLabel = new Map<number, number[]>();
  const touching = new Map<number, Set<number>>();
  let claimedCells = 0; let unclaimedFreeCells = 0;
  for (let index = 0; index < total; index += 1) {
    const label = labels[index]!;
    if (blocked[index]) continue;
    if (label === UNCLAIMED) { unclaimedFreeCells += 1; continue; }
    if (label >= ROOM_BASE) {
      claimedCells += 1;
      let list = cellsByLabel.get(label);
      if (!list) { list = []; cellsByLabel.set(label, list); }
      list.push(index);
    }
    const column = index % columns;
    for (const next of [index + 1, index + columns]) {
      if (next >= total || (next === index + 1 && column === columns - 1) || blocked[next]) continue;
      const other = labels[next]!;
      if (other !== label && other !== UNCLAIMED) {
        const a = touching.get(label) ?? new Set<number>(); a.add(other); touching.set(label, a);
        const b = touching.get(other) ?? new Set<number>(); b.add(label); touching.set(other, b);
      }
    }
  }

  const tolerance = options.simplifyToleranceFeet ?? cell * 1.5;
  const minHole = options.minHoleAreaSquareFeet ?? DEFAULTS.minHoleAreaSquareFeet;
  const maxCompare = options.maxCompareAreaSquareFeet ?? DEFAULTS.maxCompareAreaSquareFeet;
  const numberOf = new Map(liveGroups.map(({ group, label }) => [label, group.room]));
  const rooms: RoomRegion[] = [];
  for (const { group, label } of liveGroups) {
    const cells = cellsByLabel.get(label) ?? [];
    const seedIds = group.seeds.map((seed) => seed.id);
    const firstPlaced = group.seeds.map((seed) => seedCells.get(seed.id)).find(Boolean)!;
    if (!cells.length) {
      failures.push({ room: group.room, number: group.number, seedIds, reason: "claimed no cells" });
      continue;
    }
    const gridRings = traceCellRings(smoothRegion(cells, labels, label, columns, rows), columns);
    const toFeet = (ring: readonly Point2[]) => ring.map(([x, y]) => [minX + x * cell, minY + y * cell] as Point2);
    const outers = gridRings.filter((ring) => ringArea(ring) > 0).sort((a, b) => ringArea(b) - ringArea(a));
    const outer = outers[0]!;
    // A hole ring runs clockwise; the middle of its first edge lies inside
    // whichever outer ring encloses it (no edge can be on two rings).
    const holes = gridRings.filter((ring) => {
      const area = ringArea(ring);
      if (area >= 0 || -area * cell * cell < minHole || ring.length < 2) return false;
      const probe: Point2 = [(ring[0]![0] + ring[1]![0]) / 2, (ring[0]![1] + ring[1]![1]) / 2];
      return pointInRing(probe, outer);
    });
    const polygon = simplifyRing(toFeet(outer), tolerance);
    const holesFeet = holes.map((ring) => simplifyRing(toFeet(ring), tolerance)).filter((ring) => ring.length >= 3);
    const areaSquareFeet = Math.abs(ringArea(polygon)) - holesFeet.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);

    // Diagnostics, from the first seed's cell.
    const combinedComponent = combined.id[firstPlaced.cell]!;
    const shared = combinedRooms.get(combinedComponent)?.size ?? 1;
    const componentOpen = combinedFacts.open[combinedComponent] === 1;
    const rvtComponent = rvtOnly.id[firstPlaced.cell]!;
    const dwgComponent = dwgOnly.id[firstPlaced.cell]!;
    const closedIn = (component: number, facts: { open: Uint8Array }, roomsMap: Map<number, Set<number>>) =>
      component >= 0 && facts.open[component] === 0 && (roomsMap.get(component)?.size ?? 1) === 1;
    const closedByDwg = closedIn(dwgComponent, dwgFacts, dwgRooms);
    let dwgRegionIoU: number | null = null;
    if (closedByDwg && dwgFacts.size[dwgComponent]! * cell * cell <= maxCompare) {
      let intersection = 0;
      for (const cellIndex of cells) if (dwgOnly.id[cellIndex] === dwgComponent) intersection += 1;
      const union = cells.length + dwgFacts.size[dwgComponent]! - intersection;
      dwgRegionIoU = Math.round((intersection / union) * 1000) / 1000;
    }
    const touches = touching.get(label) ?? new Set<number>();
    const diagnostics: RoomRegionDiagnostics = {
      closed: !componentOpen && shared === 1,
      sharedComponent: shared,
      componentOpen,
      competedWith: [...touches].filter((other) => other >= ROOM_BASE).map((other) => numberOf.get(other)!).sort(),
      touchesExterior: touches.has(EXTERIOR),
      nudgedFeet: Math.round(firstPlaced.nudgedFeet * 100) / 100,
      outsideBound: seedIds.some((id) => seedOutsideBound.has(id)),
      pieces: outers.length,
      componentAreaSquareFeet: Math.round(combinedFacts.size[combinedComponent]! * cell * cell),
      closedByRvt: closedIn(rvtComponent, rvtFacts, rvtRooms),
      closedByDwg,
      dwgRegionIoU,
    };
    rooms.push({
      room: group.room,
      number: group.number,
      name: group.name,
      seedIds,
      polygon,
      holes: holesFeet,
      areaSquareFeet: Math.round(areaSquareFeet * 10) / 10,
      labelPoint: firstPlaced.point,
      diagnostics,
      confidence: roomConfidence(diagnostics, areaSquareFeet),
    });
  }

  return {
    cellSizeFeet: cell,
    grid: { columns, rows, minX, minY },
    rooms,
    failures,
    stats: { cells: total, barrierCells, exteriorCells, claimedCells, unclaimedFreeCells },
  };
}

// ─── DWG linework ────────────────────────────────────────────────────────────

/** A drawn primitive from the DWG, in drawing units, before registration. */
export type DwgPrimitive =
  | { kind: "line"; start: Point2; end: Point2 }
  | { kind: "arc"; centre: Point2; radius: number; startAngle: number; endAngle: number }
  | { kind: "circle"; centre: Point2; radius: number };

/** `x' = a·x + c·y + e`, `y' = b·x + d·y + f`: DWG units → feet. */
export type PlanAffine = { a: number; b: number; c: number; d: number; e: number; f: number };

export type DwgBarrierOptions = {
  /** Feet per drawing unit (for thresholds); derived from the transform when omitted. */
  feetPerUnit?: number;
  /** Arcs at least this radius are drawn walls (curved façades), feet. */
  minWallArcRadiusFeet?: number;
  /** Door-swing radius range, feet. */
  doorRadiusFeet?: [number, number];
  /** Door swings sweep about a right angle; tolerance, degrees. */
  doorSweepToleranceDegrees?: number;
  /**
   * Segments shorter than this are dropped, feet. Off by default: on the UNBC
   * survey 82 % of the lines under 46 mm are links in a chain (curves drawn
   * as runs of tiny segments), and dropping them opens the curve.
   */
  minSegmentFeet?: number;
  /**
   * A run of at least this many parallel, equal-length, closely spaced lines
   * is a stair's treads (or lockers, or toilet partitions), not walls.
   */
  treadRunMin?: number;
  /** Largest spacing between neighbouring treads, feet. */
  treadSpacingFeet?: number;
};

export type DwgBarrierReport = {
  lines: number;
  kept: number;
  wallArcs: number;
  doorSwings: number;
  doorClosures: number;
  droppedArcs: number;
  droppedCircles: number;
  droppedShort: number;
  droppedTreads: number;
};

const apply = (m: PlanAffine, point: readonly [number, number]): Point2 =>
  [m.a * point[0] + m.c * point[1] + m.e, m.b * point[0] + m.d * point[1] + m.f];

/**
 * The DWG primitives that separate rooms, in feet. Lines stay; large arcs are
 * curved walls and are chorded; door swings (a quarter circle of door-leaf
 * radius) are replaced by the two radii that close the opening and draw the
 * open leaf; smaller arcs, circles, runs of stair treads and (optionally)
 * very short lines are dropped. Returns `dwg` barriers (thickness 0) and a count of each.
 */
export function dwgBarrierSegments(
  primitives: readonly DwgPrimitive[],
  transform: PlanAffine,
  options: DwgBarrierOptions = {},
): { barriers: RoomBarrier[]; report: DwgBarrierReport } {
  const feetPerUnit = options.feetPerUnit ?? Math.sqrt(Math.abs(transform.a * transform.d - transform.b * transform.c));
  const minArc = options.minWallArcRadiusFeet ?? 8;
  const [doorLow, doorHigh] = options.doorRadiusFeet ?? [1.8, 4.3];
  const sweepTolerance = ((options.doorSweepToleranceDegrees ?? 12) * Math.PI) / 180;
  const minSegment = options.minSegmentFeet ?? 0;
  const treadRunMin = options.treadRunMin ?? 5;
  const treadSpacing = options.treadSpacingFeet ?? 1.3;
  const report: DwgBarrierReport = {
    lines: 0, kept: 0, wallArcs: 0, doorSwings: 0, doorClosures: 0,
    droppedArcs: 0, droppedCircles: 0, droppedShort: 0, droppedTreads: 0,
  };
  const lines: { start: Point2; end: Point2 }[] = [];
  const closures: RoomBarrier[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === "circle") { report.droppedCircles += 1; continue; }
    if (primitive.kind === "line") {
      report.lines += 1;
      const start = apply(transform, primitive.start); const end = apply(transform, primitive.end);
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= minSegment) { report.droppedShort += 1; continue; }
      lines.push({ start, end });
      continue;
    }
    let sweep = primitive.endAngle - primitive.startAngle;
    while (sweep <= 0) sweep += Math.PI * 2;
    const radiusFeet = Math.abs(primitive.radius) * feetPerUnit;
    const at = (angle: number): Point2 => apply(transform, [
      primitive.centre[0] + Math.abs(primitive.radius) * Math.cos(angle),
      primitive.centre[1] + Math.abs(primitive.radius) * Math.sin(angle),
    ]);
    if (radiusFeet >= minArc) {
      report.wallArcs += 1;
      const steps = Math.min(64, Math.max(2, Math.ceil((radiusFeet * sweep) / 1)));
      let previous = at(primitive.startAngle);
      for (let step = 1; step <= steps; step += 1) {
        const next = at(primitive.startAngle + (sweep * step) / steps);
        lines.push({ start: previous, end: next });
        previous = next;
      }
      continue;
    }
    if (radiusFeet >= doorLow && radiusFeet <= doorHigh && Math.abs(sweep - Math.PI / 2) <= sweepTolerance) {
      report.doorSwings += 1;
      const centre = apply(transform, primitive.centre);
      for (const angle of [primitive.startAngle, primitive.endAngle]) {
        closures.push({ start: centre, end: at(angle), thickness: 0, kind: "dwg" });
        report.doorClosures += 1;
      }
      continue;
    }
    report.droppedArcs += 1;
  }

  const treads = treadLines(lines, treadRunMin, treadSpacing);
  report.droppedTreads = treads.size;
  const barriers: RoomBarrier[] = [];
  lines.forEach((line, index) => {
    if (treads.has(index)) return;
    barriers.push({ start: line.start, end: line.end, thickness: 0, kind: "dwg" });
  });
  report.kept = barriers.length;
  barriers.push(...closures);
  return { barriers, report };
}

/**
 * Indices of lines that belong to a run of treads: at least `minRun` parallel
 * lines of equal length (±15 %), overlapping along their length, each within
 * `maxSpacing` of the next. Wall faces come in pairs, so a run of five or
 * more evenly repeated lines is stairs, lockers or cubicle partitions.
 */
export function treadLines(lines: readonly { start: Point2; end: Point2 }[], minRun = 5, maxSpacing = 1.3): Set<number> {
  type Item = { index: number; angle: number; length: number; offset: number; along: number; cx: number; cy: number };
  const items: Item[] = [];
  lines.forEach((line, index) => {
    const dx = line.end[0] - line.start[0]; const dy = line.end[1] - line.start[1];
    const length = Math.hypot(dx, dy);
    if (length < 1.5 || length > 12) return;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;
    const cx = (line.start[0] + line.end[0]) / 2; const cy = (line.start[1] + line.end[1]) / 2;
    items.push({ index, angle, length, offset: 0, along: 0, cx, cy });
  });
  // Bucket by direction (1°), then look for runs among lines of one direction.
  const byAngle = new Map<number, Item[]>();
  for (const item of items) {
    const key = Math.round((item.angle * 180) / Math.PI) % 180;
    const list = byAngle.get(key) ?? [];
    list.push(item);
    byAngle.set(key, list);
  }
  const result = new Set<number>();
  for (const [key, list] of byAngle) {
    const neighbours = [...list, ...(byAngle.get((key + 1) % 180) ?? []), ...(byAngle.get((key + 179) % 180) ?? [])];
    const angle = (key * Math.PI) / 180;
    const ux = Math.cos(angle); const uy = Math.sin(angle);
    for (const item of neighbours) { item.offset = -item.cx * uy + item.cy * ux; item.along = item.cx * ux + item.cy * uy; }
    for (const item of list) {
      if (result.has(item.index)) continue;
      // Grow a chain across the lines on either side.
      const similar = neighbours.filter((other) => Math.abs(other.length - item.length) <= 0.15 * item.length &&
        Math.abs(other.along - item.along) <= 0.25 * item.length &&
        Math.abs(other.offset - item.offset) <= maxSpacing * (minRun + 2));
      similar.sort((a, b) => a.offset - b.offset);
      const at = similar.indexOf(item);
      // Treads are often drawn double (a nosing line a few millimetres off),
      // so a near-zero gap continues the run without counting as a step.
      let low = at; let high = at;
      while (low > 0 && similar[low]!.offset - similar[low - 1]!.offset <= maxSpacing) low -= 1;
      while (high < similar.length - 1 && similar[high + 1]!.offset - similar[high]!.offset <= maxSpacing) high += 1;
      let steps = 1;
      for (let index = low + 1; index <= high; index += 1) if (similar[index]!.offset - similar[index - 1]!.offset > 0.2) steps += 1;
      if (steps >= minRun) for (let index = low; index <= high; index += 1) result.add(similar[index]!.index);
    }
  }
  return result;
}

/**
 * A sheet's DWG primitives on one layer, in drawing units. Neighbouring
 * viewports overlap a little, so only lines with both ends (and arcs with
 * their centre) inside `bounds` are kept.
 */
export function dwgPrimitivesWithin(
  entities: readonly DwgEntity[],
  bounds: DwgBounds,
  layer = "1_Wall_Exist",
): { primitives: DwgPrimitive[]; skipped: Record<string, number> } {
  const inside = (point: readonly [number, number]) =>
    point[0] >= bounds.minX && point[0] <= bounds.maxX && point[1] >= bounds.minY && point[1] <= bounds.maxY;
  const primitives: DwgPrimitive[] = [];
  const skipped: Record<string, number> = {};
  for (const entity of entities) {
    if (entity.layer !== layer) continue;
    if (entity.points && entity.points.length > 1) {
      const points = entity.points;
      const count = entity.closed ? points.length : points.length - 1;
      for (let index = 0; index < count; index += 1) {
        const start = points[index]!; const end = points[(index + 1) % points.length]!;
        if (!inside(start) || !inside(end) || (start[0] === end[0] && start[1] === end[1])) continue;
        primitives.push({ kind: "line", start: [start[0], start[1]], end: [end[0], end[1]] });
      }
    } else if ((entity.type === "ARC" || entity.type === "CIRCLE") && entity.centre && entity.radius) {
      if (!inside(entity.centre)) continue;
      const centre: Point2 = [entity.centre[0], entity.centre[1]];
      if (entity.type === "CIRCLE" || entity.startAngle == null || entity.endAngle == null) {
        primitives.push({ kind: "circle", centre, radius: entity.radius });
      } else {
        primitives.push({ kind: "arc", centre, radius: entity.radius, startAngle: entity.startAngle, endAngle: entity.endAngle });
      }
    } else if (entity.type !== "TEXT" && entity.type !== "MTEXT") {
      skipped[entity.type] = (skipped[entity.type] ?? 0) + 1;
    }
  }
  return { primitives, skipped };
}

// ─── Model barriers ──────────────────────────────────────────────────────────

const WALL_CATEGORY = -2_000_011;
const CURTAIN_CATEGORIES = new Set([-2_000_170, -2_000_171]);
const DOOR_CATEGORY = -2_000_023;
const FLOOR_CATEGORY = -2_000_032;
/** Where a plan is cut above its level, feet (as `derived-rooms.ts` does). */
export const ROOM_PLAN_CUT_FEET = 4;

function overlapsWindow(start: Point2, end: Point2, window: PlanBounds | undefined): boolean {
  if (!window) return true;
  return Math.max(start[0], end[0]) >= window.minX && Math.min(start[0], end[0]) <= window.maxX &&
    Math.max(start[1], end[1]) >= window.minY && Math.min(start[1], end[1]) <= window.maxY;
}

function arcChordBarriers(arc: WallArc, stepFeet = 1): RoomBarrier[] {
  const sweep = arc.endAngle - arc.startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep * arc.radius) / stepFeet));
  const points: Point2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = arc.startAngle + (sweep * step) / steps;
    points.push([
      arc.centre.x + arc.radius * (Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x),
      arc.centre.y + arc.radius * (Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y),
    ]);
  }
  return points.slice(1).map((point, index) => ({ start: points[index]!, end: point, thickness: arc.thickness, kind: "wall" as const }));
}

/** An oriented box's plan footprint as its long axis plus its short side as thickness. */
function boxAxis(corners: readonly (readonly [number, number, number])[]): { start: Point2; end: Point2; thickness: number } | null {
  if (corners.length < 4) return null;
  // Box-index order: the first four corners are the bottom face.
  const [p0, p1, , p3] = corners as [number, number, number][];
  const side1: Point2 = [p1![0] - p0![0], p1![1] - p0![1]];
  const side3: Point2 = [p3![0] - p0![0], p3![1] - p0![1]];
  const length1 = Math.hypot(side1[0], side1[1]); const length3 = Math.hypot(side3[0], side3[1]);
  if (!(Math.max(length1, length3) > 0.05)) return null;
  const [long, short, shortLength] = length1 >= length3 ? [side1, side3, length3] : [side3, side1, length1];
  const middle: Point2 = [p0![0] + short[0] / 2, p0![1] + short[1] / 2];
  return { start: middle, end: [middle[0] + long[0], middle[1] + long[1]], thickness: shortLength };
}

function spansCut(record: ElementBoundsRecord, cut: number): boolean {
  const shapes = [...(record.solids?.length ? record.solids : record.solid ? [record.solid] : []), ...(record.arcs ?? [])];
  if (shapes.length) return shapes.some((shape) => shape.baseElevation - 0.1 <= cut && shape.topElevation + 0.1 >= cut);
  if (record.orientedBox?.length) {
    const zs = record.orientedBox.map((corner) => corner[2]);
    return Math.min(...zs) - 0.1 <= cut && Math.max(...zs) + 0.1 >= cut;
  }
  return record.boundsFeet.min.z - 0.1 <= cut && record.boundsFeet.max.z + 0.1 >= cut;
}

export type LevelBarrierReport = {
  cutElevationFeet: number;
  walls: number;
  wallSegments: number;
  curtainElements: number;
  doors: number;
};

/**
 * Everything in the model that separates rooms where a level's plan is cut
 * (4 ft above it), whichever level the element belongs to — a two-storey
 * wall based on the floor below still divides this one. Wall bodies come
 * from their solids (pass a healed result so graphical joins are closed) and
 * arcs; curtain panels and mullions from their boxes; each door closes its
 * opening with its own footprint, widened to its host wall's thickness.
 */
export function levelRoomBarriers(
  result: Pick<ConvertResult, "elementBounds" | "levels" | "nativeHostRelations">,
  levelId: number,
  window?: PlanBounds,
): { barriers: RoomBarrier[]; report: LevelBarrierReport } {
  const level = result.levels.find((candidate) => candidate.levelId === levelId);
  const cut = (level?.elevation ?? 0) + ROOM_PLAN_CUT_FEET;
  const report: LevelBarrierReport = { cutElevationFeet: cut, walls: 0, wallSegments: 0, curtainElements: 0, doors: 0 };
  const host = new Map((result.nativeHostRelations ?? []).map((relation) => [relation.elementId, relation.hostId]));
  const wallThickness = new Map<number, number>();
  const barriers: RoomBarrier[] = [];
  for (const record of result.elementBounds) {
    if (record.categoryId !== WALL_CATEGORY || !spansCut(record, cut)) continue;
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    let used = false;
    for (const solid of solids) {
      if (solid.baseElevation - 0.1 > cut || solid.topElevation + 0.1 < cut) continue;
      const start: Point2 = [solid.start.x, solid.start.y]; const end: Point2 = [solid.end.x, solid.end.y];
      if (!overlapsWindow(start, end, window)) continue;
      barriers.push({ start, end, thickness: solid.thickness, kind: "wall" });
      wallThickness.set(record.elementId, Math.max(wallThickness.get(record.elementId) ?? 0, solid.thickness));
      report.wallSegments += 1; used = true;
    }
    for (const arc of record.arcs ?? []) {
      if (arc.baseElevation - 0.1 > cut || arc.topElevation + 0.1 < cut) continue;
      const chords = arcChordBarriers(arc).filter((chord) => overlapsWindow(chord.start, chord.end, window));
      barriers.push(...chords);
      report.wallSegments += chords.length; used ||= chords.length > 0;
    }
    if (used) report.walls += 1;
  }
  for (const record of result.elementBounds) {
    const curtain = CURTAIN_CATEGORIES.has(record.categoryId ?? 0);
    const door = record.categoryId === DOOR_CATEGORY;
    if ((!curtain && !door) || !record.orientedBox || !spansCut(record, cut)) continue;
    const axis = boxAxis(record.orientedBox);
    if (!axis || !overlapsWindow(axis.start, axis.end, window)) continue;
    if (curtain) {
      barriers.push({ ...axis, thickness: Math.min(Math.max(axis.thickness, 0.05), 2), kind: "wall" });
      report.curtainElements += 1;
    } else {
      const hostThickness = wallThickness.get(host.get(record.elementId) ?? -1) ?? 0;
      barriers.push({ ...axis, thickness: Math.min(Math.max(axis.thickness, hostThickness, 0.2), 2), kind: "door" });
      report.doors += 1;
    }
  }
  return { barriers, report };
}

/**
 * The level's floor slabs as polygons (outer ring, then holes), feet: the
 * floor the rooms may occupy. A large opening in a slab — an atrium void —
 * stays a hole, so it starts as exterior; openings smaller than
 * `minHoleAreaSquareFeet` (stair wells, shafts: a stair room's flights sit in
 * one) are filled.
 */
export function levelFloorBound(
  result: Pick<ConvertResult, "elementBounds" | "nativeAssociatedLevelRelations">,
  levelId: number,
  options: { minHoleAreaSquareFeet?: number } = {},
): Point2[][][] {
  const minHole = options.minHoleAreaSquareFeet ?? 1000;
  const members = new Set((result.nativeAssociatedLevelRelations ?? [])
    .filter((relation) => relation.levelId === levelId).map((relation) => relation.elementId));
  return result.elementBounds
    .filter((record) => record.categoryId === FLOOR_CATEGORY && members.has(record.elementId) && record.loops?.some((loop) => loop.length >= 3))
    .map((record) => record.loops!.filter((loop) => loop.length >= 3)
      .map((loop) => loop.map(([x, y]) => [x, y] as Point2))
      .filter((ring, index) => index === 0 || Math.abs(ringArea(ring)) >= minHole));
}
