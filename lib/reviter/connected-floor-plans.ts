/** Detect split-level floor plates that belong in one architectural plan. */
import polygonClipping from "polygon-clipping";
import type { MultiPolygon, Polygon } from "polygon-clipping";

import { floorPlateLevels, floorPlateRecords, type FloorPlateLevel } from "./export-svg.ts";
import type { ConvertResult, ElementBoundsRecord } from "./types.ts";

type Point2 = [number, number];
const MAX_SPLIT_LEVEL_RISE_FEET = 7;
const MAX_FLOOR_EDGE_GAP_FEET = 3;
const MAX_STACKED_FOOTPRINT_RATIO = 0.12;

export type ConnectedFloorPlanConnection = {
  lowerLevelId: number;
  upperLevelId: number;
  riseFeet: number;
  edgeGapFeet: number;
  stackedFootprintRatio: number;
};

export type ConnectedFloorPlanGroup = {
  /** Largest recovered slab footprint; used for plan cut and 3D synchronization. */
  primaryLevelId: number;
  levelIds: number[];
  levels: FloorPlateLevel[];
  floorCount: number;
  minElevation: number;
  maxElevation: number;
  connections: ConnectedFloorPlanConnection[];
};

type LevelGeometry = {
  level: FloorPlateLevel;
  geometry: MultiPolygon;
  area: number;
};

const groupCache = new WeakMap<ConvertResult, ConnectedFloorPlanGroup[]>();

function pointsForLoop(loop: NonNullable<ElementBoundsRecord["loops"]>[number]): Point2[] {
  return loop
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]]);
}

function recordPolygon(record: ElementBoundsRecord): Polygon | null {
  const rings = (record.loops ?? []).map(pointsForLoop).filter((loop) => loop.length >= 3);
  return rings.length ? rings : null;
}

function normalizedLevelGeometry(result: ConvertResult, level: FloorPlateLevel): MultiPolygon {
  const polygons = floorPlateRecords(result, level.levelId)
    .map(recordPolygon)
    .filter((polygon): polygon is Polygon => polygon != null);
  if (!polygons.length) return [];
  try {
    return polygonClipping.union(polygons[0]!, ...polygons.slice(1));
  } catch {
    // Invalid or numerically unstable floor sketches must fail closed: a raw
    // level remains available, but it is never guessed into another storey.
    return [];
  }
}

function ringArea(ring: readonly Point2[]) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twiceArea += point[0] * next[1] - next[0] * point[1];
  }
  return Math.abs(twiceArea) / 2;
}

function multiPolygonArea(geometry: MultiPolygon) {
  return geometry.reduce((total, polygon) => total + polygon.reduce(
    (area, ring, index) => area + (index ? -ringArea(ring) : ringArea(ring)),
    0,
  ), 0);
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (start[0] + ratio * dx),
    point[1] - (start[1] + ratio * dy),
  );
}

function directedBoundaryGap(source: MultiPolygon, target: MultiPolygon, best: number) {
  for (const polygon of source) for (const ring of polygon) for (const point of ring) {
    for (const targetPolygon of target) for (const targetRing of targetPolygon) {
      for (let index = 0; index < targetRing.length; index += 1) {
        best = Math.min(best, pointSegmentDistance(
          point,
          targetRing[index]!,
          targetRing[(index + 1) % targetRing.length]!,
        ));
        if (best <= 1e-5) return 0;
      }
    }
  }
  return best;
}

function boundaryGap(left: MultiPolygon, right: MultiPolygon) {
  return directedBoundaryGap(right, left, directedBoundaryGap(left, right, Infinity));
}

