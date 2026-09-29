/**
 * Register each floor-plan sheet of a survey DWG onto a Pascal scene's walls.
 *
 * For every named sheet (paper-space layout) the DWG's wall linework (layer
 * `1_Wall_Exist`) is sampled, a coarse FFT correlation against the union of
 * the scene's wall faces proposes placements (rotation from the dominant wall
 * bearings, translation from the correlation peaks), robust ICP refines them,
 * and each refined placement is scored against every level separately; the
 * level whose wall faces the sheet lies on best is the sheet's level.
 *
 * Usage:
 *   node --experimental-strip-types scripts/register-dwg-sheets.ts drawing.dwg scene.pascal.json \
 *     [--json out.json] [--overlay-dir dir --overlay "03 CJMH LVL 2" ...] [--only "sheet name"]
 *
 * Writes one record per sheet: the similarity transform (DWG units → scene
 * metres), fitted scale, rotation, mirror flag, level, inlier ratio (share of
 * sheet sample points within 0.15 m of a wall face), RMS, the runner-up level,
 * and room-label sanity checks.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { entitiesWithin } from "../lib/reviter/dwg-plan.ts";
import type { DwgBounds, DwgEntity } from "../lib/reviter/dwg-plan.ts";
import {
  applySimilarity,
  candidateRotations,
  coarseCandidates,
  convexHull,
  correlationTarget,
  dominantBearings,
  fitStats,
  icpRefine,
  insideConvexHull,
  pointsBounds,
  sampleSegments,
  SegmentIndex,
  similarityMatrix,
  splitParts,
  thinPoints,
  transformSegments,
  wallRegions,
} from "../lib/reviter/dwg-registration.ts";
import type { Bounds, Segments, Similarity } from "../lib/reviter/dwg-registration.ts";
import { parseSheetName } from "../lib/reviter/dwg-room-labels.ts";
import { decodeDwg, roomLabelReport } from "./dwg-room-labels.ts";
import { renderSvgFiles } from "./render-svg.ts";
import { declareUsage, isEntryPoint, optionalPath, positionals } from "./lib/rvt-harness.ts";

const WALL_LAYER = "1_Wall_Exist";
/** Drawing units per scene metre: the survey is in millimetres. */
const DWG_SCALE = 0.001;
/** A sheet point within this distance (m) of a wall face is an inlier. */
const TOLERANCE = 0.15;

type SceneNode = {
  id: string;
  type: string;
  name?: string;
  parentId?: string;
  start?: [number, number];
  end?: [number, number];
  thickness?: number;
  metadata?: Record<string, unknown>;
};

export type SceneLevel = {
  id: string;
  name: string;
  revitLevelId: number | null;
  elevationFeet: number | null;
  /** Wall face lines (both faces and end caps), metres. */
  faces: Segments;
  wallCount: number;
};

/** Each level's wall faces: both long faces of every wall plus its end caps. */
export function sceneLevels(scene: { nodes: Record<string, SceneNode> }): SceneLevel[] {
  const nodes = Object.values(scene.nodes);
  return nodes.filter((node) => node.type === "level").map((level) => {
    const faces: number[] = [];
    let wallCount = 0;
    for (const wall of nodes) {
      if (wall.type !== "wall" || wall.parentId !== level.id || !wall.start || !wall.end) continue;
      const [x1, y1] = wall.start;
      const [x2, y2] = wall.end;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (!(length > 0)) continue;
      wallCount += 1;
      const half = (wall.thickness ?? 0) / 2;
      const nx = (-(y2 - y1) / length) * half;
      const ny = ((x2 - x1) / length) * half;
      if (half < 0.01) {
        faces.push(x1, y1, x2, y2);
        continue;
      }
      faces.push(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x1 - nx, y1 - ny, x2 - nx, y2 - ny);
      faces.push(x1 + nx, y1 + ny, x1 - nx, y1 - ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny);
    }
    const metadata = level.metadata ?? {};
    return {
      id: level.id,
      name: level.name ?? level.id,
      revitLevelId: typeof metadata.revitLevelId === "number" ? metadata.revitLevelId : null,
      elevationFeet: typeof metadata.revitElevationFeet === "number" ? metadata.revitElevationFeet : null,
      faces: Float64Array.from(faces),
      wallCount,
    };
  });
}

