/**
 * Numbered rooms for an RVT with no native Rooms, from a registered survey DWG.
 *
 * Every room label (`ROOMNUM`/`ROOMUSE`) on a DWG sheet that
 * `register-dwg-sheets.ts` registered onto a Revit level becomes a seed; the
 * level's healed wall bodies, door closures and the sheet's own wall linework
 * become barriers; `lib/reviter/dwg-rooms.ts` floods from all seeds at once
 * and traces one boundary per label. The result is written as
 *
 * - a `RoomAnnotationSet` sidecar in Revit model feet (merged into the
 *   existing one if `--out` already exists, so manual edits survive),
 * - a diagnostics report (per room and per sheet),
 * - the healed Pascal scene with one `zone` node per room,
 * - an IFC with one `IfcSpace` per room (not with `--cache`),
 * - optional verification SVGs/PNGs per sheet.
 *
 * Usage:
 *   node --experimental-strip-types scripts/build-dwg-rooms.ts work/unbc.rvt work/floorplan.dwg \
 *     work/findings/dwg-registration.json \
 *     --out work/out/unbc.rooms.json --report work/out/unbc.rooms.report.json \
 *     --pascal-in work/out/unbc.healed.pascal.json --pascal-out work/out/unbc.rooms.pascal.json \
 *     --ifc-out work/out/unbc.rooms.ifc \
 *     [--svg-dir work/findings/rooms --svg-level 694 --svg-level 311 --png]
 *     [--cache slim-conversion.json] [--fresh] [--cell 0.4]
 *
 * `--cache` reads a JSON conversion subset (`fileName`, `origin`, `levels`,
 * relations, `drawnElementIds`, `elementBounds`) instead of converting the
 * RVT; there is then no IFC. Without `--pascal-in` the Pascal scene is
 * exported from the conversion with `healJoins`, which heals a second time.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import type { DwgRoomLabel } from "../lib/reviter/dwg-room-labels.ts";
import { parseSheetName } from "../lib/reviter/dwg-room-labels.ts";
import {
  dwgBarrierSegments,
  dwgPrimitivesWithin,
  levelFloorBound,
  levelRoomBarriers,
  roomRegions,
} from "../lib/reviter/dwg-rooms.ts";
import type {
  DwgBarrierReport,
  PlanAffine,
  PlanBounds,
  Point2,
  RoomBarrier,
  RoomRegion,
  RoomRegionFailure,
  RoomSeed,
} from "../lib/reviter/dwg-rooms.ts";
import { makeIfcCenterlines } from "../lib/reviter/export-ifc.ts";
import { makePascalScene } from "../lib/reviter/export-pascal.ts";
import { healConvertResult } from "../lib/reviter/heal-walls.ts";
import {
  annotationsToReviewedRooms,
  appendRoomZones,
  feetToPascalPlan,
  makeRoomAnnotationSet,
  mergeRoomAnnotations,
  pascalFrameFor,
  readPascalFrame,
} from "../lib/reviter/room-annotations.ts";
import type { PascalBuild, PascalFrame, RoomAnnotation, RoomAnnotationSet } from "../lib/reviter/room-annotations.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { decodeDwg, roomLabelReport } from "./dwg-room-labels.ts";
import { declareUsage, hasFlag, isEntryPoint, numberOption, optionValue, positionals } from "./lib/rvt-harness.ts";
import { renderSvgFiles } from "./render-svg.ts";

const METRES_PER_FOOT = 0.3048;

/** One record of `dwg-registration.json` (the fields used here). */
export type RegistrationRecord = {
  sheetId: number;
  title: string;
  part?: number;
  partBounds?: PlanBounds;
  building: string | null;
  dwgFloor: string | null;
  status: "registered" | "ambiguous" | "no-match";
  revitLevelId: number;
  elevationFeet: number;
  transform: { matrix: PlanAffine };
  inlierRatio: number;
  levelConfidence?: string;
  siblingLevelsByFloor?: Record<string, string[]>;
};

export type EmissionLevel = { levelId: number; source: "sheet" | "siblings"; sheetLevelId: number };

const levelIdOf = (nodeId: string) => Number(nodeId.replace(/^level_r/u, ""));

