/**
 * Coverage audit: which elements of a Revit model actually reach the scene.
 *
 * The conversion reports how much it recovered. It cannot report what it
 * missed, because nothing inside the RVT says how many walls a building has.
 * The paired IFC export does, so this script joins the two and measures the
 * gap the only way it can be measured — element by element.
 *
 * Every IFC product Revit exports carries its Revit element id in the `Tag`
 * attribute, which is the same id the partition decoders recover. Membership of
 * a drawn element set is therefore a direct question rather than an estimate:
 * of the 7,381 walls the export says exist, how many are in the view?
 *
 *   node --experimental-strip-types scripts/audit-coverage.ts model.rvt model.ifc
 *
 * Both files stay local. Writing `--json <path>` also dumps the per-type detail
 * so two runs can be differenced.
 *
 * The measurement is also exported — `convertModel`, `computeCoverage`,
 * `printCoverage` — so `verify-pair.ts` can run it beside the overlay against a
 * single conversion instead of paying for the decode twice and risking two
 * subtly different answers to the same question.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { selectDisplayBounds } from "../lib/reviter/scene.ts";
import { solidBounds } from "../lib/reviter/bounds-records.ts";

import type { ConvertResult } from "../lib/reviter/types.ts";

/** IFC product types worth reporting, in the order a reader cares about them. */
export const REPORTED_TYPES = [
  "IFCWALLSTANDARDCASE",
  "IFCWALL",
  "IFCCURTAINWALL",
  "IFCMEMBER",
  "IFCPLATE",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCCOLUMN",
  "IFCRAILING",
  "IFCSLAB",
  "IFCROOF",
  "IFCCOVERING",
  "IFCSTAIR",
  "IFCSTAIRFLIGHT",
  "IFCRAMP",
  "IFCRAMPFLIGHT",
  "IFCOPENINGELEMENT",
];

export type IfcProduct = { type: string; tag: number };

/**
 * Read `#id=IFCTYPE(...)` product lines and their Revit element id.
 *
 * The tag is the last all-digit quoted attribute: a product's name also holds
 * the id, but as `Family:Type:Id`, so it never reads as digits alone.
 */
export function readIfcProducts(text: string, types: Set<string>): IfcProduct[] {
  const products: IfcProduct[] = [];
  const entity = /^#\d+ *= *([A-Z0-9]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const type = match[1]!;
    if (!types.has(type)) continue;
    let tag = 0;
    for (const quoted of match[2]!.matchAll(/'([^']*)'/g)) {
      const value = quoted[1]!;
      if (/^\d+$/.test(value)) tag = Number(value);
    }
    if (tag) products.push({ type, tag });
  }
  return products;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

/**
 * Decode an RVT the way the studio does, and fail loudly rather than returning
 * a half-answer a caller might treat as a result.
 */
export function convertModel(rvtPath: string): ConvertResult {
  const rvt = readFileSync(rvtPath);
  const outcome = convertRvtBytes(
    new Uint8Array(rvt.buffer, rvt.byteOffset, rvt.byteLength),
    rvtPath.split("/").pop() ?? "model.rvt",
    // The release drives decoder selection; the studio reads it from
    // BasicFileInfo, and the supplied project is a 2027 file.
    { revitVersion: 2027 },
  );
  if (!outcome.ok) throw new Error(`conversion failed: ${outcome.error}`);
  return outcome;
}

export type CoverageRow = { inIfc: number; seen: number; recovered: number; drawn: number };

export type CoverageResult = {
  rows: Record<string, CoverageRow>;
  totals: { inIfc: number; drawn: number };
  /** Every record the decoders produced, drawable or not. */
  recordCount: number;
  /** Of those, the ones with an extent the scene could draw. */
  withVolumeCount: number;
  drawnCount: number;
  unclassifiedCount: number;
  /** Sheets held back: a floor's own sketch, an unnamed plate, a top rail. */
  omittedSheetCount: number;
  /** Curtain-wall and opening containers, drawn as their children instead. */
  omittedWrapperCount: number;
  stats: ConvertResult["stats"];
  /** The element ids the scene draws, shared with the overlay pass. */
  drawnIds: Set<number>;
};

/**
 * Join a conversion to its paired export, element id by element id.
 *
 * Three sets are kept apart because they have different fixes: `seen` is a
 * decoder proving an id real, `recovered` is an envelope existing for it, and
 * `drawn` is that envelope surviving the scene's own selection.
 */