function inside(bounds: DwgBounds, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/** A sheet's wall linework as segments (DWG units), arcs tessellated. */
export function sheetWallSegments(entities: readonly DwgEntity[], bounds: DwgBounds): Segments {
  const out: number[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    // Neighbouring viewports overlap a little; keep only this sheet's lines.
    if (!inside(bounds, x1, y1) || !inside(bounds, x2, y2)) return;
    if (x1 === x2 && y1 === y2) return;
    out.push(x1, y1, x2, y2);
  };
  for (const entity of entitiesWithin(entities, bounds)) {
    if (entity.layer !== WALL_LAYER) continue;
    if (entity.points && entity.points.length > 1) {
      const points = entity.points;
      for (let k = 0; k + 1 < points.length; k += 1) push(points[k]![0], points[k]![1], points[k + 1]![0], points[k + 1]![1]);
      if (entity.closed) {
        const last = points[points.length - 1]!;
        push(last[0], last[1], points[0]![0], points[0]![1]);
      }
    } else if (entity.type === "ARC" && entity.centre && entity.radius && entity.startAngle != null && entity.endAngle != null) {
      let sweep = entity.endAngle - entity.startAngle;
      while (sweep <= 0) sweep += Math.PI * 2;
      const r = Math.abs(entity.radius);
      // Chords no longer than ~250 units (0.25 m) and no more than 64 of them.
      const steps = Math.min(64, Math.max(2, Math.ceil((r * sweep) / 250)));
      let px = entity.centre[0] + r * Math.cos(entity.startAngle);
      let py = entity.centre[1] + r * Math.sin(entity.startAngle);
      for (let k = 1; k <= steps; k += 1) {
        const angle = entity.startAngle + (sweep * k) / steps;
        const x = entity.centre[0] + r * Math.cos(angle);
        const y = entity.centre[1] + r * Math.sin(angle);
        push(px, py, x, y);
        px = x;
        py = y;
      }
    }
  }
  return Float64Array.from(out);
}

type SheetInput = {
  sheetId: number;
  title: string;
  building: string | null;
  dwgFloor: string | null;
  bounds: DwgBounds;
  segments: Segments;
  /** Floors the sheet's name gives ("2", "B"), for comparing sheets of a building. */
  floors: string[];
  /** For one drawing of several on a sheet: its number, largest first (1-based). */
  part?: number;
  /** Middle of the linework's extent (DWG units). */
  centre: [number, number];
  labels: { number: string; name: string | null; x: number; y: number }[];
};

type LevelScore = { levelIndex: number; inlierRatio: number; rms: number; coverage: number };

type Placement = {
  transform: Similarity;
  coarseScore: number;
  scores: LevelScore[];
};

/** Share of a level's wall-face samples, near the placed sheet, that lie on sheet lines. */
function coverage(
  sheetIndex: SegmentIndex, levelSamples: Float64Array, window: Bounds,
): number {
  let near = 0;
  let total = 0;
  for (let i = 0; i < levelSamples.length; i += 2) {
    const x = levelSamples[i]!;
    const y = levelSamples[i + 1]!;
    if (x < window.minX || x > window.maxX || y < window.minY || y > window.maxY) continue;
    total += 1;
    const hit = sheetIndex.nearest(x, y, TOLERANCE);
    if (hit && hit.distance <= TOLERANCE) near += 1;
  }
  return total ? near / total : 0;
}

/**
 * Where to look for a sheet whose building is already placed by a sibling
 * sheet: the sibling's rotations and reflection, and placements whose centre
 * lies within `radius` of a sibling's.
 */
export type SheetHint = { thetas: number[]; mirror: boolean; near: [number, number][]; radius: number };

export function sheetRegistrar(levels: readonly SceneLevel[], log: (text: string) => void = () => {}) {
  const started = Date.now();
  const allFaces = Float64Array.from(levels.flatMap((level) => [...level.faces]));
  const target = correlationTarget(allFaces, { cell: 1, sigma: 1, maxSheetSize: 170 });
  const unionIndex = new SegmentIndex(allFaces, 0.5);
  const levelIndexes = levels.map((level) => new SegmentIndex(level.faces, 0.5));
  const levelSamples = levels.map((level) => thinPoints(sampleSegments(level.faces, 0.25), 0.2));
  const levelTargets = new Map<number, ReturnType<typeof correlationTarget>>();
  const levelTarget = (levelIndex: number) => {
    let found = levelTargets.get(levelIndex);
    if (!found) {
      found = correlationTarget(levels[levelIndex]!.faces, { cell: 1, sigma: 1, maxSheetSize: 170 });
      levelTargets.set(levelIndex, found);
    }
    return found;
  };
  // Every level's dominant bearings: a building drawn at its own angle may
  // dominate one level and be a sliver of the union.
  const targetBearings: number[] = [];
  for (const faces of [allFaces, ...levels.map((level) => level.faces)]) {
    for (const peak of dominantBearings(faces, { minShare: 0.05, limit: 4 })) {
      if (!targetBearings.some((d) => Math.abs(((d - peak.degrees + 135) % 90) - 45) < 1.5)) targetBearings.push(peak.degrees);
    }
  }
  log(`targets ready in ${Date.now() - started} ms; model bearings ${targetBearings.map((d) => d.toFixed(1)).join(", ")}`);

  return (sheet: SheetInput, hint?: SheetHint, mirrors?: readonly boolean[]) => {
    const t0 = Date.now();
    const samplesDwg = thinPoints(sampleSegments(sheet.segments, 250), 150);
    const coarsePoints = thinPoints(samplesDwg, 600, 800);
    const finePoints = thinPoints(samplesDwg, 150, 4000);
    let placements: Placement[];
    let rotations: number;
    if (hint) {
      // Search each level on its own, at the sibling's rotation, near the
      // sibling: a sparse level no longer competes with the whole model.
      rotations = hint.thetas.length;
      placements = [];
      levels.forEach((level, levelIndex) => {
        if (level.faces.length < 40) return;
        const coarse = coarseCandidates(levelTarget(levelIndex), sheet.segments, {
          scale: DWG_SCALE, thetas: hint.thetas, mirrors: [hint.mirror], peaksPerRotation: 8,
        }).filter((candidate) => {
          const [x, y] = centreOf(sheet, candidate.transform);
          return hint.near.some(([nx, ny]) => Math.hypot(nx - x, ny - y) <= hint.radius);
        });
        for (const candidate of coarse.slice(0, 2)) {
          placements.push({
            transform: icpRefine(levelIndexes[levelIndex]!, finePoints, candidate.transform, { schedule: [2, 1, 0.5, 0.25, 0.15] }),
            coarseScore: candidate.score,
            scores: [],
          });
        }
      });
    } else {
    const sheetBearings = dominantBearings(sheet.segments, { minShare: 0.15, limit: 2 }).map((peak) => peak.degrees);
    const thetas = candidateRotations(targetBearings, sheetBearings.length ? sheetBearings : [0]);
    rotations = thetas.length;
    const coarse = coarseCandidates(target, sheet.segments, {
      scale: DWG_SCALE, thetas, tryMirror: true, mirrors, peaksPerRotation: 3,
    });
    // Keep distinct placements only.
    const distinct: typeof coarse = [];
    for (const candidate of coarse) {
      if (distinct.length >= 12) break;
      const [cx, cy] = centreOf(sheet, candidate.transform);
      if (distinct.some((other) => {
        const [ox, oy] = centreOf(sheet, other.transform);
        return other.transform.mirror === candidate.transform.mirror
          && Math.abs(angleDiff(other.transform.theta, candidate.transform.theta)) < 0.05
          && Math.hypot(ox - cx, oy - cy) < 4;
      })) continue;
      distinct.push(candidate);
    }

    // Pull each onto the union of all levels first (buildings keep their plan
    // position from floor to floor) and screen cheaply; only the best few get
    // the fine fit against their best level.
    const screened = distinct.map((candidate) => {
      const transform = icpRefine(unionIndex, coarsePoints, candidate.transform, { schedule: [2, 1, 0.5] });
      const quick = levelIndexes.map((index, levelIndex) => ({ levelIndex, ...fitStats(index, coarsePoints, transform, 0.3) }))
        .sort((a, b) => b.inlierRatio - a.inlierRatio);
      return { transform, coarseScore: candidate.score, quick: quick[0]! };
    }).sort((a, b) => b.quick.inlierRatio - a.quick.inlierRatio);
    if (process.env.DEBUG_REGISTRATION) {
      for (const c of screened) log(`  screened θ=${(c.transform.theta * 180 / Math.PI).toFixed(1)} m=${c.transform.mirror} coarse=${c.coarseScore.toFixed(3)} quick=${levels[c.quick.levelIndex]!.name} ${c.quick.inlierRatio.toFixed(3)} at ${centreOf(sheet, c.transform).map((v) => v.toFixed(1))}`);
    }
    placements = screened.slice(0, 5).map((candidate) => ({
      transform: icpRefine(levelIndexes[candidate.quick.levelIndex]!, finePoints, candidate.transform, { schedule: [1, 0.5, 0.25, 0.15] }),
      coarseScore: candidate.coarseScore,
      scores: [],
    }));
    }
    // Score every refined placement against every level.
    for (const placement of placements) {
      placement.scores = levelIndexes.map((index, levelIndex) => {
        const stats = fitStats(index, finePoints, placement.transform, TOLERANCE);
        return { levelIndex, inlierRatio: stats.inlierRatio, rms: stats.rms, coverage: 0 };
      }).sort((a, b) => b.inlierRatio - a.inlierRatio);
    }
    placements.sort((a, b) => b.scores[0]!.inlierRatio - a.scores[0]!.inlierRatio);
    const winner = placements[0];
    if (!winner) return { sheet, result: null, elapsed: Date.now() - t0 };

    // The best level and the runner-up each get their own refinement, so the
    // comparison is not biased towards the level the placement was fitted to.
    const contenders = winner.scores.slice(0, 3).map((score) => {
      const index = levelIndexes[score.levelIndex]!;
      const transform = icpRefine(index, finePoints, winner.transform, { schedule: [0.5, 0.25, 0.15] });
      const stats = fitStats(index, finePoints, transform, TOLERANCE);
      return { levelIndex: score.levelIndex, transform, ...stats };
    }).sort((a, b) => b.inlierRatio - a.inlierRatio);
    const chosen = contenders[0]!;
    const runnerUp = contenders[1] ?? null;
    // Free-scale refinement, reported (the transform keeps it).
    const scaled = icpRefine(levelIndexes[chosen.levelIndex]!, finePoints, chosen.transform, {
      schedule: [0.5, 0.25, 0.15], fitScale: true,
    });
    const scaledStats = fitStats(levelIndexes[chosen.levelIndex]!, finePoints, scaled, TOLERANCE);

    // Coverage: how much of the chosen (and runner-up) level's walls, inside
    // the placed sheet's extent, the sheet explains.
    const placedSegments = transformSegments(chosen.transform, sheet.segments);
    const placedIndex = new SegmentIndex(placedSegments, 0.5);
    const window = pointsBounds(thinPoints(sampleSegments(placedSegments, 0.5), 0.5));
    const coverageOf = (levelIndex: number) => coverage(placedIndex, levelSamples[levelIndex]!, window);

    // Second-best distinct placement (a different position or rotation), for
    // the ambiguity check.
    const alternative = placements.slice(1).find((placement) => {
      const [ax, ay] = centreOf(sheet, placement.transform);
      const [bx, by] = centreOf(sheet, chosen.transform);
      return Math.hypot(ax - bx, ay - by) > 3 || Math.abs(angleDiff(placement.transform.theta, chosen.transform.theta)) > 0.05
        || placement.transform.mirror !== chosen.transform.mirror;
    }) ?? null;

    return {
      sheet,
      result: {
        chosen, runnerUp, scaled, scaledStats,
        chosenCoverage: coverageOf(chosen.levelIndex),
        runnerUpCoverage: runnerUp ? coverageOf(runnerUp.levelIndex) : null,
        alternative: alternative
          ? { transform: alternative.transform, levelIndex: alternative.scores[0]!.levelIndex, inlierRatio: alternative.scores[0]!.inlierRatio }
          : null,
        candidates: placements.length,
        rotations,
        hinted: Boolean(hint),
        allLevels: winner.scores,
      },
      elapsed: Date.now() - t0,
    };
  };
}

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Where the middle of the sheet's linework lands. */
function centreOf(sheet: SheetInput, transform: Similarity): [number, number] {
  return applySimilarity(transform, sheet.centre[0], sheet.centre[1]);
}

/** Label sanity checks on the chosen level: inside the wall hull, in a closed region, alone in it. */
function labelChecks(sheet: SheetInput, transform: Similarity, level: SceneLevel) {
  const placed = sheet.labels.map((label) => applySimilarity(transform, label.x, label.y));
  if (!placed.length) return { labels: 0, inHull: 0, inClosedRegion: 0, sharingRegion: 0, onWall: 0 };
  const placedSheet = transformSegments(transform, sheet.segments);
  const box = pointsBounds(placedSheet);
  const margin = 5;
  const window = { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
  const nearby: number[] = [];
  const hullPoints: number[] = [];
  for (let i = 0; i < level.faces.length; i += 4) {
    const f = level.faces;
    const midX = (f[i]! + f[i + 2]!) / 2;
    const midY = (f[i + 1]! + f[i + 3]!) / 2;
    if (midX < window.minX || midX > window.maxX || midY < window.minY || midY > window.maxY) continue;
    nearby.push(f[i]!, f[i + 1]!, f[i + 2]!, f[i + 3]!);
    hullPoints.push(f[i]!, f[i + 1]!, f[i + 2]!, f[i + 3]!);
  }
  const hull = convexHull(Float64Array.from(hullPoints));
  const inHull = placed.filter(([x, y]) => insideConvexHull(hull, x, y)).length;
  const { region, open } = wallRegions(Float64Array.from(nearby), placed, { cell: 0.1, thicken: 1, bounds: window });
  const counts = new Map<number, number>();
  for (const id of region) if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  // Corridors and stairs are often drawn as several tagged pieces of one open
  // space, so sharing is reported, not failed.
  const inClosed = region.filter((id) => id >= 0 && !open[id]).length;
  const sharing = region.filter((id) => id >= 0 && !open[id] && (counts.get(id) ?? 0) > 1).length;
  return {
    labels: placed.length,
    inHull,
    inClosedRegion: inClosed,
    sharingRegion: sharing,
    onWall: region.filter((id) => id < 0).length,
    placed,
    region,
  };
}

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

function overlaySvg(
  sheet: SheetInput, transform: Similarity, level: SceneLevel, labelsPlaced: [number, number][],
  heading: string,
): string {
  const placed = transformSegments(transform, sheet.segments);
  const box = pointsBounds(placed);
  const margin = 6;
  const minX = box.minX - margin;
  const maxX = box.maxX + margin;
  const minY = box.minY - margin;
  const maxY = box.maxY + margin;
  const width = maxX - minX;
  const height = maxY - minY;
  const pixels = 2400;
  const lines = (segments: Segments, stroke: string, strokeWidth: number, filter?: (x: number, y: number) => boolean) => {
    let d = "";
    for (let i = 0; i < segments.length; i += 4) {
      const x1 = segments[i]!;
      const y1 = segments[i + 1]!;
      const x2 = segments[i + 2]!;
      const y2 = segments[i + 3]!;
      if (filter && !filter(x1, y1) && !filter(x2, y2)) continue;
      d += `M${x1.toFixed(2)} ${(-y1).toFixed(2)}L${x2.toFixed(2)} ${(-y2).toFixed(2)}`;
    }
    return `<path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round"/>`;
  };
  const within = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const labels = labelsPlaced.map(([x, y], index) => {
    const text = sheet.labels[index]!.number.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);
    return `<circle cx="${x.toFixed(2)}" cy="${(-y).toFixed(2)}" r="0.35" fill="#1d4ed8"/>` +
      `<text x="${(x + 0.5).toFixed(2)}" y="${(-y + 0.3).toFixed(2)}" font-size="0.9" fill="#1d4ed8" font-family="sans-serif">${text}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${Math.round((pixels * height) / width) + 60}" ` +
    `viewBox="${minX.toFixed(2)} ${(-maxY - (60 * width) / pixels).toFixed(2)} ${width.toFixed(2)} ${(height + (60 * width) / pixels).toFixed(2)}" style="background:#fff">` +
    `<rect x="${minX}" y="${-maxY - (60 * width) / pixels}" width="${width}" height="${height + (60 * width) / pixels}" fill="#fff"/>` +
    lines(level.faces, "#9ca3af", 0.12, within) +
    lines(placed, "#dc2626", 0.05) +
    labels +
    `<text x="${(minX + 1).toFixed(2)}" y="${(-maxY - (20 * width) / pixels).toFixed(2)}" font-size="${((28 * width) / pixels).toFixed(2)}" font-family="sans-serif">${heading.replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`)}</text>` +
    `</svg>`;
}

async function main() {
  declareUsage(
    "register-dwg-sheets.ts drawing.dwg scene.pascal.json [--json out.json] [--overlay-dir dir --overlay \"sheet\" ...] [--only \"sheet\" ...]",
  );
  const [dwgPath, scenePath] = positionals("--json", "--overlay-dir", "--overlay", "--only");
  if (!dwgPath || !scenePath) throw new Error("usage: register-dwg-sheets.ts drawing.dwg scene.pascal.json [--json out.json]");
  const argv = process.argv;
  const many = (flag: string) => argv.flatMap((value, index) => (argv[index - 1] === flag ? [value] : []));
  const only = new Set(many("--only"));
  const log = (text: string) => process.stderr.write(`${text}\n`);

  const started = Date.now();
  const database = await decodeDwg(dwgPath);
  const { entities, labels, plans, assignment } = roomLabelReport(database, { source: dwgPath });
  const sheets: SheetInput[] = plans.map((plan, index) => {
    const parsed = parseSheetName(plan.name);
    const segments = sheetWallSegments(entities, plan.bounds);
    const box = segments.length ? pointsBounds(segments) : plan.bounds;
    return {
      sheetId: index,
      title: plan.name,
      building: parsed.building,
      dwgFloor: parsed.levels.length ? parsed.levels.join("+") + (parsed.part ? ` (${parsed.part})` : "") : (parsed.part ?? null),
      bounds: plan.bounds,
      segments,
      floors: parsed.levels,
      centre: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] as [number, number],
      labels: labels.filter((_, labelIndex) => assignment[labelIndex] === index).map((label) => ({
        number: label.number, name: label.name, x: label.position[0], y: label.position[1],
      })),
    };
  }).filter((sheet) => !only.size || only.has(sheet.title));
  log(`decoded ${plans.length} sheets in ${Date.now() - started} ms`);

  const scene = JSON.parse(readFileSync(scenePath, "utf8")) as { nodes: Record<string, SceneNode> };
  const levels = sceneLevels(scene);
  const register = sheetRegistrar(levels, log);
  const results = sheets.map((sheet) => {
    const found = register(sheet);
    logResult(found, levels, log, "pass 1");
    return found;
  });

  // The drawing is one survey and the scene one frame, so every sheet shares
  // the reflection between them; the confident sheets vote on which it is.
  const votes = results.filter((found) => (found.result?.chosen.inlierRatio ?? 0) >= 0.5)
    .map((found) => found.result!.chosen.transform.mirror);
  expectedMirror = votes.length ? votes.filter(Boolean).length * 2 >= votes.length : null;
  log(`reflection: ${expectedMirror} (${votes.filter(Boolean).length} of ${votes.length} confident sheets mirrored)`);

  // Pass 2: a sheet that did not register cleanly, in a building another
  // sheet did register, is searched again level by level at that sheet's
  // rotation and near its position.
  const statusOf = (found: Registered) => found.result ? provisionalStatus(found.sheet, found.result, levels) : "no-match";
  const hintFor = (sheet: SheetInput, pool: readonly Registered[]): SheetHint | null => {
    const siblings = pool.filter((other) =>
      other.sheet !== sheet && other.result && other.sheet.building === sheet.building && statusOf(other) === "registered");
    if (!sheet.building || !siblings.length) return null;
    const thetas: number[] = [];
    for (const sibling of siblings) {
      const theta = sibling.result!.chosen.transform.theta;
      if (!thetas.some((other) => Math.abs(angleDiff(other, theta)) < 0.01)) thetas.push(theta);
    }
    const mirrors = siblings.map((sibling) => sibling.result!.chosen.transform.mirror);
    return {
      thetas,
      mirror: mirrors.filter(Boolean).length * 2 >= mirrors.length,
      radius: 45,
      near: siblings.map((sibling) => centreOf(sibling.sheet, sibling.result!.chosen.transform)),
    };
  };
  const merit = (found: Registered) => !found.result ? 0
    : found.result.chosen.inlierRatio * (expectedMirror == null || found.result.chosen.transform.mirror === expectedMirror ? 1 : 0.5);
  const better = (a: Registered, b: Registered) => (merit(a) >= merit(b) ? a : b);
  const firstPass = [...results];
  results.forEach((found, index) => {
    if (statusOf(found) === "registered") return;
    const hint = hintFor(found.sheet, firstPass);
    // Without a sibling, search again only if the first pass settled on the
    // wrong reflection, so the sheet's best consistent placement is reported.
    if (!hint && (expectedMirror == null || found.result?.chosen.transform.mirror === expectedMirror)) return;
    const again = hint ? register(found.sheet, hint) : register(found.sheet, undefined, [expectedMirror!]);
    logResult(again, levels, log, hint ? "pass 2" : "pass 2m");
    results[index] = { ...better(again, found), elapsed: again.elapsed + found.elapsed };
  });

  // Pass 3: a sheet that still does not register may hold several drawings
  // side by side (two floors, or two wings not at their true offset). Each
  // drawing is placed on its own.
  const partResults: Registered[] = [];
  results.forEach((found) => {
    if (statusOf(found) === "registered") return;
    const parts = splitParts(found.sheet.segments, { cell: 500, gap: 3000, minShare: 0.05, minLength: 50_000 });
    if (parts.length < 2) return;
    parts.forEach((segments, partIndex) => {
      const box = pointsBounds(segments);
      const margin = 1000;
      const sheet: SheetInput = {
        ...found.sheet,
        title: `${found.sheet.title} #${partIndex + 1}`,
        part: partIndex + 1,
        bounds: { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin },
        segments,
        centre: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2],
        labels: found.sheet.labels.filter((label) => label.x >= box.minX - margin && label.x <= box.maxX + margin
          && label.y >= box.minY - margin && label.y <= box.maxY + margin),
      };
      let best = register(sheet, undefined, expectedMirror == null ? undefined : [expectedMirror]);
      logResult(best, levels, log, "pass 3");
      const hint = hintFor(sheet, results);
      if (hint && statusOf(best) !== "registered") {
        const again = register(sheet, hint);
        logResult(again, levels, log, "pass 3h");
        best = { ...better(again, best), elapsed: again.elapsed + best.elapsed };
      }
      partResults.push(best);
    });
  });
  results.push(...partResults);

  const records = results.map(({ sheet, result, elapsed }) => {
    if (!result) {
      log(`${sheet.title}: no candidates`);
      return { sheetId: sheet.sheetId, title: sheet.title, building: sheet.building, dwgFloor: sheet.dwgFloor, status: "no-match" as const };
    }
    const { chosen, runnerUp, scaled, scaledStats } = result;
    const level = levels[chosen.levelIndex]!;
    const checks = labelChecks(sheet, chosen.transform, level);
    const margin = runnerUp ? chosen.inlierRatio - runnerUp.inlierRatio : chosen.inlierRatio;
    const status = classify(chosen.inlierRatio, margin, result.alternative?.inlierRatio ?? 0, checks, chosen.transform, scaled.scale);
    const record = {
      sheetId: sheet.sheetId,
      title: sheet.title,
      ...(sheet.part ? { part: sheet.part, partBounds: sheet.bounds } : {}),
      building: sheet.building,
      dwgFloor: sheet.dwgFloor,
      status,
      rvtLevelNodeId: level.id,
      rvtLevelName: level.name,
      revitLevelId: level.revitLevelId,
      elevation: level.elevationFeet == null ? null : round(level.elevationFeet * 0.3048, 3),
      elevationFeet: level.elevationFeet == null ? null : round(level.elevationFeet, 3),
      transform: {
        scale: chosen.transform.scale,
        theta: round(chosen.transform.theta, 7),
        tx: round(chosen.transform.tx, 4),
        ty: round(chosen.transform.ty, 4),
        mirror: chosen.transform.mirror,
        matrix: Object.fromEntries(Object.entries(similarityMatrix(chosen.transform)).map(([k, v]) => [k, Number(v.toPrecision(10))])),
      },
      scale: Number(scaled.scale.toPrecision(6)),
      scaleInlierRatio: round(scaledStats.inlierRatio),
      thetaDeg: round((chosen.transform.theta * 180) / Math.PI, 3),
      mirror: chosen.transform.mirror,
      inlierRatio: round(chosen.inlierRatio),
      rmsMetres: round(chosen.rms),
      samplePoints: chosen.total,
      coverage: round(result.chosenCoverage),
      runnerUp: runnerUp ? {
        level: levels[runnerUp.levelIndex]!.id,
        levelName: levels[runnerUp.levelIndex]!.name,
        inlierRatio: round(runnerUp.inlierRatio),
        coverage: result.runnerUpCoverage == null ? null : round(result.runnerUpCoverage),
      } : null,
      levelMargin: round(margin),
      levelConfidence: margin >= 0.1 ? "high" : margin >= 0.04 ? "medium" : "low",
      searchedNearSibling: result.hinted,
      alternativePlacement: result.alternative ? {
        thetaDeg: round((result.alternative.transform.theta * 180) / Math.PI, 2),
        tx: round(result.alternative.transform.tx, 2),
        ty: round(result.alternative.transform.ty, 2),
        mirror: result.alternative.transform.mirror,
        level: levels[result.alternative.levelIndex]!.id,
        inlierRatio: round(result.alternative.inlierRatio),
      } : null,
      allLevels: result.allLevels.map((score) => ({ level: levels[score.levelIndex]!.id, inlierRatio: round(score.inlierRatio) })),
      labels: {
        count: checks.labels,
        inWallHull: checks.inHull,
        inClosedRegion: checks.inClosedRegion,
        sharingRegion: checks.sharingRegion,
        onWall: checks.onWall,
      },
      placedLabels: (checks.placed ?? []).map(([x, y], index) => ({ number: sheet.labels[index]!.number, x: round(x, 3), y: round(y, 3) })),
      seconds: round(elapsed / 1000, 1),
    };
    log(`${sheet.title.padEnd(28)} ${status.padEnd(10)} ${level.name.padEnd(20)} in=${record.inlierRatio.toFixed(3)} ` +
      `2nd=${record.runnerUp?.inlierRatio.toFixed(3)} (${record.runnerUp?.levelName}) alt=${record.alternativePlacement?.inlierRatio.toFixed(3)} ` +
      `θ=${record.thetaDeg.toFixed(2)} m=${record.mirror} s=${record.scale} rms=${record.rmsMetres.toFixed(3)} ` +
      `cov=${record.coverage.toFixed(2)} hull=${checks.inHull}/${checks.labels} closed=${checks.inClosedRegion} ${record.seconds}s`);
    return record;
  });

  // What the building's other sheets say: the level each registered sheet of
  // the same building and floor was placed on. A floor the walls cannot place
  // (an atrium modelled as full-height walls on the ground level, a basement
  // the model lacks) can still take its level from a sibling.
  for (const record of records) {
    const sheet = results.find((found) => found.sheet.title === record.title)!.sheet;
    const byFloor: Record<string, string[]> = {};
    for (const floor of sheet.floors) {
      const levelsForFloor = new Set<string>();
      for (const other of records) {
        if (other === record || other.status !== "registered" || other.building !== record.building || !("rvtLevelNodeId" in other)) continue;
        const otherSheet = results.find((found) => found.sheet.title === other.title)!.sheet;
        if (otherSheet.floors.length === 1 && otherSheet.floors[0] === floor) levelsForFloor.add(other.rvtLevelNodeId);
      }
      if (levelsForFloor.size) byFloor[floor] = [...levelsForFloor];
    }
    Object.assign(record, { siblingLevelsByFloor: byFloor });
    // A partial fit is only a placement when a registered sibling vouches for
    // the building being in the scene; a small sheet of an absent building
    // lands a third of its lines on some wall somewhere.
    const vouched = records.some((other) => other !== record && other.status === "registered" && other.building === record.building);
    if (record.status === "ambiguous" && !vouched && "inlierRatio" in record && record.inlierRatio < 0.5) {
      Object.assign(record, { status: "no-match" });
    }
  }

  const out = optionalPath("--json");
  const json = {
    source: { dwg: dwgPath, scene: scenePath },
    method: {
      dwgUnitsPerMetre: 1 / DWG_SCALE,
      inlierToleranceMetres: TOLERANCE,
      transform: "p_scene = scale · R(theta) · M · p_dwg + (tx, ty); M reflects x when mirror; matrix: x' = a·x + c·y + e, y' = b·x + d·y + f",
      scaleNote: "`transform.scale` is fixed at 0.001 (mm → m); `scale` is the free-scale ICP fit, reported as a check.",
    },
    levels: levels.map((level) => ({ id: level.id, name: level.name, revitLevelId: level.revitLevelId, elevationFeet: level.elevationFeet, walls: level.wallCount })),
    sheets: records,
  };
  if (out) writeFileSync(out, `${JSON.stringify(json, null, 1)}\n`);

  const overlayDir = optionalPath("--overlay-dir");
  if (overlayDir) {
    mkdirSync(overlayDir, { recursive: true });
    const wanted = many("--overlay");
    const pairs: [string, string][] = [];
    for (const name of wanted.length ? wanted : records.map((record) => record.title)) {
      const index = records.findIndex((record) => record.title === name);
      const record = records[index];
      const found = results[index];
      if (!record || !found?.result || !("rvtLevelNodeId" in record)) { log(`no overlay for ${name}`); continue; }
      const level = levels[found.result.chosen.levelIndex]!;
      const checks = labelChecks(found.sheet, found.result.chosen.transform, level);
      const heading = `${record.title} → ${level.name} (${record.elevationFeet} ft) · inliers ${(record.inlierRatio * 100).toFixed(1)}% ` +
        `(runner-up ${record.runnerUp?.levelName} ${((record.runnerUp?.inlierRatio ?? 0) * 100).toFixed(1)}%) · θ ${record.thetaDeg.toFixed(2)}° · ` +
        `rms ${(record.rmsMetres * 1000).toFixed(0)} mm · ${record.status}`;
      const base = join(overlayDir, name.replace(/[^\w.-]+/gu, "-"));
      writeFileSync(`${base}.svg`, overlaySvg(found.sheet, found.result.chosen.transform, level, checks.placed ?? [], heading));
      pairs.push([`${base}.svg`, `${base}.png`]);
    }
    await renderSvgFiles(pairs, 2400);
  }
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

