/**
 * One decode, every configuration: the harness for comparing rectify modes.
 *
 * This exists because of a specific mistake. A published before/after table
 * compared `--no-contact` against the flag ON — and, invisibly, wings computed
 * from two DIFFERENT IFCs, because the two runs were made hours apart and the
 * wings file was an argument retyped rather than a fixed input recorded. Both
 * inputs were legitimate, so every number in the table looked reasonable. The
 * mismatch surfaced only when an unrelated probe printed `moved` and it
 * disagreed with the published figure by 209 elements.
 *
 * An A/B whose halves come from different inputs is not an A/B. So: one
 * process, one decode, one wings file, and the configurations differ ONLY in
 * the flags this script names. That is correct by construction rather than by
 * anyone remembering.
 *
 * It also decodes once instead of once per configuration, which on the real
 * model is four minutes and 8 GB saved per extra column.
 *
 * Usage:
 *   node --experimental-strip-types --max-old-space-size=8000 \
 *     scripts/ablate-rectify.ts model.rvt --wings wings.json \
 *     [--out-dir dir/] [--modes hull,contact,elastic:5,elastic:20]
 *
 * Modes:
 *   hull          the wing hull alone, no contact claim
 *   contact       hull + contact claim (what ships)
 *   elastic:<m>   a continuous field with an <m> metre transition band
 *
 * VERIFYING THIS FILE. It reassembles the audit that `scripts/rectify-plan.ts`
 * runs, so it can drift from it. The check is that `hull` here reproduces
 * `rectify-plan.ts --no-contact` exactly — same broken joins, same clashes. If
 * it does not, this harness is wrong and its numbers are not publishable.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isEntryPoint, optionValue } from "./lib/rvt-harness.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { floorPlateLevels } from "../lib/reviter/export-svg.ts";
import { auditLevels } from "../lib/reviter/rectify-audit.ts";
import { rectifyForPlan, type RectifyPlanInput, type RectifyPlanOptions }
  from "../lib/reviter/rectify-plan.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

export type Mode = { name: string; options: RectifyPlanOptions };

/** `hull`, `contact`, `elastic:5` — the whole vocabulary, deliberately small. */
export function parseModes(spec: string): Mode[] {
  return spec.split(",").map((raw) => {
    const name = raw.trim();
    if (name === "hull") return { name, options: { contact: false } };
    if (name === "contact") return { name, options: {} };
    const elastic = /^elastic:([0-9]+(?:\.[0-9]+)?)$/.exec(name);
    if (elastic) return { name, options: { bandMetres: Number(elastic[1]) } };
    throw new Error(`Unknown mode "${name}". Use hull, contact, or elastic:<metres>.`);
  });
}

export type ModeResult = {
  mode: string;
  moved: number;
  contactClaims: number;
  straddling: number;
  brokenJoins: number;
  clashes: number;
  total: number;
  byCategory: Record<string, number>;
};

export function scoreMode(
  result: ConvertResult, wings: RectifyPlanInput, mode: Mode,
  drawnByLevel: ReadonlyMap<number, { elevation: number; elementIds: number[] }>,
): { row: ModeResult; audit: ReturnType<typeof auditLevels> } {
  const { result: squared, report } = rectifyForPlan(result, wings, "mixed", mode.options);
  const audit = auditLevels({
    before: result, after: squared, movedIds: report.movedIds, drawnByLevel,
  });
  const byCategory: Record<string, number> = {};
  let brokenJoins = 0;
  let clashes = 0;
  for (const level of audit) {
    brokenJoins += level.brokenJoins.length;
    clashes += level.clashes.length;
    for (const finding of [...level.brokenJoins, ...level.clashes]) {
      const key = finding.categoryName ?? String(finding.categoryId ?? "?");
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
  }
  return {
    audit,
    row: {
      mode: mode.name, moved: report.moved, contactClaims: report.contactClaims,
      straddling: report.straddling, brokenJoins, clashes,
      total: brokenJoins + clashes, byCategory,
    },
  };
}

async function run(argv: string[]): Promise<void> {
  const input = argv[0];
  const wingsPath = optionValue("--wings", argv);
  if (!input || input.startsWith("-") || !wingsPath) {
    throw new Error("Usage: ablate-rectify.ts model.rvt --wings wings.json " +
      "[--out-dir dir/] [--modes hull,contact,elastic:5]");
  }
  const modes = parseModes(optionValue("--modes", argv) ?? "hull,contact");
  const outDir = optionValue("--out-dir", argv);
  const wings = JSON.parse(readFileSync(wingsPath, "utf8")) as RectifyPlanInput;

  const bytes = readFileSync(input);
  process.stderr.write(`decoding ${input} once, for ${modes.length} mode(s) ...\n`);
  const outcome = convertRvtBytes(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    input.split("/").pop() ?? "model.rvt", {}, () => {});
  if (!outcome.ok) throw new Error(`Could not read ${input}: ${outcome.error ?? ""}`);
  const result = outcome as ConvertResult;

  const levels = floorPlateLevels(result)
    .sort((left, right) => left.elevation - right.elevation).map((level) => level.levelId);
  const elevations = new Map(result.levels.flatMap((level) =>
    level.levelId == null ? [] : [[level.levelId, level.elevation] as const]));
  const drawnByLevel = new Map<number, { elevation: number; elementIds: number[] }>();
  for (const relation of result.nativeAssociatedLevelRelations ?? []) {
    if (!levels.includes(relation.levelId)) continue;
    const entry = drawnByLevel.get(relation.levelId)
      ?? { elevation: elevations.get(relation.levelId) ?? 0, elementIds: [] };
    entry.elementIds.push(relation.elementId);
    drawnByLevel.set(relation.levelId, entry);
  }

  // The inputs are named in the output, not just the flags, because naming
  // only the flag is exactly how the two halves came apart last time.
  process.stderr.write(`model ${input}\nwings ${wingsPath}\n` +
    `${result.elementBounds.length} element records, ${levels.length} level(s)\n\n`);
  process.stderr.write(`${"mode".padEnd(14)}${"moved".padStart(9)}${"claims".padStart(9)}` +
    `${"deformed".padStart(10)}${"joins".padStart(8)}${"clashes".padStart(9)}` +
    `${"total".padStart(8)}\n`);

  const rows: ModeResult[] = [];
  for (const mode of modes) {
    const { row, audit } = scoreMode(result, wings, mode, drawnByLevel);
    rows.push(row);
    process.stderr.write(`${row.mode.padEnd(14)}${String(row.moved).padStart(9)}` +
      `${String(row.contactClaims).padStart(9)}${String(row.straddling).padStart(10)}` +
      `${String(row.brokenJoins).padStart(8)}${String(row.clashes).padStart(9)}` +
      `${String(row.total).padStart(8)}\n`);
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${row.mode.replace(":", "-")}.json`),
        JSON.stringify({ model: input, wings: wingsPath, mode: row, audit }), "utf8");
    }
  }
  process.stderr.write("\nleft behind, by category:\n");
  const names = [...new Set(rows.flatMap((row) => Object.keys(row.byCategory)))];
  for (const name of names) {
    process.stderr.write(`  ${name.padEnd(24)}` +
      rows.map((row) => String(row.byCategory[name] ?? 0).padStart(8)).join("") + "\n");
  }
}

if (isEntryPoint(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