/**
 * The level a registered sheet's rooms go on. Normally the level its walls
 * fitted best; but a sheet drawing an atrium, whose full-height walls live
 * only on the floor they start from, fits that floor whatever storey it
 * shows. When every other registered sheet of the building and floor agrees
 * on a single level and the sheet's own level is not among them, theirs is
 * used. Split parts inherit their parent's floor name, which may be wrong
 * for the part, so they keep their own level.
 */
export function emissionLevel(record: RegistrationRecord): EmissionLevel {
  const own = { levelId: record.revitLevelId, source: "sheet" as const, sheetLevelId: record.revitLevelId };
  if (record.part != null) return own;
  const floors = parseSheetName(record.title).levels;
  if (floors.length !== 1) return own;
  const siblings = [...new Set((record.siblingLevelsByFloor?.[floors[0]!] ?? []).map(levelIdOf))];
  if (!siblings.length || siblings.includes(record.revitLevelId) || siblings.length !== 1) return own;
  return { levelId: siblings[0]!, source: "siblings", sheetLevelId: record.revitLevelId };
}

/** DWG units → Pascal metres (the registration's matrix) → Revit feet (the export's frame). */
export function dwgToFeet(matrix: PlanAffine, frame: PascalFrame): PlanAffine {
  const k = 1 / frame.metresPerFoot;
  const s = frame.planSign;
  return {
    a: matrix.a * k, c: matrix.c * k, e: matrix.e * k + frame.originFeet.x,
    b: s * matrix.b * k, d: s * matrix.d * k, f: s * matrix.f * k + frame.originFeet.y,
  };
}

const applyAffine = (m: PlanAffine, point: readonly [number, number]): Point2 =>
  [m.a * point[0] + m.c * point[1] + m.e, m.b * point[0] + m.d * point[1] + m.f];

type SheetJob = {
  key: string;
  record: RegistrationRecord;
  level: EmissionLevel;
  toFeet: PlanAffine;
  labels: DwgRoomLabel[];
  seeds: RoomSeed[];
  dwgBarriers: RoomBarrier[];
  dwgReport: DwgBarrierReport;
  window: PlanBounds;
  skippedLabels: { number: string; reason: string }[];
};

type RoomOutcome = { job: SheetJob; region: RoomRegion };

function boundsOf(points: Iterable<readonly [number, number]>, margin: number): PlanBounds {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

const overlaps = (a: PlanBounds, b: PlanBounds) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Seeds for one sheet: a tag is a room; loose text repeating a tag's number is another seed of it. */
function sheetSeeds(key: string, labels: readonly DwgRoomLabel[], toFeet: PlanAffine) {
  const seeds: RoomSeed[] = [];
  const skipped: { number: string; reason: string }[] = [];
  const tagged = new Map<string, string>();
  labels.forEach((label, index) => {
    if (label.source === "attribute" && label.parsed) {
      const room = `${key}:${label.insert ?? `label${index}`}`;
      if (!tagged.has(label.number)) tagged.set(label.number, room);
    }
  });
  labels.forEach((label, index) => {
    if (!label.parsed) {
      skipped.push({ number: label.raw, reason: "not a room number" });
      return;
    }
    const room = label.source === "attribute"
      ? `${key}:${label.insert ?? `label${index}`}`
      : tagged.get(label.number) ?? `${key}:text:${label.number}`;
    seeds.push({ id: `${key}#${index}`, room, number: label.number, name: label.name, point: applyAffine(toFeet, label.position) });
  });
  return { seeds, skipped };
}

/** The share of DWG line samples that lie on a model barrier: a check that the frame and registration still agree. */
function dwgOnModelShare(dwg: readonly RoomBarrier[], model: readonly RoomBarrier[], tolerance = 0.5): number {
  const cell = 4;
  const hash = new Map<string, RoomBarrier[]>();
  for (const barrier of model) {
    const r = barrier.thickness / 2 + tolerance;
    for (let x = Math.floor((Math.min(barrier.start[0], barrier.end[0]) - r) / cell); x <= Math.floor((Math.max(barrier.start[0], barrier.end[0]) + r) / cell); x += 1) {
      for (let y = Math.floor((Math.min(barrier.start[1], barrier.end[1]) - r) / cell); y <= Math.floor((Math.max(barrier.start[1], barrier.end[1]) + r) / cell); y += 1) {
        const list = hash.get(`${x},${y}`) ?? [];
        list.push(barrier);
        hash.set(`${x},${y}`, list);
      }
    }
  }
  let samples = 0; let hits = 0;
  for (const line of dwg) {
    const length = Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1]);
    const steps = Math.max(1, Math.round(length));
    for (let step = 0; step <= steps; step += 1) {
      const x = line.start[0] + ((line.end[0] - line.start[0]) * step) / steps;
      const y = line.start[1] + ((line.end[1] - line.start[1]) * step) / steps;
      samples += 1;
      const near = hash.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? [];
      if (near.some((barrier) => distance(x, y, barrier.start, barrier.end) <= barrier.thickness / 2 + tolerance)) hits += 1;
    }
  }
  return samples ? hits / samples : 0;
}

