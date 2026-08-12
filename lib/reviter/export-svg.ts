/** Plan-view SVG of the recovered model or one persisted Revit level. */
import type { ConvertResult, ElementBoundsRecord, LevelBand, Segment } from "./types.ts";
import { cachedDerivedRoomsForLevel, type DerivedRoomResult } from "./derived-rooms.ts";

export type PlanSvgOptions = {
  /** Exact Revit Level element id from `result.levels`. */
  levelId?: number;
};

export type FloorPlateSvgOptions = {
  /** Overlay approximate, unnamed floor regions inferred from vertical barriers. */
  derivedRooms?: boolean | DerivedRoomResult;
};

const REVIT_FLOORS_CATEGORY_ID = -2_000_032;
const NO_DERIVED_REGIONS = {};
const floorSvgCache = new WeakMap<ConvertResult, Map<number, WeakMap<object, string>>>();
const svgDataUrlCache = new Map<string, string>();

/** Reuse URI encoding across Report, the side map, and the mobile map. */
export function floorPlateSvgDataUrl(svg: string) {
  const cached = svgDataUrlCache.get(svg);
  if (cached) return cached;
  const value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  svgDataUrlCache.set(svg, value);
  if (svgDataUrlCache.size > 12) svgDataUrlCache.delete(svgDataUrlCache.keys().next().value!);
  return value;
}

export type FloorPlateLevel = LevelBand & {
  levelId: number;
  floorCount: number;
};

