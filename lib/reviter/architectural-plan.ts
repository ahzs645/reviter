/** Architectural plan composition from persisted, level-aware RVT geometry. */
import { cachedDerivedRoomsForLevel, type DerivedRoomResult } from "./derived-rooms.ts";
import { floorPlateRecords } from "./export-svg.ts";
import { formatFeetInches } from "./format-length.ts";
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

export type ArchitecturalPlanRoomLabel = { name?: string; number?: string };

export type ArchitecturalPlanSvgOptions = {
  /** Overlay approximate, unnamed regions inferred from recovered barriers. */
  derivedRooms?: boolean | DerivedRoomResult;
  /**
   * User-accepted names/numbers from Room review, keyed by derived-room
   * candidate key. Labelled regions read like plan rooms; the rest keep their
   * F-numbers so reviewed and unreviewed regions stay distinguishable.
   */
  roomLabels?: Readonly<Record<string, ArchitecturalPlanRoomLabel>>;
  /** Rotate the drawing view clockwise in 90-degree steps without moving RVT geometry. */
  rotationQuarterTurns?: number;
  /** Nearby, adjoining split-level elevations to compose into the same map. */
  connectedLevelIds?: readonly number[];
  /**
   * `screen` (default) keeps cut linework pixel-crisp under zoom with
   * non-scaling strokes. `document` renders paper-correct ISO pen widths for
   * an implied print of the plan's long side at ~800 mm, with an overall
   * dimension string — the variant to download and print.
   */
  purpose?: "screen" | "document";
  /**
   * Which ink the drawing is in. `light` is the paper drawing; `dark` keeps the
   * same line-weight hierarchy but inverts the tonal order, so cut walls stay
   * the heaviest thing on the sheet by being the lightest. `document` output
   * ignores this and always prints on paper.
   */
  theme?: PlanTheme;
};

export type PlanTheme = "light" | "dark";

/**
 * The drawing's ink. Two sets, one vocabulary — every colour the plan uses is
 * named here so a themed plan is a palette swap rather than a second renderer.
 *
 * The dark set is not an inversion. A plan reads by tonal hierarchy: cut
 * elements heaviest, drawn symbols medium, projections lightest. On paper that
 * means near-black poché on cream; on a dark sheet it means near-white poché on
 * near-black, with the mid-tones re-spaced so the ordering survives.
 */
type PlanPalette = {
  paper: string;
  floorFills: readonly string[];
  floorStroke: string;
  wallFill: string;
  wallStroke: string;
  columnFill: string;
  columnStroke: string;
  /** Fills the wall gap a door or window sits in, so the wall reads as broken. */
  opening: string;
  leaf: string;
  swing: string;
  window: string;
  stairStroke: string;
  treadSurface: string;
  landing: string;
  runDirection: string;
  openEdge: string;
  roomFill: string;
  roomStroke: string;
  nearClosedFill: string;
  nearClosedStroke: string;
  roomLabel: string;
  acceptedRoomLabel: string;
  annotation: string;
  /** Halo behind annotation text and the scale bar's light segments. */
  annotationHalo: string;
  dimension: string;
  north: string;
};