export function computeCoverage(outcome: ConvertResult, ifcPath: string): CoverageResult {
  // Re-run the scene's own selection so the audit reports the set the viewer
  // draws, rather than a set assembled a second, possibly different way.
  const withVolume = outcome.elementBounds.filter(
    (record) => solidBounds(record) || (record.loops?.length ?? 0) > 0,
  );
  const selection = selectDisplayBounds(withVolume);
  const drawn = new Set(selection.records.map((record) => record.elementId));
  const recovered = new Set(outcome.elementBounds.map((record) => record.elementId));
  const seen = new Set<number>(recovered);
  for (const elementId of outcome.elementIndex?.partitionRecordIds ?? []) seen.add(elementId);
  for (const elementId of outcome.elementIndex?.uniqueElementIds ?? []) seen.add(elementId);

  const products = readIfcProducts(readFileSync(ifcPath, "latin1"), new Set(REPORTED_TYPES));
  const byType = new Map<string, IfcProduct[]>();
  for (const product of products) {
    const group = byType.get(product.type) ?? [];
    group.push(product);
    byType.set(product.type, group);
  }

  const rows: Record<string, CoverageRow> = {};
  let totalIfc = 0;
  let totalDrawn = 0;
  for (const type of REPORTED_TYPES) {
    const group = byType.get(type) ?? [];
    if (!group.length) continue;
    rows[type] = {
      inIfc: group.length,
      seen: group.filter((product) => seen.has(product.tag)).length,
      recovered: group.filter((product) => recovered.has(product.tag)).length,
      drawn: group.filter((product) => drawn.has(product.tag)).length,
    };
    // Openings are voids, not building elements; they are reported for context
    // but would distort a total that is meant to read as "how much of the
    // building is on screen".
    if (type !== "IFCOPENINGELEMENT") {
      totalIfc += group.length;
      totalDrawn += rows[type]!.drawn;
    }
  }

  return {
    rows,
    totals: { inIfc: totalIfc, drawn: totalDrawn },
    recordCount: outcome.elementBounds.length,
    withVolumeCount: withVolume.length,
    drawnCount: selection.records.length,
    unclassifiedCount: selection.unclassifiedCount,
    omittedSheetCount: selection.omittedSheetCount,
    // `selectDisplayBounds` already returns what it actually held back, and
    // recomputing it from `displayRole` alone stopped being the same number
    // when the wrapper rule started checking its own premise: a wrapper with
    // no curtain panel behind it is now released, so the role says "wrapper"
    // for 1,607 records while 1,582 are withheld.
    omittedWrapperCount: selection.omittedWrapperCount,
    stats: outcome.stats,
    drawnIds: drawn,
  };
}

/** The table this script exists to print. */
export function printCoverage(result: CoverageResult): void {
  console.log(
    `${pad("IFC product type", 22)}${padStart("in IFC", 8)}${padStart("seen", 8)}` +
      `${padStart("recovered", 11)}${padStart("drawn", 8)}${padStart("drawn %", 9)}`,
  );
  console.log("-".repeat(66));
  for (const type of REPORTED_TYPES) {
    const row = result.rows[type];
    if (!row) continue;
    const share = ((row.drawn / row.inIfc) * 100).toFixed(1);
    console.log(
      `${pad(type, 22)}${padStart(String(row.inIfc), 8)}${padStart(String(row.seen), 8)}` +
        `${padStart(String(row.recovered), 11)}${padStart(String(row.drawn), 8)}` +
        `${padStart(`${share}%`, 9)}`,
    );
  }
  console.log("-".repeat(66));
  const { inIfc, drawn } = result.totals;
  console.log(
    `${pad("building elements", 22)}${padStart(String(inIfc), 8)}${padStart("", 8)}` +
      `${padStart("", 11)}${padStart(String(drawn), 8)}` +
      `${padStart(`${((drawn / inIfc) * 100).toFixed(1)}%`, 9)}`,
  );
}

/** The recovery ledger that sits under the table. */
export function printLedger(result: CoverageResult): void {
  const stats = result.stats;
  console.log(`
records recovered        ${result.recordCount.toLocaleString()}
  with a drawable extent ${result.withVolumeCount.toLocaleString()}
  drawn                  ${result.drawnCount.toLocaleString()}
  of those, uncategorised ${result.unclassifiedCount.toLocaleString()}
sheets held back        ${result.omittedSheetCount.toLocaleString()}
  held back as wrappers  ${result.omittedWrapperCount.toLocaleString()}
from a solid alone       ${(stats.solidOnlyElements ?? 0).toLocaleString()}
from an instance alone   ${(stats.instanceOnlyElements ?? 0).toLocaleString()}
railings swept          ${(stats.sweptRailings ?? 0).toLocaleString()}
curved walls rebuilt    ${(stats.curvedWalls ?? 0).toLocaleString()}
door leaves cut         ${(stats.doorLeaves ?? 0).toLocaleString()}
from a sketch boundary   ${(stats.sketchBoundaryElements ?? 0).toLocaleString()} \
(${(stats.unnamedSketchElements ?? 0).toLocaleString()} of them uncategorised)
conversion took          ${(stats.durationMs / 1000).toFixed(1)}s
`);
}

/** True when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!rvtPath || !ifcPath) {
    console.error("usage: audit-coverage.ts <model.rvt> <model.ifc> [--json <path>]");
    process.exit(2);
  }
  const jsonFlag = process.argv.indexOf("--json");
  const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : undefined;

  const outcome = convertModel(rvtPath);
  const result = computeCoverage(outcome, ifcPath);

  console.log(`\n${rvtPath.split("/").pop()} against ${ifcPath.split("/").pop()}\n`);
  printCoverage(result);
  printLedger(result);

  if (jsonPath) {
    writeFileSync(
      jsonPath,
      `${JSON.stringify(
        {
          rows: result.rows,
          totals: result.totals,
          stats: result.stats,
          categories: outcome.nativeCategories?.categories,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`per-type detail written to ${jsonPath}`);
  }
}