function segmentBounds(segments: readonly Segment[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  // Do not spread or flatMap this model-sized collection. The UNBC plan has
  // enough segments to overflow JavaScript's call-argument stack.
  for (const segment of segments) {
    minX = Math.min(minX, segment.x0, segment.x1);
    maxX = Math.max(maxX, segment.x0, segment.x1);
    minY = Math.min(minY, segment.y0, segment.y1);
    maxY = Math.max(maxY, segment.y0, segment.y1);
  }
  return { minX, maxX, minY, maxY };
}

function recordSegments(records: readonly ElementBoundsRecord[]): Segment[] {
  const segments: Segment[] = [];
  for (const { boundsFeet: { min, max } } of records) {
    segments.push(
      { x0: min.x, y0: min.y, z0: min.z, x1: max.x, y1: min.y, z1: min.z },
      { x0: max.x, y0: min.y, z0: min.z, x1: max.x, y1: max.y, z1: min.z },
      { x0: max.x, y0: max.y, z0: min.z, x1: min.x, y1: max.y, z1: min.z },
      { x0: min.x, y0: max.y, z0: min.z, x1: min.x, y1: min.y, z1: min.z },
    );
  }
  return segments;
}

function drawnElementIds(result: ConvertResult): Set<number> {
  const ids = new Set<number>();
  for (const mesh of result.meshes) {
    if (!mesh.elementIds) continue;
    for (const elementId of mesh.elementIds) ids.add(elementId);
  }
  return ids;
}

function levelElementIds(result: ConvertResult, levelId: number): Set<number> {
  const relations = result.nativeAssociatedLevelRelations;
  if (!relations?.length) {
    throw new Error("This RVT does not expose persisted element-to-level relationships.");
  }
  if (!result.levels.some((level) => level.levelId === levelId)) {
    throw new Error(`Revit level ${levelId} is not present in this model.`);
  }
  return new Set(
    relations
      .filter((relation) => relation.levelId === levelId)
      .map((relation) => relation.elementId),
  );
}

/** Exact level membership first; no elevation histogram is used when a level is requested. */
export function planSegments(
  result: ConvertResult,
  options: PlanSvgOptions = {},
): Segment[] {
  if (options.levelId == null) return result.segments;
  const members = levelElementIds(result, options.levelId);
  const drawn = drawnElementIds(result);
  return recordSegments(result.elementBounds.filter(
    (record) => members.has(record.elementId) && drawn.has(record.elementId),
  ));
}

/** Native `Floors` sketch boundaries assigned to one exact Revit level. */
export function floorPlateRecords(
  result: ConvertResult,
  levelId: number,
): ElementBoundsRecord[] {
  const members = levelElementIds(result, levelId);
  return result.elementBounds.filter((record) =>
    members.has(record.elementId) &&
    record.categoryId === REVIT_FLOORS_CATEGORY_ID &&
    record.loops?.some((loop) => loop.length >= 3),
  );
}

/** Levels that contain at least one recovered native `Floors` sketch. */
export function floorPlateLevels(result: ConvertResult): FloorPlateLevel[] {
  const floorIds = new Set(
    result.elementBounds
      .filter((record) =>
        record.categoryId === REVIT_FLOORS_CATEGORY_ID &&
        record.loops?.some((loop) => loop.length >= 3),
      )
      .map((record) => record.elementId),
  );
  const idsByLevel = new Map<number, Set<number>>();
  for (const relation of result.nativeAssociatedLevelRelations ?? []) {
    if (!floorIds.has(relation.elementId)) continue;
    const ids = idsByLevel.get(relation.levelId) ?? new Set<number>();
    ids.add(relation.elementId);
    idsByLevel.set(relation.levelId, ids);
  }
  return result.levels.flatMap((level) => {
    if (level.levelId == null) return [];
    const floorCount = idsByLevel.get(level.levelId)?.size ?? 0;
    return floorCount ? [{ ...level, levelId: level.levelId, floorCount }] : [];
  });
}

function floorPointBounds(records: readonly ElementBoundsRecord[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    for (const loop of record.loops ?? []) {
      for (const point of loop) {
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/** World-space plan bounds shared by the SVG and interactive map overlays. */
export function floorPlateBounds(result: ConvertResult, levelId: number) {
  const records = floorPlateRecords(result, levelId);
  if (!records.length) return null;
  return floorPointBounds(records);
}

/**
 * The actual recovered Revit floor slabs, not a projection of every element
 * on the level. Outer and inner sketch loops share an even-odd fill so atria
 * and other slab openings remain open in the SVG.
 */
export function makeFloorPlateSvg(
  result: ConvertResult,
  levelId: number,
  options: FloorPlateSvgOptions = {},
): string {
  const records = floorPlateRecords(result, levelId);
  if (!records.length) {
    throw new Error(`Revit level ${levelId} contains no recovered Floors sketch boundaries.`);
  }
  const derivedRooms = options.derivedRooms === true
    ? cachedDerivedRoomsForLevel(result, levelId)
    : options.derivedRooms || null;
  let byLevel = floorSvgCache.get(result);
  if (!byLevel) { byLevel = new Map(); floorSvgCache.set(result, byLevel); }
  let variants = byLevel.get(levelId);
  if (!variants) { variants = new WeakMap(); byLevel.set(levelId, variants); }
  const variantKey = derivedRooms ?? NO_DERIVED_REGIONS;
  const cachedSvg = variants.get(variantKey);
  if (cachedSvg) return cachedSvg;
  const { minX, maxX, minY, maxY } = floorPointBounds(records);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const strokeWidth = Math.max(width, height) / 1_200;
  const paths = records.map((record) => {
    const path = (record.loops ?? []).filter((loop) => loop.length >= 3).map((loop) =>
      `${loop.map((point, index) =>
        `${index ? "L" : "M"} ${point[0] - minX} ${maxY - point[1]}`,
      ).join(" ")} Z`,
    ).join(" ");
    return `<path data-revit-element-id="${record.elementId}" d="${path}"/>`;
  }).join("");
  const roomPaths = derivedRooms?.rooms.map((room) => {
    const path = room.loops.map((loop) =>
      `${loop.map(([x, y], index) =>
        `${index ? "L" : "M"} ${x - minX} ${maxY - y}`,
      ).join(" ")} Z`,
    ).join(" ");
    return `<path data-derived-floor-region-id="${room.id}" data-area-square-feet="${room.areaSquareFeet.toFixed(1)}" d="${path}"/>`;
  }).join("") ?? "";
  const roomLabels = derivedRooms ? [...derivedRooms.rooms]
    .sort((left, right) => right.areaSquareFeet - left.areaSquareFeet)
    .reduce<typeof derivedRooms.rooms>((labels, room) => {
      const spacing = Math.max(width, height) / 55;
      if (
        labels.length < 60 &&
        labels.every((label) => Math.hypot(
          label.centroid[0] - room.centroid[0],
          label.centroid[1] - room.centroid[1],
        ) >= spacing)
      ) labels.push(room);
      return labels;
    }, [])
    .sort((left, right) => left.id - right.id)
    : [];
  const roomLayer = derivedRooms
    ? `<g data-derived-floor-region-count="${derivedRooms.rooms.length}" data-derived-floor-region-source="${derivedRooms.source}" fill="#f2a65a" fill-opacity="0.44" fill-rule="evenodd" stroke="#9a4d13" stroke-width="${strokeWidth * 1.4}" stroke-linejoin="round" vector-effect="non-scaling-stroke">${roomPaths}</g><g fill="#6f310b" font-family="system-ui, sans-serif" font-size="${Math.max(width, height) / 160}" font-weight="700" pointer-events="none">${roomLabels.map((room) => `<text x="${room.centroid[0] - minX}" y="${maxY - room.centroid[1]}" text-anchor="middle" dominant-baseline="central">F${room.id}</text>`).join("")}</g>`
    : "";
  const level = result.levels.find((candidate) => candidate.levelId === levelId)!;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="floor-map-title floor-map-desc" data-revit-level-id="${levelId}" data-revit-floor-count="${records.length}"${derivedRooms ? ` data-derived-floor-region-count="${derivedRooms.rooms.length}"` : ""}>
  <title id="floor-map-title">Recovered Revit floor plates on level ${levelId}</title>
  <desc id="floor-map-desc">Native floor sketch boundaries at ${level.elevation.toFixed(3)} feet${derivedRooms ? ` with ${derivedRooms.rooms.length} approximate floor regions partitioned by recovered vertical barriers` : ""}.</desc>
  <rect width="100%" height="100%" fill="#f4f1e9"/>
  <g fill="#79b7b0" fill-opacity="0.5" fill-rule="evenodd" stroke="#143e46" stroke-width="${strokeWidth}" stroke-linejoin="round" vector-effect="non-scaling-stroke">${paths}</g>
  ${roomLayer}
</svg>`;
  variants.set(variantKey, svg);
  return svg;
}

export function makePlanSvg(
  result: ConvertResult,
  options: PlanSvgOptions = {},
): string {
  const segments = planSegments(result, options);
  if (!segments.length) {
    throw new Error(options.levelId == null
      ? "The recovered model contains no plan segments."
      : `Revit level ${options.levelId} contains no drawn plan geometry.`);
  }
  const { minX, maxX, minY, maxY } = segmentBounds(segments);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const strokeWidth = Math.max(width, height) / 1_200;
  const paths = segments
    .map(
      (segment) =>
        `<path d="M ${segment.x0 - minX} ${maxY - segment.y0} L ${segment.x1 - minX} ${maxY - segment.y1}"/>`,
    )
    .join("");
  const level = options.levelId == null
    ? null
    : result.levels.find((candidate) => candidate.levelId === options.levelId) ?? null;
  const label = level
    ? `Recovered RVT level ${level.levelId} at ${level.elevation.toFixed(3)} feet`
    : "Recovered RVT plan centerlines";
  const levelAttribute = level ? ` data-revit-level-id="${level.levelId}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"${levelAttribute}>
  <rect width="100%" height="100%" fill="#f4f1e9"/>
  <g fill="none" stroke="#143e46" stroke-width="${strokeWidth}" stroke-linecap="round" vector-effect="non-scaling-stroke">${paths}</g>
</svg>`;
}