const PLAN_PALETTES: Record<PlanTheme, PlanPalette> = {
  light: {
    paper: "#fffdf7",
    floorFills: ["#f6f3eb", "#edf2ed", "#f2eee5", "#eaf0f2"],
    floorStroke: "#9aa4a6",
    wallFill: "#1f2937",
    wallStroke: "#111827",
    columnFill: "#374151",
    columnStroke: "#111827",
    opening: "#fffdf7",
    leaf: "#374151",
    swing: "#64748b",
    window: "#334155",
    stairStroke: "#1f2937",
    treadSurface: "#f8fafc",
    landing: "#f1f5f9",
    runDirection: "#111827",
    openEdge: "#8b6f52",
    roomFill: "#e7c89c",
    roomStroke: "#c18a49",
    nearClosedFill: "#f3b36f",
    nearClosedStroke: "#d9823b",
    roomLabel: "#875623",
    acceptedRoomLabel: "#1f2937",
    annotation: "#111827",
    annotationHalo: "#fffdf7",
    dimension: "#334155",
    north: "#b91c1c",
  },
  dark: {
    paper: "#0d1417",
    floorFills: ["#1a2326", "#182423", "#1d2523", "#172227"],
    floorStroke: "#46585c",
    wallFill: "#dde6e7",
    wallStroke: "#f1f7f7",
    columnFill: "#c4d1d3",
    columnStroke: "#eef4f4",
    opening: "#0d1417",
    leaf: "#a4b7ba",
    swing: "#71868a",
    window: "#9fb4b8",
    stairStroke: "#d5e0e1",
    treadSurface: "#1b2529",
    landing: "#222d31",
    runDirection: "#eef4f4",
    openEdge: "#b08a63",
    roomFill: "#8a6a33",
    roomStroke: "#c18a49",
    nearClosedFill: "#a4712f",
    nearClosedStroke: "#d9823b",
    roomLabel: "#f0d9b0",
    acceptedRoomLabel: "#e7eeef",
    annotation: "#e3ecec",
    annotationHalo: "#0d1417",
    dimension: "#9fb4b8",
    north: "#e2685e",
  },
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
const svgCache = new WeakMap<ConvertResult, Map<string, string>>();
// Option objects (derived rooms, room labels) are cache-keyed by identity, not
// content: a rebuilt object simply misses the cache and re-renders.
const optionIdentity = new WeakMap<object, number>();
let optionIdentityCounter = 0;
function identityOf(value: object | null | undefined): number {
  if (!value) return 0;
  let id = optionIdentity.get(value);
  if (id == null) { id = ++optionIdentityCounter; optionIdentity.set(value, id); }
  return id;
}

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

type WallCornerOverrides = {
  startLeft?: Point2; startRight?: Point2; endLeft?: Point2; endRight?: Point2;
};

function wallPolygon(solid: WallSolid, corners?: WallCornerOverrides): Point2[] {
  const dx = solid.end.x - solid.start.x; const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy) || 1; const px = -dy / length * solid.thickness / 2;
  const py = dx / length * solid.thickness / 2;
  return [
    corners?.startLeft ?? [solid.start.x + px, solid.start.y + py],
    corners?.endLeft ?? [solid.end.x + px, solid.end.y + py],
    corners?.endRight ?? [solid.end.x - px, solid.end.y - py],
    corners?.startRight ?? [solid.start.x - px, solid.start.y - py],
  ];
}

const MITER_JUNCTION_TOLERANCE_FEET = 0.25;
const MITER_LIMIT = 10;

function lineIntersection(pointA: Point2, dirA: Point2, pointB: Point2, dirB: Point2): Point2 | null {
  const cross = dirA[0] * dirB[1] - dirA[1] * dirB[0];
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((pointB[0] - pointA[0]) * dirB[1] - (pointB[1] - pointA[1]) * dirB[0]) / cross;
  return [pointA[0] + dirA[0] * t, pointA[1] + dirA[1] * t];
}

/**
 * Corner joints for the cut-wall poché. Where exactly two wall solids meet at
 * a shared endpoint, their offset edges are extended to their intersection so
 * the corner closes with a proper miter instead of two overlapping butt ends.
 * Near-collinear pairs (miter spike), T-junctions, and walls shorter than the
 * miter itself keep the plain rectangle — an over-eager miter reads worse than
 * an honest butt joint on recovered geometry.
 */
