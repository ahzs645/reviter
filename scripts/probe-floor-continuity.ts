/**
 * Why a storey's plan stops short.
 *
 * Prints every recovered floor-plate level, its footprint area and extent, and
 * the split-level groups `connectedFloorPlanGroups` composes from them — so a
 * plan that covers only part of a building can be traced to the level ids it
 * was asked for rather than to the drawing code.
 *
 *   node --experimental-strip-types scripts/probe-floor-continuity.ts model.rvt
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import polygonClipping from "polygon-clipping";
import type { MultiPolygon } from "polygon-clipping";

import { connectedFloorPlanGroups } from "../lib/reviter/connected-floor-plans.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { floorPlateLevels, floorPlateRecords } from "../lib/reviter/export-svg.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

const input = process.argv[2];
if (!input) {
  console.error("usage: node --experimental-strip-types scripts/probe-floor-continuity.ts <model.rvt> [cache.json]");
  process.exit(2);
}

// Conversion of a campus model is two and a half minutes, and this probe is
// meant to be re-run while changing the composer, so the parsed result is
// cached beside it on request.
const cachePath = process.argv[3];
let result: ConvertResult;
if (cachePath && existsSync(cachePath)) {
  result = JSON.parse(readFileSync(cachePath, "utf8")) as ConvertResult;
  console.log(`loaded cached conversion from ${cachePath}`);
} else {
  const started = Date.now();
  const outcome = await convertRvtBytes(new Uint8Array(readFileSync(input)));
  if (!("elementBounds" in outcome)) {
    console.error("conversion failed:", outcome);
    process.exit(1);
  }
  result = outcome;
  console.log(`converted in ${((Date.now() - started) / 1_000).toFixed(1)}s`);
  if (cachePath) {
    writeFileSync(cachePath, JSON.stringify({
      levels: result.levels,
      nativeAssociatedLevelRelations: result.nativeAssociatedLevelRelations,
      elementBounds: result.elementBounds,
    }));
    console.log(`cached conversion to ${cachePath}`);
  }
}

const feet = (value: number) => `${value.toFixed(1)}'`;

function ringArea(ring: readonly (readonly number[])[]) {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twice += point[0]! * next[1]! - next[0]! * point[1]!;
  }
  return Math.abs(twice) / 2;
}

/** Plan area of one level's slabs, without unioning — enough to rank levels. */
function levelArea(levelId: number) {
  let area = 0;
  for (const record of floorPlateRecords(result, levelId)) {
    for (const [index, loop] of (record.loops ?? []).entries()) {
      area += index === 0 ? ringArea(loop) : -ringArea(loop);
    }
  }
  return area;
}

const levels = floorPlateLevels(result);
const rows = levels.map((level) => {
  const records = floorPlateRecords(result, level.levelId);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const record of records) {
    minX = Math.min(minX, record.boundsFeet.min.x);
    minY = Math.min(minY, record.boundsFeet.min.y);
    maxX = Math.max(maxX, record.boundsFeet.max.x);
    maxY = Math.max(maxY, record.boundsFeet.max.y);
  }
  return {
    level, records: records.length, area: levelArea(level.levelId),
    minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY, covers: 0,
  };
});
// The building's own plan extent, taken from every slab on every level.
const whole = {
  minX: Math.min(...rows.map((row) => row.minX)),
  minY: Math.min(...rows.map((row) => row.minY)),
  maxX: Math.max(...rows.map((row) => row.maxX)),
  maxY: Math.max(...rows.map((row) => row.maxY)),
};
const wholeArea = (whole.maxX - whole.minX) * (whole.maxY - whole.minY);
console.log(`\nmodel plan extent: ${feet(whole.maxX - whole.minX)} x ${feet(whole.maxY - whole.minY)}`);
console.log(`levels with floor plates: ${levels.length}\n`);

console.log("LEVEL      ELEV      SLABS   AREA(sf)   EXTENT(ft)        BBOX COVERS");
for (const row of rows) row.covers = (row.spanX * row.spanY) / wholeArea;
for (const row of rows) {
  console.log(
    `${String(row.level.levelId).padEnd(10)} ${feet(row.level.elevation).padEnd(9)} ` +
    `${String(row.records).padEnd(7)} ${Math.round(row.area).toLocaleString().padStart(9)}  ` +
    `${`${feet(row.spanX)} x ${feet(row.spanY)}`.padEnd(17)} ${(row.covers * 100).toFixed(0)}%`,
  );
}

const groups = connectedFloorPlanGroups(result);
console.log(`\nsplit-level groups: ${groups.length} plans from ${levels.length} levels\n`);
for (const group of groups.sort((left, right) => left.minElevation - right.minElevation)) {
  const area = group.levelIds.reduce((total, id) => total + levelArea(id), 0);
  console.log(
    `plan @${feet(group.minElevation)}–${feet(group.maxElevation)}  primary ${group.primaryLevelId}  ` +
    `levels [${group.levelIds.join(", ")}]  slabs ${group.floorCount}  area ${Math.round(area).toLocaleString()} sf`,
  );
  for (const link of group.connections) {
    console.log(
      `    join ${link.lowerLevelId} → ${link.upperLevelId}  rise ${feet(link.riseFeet)}  ` +
      `gap ${feet(link.edgeGapFeet)}  stacked ${(link.stackedFootprintRatio * 100).toFixed(1)}%`,
    );
  }
}

