/**
 * Draw a floor plan of the recovered model before and after plan rectification.
 *
 * Usage:
 *   node --experimental-strip-types scripts/rectify-plan.ts model.rvt \
 *     --wings wings.json --out-dir out/ [--level-id 311] [--theme dark]
 *
 * `wings.json` is what the downstream voxel pipeline publishes from its own
 * analysis of this model's walls: one rigid motion per off-grid wing, in
 * metres. This applies them to the recovered model's plan coordinates and
 * hands the result to `makeArchitecturalFloorSvg` — the same function the
 * studio's floor viewer calls — so the rectified building is drawn as a
 * building, with wall poché and door swings, rather than as a stick diagram of
 * wall footprints.
 *
 * With no --level-id, every level that has a recovered floor sketch is drawn.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hasFlag, isEntryPoint, optionValue } from "./lib/rvt-harness.ts";
import { makeArchitecturalFloorSvg } from "../lib/reviter/architectural-plan.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { floorPlateLevels } from "../lib/reviter/export-svg.ts";
import { auditLevels } from "../lib/reviter/rectify-audit.ts";
import { rectifyForPlan, type RectifyPlanInput, type RectifyPlanReport }
  from "../lib/reviter/rectify-plan.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

export type RectifyPlanArguments = {
  input: string;
  wings: string;
  outDir: string;
  levelId?: number;
  theme: "light" | "dark";
  revitVersion?: number;
  /** Hull only, no contact claim — the ablation the claim is measured against. */
  noContact: boolean;
  /** Elastic transition band in metres; 0 for the rigid transform. */
  bandMetres: number;
};

export function parseRectifyPlanArguments(argv: string[]): RectifyPlanArguments {
  const input = argv[0];
  const wings = optionValue("--wings", argv);
  const outDir = optionValue("--out-dir", argv);
  if (!input || input.startsWith("-") || !wings || !outDir) {
    throw new Error(
      "Usage: rectify-plan.ts model.rvt --wings wings.json --out-dir dir/ " +
      "[--level-id 311] [--theme dark] [--revit-version 2027] [--no-contact] " +
      "[--band-metres 5]");
  }
  const rawLevel = optionValue("--level-id", argv);
  const levelId = rawLevel == null ? undefined : Number(rawLevel);
  if (rawLevel != null && !Number.isSafeInteger(levelId)) {
    throw new Error(`Invalid Revit level id "${rawLevel}".`);
  }
  const rawVersion = optionValue("--revit-version", argv);
  const revitVersion = rawVersion == null ? undefined : Number(rawVersion);
  return {
    input, wings, outDir, levelId, revitVersion,
    noContact: hasFlag("--no-contact", argv),
    bandMetres: Number(optionValue("--band-metres", argv) ?? 0),
    theme: hasFlag("--theme=dark", argv) || optionValue("--theme", argv) === "dark"
      ? "dark" : "light",
  };
}

/** Every level worth drawing, largest floor area first is not needed — order
 * by elevation, the way anyone reads a set of plans. */
function levelsToDraw(result: ConvertResult, only?: number): number[] {
  const levels = floorPlateLevels(result)
    .sort((left, right) => left.elevation - right.elevation)
    .map((level) => level.levelId);
  if (only == null) return levels;
  if (!levels.includes(only)) {
    throw new Error(`Level ${only} has no recovered floor sketch. ` +
      `Levels with one: ${levels.join(", ")}`);
  }
  return [only];
}