function miteredWallCorners(
  candidates: ReturnType<typeof wallSolids>,
): Map<WallSolid, WallCornerOverrides> {
  const junctions = new Map<string, Array<{ solid: WallSolid; end: "start" | "end" }>>();
  for (const { solid } of candidates) {
    const length = Math.hypot(solid.end.x - solid.start.x, solid.end.y - solid.start.y);
    if (length < 1e-6) continue;
    for (const end of ["start", "end"] as const) {
      const point = solid[end];
      const key = `${Math.round(point.x / MITER_JUNCTION_TOLERANCE_FEET)},${Math.round(point.y / MITER_JUNCTION_TOLERANCE_FEET)}`;
      const members = junctions.get(key);
      if (members) members.push({ solid, end }); else junctions.set(key, [{ solid, end }]);
    }
  }

  const overrides = new Map<WallSolid, WallCornerOverrides>();
  const cornerFor = (solid: WallSolid) => {
    let value = overrides.get(solid);
    if (!value) { value = {}; overrides.set(solid, value); }
    return value;
  };
  const geometry = (member: { solid: WallSolid; end: "start" | "end" }) => {
    const { solid, end } = member;
    const dx = solid.end.x - solid.start.x; const dy = solid.end.y - solid.start.y;
    const length = Math.hypot(dx, dy);
    const direction: Point2 = [dx / length, dy / length];
    const normal: Point2 = [-direction[1], direction[0]];
    const half = solid.thickness / 2;
    const junction = solid[end];
    return {
      direction, length, half,
      junction: [junction.x, junction.y] as Point2,
      corner: (side: 1 | -1): Point2 => [junction.x + normal[0] * half * side, junction.y + normal[1] * half * side],
    };
  };

  for (const members of junctions.values()) {
    if (members.length !== 2) continue;
    const [a, b] = [members[0]!, members[1]!];
    if (a.solid === b.solid) continue;
    const wallA = geometry(a); const wallB = geometry(b);
    // With both polygons wound start→end, matching sides pair left↔left when
    // one wall ends where the other starts, and left↔right when both walls
    // meet head-on or tail-on.
    const flip = a.end === b.end;
    for (const sideA of [1, -1] as const) {
      const sideB = flip ? (-sideA as 1 | -1) : sideA;
      const miter = lineIntersection(wallA.corner(sideA), wallA.direction, wallB.corner(sideB), wallB.direction);
      if (!miter) continue;
      const reach = distanceBetween(miter, wallA.junction);
      const limit = MITER_LIMIT * Math.max(wallA.half, wallB.half);
      if (reach > limit || reach > Math.min(wallA.length, wallB.length)) continue;
      const keyA = a.end === "end" ? (sideA === 1 ? "endLeft" : "endRight") : (sideA === 1 ? "startLeft" : "startRight");
      const keyB = b.end === "end" ? (sideB === 1 ? "endLeft" : "endRight") : (sideB === 1 ? "startLeft" : "startRight");
      cornerFor(a.solid)[keyA] = miter;
      cornerFor(b.solid)[keyB] = miter;
    }
  }
  return overrides;
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
  const miters = miteredWallCorners(wallSolids(records));
  return records.map((record) => {
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    const polygons = solids.map((solid) => `<path d="${path(wallPolygon(solid, miters.get(solid)), bounds)}"/>`).join("");
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

/**
 * Leaf count decoded from the door's own family/type name — "Дверь-Двойная"
 * and "Double" both name a pair of leaves. Names are persisted data, so this
 * stays a decode rather than a geometric guess; unrecognised names keep the
 * single-leaf symbol.
 */
function doorLeafCount(record: ElementBoundsRecord): 1 | 2 {
  const name = `${record.familyName ?? ""} ${record.typeName ?? ""}`.toLowerCase();
  return /double|двойн/u.test(name) ? 2 : 1;
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
    const jambA: Point2 = [frame.center[0] - frame.u[0] * frame.halfWidth, frame.center[1] - frame.u[1] * frame.halfWidth];
    const jambB: Point2 = [frame.center[0] + frame.u[0] * frame.halfWidth, frame.center[1] + frame.u[1] * frame.halfWidth];
    if (doorLeafCount(record) === 2) {
      // A pair of half-width leaves hinged at opposite jambs, meeting
      // perpendicular at the centre of the opening — the standard double-door
      // symbol. Both swing to the same side, like the recovered single doors.
      const half = width / 2;
      const leaf = (jamb: Point2, sweep: 0 | 1) => {
        const opened: Point2 = [jamb[0] + frame.v[0] * half, jamb[1] + frame.v[1] * half];
        const [jambX, jambY] = renderPoint(jamb, bounds);
        const [openX, openY] = renderPoint(opened, bounds);
        const [centreX, centreY] = renderPoint(frame.center, bounds);
        return `<path class="leaf" d="M ${jambX} ${jambY} L ${openX} ${openY}"/><path class="swing" d="M ${centreX} ${centreY} A ${half} ${half} 0 0 ${sweep} ${openX} ${openY}"/>`;
      };
      return `<g data-revit-element-id="${record.elementId}" data-door-leaves="2">${opening}${leaf(jambA, 0)}${leaf(jambB, 1)}</g>`;
    }
    const opened: Point2 = [jambA[0] + frame.v[0] * width, jambA[1] + frame.v[1] * width];
    const [pivotX, pivotY] = renderPoint(jambA, bounds); const [closedX, closedY] = renderPoint(jambB, bounds);
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
  palette: PlanPalette,
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
    `<rect x="${margin + segment * index}" y="${barY}" width="${segment}" height="${barHeight}" fill="${index % 2 ? palette.annotationHalo : palette.annotation}"/>`).join("");
  const barLabels = `<text x="${margin}" y="${barY - barHeight * 0.9}" text-anchor="start">0</text>` +
    `<text x="${margin + barFeet}" y="${barY - barHeight * 0.9}" text-anchor="end">${barFeet}′</text>`;

  const radius = Math.min(Math.max(1.6, scale * 0.015), footer * 0.38);
  const northX = width - margin - radius; const northY = height + footer * 0.5;
  const angle = rotationQuarterTurns * Math.PI / 2;
  const letterX = northX + Math.sin(angle) * radius * 1.8;
  const letterY = northY - Math.cos(angle) * radius * 1.8;
  const needle = `<g class="north"><g transform="translate(${northX} ${northY}) rotate(${rotationQuarterTurns * 90})">` +
    `<circle r="${radius}"/>` +
    `<path d="M 0 ${-radius * 0.85} L ${radius * 0.34} ${radius * 0.4} L 0 ${radius * 0.14} L ${-radius * 0.34} ${radius * 0.4} Z" fill="${palette.north}"/>` +
    `</g><text x="${letterX}" y="${letterY}" text-anchor="middle" dominant-baseline="central">N</text></g>`;
  return `<g class="plan-annotations" aria-hidden="true"><g class="scale-bar">${segments}${barLabels}</g>${needle}</g>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[character]!));
}

export type PlanDrawingFrame = {
  minX: number; minY: number; maxX: number; maxY: number;
  footerFeet: number;
  rotationQuarterTurns: number;
};

/** The world-space drawing frame a plan SVG advertises on its root element. */
export function planDrawingFrame(svg: string): PlanDrawingFrame | null {
  const attr = (name: string) => {
    const match = svg.match(new RegExp(`${name}="([^"]+)"`, "u"));
    return match ? Number(match[1]) : Number.NaN;
  };
  const frame = {
    minX: attr("data-plan-min-x-feet"), minY: attr("data-plan-min-y-feet"),
    maxX: attr("data-plan-max-x-feet"), maxY: attr("data-plan-max-y-feet"),
    footerFeet: attr("data-plan-footer-feet"),
    rotationQuarterTurns: attr("data-view-rotation-degrees") / 90,
  };
  return Object.values(frame).every(Number.isFinite) ? frame : null;
}