function distance(x: number, y: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

// ─── Verification drawing ────────────────────────────────────────────────────

function hue(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0) % 360;
}

const escapeXml = (text: string) => text.replace(/[<>&"]/gu, (character) => `&#${character.charCodeAt(0)};`);

/** Walls, DWG lines, room fills and labels for one sheet's window; plan north up. */
export function roomsSheetSvg(
  title: string,
  window: PlanBounds,
  model: readonly RoomBarrier[],
  dwg: readonly RoomBarrier[],
  rooms: readonly RoomRegion[],
  failures: readonly RoomRegionFailure[],
  seedPoints: ReadonlyMap<string, Point2>,
): string {
  const scale = 12; // px per foot
  const width = (window.maxX - window.minX) * scale;
  const height = (window.maxY - window.minY) * scale;
  const px = ([x, y]: readonly [number, number]) =>
    `${((x - window.minX) * scale).toFixed(1)},${((window.maxY - y) * scale).toFixed(1)}`;
  const inside = (b: RoomBarrier) => overlaps(boundsOf([b.start, b.end], 0), window);
  const parts: string[] = [];
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const room of rooms) {
    const h = hue(room.number);
    const rings = [room.polygon, ...room.holes].map((ring) => `M${ring.map(px).join("L")}Z`).join("");
    const stroke = room.diagnostics.closed ? "#1f2937" : room.diagnostics.componentOpen ? "#dc2626" : "#d97706";
    parts.push(`<path d="${rings}" fill="hsl(${h} 70% 72% / 0.55)" fill-rule="evenodd" stroke="${stroke}" stroke-width="2"/>`);
  }
  for (const barrier of model) {
    if (!inside(barrier)) continue;
    const colour = barrier.kind === "door" ? "#f97316" : "#374151";
    parts.push(`<line x1="${px(barrier.start).split(",")[0]}" y1="${px(barrier.start).split(",")[1]}" x2="${px(barrier.end).split(",")[0]}" y2="${px(barrier.end).split(",")[1]}" stroke="${colour}" stroke-width="${Math.max(1.5, barrier.thickness * scale).toFixed(1)}" stroke-linecap="butt" opacity="0.85"/>`);
  }
  const dwgPath = dwg.filter(inside).map((barrier) => `M${px(barrier.start)}L${px(barrier.end)}`).join("");
  parts.push(`<path d="${dwgPath}" stroke="#2563eb" stroke-width="1.2" fill="none" opacity="0.8"/>`);
  for (const room of rooms) {
    const [x, y] = px(room.labelPoint).split(",");
    const conf = room.confidence.toFixed(2);
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="#111827"/>`);
    parts.push(`<text x="${x}" y="${Number(y) - 6}" font-size="15" font-weight="700" text-anchor="middle" fill="#111827" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(room.number)}</text>`);
    parts.push(`<text x="${x}" y="${Number(y) + 14}" font-size="11" text-anchor="middle" fill="#374151" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(`${room.name ?? ""} ${conf}`)}</text>`);
  }
  for (const failure of failures) {
    const point = seedPoints.get(failure.seedIds[0]!);
    if (!point) continue;
    const [x, y] = px(point).split(",");
    parts.push(`<text x="${x}" y="${y}" font-size="16" font-weight="700" fill="#dc2626">✕ ${escapeXml(failure.number)}</text>`);
  }
  parts.push(`<text x="12" y="28" font-size="22" font-weight="700" fill="#111827">${escapeXml(title)}</text>`);
  parts.push(`<text x="12" y="50" font-size="14" fill="#374151">grey: RVT walls/curtain (healed) · orange: door closures · blue: DWG linework · outline: black closed, amber shared, red open</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" font-family="system-ui,sans-serif">\n${parts.join("\n")}\n</svg>\n`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

type Slim = Pick<ConvertResult, "fileName" | "origin" | "levels" | "nativeAssociatedLevelRelations" | "nativeHostRelations" | "elementBounds"> & { drawnElementIds?: number[] };

function loadModel(rvtPath: string, cachePath: string | null, log: (text: string) => void): { result: ConvertResult; full: boolean } {
  if (cachePath) {
    const slim = JSON.parse(readFileSync(cachePath, "utf8")) as Slim;
    const meshes = slim.drawnElementIds ? [{ elementIds: slim.drawnElementIds }] : [];
    return { result: { ...slim, meshes } as unknown as ConvertResult, full: false };
  }
  const bytes = readFileSync(rvtPath);
  const outcome = convertRvtBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), basename(rvtPath), {},
    ({ ratio, message }) => process.stderr.write(`\r${String(Math.round(ratio * 100)).padStart(3)}% ${message.padEnd(52)}`));
  process.stderr.write("\n");
  if (!outcome.ok) throw new Error(outcome.error);
  log(`converted ${basename(rvtPath)}: ${outcome.elementBounds.length} records`);
  return { result: outcome, full: true };
}