type Registered = ReturnType<ReturnType<typeof sheetRegistrar>>;

function provisionalStatus(sheet: SheetInput, result: NonNullable<Registered["result"]>, levels: readonly SceneLevel[]) {
  const checks = labelChecks(sheet, result.chosen.transform, levels[result.chosen.levelIndex]!);
  const margin = result.runnerUp ? result.chosen.inlierRatio - result.runnerUp.inlierRatio : result.chosen.inlierRatio;
  return classify(result.chosen.inlierRatio, margin, result.alternative?.inlierRatio ?? 0, checks,
    result.chosen.transform, result.scaled.scale);
}

function logResult(found: Registered, levels: readonly SceneLevel[], log: (text: string) => void, pass: string) {
  const result = found.result;
  if (!result) { log(`${pass} ${found.sheet.title}: no candidates`); return; }
  const status = provisionalStatus(found.sheet, result, levels);
  log(`${pass} ${found.sheet.title.padEnd(28)} ${status.padEnd(10)} ${levels[result.chosen.levelIndex]!.name.padEnd(20)} ` +
    `in=${result.chosen.inlierRatio.toFixed(3)} 2nd=${result.runnerUp?.inlierRatio.toFixed(3)} ` +
    `(${result.runnerUp ? levels[result.runnerUp.levelIndex]!.name : "-"}) alt=${result.alternative?.inlierRatio.toFixed(3)} ` +
    `θ=${((result.chosen.transform.theta * 180) / Math.PI).toFixed(2)} m=${result.chosen.transform.mirror} ` +
    `s=${result.scaled.scale.toPrecision(6)} rms=${result.chosen.rms.toFixed(3)} ${(found.elapsed / 1000).toFixed(1)}s`);
}