/**
 * Convert a fraction of the rendered plan image (0–1 across its full width
 * and height, footer included) back to model feet, inverting the view
 * rotation. Returns null for points in the sheet-furniture footer.
 */
export function planWorldPoint(
  frame: PlanDrawingFrame,
  u: number,
  v: number,
): Point2 | null {
  const sourceWidth = frame.maxX - frame.minX;
  const sourceHeight = frame.maxY - frame.minY;
  const rotation = ((Math.round(frame.rotationQuarterTurns) % 4) + 4) % 4;
  const viewWidth = rotation % 2 ? sourceHeight : sourceWidth;
  const viewHeight = rotation % 2 ? sourceWidth : sourceHeight;
  const viewX = u * viewWidth;
  const viewY = v * (viewHeight + frame.footerFeet);
  if (viewX < 0 || viewY < 0 || viewX > viewWidth || viewY > viewHeight) return null;
  let contentX: number; let contentY: number;
  if (rotation === 1) { contentX = viewY; contentY = sourceHeight - viewX; }
  else if (rotation === 2) { contentX = sourceWidth - viewX; contentY = sourceHeight - viewY; }
  else if (rotation === 3) { contentX = sourceWidth - viewY; contentY = viewX; }
  else { contentX = viewX; contentY = viewY; }
  return [frame.minX + contentX, frame.maxY - contentY];
}