function connection(left: LevelGeometry, right: LevelGeometry): ConnectedFloorPlanConnection | null {
  const riseFeet = right.level.elevation - left.level.elevation;
  if (riseFeet > MAX_SPLIT_LEVEL_RISE_FEET || !left.area || !right.area) return null;
  let intersection: MultiPolygon;
  try {
    intersection = polygonClipping.intersection(left.geometry, right.geometry);
  } catch {
    return null;
  }
  const stackedFootprintRatio = multiPolygonArea(intersection) / Math.min(left.area, right.area);
  if (stackedFootprintRatio > MAX_STACKED_FOOTPRINT_RATIO) return null;
  const edgeGapFeet = boundaryGap(left.geometry, right.geometry);
  if (edgeGapFeet > MAX_FLOOR_EDGE_GAP_FEET) return null;
  return {
    lowerLevelId: left.level.levelId,
    upperLevelId: right.level.levelId,
    riseFeet,
    edgeGapFeet,
    stackedFootprintRatio,
  };
}

/**
 * Compose only nearby, adjoining floor plates with little vertical stacking.
 * A normal upper storey overlaps the floor below and therefore remains a
 * separate plan; a split-level wing touches its neighbour and joins the group.
 */
export function connectedFloorPlanGroups(result: ConvertResult): ConnectedFloorPlanGroup[] {
  const cached = groupCache.get(result);
  if (cached) return cached;
  const geometries = floorPlateLevels(result)
    .sort((left, right) => left.elevation - right.elevation)
    .map((level): LevelGeometry => {
      const geometry = normalizedLevelGeometry(result, level);
      return { level, geometry, area: multiPolygonArea(geometry) };
    });
  const parent = geometries.map((_, index) => index);
  const groupMinElevation = geometries.map(({ level }) => level.elevation);
  const groupMaxElevation = geometries.map(({ level }) => level.elevation);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const joins: ConnectedFloorPlanConnection[] = [];
  for (let left = 0; left < geometries.length; left += 1) {
    for (let right = left + 1; right < geometries.length; right += 1) {
      if (geometries[right]!.level.elevation - geometries[left]!.level.elevation > MAX_SPLIT_LEVEL_RISE_FEET) break;
      const candidate = connection(geometries[left]!, geometries[right]!);
      if (!candidate) continue;
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) {
        const mergedMin = Math.min(groupMinElevation[leftRoot]!, groupMinElevation[rightRoot]!);
        const mergedMax = Math.max(groupMaxElevation[leftRoot]!, groupMaxElevation[rightRoot]!);
        // Do not let a chain of small steps absorb an entire multi-storey
        // building. One composite plan remains within one split-level rise.
        if (mergedMax - mergedMin > MAX_SPLIT_LEVEL_RISE_FEET) continue;
        parent[rightRoot] = leftRoot;
        groupMinElevation[leftRoot] = mergedMin;
        groupMaxElevation[leftRoot] = mergedMax;
      }
      joins.push(candidate);
    }
  }
  const indicesByRoot = new Map<number, number[]>();
  geometries.forEach((_, index) => {
    const root = find(index);
    const indices = indicesByRoot.get(root) ?? [];
    indices.push(index);
    indicesByRoot.set(root, indices);
  });
  const groups = [...indicesByRoot.values()].map((indices): ConnectedFloorPlanGroup => {
    const members = indices.map((index) => geometries[index]!);
    const ids = new Set(members.map(({ level }) => level.levelId));
    const primary = [...members].sort((left, right) => right.area - left.area)[0]!;
    return {
      primaryLevelId: primary.level.levelId,
      levelIds: members.map(({ level }) => level.levelId),
      levels: members.map(({ level }) => level),
      floorCount: members.reduce((total, { level }) => total + level.floorCount, 0),
      minElevation: members[0]!.level.elevation,
      maxElevation: members.at(-1)!.level.elevation,
      connections: joins.filter(({ lowerLevelId, upperLevelId }) =>
        ids.has(lowerLevelId) && ids.has(upperLevelId)),
    };
  });
  groupCache.set(result, groups);
  return groups;
}

export function connectedFloorPlanGroup(result: ConvertResult, levelId: number) {
  return connectedFloorPlanGroups(result).find((group) => group.levelIds.includes(levelId)) ?? null;
}
