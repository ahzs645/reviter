/** Architectural plan composition from persisted, level-aware RVT geometry. */
import { cachedDerivedRoomsForLevel, type DerivedRoomResult } from "./derived-rooms.ts";
import { floorPlateRecords } from "./export-svg.ts";
import type { ConvertResult, ElementBoundsRecord, Point3, WallArc, WallSolid } from "./types.ts";

const WALL_CATEGORY_IDS = new Set([-2_000_011, -2_000_170, -2_000_171]);
const DOOR_CATEGORY_ID = -2_000_023;
const WINDOW_CATEGORY_ID = -2_000_014;
const COLUMN_CATEGORY_IDS = new Set([-2_000_100, -2_000_133]);
const PLAN_CUT_HEIGHT_FEET = 4;

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
    }).join("")}${[...risers.values()].map(([start, end]) => `<path class="riser" d="${path([xy(start), xy(end)], bounds, false)}"/>`).join("")}</g>`;
    }
    return "";
  }).join("");
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
  const bounds = { minX: plan.bounds.minX - padding, minY: plan.bounds.minY - padding, maxX: plan.bounds.maxX + padding, maxY: plan.bounds.maxY + padding };
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX); const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const width = rotation % 2 ? sourceHeight : sourceWidth; const height = rotation % 2 ? sourceWidth : sourceHeight;
  const contentTransform = rotation === 1 ? `translate(${sourceHeight} 0) rotate(90)`
    : rotation === 2 ? `translate(${sourceWidth} ${sourceHeight}) rotate(180)`
      : rotation === 3 ? `translate(0 ${sourceWidth}) rotate(270)` : "";
  const scale = Math.max(sourceWidth, sourceHeight); const fineStroke = Math.max(0.035, scale / 2_600);
  const connected = plan.levelPlans.length > 1;
  const floorFills = ["#f6f3eb", "#edf2ed", "#f2eee5", "#eaf0f2"];
  const floorGroups = plan.levelPlans.map((part, index) =>
    `<g class="floors" data-source-revit-level-id="${part.levelId}" data-source-elevation-feet="${part.elevation}" style="--floor-fill:${floorFills[index % floorFills.length]}">${floorLayer(part.floorRecords, bounds)}</g>`,
  ).join("");
  const stairGroups = plan.levelPlans.map((part) =>
    `<g data-source-revit-level-id="${part.levelId}">${stairLayer(part.stairRecords, bounds, part.elevation, part.nextElevation)}</g>`,
  ).join("");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="architectural-plan-title architectural-plan-desc" data-revit-level-id="${levelId}" data-revit-level-ids="${plan.levelPlans.map((part) => part.levelId).join(",")}" data-connected-level-count="${plan.levelPlans.length}" data-view-rotation-degrees="${rotation * 90}" data-plan-cut-elevation-feet="${plan.cutElevation}" data-floor-count="${plan.floors}" data-wall-count="${plan.walls}" data-door-count="${plan.doors}" data-window-count="${plan.windows}" data-stair-count="${plan.stairs}">
  <title id="architectural-plan-title">${connected ? "Connected split-level architectural plan" : `Architectural floor map for Revit level ${levelId}`}</title>
  <desc id="architectural-plan-desc">Recovered floor outlines, walls, doors, windows, stairs and columns ${connected ? `across ${plan.levelPlans.length} adjoining elevations from ${plan.levelPlans[0]!.elevation.toFixed(3)} to ${plan.levelPlans.at(-1)!.elevation.toFixed(3)} feet` : `at ${plan.elevation.toFixed(3)} feet`}. Door swings and uncategorized fallback footprints are approximate.</desc>
  <style>
    .floors{fill:var(--floor-fill,#f6f3eb);stroke:#76858a;stroke-width:${fineStroke};vector-effect:non-scaling-stroke}
    .rooms{fill:#e7c89c;fill-opacity:.34;stroke:#c18a49;stroke-width:${fineStroke};vector-effect:non-scaling-stroke}
    .rooms .near-closed{fill:#f3b36f;fill-opacity:.22;stroke:#d9823b;stroke-dasharray:${fineStroke * 5} ${fineStroke * 3}}
    .room-labels{fill:#875623;font:700 ${scale / 170}px system-ui,sans-serif;pointer-events:none}
    .walls{fill:#e0e7e5;stroke:#344b50;stroke-width:${fineStroke * 0.8};stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .walls path{vector-effect:non-scaling-stroke}
    .walls .arc-body{fill:none;stroke:#e0e7e5;vector-effect:none}
    .walls .arc-centreline{fill:none;stroke:#344b50;stroke-width:${fineStroke * 0.8};vector-effect:non-scaling-stroke}
    .columns{fill:#52656a;stroke:#263f46;stroke-width:${fineStroke};vector-effect:non-scaling-stroke}
    .doors .opening,.windows .opening{fill:#fffdf7;stroke:#fffdf7;stroke-width:${fineStroke * 2};vector-effect:non-scaling-stroke}
    .doors .leaf{fill:none;stroke:#a35b35;stroke-width:${fineStroke * 1.5};vector-effect:non-scaling-stroke}
    .doors .swing{fill:none;stroke:#a35b35;stroke-width:${fineStroke};stroke-dasharray:${fineStroke * 5} ${fineStroke * 3};vector-effect:non-scaling-stroke}
    .windows path:not(.opening){fill:none;stroke:#2a7990;stroke-width:${fineStroke * 1.25};vector-effect:non-scaling-stroke}
    .stairs{fill:none;stroke:#6e5a86;stroke-width:${fineStroke * 0.8};vector-effect:non-scaling-stroke}
    .stairs .tread-surface{fill:#f3eef6;stroke:none}.stairs .riser{stroke-width:${fineStroke};vector-effect:non-scaling-stroke}
    .stairs .landing{fill:#eee8f3;stroke:#6e5a86;stroke-width:${fineStroke};vector-effect:non-scaling-stroke}
  </style>
  <rect width="100%" height="100%" fill="#fffdf7"/>
  <g${contentTransform ? ` transform="${contentTransform}"` : ""}>
  <g fill-rule="evenodd">${floorGroups}</g>
  ${roomLayer(derivedRooms, bounds, scale)}
  <g class="walls">${wallLayer(plan.wallRecords, bounds)}</g>
  <g class="columns">${plan.columnRecords.map((record) => `<path data-revit-element-id="${record.elementId}" d="${path(distinctPlanPoints(record), bounds)}"/>`).join("")}</g>
  <g class="windows">${openingLayer(plan.windowRecords, bounds, "window")}</g>
  <g class="doors">${openingLayer(plan.doorRecords, bounds, "door")}</g>
  <g class="stairs">${stairGroups}</g>
  </g>
</svg>`;
  variants.set(cacheKey, svg); return svg;
}