/**
 * A single overall dimension string across the drawing's content width, drawn
 * with standard anatomy — witness lines with a start gap and overshoot, 45°
 * architectural ticks, the value lettered above the line — for document
 * output. One honest overall measure; interior chains would imply a precision
 * recovered geometry does not have.
 */
function overallDimensionLayer(
  content: PlanBounds,
  frame: PlanBounds,
  height: number,
  footer: number,
  mmToFeet: number,
) {
  const startX = content.minX - frame.minX;
  const endX = content.maxX - frame.minX;
  if (endX - startX < mmToFeet * 40) return "";
  const gap = 1.5 * mmToFeet;
  const overshoot = 1.2 * mmToFeet;
  const tickHalf = 1.8 * mmToFeet * Math.SQRT1_2;
  const lineY = height + footer * 0.24;
  const fontSize = 3.5 * mmToFeet;
  const tick = (x: number) =>
    `<path d="M ${x - tickHalf} ${lineY + tickHalf} L ${x + tickHalf} ${lineY - tickHalf}"/>`;
  return `<g class="plan-dimensions">` +
    `<path d="M ${startX} ${height + gap} L ${startX} ${lineY + overshoot} M ${endX} ${height + gap} L ${endX} ${lineY + overshoot}"/>` +
    `<path d="M ${startX} ${lineY} L ${endX} ${lineY}"/>` +
    tick(startX) + tick(endX) +
    `<text x="${(startX + endX) / 2}" y="${lineY - fontSize * 0.45}" text-anchor="middle" font-size="${fontSize}">${formatFeetInches(content.maxX - content.minX)}</text></g>`;
}