/** Heights per building: the gap to the next registered floor above, else the one below, else 12 ft. */
function storeyHeights(jobs: readonly SheetJob[], elevationOf: (levelId: number) => number) {
  const byBuilding = new Map<string, number[]>();
  for (const job of jobs) {
    const list = byBuilding.get(job.record.building ?? "") ?? [];
    list.push(elevationOf(job.level.levelId));
    byBuilding.set(job.record.building ?? "", list);
  }
  return (building: string, levelId: number) => {
    const elevations = [...new Set(byBuilding.get(building) ?? [])].sort((a, b) => a - b);
    const here = elevationOf(levelId);
    const above = elevations.find((value) => value > here + 1);
    const below = [...elevations].reverse().find((value) => value < here - 1);
    if (above != null) return above - here;
    if (below != null) return here - below;
    return 12;
  };
}

async function main() {
  declareUsage("build-dwg-rooms.ts model.rvt drawing.dwg registration.json [--out rooms.json] [--report report.json] [--pascal-in healed.pascal.json] [--pascal-out out.pascal.json] [--ifc-out out.ifc] [--svg-dir dir --svg-level <levelId> ... --png] [--cache slim.json] [--fresh] [--cell 0.4]");
  const valueFlags = ["--out", "--report", "--pascal-in", "--pascal-out", "--ifc-out", "--svg-dir", "--svg-level", "--svg-sheet", "--cache", "--cell"];
  const [rvtPath, dwgPath, registrationPath] = positionals(...valueFlags);
  if (!rvtPath || !dwgPath || !registrationPath) throw new Error("usage: build-dwg-rooms.ts model.rvt drawing.dwg registration.json [options]");
  const argv = process.argv;
  const many = (flag: string) => argv.flatMap((value, index) => (argv[index - 1] === flag ? [value] : []));
  const outPath = optionValue("--out") ?? "work/out/unbc.rooms.json";
  const reportPath = optionValue("--report") ?? outPath.replace(/\.json$/u, ".report.json");
  const pascalIn = optionValue("--pascal-in");
  const pascalOut = optionValue("--pascal-out");
  const ifcOut = optionValue("--ifc-out");
  const svgDir = optionValue("--svg-dir");
  const svgLevels = new Set(many("--svg-level").map(Number));
  const svgSheets = new Set(many("--svg-sheet"));
  const cell = numberOption("--cell", 0.4);
  const log = (text: string) => process.stderr.write(`${text}\n`);
  const timings: Record<string, number> = {};
  const started = Date.now();
  let mark = started;
  const lap = (name: string) => { const now = Date.now(); timings[name] = (now - mark) / 1000; mark = now; };

  const { result, full } = loadModel(rvtPath, optionValue("--cache"), log);
  lap("convert");
  // `--cache-healed`: the cache already holds healed walls (a scratch speed-up).
  const healed = hasFlag("--cache-healed") ? { result, edits: [] } : healConvertResult(result);
  log(`healed wall joins: ${healed.edits.length} end edits`);
  lap("heal");
  const frame = pascalFrameFor(result);

  const dwgBytes = readFileSync(dwgPath);
  const sha256 = createHash("sha256").update(dwgBytes).digest("hex");
  const database = await decodeDwg(dwgPath);
  const { entities, labels, plans, assignment } = roomLabelReport(database, { source: dwgPath });
  lap("decode DWG");

  const registration = JSON.parse(readFileSync(registrationPath, "utf8")) as { sheets: RegistrationRecord[] };
  const elevationOf = (levelId: number) => result.levels.find((level) => level.levelId === levelId)?.elevation ?? 0;

  // Which sheets make rooms, and which do not.
  const skippedSheets: { sheet: string; status: string; labels: number; reason: string }[] = [];
  const splitParents = new Set(registration.sheets.filter((record) => record.part != null).map((record) => record.sheetId));
  const jobs: SheetJob[] = [];
  for (const record of registration.sheets) {
    const sheetLabels = labels.filter((_, index) => assignment[index] === record.sheetId);
    const partLabels = record.part != null && record.partBounds
      ? sheetLabels.filter((label) => label.position[0] >= record.partBounds!.minX && label.position[0] <= record.partBounds!.maxX &&
          label.position[1] >= record.partBounds!.minY && label.position[1] <= record.partBounds!.maxY)
      : sheetLabels;
    // A split sheet is represented by its parts when a part registered.
    const partsRegistered = registration.sheets.some((other) => other.sheetId === record.sheetId && other.part != null && other.status === "registered");
    if (record.status !== "registered") {
      if (record.part == null && partsRegistered) continue;
      if (record.part != null && !partsRegistered) continue; // the whole sheet is reported instead
      skippedSheets.push({ sheet: record.title, status: record.status, labels: partLabels.length, reason: record.status === "no-match" ? "building or floor not in the RVT" : "registration ambiguous" });
      continue;
    }
    if (record.part == null && splitParents.has(record.sheetId) && partsRegistered) continue;
    const key = record.part == null ? `s${record.sheetId}` : `s${record.sheetId}p${record.part}`;
    const level = emissionLevel(record);
    const toFeet = dwgToFeet(record.transform.matrix, frame);
    const bounds = record.partBounds ?? plans[record.sheetId]!.bounds;
    const { primitives } = dwgPrimitivesWithin(entities, bounds);
    const { barriers: dwgBarriers, report: dwgReport } = dwgBarrierSegments(primitives, toFeet);
    const { seeds, skipped } = sheetSeeds(key, partLabels, toFeet);
    const window = boundsOf([...dwgBarriers.flatMap((barrier) => [barrier.start, barrier.end]), ...seeds.map((seed) => seed.point)], 10);
    jobs.push({ key, record, level, toFeet, labels: partLabels, seeds, dwgBarriers, dwgReport, window, skippedLabels: skipped });
  }
  lap("prepare sheets");

  // Per level, sheets whose windows overlap are flooded together.
  const outcomes: RoomOutcome[] = [];
  const failures: (RoomRegionFailure & { sheet: string; levelId: number })[] = [];
  const sheetStats: Record<string, unknown>[] = [];
  const svgJobs: { path: string; svg: string }[] = [];
  const levels = [...new Set(jobs.map((job) => job.level.levelId))].sort((a, b) => elevationOf(a) - elevationOf(b));
  for (const levelId of levels) {
    const onLevel = jobs.filter((job) => job.level.levelId === levelId);
    const clusters: SheetJob[][] = [];
    for (const job of onLevel) {
      const touching = clusters.filter((cluster) => cluster.some((other) => overlaps(other.window, job.window)));
      const merged = [job, ...touching.flat()];
      for (const cluster of touching) clusters.splice(clusters.indexOf(cluster), 1);
      clusters.push(merged);
    }
    const bound = levelFloorBound(healed.result, levelId);
    for (const cluster of clusters) {
      const window = boundsOf(cluster.flatMap((job) => [[job.window.minX, job.window.minY], [job.window.maxX, job.window.maxY]] as Point2[]), 0);
      const { barriers: model, report: modelReport } = levelRoomBarriers(healed.result, levelId, window);
      const seeds = cluster.flatMap((job) => job.seeds);
      const clusterStarted = Date.now();
      const regions = roomRegions({
        seeds,
        barriers: [...model, ...cluster.flatMap((job) => job.dwgBarriers)],
        bound,
        window,
      }, { cellSizeFeet: cell });
      const seconds = (Date.now() - clusterStarted) / 1000;
      const sheetOfRoom = (room: string) => cluster.find((job) => room.startsWith(`${job.key}:`))!;
      for (const region of regions.rooms) outcomes.push({ job: sheetOfRoom(region.room), region });
      for (const failure of regions.failures) failures.push({ ...failure, sheet: sheetOfRoom(failure.room).record.title, levelId });
      log(`level ${levelId}: ${cluster.map((job) => job.record.title).join(", ")}: ${regions.rooms.length} rooms, ${regions.failures.length} failed, ` +
        `${regions.grid.columns}×${regions.grid.rows} cells, ${seconds.toFixed(1)} s`);
      for (const job of cluster) {
        const mine = regions.rooms.filter((region) => region.room.startsWith(`${job.key}:`));
        sheetStats.push({
          sheet: job.record.title,
          key: job.key,
          building: job.record.building,
          levelId,
          levelSource: job.level.source,
          sheetLevelId: job.level.sheetLevelId,
          labels: job.labels.length,
          seeds: job.seeds.length,
          rooms: mine.length,
          closed: mine.filter((region) => region.diagnostics.closed).length,
          shared: mine.filter((region) => !region.diagnostics.closed && !region.diagnostics.componentOpen).length,
          open: mine.filter((region) => region.diagnostics.componentOpen).length,
          meanConfidence: mine.length ? Math.round((mine.reduce((sum, region) => sum + region.confidence, 0) / mine.length) * 100) / 100 : null,
          dwgOnModelShare: Math.round(dwgOnModelShare(job.dwgBarriers, model) * 1000) / 1000,
          registrationInliers: job.record.inlierRatio,
          dwg: job.dwgReport,
          model: modelReport,
          skippedLabels: job.skippedLabels,
          clusterCells: regions.stats.cells,
          clusterSeconds: seconds,
        });
        if (svgDir && (svgLevels.has(levelId) || svgSheets.has(job.record.title))) {
          const seedPoints = new Map(job.seeds.map((seed) => [seed.id, seed.point] as const));
          svgJobs.push({
            path: join(svgDir, `rooms-${levelId}-${job.record.title.replace(/[^A-Za-z0-9]+/gu, "-")}.svg`),
            svg: roomsSheetSvg(`${job.record.title} → level ${levelId} (${mine.length} rooms)`, job.window, model, job.dwgBarriers,
              mine, regions.failures.filter((failure) => failure.room.startsWith(`${job.key}:`)), seedPoints),
          });
        }
      }
    }
  }
  lap("rooms");

  // Annotations: proposals, merged into the existing sidecar so manual edits survive.
  const heightFor = storeyHeights(jobs, elevationOf);
  const labelByIndex = new Map<string, DwgRoomLabel>();
  for (const job of jobs) job.labels.forEach((label, index) => labelByIndex.set(`${job.key}#${index}`, label));
  const proposals: RoomAnnotation[] = outcomes.map(({ job, region }) => {
    const label = labelByIndex.get(region.seedIds[0]!)!;
    return {
      key: "",
      levelId: job.level.levelId,
      number: region.number,
      ...(region.name ? { name: region.name } : {}),
      polygonFeet: region.polygon,
      ...(region.holes.length ? { holesFeet: region.holes } : {}),
      labelPointFeet: applyAffine(job.toFeet, label.position),
      source: { number: "dwg", name: "dwg", polygon: "derived" },
      dwg: {
        fileName: basename(dwgPath),
        sha256,
        sectionId: job.record.title,
        ...(label.insert ? { entityHandle: label.insert } : {}),
        ...(label.tag ? { tag: label.tag } : {}),
        layer: label.layer,
        rawText: label.raw,
        anchorDwg: [label.position[0], label.position[1]],
        registrationId: `${job.key}@${createHash("sha256").update(JSON.stringify(job.record.transform.matrix)).digest("hex").slice(0, 12)}`,
      },
      confidence: region.confidence,
      heightFeet: Math.round(heightFor(job.record.building ?? "", job.level.levelId) * 1000) / 1000,
      status: "active",
    } satisfies RoomAnnotation;
  });
  const existing = !hasFlag("--fresh") && existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, "utf8")) as RoomAnnotationSet).annotations
    : [];
  const merged = mergeRoomAnnotations(existing, proposals);
  const set = makeRoomAnnotationSet(result.fileName, merged.annotations);
  writeFileSync(outPath, `${JSON.stringify(set, null, 1)}\n`);
  log(`wrote ${outPath}: ${merged.annotations.length} annotations (matched ${merged.report.matched}, added ${merged.report.added}, stale ${merged.report.stale.length}, conflicts ${merged.report.conflicts.length})`);
  lap("annotations");

  // Keys for the report: the merge minted them in proposal order for new rooms.
  const keyOf = (index: number) => {
    const proposal = proposals[index]!;
    return merged.annotations.find((annotation) => annotation.levelId === proposal.levelId &&
      annotation.dwg?.entityHandle === proposal.dwg?.entityHandle && annotation.dwg?.sectionId === proposal.dwg?.sectionId &&
      annotation.number === proposal.number)?.key ?? null;
  };

  if (pascalOut) {
    const scene = pascalIn
      ? JSON.parse(readFileSync(pascalIn, "utf8")) as PascalBuild
      : (({ nodes, rootNodeIds }) => ({ nodes, rootNodeIds }))(makePascalScene(result, { healJoins: true }));
    const stamped = readPascalFrame(scene);
    if (stamped && (Math.abs(stamped.originFeet.x - frame.originFeet.x) > 1e-6 || Math.abs(stamped.originFeet.y - frame.originFeet.y) > 1e-6)) {
      throw new Error(`${pascalIn} was exported in a different frame (origin ${JSON.stringify(stamped.originFeet)}).`);
    }
    // Unstamped scene: check one healed wall lands where this frame puts it.
    const probe = healed.result.elementBounds.find((record) => record.categoryId === -2_000_011 && record.solids?.length === 1 && scene.nodes[`wall_e${record.elementId}`]);
    if (probe) {
      const node = scene.nodes[`wall_e${probe.elementId}`] as unknown as { start: [number, number] };
      const expected = feetToPascalPlan(frame, [probe.solids![0]!.start.x, probe.solids![0]!.start.y]);
      const error = Math.hypot(node.start[0] - expected[0], node.start[1] - expected[1]);
      log(`frame check on wall_e${probe.elementId}: ${error.toFixed(6)} m`);
      if (error > 0.01) throw new Error(`The Pascal scene does not match this conversion's frame (wall off by ${error.toFixed(3)} m).`);
    }
    const report = appendRoomZones(scene, merged.annotations, frame);
    writeFileSync(pascalOut, JSON.stringify(scene));
    log(`wrote ${pascalOut}: ${report.written} zones (${report.replaced} replaced, ${report.skipped.length} skipped, ${report.truncatedNumbers.length} numbers truncated)`);
    lap("pascal");
  }

  let ifcSpaces: number | null = null;
  if (ifcOut) {
    if (!full) {
      log("--ifc-out needs a full conversion; skipped with --cache.");
    } else {
      const rooms = annotationsToReviewedRooms(merged.annotations);
      const ifc = makeIfcCenterlines(result, { rooms });
      writeFileSync(ifcOut, ifc);
      ifcSpaces = (ifc.match(/IFCSPACE\(/gu) ?? []).length;
      log(`wrote ${ifcOut}: ${ifcSpaces} IfcSpace`);
      lap("ifc");
    }
  }

  if (svgDir && svgJobs.length) {
    mkdirSync(svgDir, { recursive: true });
    for (const job of svgJobs) writeFileSync(job.path, job.svg);
    log(`wrote ${svgJobs.length} SVGs to ${svgDir}`);
    if (hasFlag("--png")) await renderSvgFiles(svgJobs.map((job) => [job.path, job.path.replace(/\.svg$/u, ".png")]), 1600);
    lap("svg");
  }

  // Report.
  const labelTotal = labels.length;
  const regions = outcomes.map((outcome) => outcome.region);
  const histogram: Record<string, number> = {};
  for (const region of regions) {
    const bucket = region.confidence >= 0.9 ? "≥0.9" : region.confidence >= 0.75 ? "0.75–0.9" : region.confidence >= 0.5 ? "0.5–0.75" : region.confidence >= 0.3 ? "0.3–0.5" : "<0.3";
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }
  const byBuilding: Record<string, { labels: number; rooms: number; closed: number; sheetsRegistered: number; sheetsSkipped: number; labelsSkipped: number }> = {};
  const buildingOf = (title: string) => parseSheetName(title).building ?? "?";
  for (const job of jobs) {
    const entry = byBuilding[job.record.building ?? "?"] ??= { labels: 0, rooms: 0, closed: 0, sheetsRegistered: 0, sheetsSkipped: 0, labelsSkipped: 0 };
    entry.sheetsRegistered += 1;
    entry.labels += job.labels.length;
  }
  for (const skipped of skippedSheets) {
    const entry = byBuilding[buildingOf(skipped.sheet)] ??= { labels: 0, rooms: 0, closed: 0, sheetsRegistered: 0, sheetsSkipped: 0, labelsSkipped: 0 };
    entry.sheetsSkipped += 1;
    entry.labelsSkipped += skipped.labels;
  }
  for (const { job, region } of outcomes) {
    const entry = byBuilding[job.record.building ?? "?"]!;
    entry.rooms += 1;
    if (region.diagnostics.closed) entry.closed += 1;
  }
  const numbersSeen = new Map<string, number>();
  for (const region of regions) numbersSeen.set(`${region.number}`, (numbersSeen.get(region.number) ?? 0) + 1);
  const report = {
    generated: new Date().toISOString(),
    inputs: { rvt: rvtPath, dwg: dwgPath, dwgSha256: sha256, registration: registrationPath, cellSizeFeet: cell, pascalIn, frame },
    totals: {
      dwgLabels: labelTotal,
      labelsOnRoomSheets: jobs.reduce((sum, job) => sum + job.labels.length, 0),
      seeds: jobs.reduce((sum, job) => sum + job.seeds.length, 0),
      rooms: regions.length,
      annotations: merged.annotations.length,
      closed: regions.filter((region) => region.diagnostics.closed).length,
      sharedComponent: regions.filter((region) => !region.diagnostics.closed && !region.diagnostics.componentOpen).length,
      openComponent: regions.filter((region) => region.diagnostics.componentOpen).length,
      competed: regions.filter((region) => region.diagnostics.competedWith.length > 0).length,
      touchesExterior: regions.filter((region) => region.diagnostics.touchesExterior).length,
      closedByRvtAlone: regions.filter((region) => region.diagnostics.closedByRvt).length,
      closedByDwgAlone: regions.filter((region) => region.diagnostics.closedByDwg).length,
      dwgIoUAtLeast085: regions.filter((region) => (region.diagnostics.dwgRegionIoU ?? 0) >= 0.85).length,
      nudged: regions.filter((region) => region.diagnostics.nudgedFeet > 0).length,
      outsideSlab: regions.filter((region) => region.diagnostics.outsideBound).length,
      multiPiece: regions.filter((region) => region.diagnostics.pieces > 1).length,
      failures: failures.length,
      duplicateNumbers: [...numbersSeen].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count })),
      skippedSheets: skippedSheets.length,
      labelsOnSkippedSheets: skippedSheets.reduce((sum, sheet) => sum + sheet.labels, 0),
      labelsSkippedMalformed: jobs.flatMap((job) => job.skippedLabels),
      ifcSpaces,
      confidence: histogram,
    },
    byBuilding,
    timings: { ...timings, total: (Date.now() - started) / 1000 },
    skippedSheets,
    sheets: sheetStats,
    failures,
    rooms: outcomes.map(({ job, region }, index) => ({
      key: keyOf(index),
      sheet: job.record.title,
      levelId: job.level.levelId,
      number: region.number,
      name: region.name,
      areaSquareMetres: Math.round(region.areaSquareFeet * METRES_PER_FOOT * METRES_PER_FOOT * 100) / 100,
      confidence: region.confidence,
      vertices: region.polygon.length,
      holes: region.holes.length,
      ...region.diagnostics,
    })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`);
  log(`wrote ${reportPath}`);
  log(JSON.stringify({ totals: report.totals, timings: report.timings }, null, 1));
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