/** The reflection every sheet shares, once the confident sheets have voted. */
let expectedMirror: boolean | null = null;

/**
 * - no-match: under 30 % of the sheet's sample points on a wall face, the
 *   other reflection, a scale more than 0.5 % off millimetres, or half its
 *   labels outside the walls' hull: nothing in the scene is this drawing.
 * - registered: at least half the points on a wall face, a level ahead of the
 *   next by at least 2 points, no other placement within 5 points, and the
 *   labels inside the walls' hull.
 * - ambiguous: placed, but either the fit is partial (the floor is only partly
 *   modelled, or the level holding it is absent) or the level is a toss-up.
 */
function classify(
  inlierRatio: number, levelMargin: number, alternativeRatio: number,
  checks: { labels: number; inHull: number }, transform: Similarity, fittedScale: number,
): "registered" | "ambiguous" | "no-match" {
  const labelShare = checks.labels ? checks.inHull / checks.labels : 1;
  if (inlierRatio < 0.3 || labelShare < 0.5) return "no-match";
  if (expectedMirror != null && transform.mirror !== expectedMirror) return "no-match";
  if (Math.abs(fittedScale / DWG_SCALE - 1) > 0.005) return "no-match";
  if (inlierRatio >= 0.5 && levelMargin >= 0.02 && inlierRatio - alternativeRatio >= 0.05 && labelShare >= 0.9) return "registered";
  return "ambiguous";
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