function roomLayer(
  rooms: DerivedRoomResult | null,
  bounds: PlanBounds,
  scale: number,
  roomLabels?: Readonly<Record<string, ArchitecturalPlanRoomLabel>>,
) {
  if (!rooms) return "";
  const paths = rooms.rooms.map((room) => `<path class="${room.closure}" data-derived-floor-region-id="${room.id}" data-derived-room-key="${room.key}" d="${room.loops.map((loop) => path(loop, bounds)).join(" ")}"/>`).join("");
  const fontSize = scale / 170;
  // Labels are laid out with estimated text metrics (character width ≈ 0.62 ×
  // font size, the usual UI-sans ratio), largest rooms first. A label that
  // would sit on an already-placed one tries small vertical shifts; if every
  // slot is taken it is dropped — on a drawing, a missing minor label reads
  // better than two on top of each other.
  const placed: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
  const overlapsPlaced = (box: { minX: number; minY: number; maxX: number; maxY: number }) =>
    placed.some((other) => box.maxX > other.minX && box.minX < other.maxX &&
      box.maxY > other.minY && box.minY < other.maxY);
  const labels = [...rooms.rooms].sort((a, b) => b.areaSquareFeet - a.areaSquareFeet).slice(0, 60)
    .map((room) => {
      const [x, baseY] = renderPoint(room.centroid, bounds);
      // Accepted Room-review names read like plan rooms (NAME over number);
      // unreviewed regions keep their F-numbers so the two stay distinct.
      const accepted = roomLabels?.[room.key];
      const title = accepted?.name?.trim()
        ? escapeXml(accepted.name.trim().toUpperCase())
        : accepted?.number?.trim() ? escapeXml(accepted.number.trim()) : `F${room.id}`;
      const hasNumberLine = Boolean(accepted?.name?.trim() && accepted?.number?.trim());
      // Rooms large enough to hold another line also get their measured area,
      // the way space labels read on a real plan. The value is derived, so it
      // stays rounded rather than implying survey precision.
      const hasAreaLine = room.areaSquareFeet >= 300;
      const lineCount = 1 + (hasNumberLine ? 1 : 0) + (hasAreaLine ? 1 : 0);
      const halfWidth = Math.max(title.length, 4) * fontSize * 0.62 / 2;
      const halfHeight = (lineCount * fontSize * 1.15) / 2;
      let y: number | null = null;
      for (const shift of [0, 1.1, -1.1, 2.2, -2.2]) {
        const candidateY = baseY + shift * halfHeight;
        const box = {
          minX: x - halfWidth, maxX: x + halfWidth,
          minY: candidateY - halfHeight, maxY: candidateY + halfHeight,
        };
        if (!overlapsPlaced(box)) { placed.push(box); y = candidateY; break; }
      }
      if (y == null) return "";
      const numberLine = hasNumberLine
        ? `<tspan x="${x}" dy="${scale / 165}">${escapeXml(accepted!.number!.trim())}</tspan>`
        : "";
      const area = hasAreaLine
        ? `<tspan x="${x}" dy="${scale / 150}" font-size="${scale / 260}">${Math.round(room.areaSquareFeet).toLocaleString("en-US")} ft²</tspan>`
        : "";
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"${accepted ? ` class="accepted" data-derived-room-key="${room.key}"` : ""}>${title}${numberLine}${area}</text>`;
    }).join("");
  return `<g class="rooms" fill-rule="evenodd">${paths}</g><g class="room-labels" font-size="${fontSize}">${labels}</g>`;
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
  // Paper is the only ink a printed sheet has, so document output pins the
  // palette rather than following the screen the request came from.
  const theme: PlanTheme = options.purpose === "document"
    ? "light"
    : options.theme === "dark" ? "dark" : "light";
  const palette = PLAN_PALETTES[theme];
  const cacheKey = `${levelId}:${plan.levelPlans.map((part) => part.levelId).join(",")}` +
    `|${rotation}|${identityOf(derivedRooms)}|${identityOf(options.roomLabels)}|${options.purpose === "document" ? "doc" : "scr"}|${theme}`;
  let cacheStore = svgCache.get(result); if (!cacheStore) { cacheStore = new Map(); svgCache.set(result, cacheStore); }
  const cached = cacheStore.get(cacheKey); if (cached) return cached;

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
  const documentMode = options.purpose === "document";
  // Document output is a paper model: the plan's long side prints at ~800 mm,
  // so ISO 128 pen millimetres (0.5 cut / 0.35 medium / 0.25 symbol / 0.18
  // fine) convert to drawing feet at this ratio and the whole sheet scales
  // like ink. Screen mode instead pins cut linework to device pixels and
  // gives symbols a legibility floor.
  const mmToFeet = scale / 800;
  const cutStroke = documentMode ? 0.5 * mmToFeet : 1.35;
  const projectionStroke = documentMode ? 0.18 * mmToFeet : 0.8;
  const leafPen = documentMode ? 0.35 * mmToFeet : Math.max(0.12, fineStroke * 2.2);
  const symbolPen = documentMode ? 0.25 * mmToFeet : Math.max(0.08, fineStroke * 1.5);
  const swingDash = `${fineStroke * 5} ${fineStroke * 3.5}`;
  const crisp = documentMode ? "" : ";vector-effect:non-scaling-stroke";
  const connected = plan.levelPlans.length > 1;
  const openEnds = exposedWallEnds(plan.wallRecords, plan.floorRecords);
  const floorFills = palette.floorFills;
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
    .floors{fill:var(--floor-fill,${palette.floorFills[0]});stroke:${palette.floorStroke};stroke-width:${projectionStroke}${crisp}}
    .rooms{fill:${palette.roomFill};fill-opacity:.34;stroke:${palette.roomStroke};stroke-width:${projectionStroke}${crisp}}
    .rooms .near-closed{fill:${palette.nearClosedFill};fill-opacity:.22;stroke:${palette.nearClosedStroke};stroke-dasharray:${fineStroke * 5} ${fineStroke * 3}}
    .room-labels{fill:${palette.roomLabel};font:700 ${scale / 170}px system-ui,sans-serif;pointer-events:none;paint-order:stroke;stroke:${palette.annotationHalo};stroke-width:${scale / 850}}
    .room-labels .accepted{fill:${palette.acceptedRoomLabel}}
    .walls{fill:${palette.wallFill};fill-opacity:.94;stroke:${palette.wallStroke};stroke-width:${cutStroke};stroke-linejoin:round${crisp}}
    ${documentMode ? "" : ".walls path{vector-effect:non-scaling-stroke}"}
    .walls .arc-body{fill:none;stroke:${palette.wallFill};stroke-opacity:.94;vector-effect:none}
    .walls .arc-centreline{fill:none;stroke:${palette.wallStroke};stroke-width:${cutStroke * 0.7}${crisp}}
    .open-edges{fill:none;stroke:${palette.openEdge};stroke-width:${symbolPen};stroke-linecap:round;opacity:.82;pointer-events:none}
    .columns{fill:${palette.columnFill};stroke:${palette.columnStroke};stroke-width:${cutStroke * 0.9}${crisp}}
    .doors .opening,.windows .opening{fill:${palette.opening};stroke:${palette.opening};stroke-width:${cutStroke * 1.3}${crisp}}
    .doors .leaf{fill:none;stroke:${palette.leaf};stroke-width:${leafPen};stroke-linecap:round}
    .doors .swing{fill:none;stroke:${palette.swing};stroke-width:${symbolPen};stroke-dasharray:${swingDash};stroke-linecap:round}
    .windows path:not(.opening){fill:none;stroke:${palette.window};stroke-width:${symbolPen}}
    .stairs{fill:none;stroke:${palette.stairStroke};stroke-width:${symbolPen}}
    .stairs .tread-surface{fill:${palette.treadSurface};stroke:none}.stairs .riser{stroke-width:${symbolPen}}
    .stairs .landing{fill:${palette.landing};stroke:${palette.stairStroke};stroke-width:${symbolPen}}
    .stairs .run-direction{fill:none;stroke:${palette.runDirection};stroke-width:${leafPen};stroke-linecap:round}
    .stairs .run-direction-head{fill:${palette.runDirection};stroke:none}
    .stairs .run-direction-label{fill:${palette.annotation};font:600 ${Math.max(2, scale / 240)}px system-ui,sans-serif;paint-order:stroke;stroke:${palette.annotationHalo};stroke-width:${Math.max(0.5, scale / 1_100)};pointer-events:none}
    .plan-annotations{pointer-events:none}
    .plan-annotations text{fill:${palette.annotation};font:600 ${Math.max(2, scale / 220)}px system-ui,sans-serif;paint-order:stroke;stroke:${palette.annotationHalo};stroke-width:${Math.max(0.5, scale / 1_000)}}
    .plan-annotations .scale-bar rect{stroke:${palette.annotation};stroke-width:${projectionStroke}${crisp}}
    .plan-annotations .north circle{fill:${palette.annotationHalo};stroke:${palette.annotation};stroke-width:${projectionStroke}${crisp}}
    .plan-annotations .north path{stroke:${palette.annotation};stroke-width:${projectionStroke};stroke-linejoin:round${crisp}}
    .plan-dimensions{fill:none;stroke:${palette.dimension};stroke-width:${symbolPen}}
    .plan-dimensions text{fill:${palette.annotation};stroke:none;font-family:ui-monospace,monospace;font-weight:500}
  </style>
  <rect width="100%" height="100%" fill="${palette.paper}" data-plan-paper="${theme}"/>
  <g${contentTransform ? ` transform="${contentTransform}"` : ""}>
  <g fill-rule="evenodd">${floorGroups}</g>
  ${roomLayer(derivedRooms, bounds, scale, options.roomLabels)}
  <g class="walls">${wallLayer(plan.wallRecords, bounds)}</g>
  <g class="open-edges" data-confirmed-open-end-count="${openEnds.length}">${exposedWallEndLayer(openEnds, bounds)}</g>
  <g class="columns">${plan.columnRecords.map((record) => `<path data-revit-element-id="${record.elementId}" d="${path(distinctPlanPoints(record), bounds)}"/>`).join("")}</g>
  <g class="windows">${openingLayer(plan.windowRecords, bounds, "window")}</g>
  <g class="doors">${openingLayer(plan.doorRecords, bounds, "door")}</g>
  <g class="stairs">${stairGroups}</g>
  </g>
  ${planAnnotationLayer(width, height, scale, rotation, footer, palette)}
  ${documentMode && rotation === 0 ? overallDimensionLayer(renderedBounds, bounds, height, footer, mmToFeet) : ""}
</svg>`;
  cacheStore.set(cacheKey, svg); return svg;
}