// What each storey is worth once composed, against the level that leads it.
console.log("\nwhat composing gains each storey:\n");
for (const group of groups) {
  if (group.levelIds.length < 2) continue;
  const primaryArea = levelArea(group.primaryLevelId);
  const total = group.levelIds.reduce((sum, id) => sum + levelArea(id), 0);
  console.log(
    `plan @${feet(group.minElevation)}  primary level ${group.primaryLevelId} alone ` +
    `${Math.round(primaryArea).toLocaleString()} sf → composed ${Math.round(total).toLocaleString()} sf ` +
    `(+${Math.round((total / primaryArea - 1) * 100)}%, ${group.levelIds.length - 1} more elevation${group.levelIds.length > 2 ? "s" : ""})`,
  );
}

// The near-misses, with the numbers rather than a guess: for every pair inside
// the rise limit, the measured edge gap and vertical stacking, and which of the
// three thresholds actually rejected it. This is where a storey that visibly
// continues but draws short gets explained.
console.log("\nnear misses (measured, not inferred):\n");
console.log("  thresholds: rise ≤ 7.0'   edge gap ≤ 3.0'   stacked ≤ 12%\n");
const geometries = new Map(levels.map((level) => {
  const polygons = floorPlateRecords(result, level.levelId)
    .map((record) => (record.loops ?? [])
      .map((loop) => loop.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map((point) => [point[0], point[1]] as [number, number]))
      .filter((ring) => ring.length >= 3))
    .filter((rings) => rings.length);
  let geometry: MultiPolygon = [];
  try {
    if (polygons.length) geometry = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
  } catch { geometry = []; }
  return [level.levelId, geometry] as const;
}));

function area(geometry: MultiPolygon) {
  return geometry.reduce((total, polygon) => total + polygon.reduce(
    (sum, ring, index) => sum + (index ? -ringArea(ring) : ringArea(ring)), 0), 0);
}
function segmentDistance(point: readonly number[], start: readonly number[], end: readonly number[]) {
  const dx = end[0]! - start[0]!, dy = end[1]! - start[1]!;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0]! - start[0]!, point[1]! - start[1]!);
  const ratio = Math.max(0, Math.min(1, ((point[0]! - start[0]!) * dx + (point[1]! - start[1]!) * dy) / lengthSquared));
  return Math.hypot(point[0]! - (start[0]! + ratio * dx), point[1]! - (start[1]! + ratio * dy));
}
function gapBetween(left: MultiPolygon, right: MultiPolygon) {
  let best = Infinity;
  for (const [source, target] of [[left, right], [right, left]] as const) {
    for (const polygon of source) for (const ring of polygon) for (const point of ring) {
      for (const targetPolygon of target) for (const targetRing of targetPolygon) {
        for (let index = 0; index < targetRing.length; index += 1) {
          best = Math.min(best, segmentDistance(point, targetRing[index]!, targetRing[(index + 1) % targetRing.length]!));
          if (best <= 1e-5) return 0;
        }
      }
    }
  }
  return best;
}

const sorted = [...levels].sort((left, right) => left.elevation - right.elevation);
for (let index = 0; index < sorted.length - 1; index += 1) {
  const lower = sorted[index]!;
  for (let next = index + 1; next < sorted.length; next += 1) {
    const upper = sorted[next]!;
    const rise = upper.elevation - lower.elevation;
    if (rise > 12) break;
    const joined = groups.some((group) =>
      group.levelIds.includes(lower.levelId) && group.levelIds.includes(upper.levelId));
    if (joined) continue;
    const left = geometries.get(lower.levelId) ?? [];
    const right = geometries.get(upper.levelId) ?? [];
    const leftArea = area(left), rightArea = area(right);
    const reasons: string[] = [];
    if (rise > 7) reasons.push(`rise ${feet(rise)} > 7.0'`);
    let stacked = Number.NaN, gap = Number.NaN;
    if (leftArea && rightArea && rise <= 7) {
      try { stacked = area(polygonClipping.intersection(left, right)) / Math.min(leftArea, rightArea); } catch { /* unstable sketch */ }
      if (stacked > 0.12) reasons.push(`stacked ${(stacked * 100).toFixed(1)}% > 12%`);
      else {
        gap = gapBetween(left, right);
        if (gap > 3) reasons.push(`edge gap ${feet(gap)} > 3.0'`);
      }
    }
    console.log(
      `  ${lower.levelId} @${feet(lower.elevation)} ↔ ${upper.levelId} @${feet(upper.elevation)}  ` +
      `rise ${feet(rise).padStart(6)}  ` +
      `gap ${Number.isFinite(gap) ? feet(gap).padStart(7) : "      —"}  ` +
      `stacked ${Number.isFinite(stacked) ? `${(stacked * 100).toFixed(1)}%`.padStart(6) : "     —"}  ` +
      `→ ${reasons.join(" · ") || "would join"}`,
    );
  }
}