export async function runRectifyPlan(args: RectifyPlanArguments): Promise<void> {
  const wings = JSON.parse(readFileSync(args.wings, "utf8")) as RectifyPlanInput;
  if (!Array.isArray(wings.wings)) {
    throw new Error(`${args.wings} has no "wings" array.`);
  }
  process.stderr.write(`reading ${args.input} ...\n`);
  const bytes = readFileSync(args.input);
  const result = convertRvtBytes(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    args.input.split("/").pop() ?? "model.rvt",
    args.revitVersion == null ? {} : { revitVersion: args.revitVersion },
    ({ ratio, message }) => process.stderr.write(
      `\r  ${(ratio * 100).toFixed(0).padStart(3)}%  ${message.slice(0, 60).padEnd(60)}`),
  );
  process.stderr.write("\n");
  if (!result.ok) throw new Error(`Could not read ${args.input}: ${result.error ?? ""}`);

  process.stderr.write(
    `model origin ${result.origin.x.toFixed(1)}, ${result.origin.y.toFixed(1)} ft — ` +
    `the offset between this model's meshes and its elementBounds. The plan is ` +
    `drawn from elementBounds, which the wings already share a frame with.\n`);
  const levels = levelsToDraw(result, args.levelId);
  mkdirSync(args.outDir, { recursive: true });
  process.stderr.write(`${levels.length} level(s) with a recovered floor sketch\n`);

  for (const levelId of levels) {
    const svg = makeArchitecturalFloorSvg(result, levelId, { theme: args.theme });
    writeFileSync(join(args.outDir, `level-${levelId}-before.svg`), svg, "utf8");
  }

  // Both assignments, from one decode. A wall is small and wants to move
  // whole; a floor plate spans the seam and has to be cut at it. Drawing both
  // is the only way to see which the plan actually needs.
  const reports: Record<string, Omit<RectifyPlanReport, "movedIds">> = {};
  let squaredForAudit: ConvertResult | null = null;
  let movedIds = new Set<number>();
  for (const assignment of ["element", "mixed"] as const) {
    const { result: squared, report } = rectifyForPlan(
      result, wings, assignment,
      { contact: !args.noContact, bandMetres: args.bandMetres || undefined });
    const { movedIds: ids, ...rest } = report;
    reports[assignment] = rest;
    if (assignment === "mixed") { squaredForAudit = squared; movedIds = ids; }
    process.stderr.write(
      `rectify (${assignment}): ${report.wings} wing(s) moved ${report.moved} of ` +
      `${report.records} element records; ${report.straddling} straddle a wing edge; ` +
      `${args.bandMetres ? `elastic, ${args.bandMetres} m band, ${report.straddling} deformed`
        : args.noContact ? "hull only (--no-contact)"
        : `${report.contactClaims} claimed by contact`}\n`);
    for (const levelId of levels) {
      const svg = makeArchitecturalFloorSvg(squared, levelId, { theme: args.theme });
      writeFileSync(join(args.outDir, `level-${levelId}-after-${assignment}.svg`), svg, "utf8");
    }
  }
  process.stderr.write(`  ${levels.length} level(s) drawn before and after, two ways\n`);

  // Floor by floor: what stayed put that should not have.
  const elevations = new Map(result.levels.flatMap((level) =>
    level.levelId == null ? [] : [[level.levelId, level.elevation] as const]));
  const byLevel = new Map<number, { elevation: number; elementIds: number[] }>();
  for (const relation of result.nativeAssociatedLevelRelations ?? []) {
    if (!levels.includes(relation.levelId)) continue;
    const entry = byLevel.get(relation.levelId)
      ?? { elevation: elevations.get(relation.levelId) ?? 0, elementIds: [] };
    entry.elementIds.push(relation.elementId);
    byLevel.set(relation.levelId, entry);
  }
  const audit = auditLevels({
    before: result, after: squaredForAudit!, movedIds, drawnByLevel: byLevel,
  });
  process.stderr.write(
    `\n${"level".padEnd(10)}${"elev".padStart(8)}${"drawn".padStart(8)}` +
    `${"moved".padStart(8)}${"joins broken".padStart(14)}${"clashes".padStart(9)}\n`);
  const byCategory = new Map<string, number>();
  for (const level of audit) {
    process.stderr.write(
      `${String(level.levelId).padEnd(10)}${level.elevation.toFixed(1).padStart(8)}` +
      `${String(level.drawn).padStart(8)}${String(level.moved).padStart(8)}` +
      `${String(level.brokenJoins.length).padStart(14)}` +
      `${String(level.clashes.length).padStart(9)}\n`);
    for (const finding of [...level.brokenJoins, ...level.clashes]) {
      const name = finding.categoryName ?? String(finding.categoryId ?? "?");
      byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
    }
  }
  // Which categories the hull keeps missing is the actionable half: one
  // element left behind is a rounding call, a whole category of them is a
  // population the hull was never built from.
  const ranked = [...byCategory].sort((left, right) => right[1] - left[1]);
  if (ranked.length) {
    process.stderr.write("\nleft behind, by category:\n");
    for (const [name, count] of ranked) {
      process.stderr.write(`  ${String(count).padStart(5)}  ${name}\n`);
    }
  }
  writeFileSync(join(args.outDir, "rectify-plan.json"),
    JSON.stringify({ levels, reports, audit }, null, 2), "utf8");
}

if (isEntryPoint(import.meta.url)) {
  runRectifyPlan(parseRectifyPlanArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
