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
 */
import { readFileSync, writeFileSync } from "node:fs";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { displayRole, selectDisplayBounds } from "../lib/reviter/scene.ts";
import { solidBounds } from "../lib/reviter/bounds-records.ts";

/** IFC product types worth reporting, in the order a reader cares about them. */
const REPORTED_TYPES = [
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

type IfcProduct = { type: string; tag: number };

/**
 * Read `#id=IFCTYPE(...)` product lines and their Revit element id.
 *
 * The tag is the last all-digit quoted attribute: a product's name also holds
 * the id, but as `Family:Type:Id`, so it never reads as digits alone.
 */
function readIfcProducts(text: string, types: Set<string>): IfcProduct[] {
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

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
if (!rvtPath || !ifcPath) {
  console.error("usage: audit-coverage.ts <model.rvt> <model.ifc> [--json <path>]");
  process.exit(2);
}
const jsonFlag = process.argv.indexOf("--json");
const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : undefined;

const rvt = readFileSync(rvtPath);
const outcome = convertRvtBytes(
  new Uint8Array(rvt.buffer, rvt.byteOffset, rvt.byteLength),
  rvtPath.split("/").pop() ?? "model.rvt",
  // The release drives decoder selection; the studio reads it from
  // BasicFileInfo, and the supplied project is a 2027 file.
  { revitVersion: 2027 },
);
if (!outcome.ok) {
  console.error(`conversion failed: ${outcome.error}`);
  process.exit(1);
}

// Re-run the scene's own selection so the audit reports the set the viewer
// draws, rather than a set assembled a second, possibly different way.
const withVolume = outcome.elementBounds.filter(
  (record) => solidBounds(record) || (record.loops?.length ?? 0) > 0,
);
const selection = selectDisplayBounds(withVolume);
const drawn = new Set(selection.records.map((record) => record.elementId));
const recovered = new Set(outcome.elementBounds.map((record) => record.elementId));
// Everything the scan proved to be a real element, whether or not any geometry
// was built for it. The distance between `seen` and `recovered` is a decoder
// gap; the distance between `recovered` and `drawn` is a display gap. They have
// different fixes, so the audit has to tell them apart.
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

console.log(`\n${rvtPath.split("/").pop()} against ${ifcPath.split("/").pop()}\n`);
console.log(
  `${pad("IFC product type", 22)}${padStart("in IFC", 8)}${padStart("seen", 8)}` +
    `${padStart("recovered", 11)}${padStart("drawn", 8)}${padStart("drawn %", 9)}`,
);
console.log("-".repeat(66));

const rows: Record<string, { inIfc: number; seen: number; recovered: number; drawn: number }> = {};
let totalIfc = 0;
let totalDrawn = 0;
for (const type of REPORTED_TYPES) {
  const group = byType.get(type) ?? [];
  if (!group.length) continue;
  const seenCount = group.filter((product) => seen.has(product.tag)).length;
  const recoveredCount = group.filter((product) => recovered.has(product.tag)).length;
  const drawnCount = group.filter((product) => drawn.has(product.tag)).length;
  rows[type] = { inIfc: group.length, seen: seenCount, recovered: recoveredCount, drawn: drawnCount };
  // Openings are voids, not building elements; they are reported for context
  // but would distort a total that is meant to read as "how much of the
  // building is on screen".
  if (type !== "IFCOPENINGELEMENT") {
    totalIfc += group.length;
    totalDrawn += drawnCount;
  }
  const share = ((drawnCount / group.length) * 100).toFixed(1);
  console.log(
    `${pad(type, 22)}${padStart(String(group.length), 8)}${padStart(String(seenCount), 8)}` +
      `${padStart(String(recoveredCount), 11)}${padStart(String(drawnCount), 8)}` +
      `${padStart(`${share}%`, 9)}`,
  );
}
console.log("-".repeat(66));
console.log(
  `${pad("building elements", 22)}${padStart(String(totalIfc), 8)}${padStart("", 8)}` +
    `${padStart("", 11)}${padStart(String(totalDrawn), 8)}` +
    `${padStart(`${((totalDrawn / totalIfc) * 100).toFixed(1)}%`, 9)}`,
);

const wrappers = withVolume.filter((record) => displayRole(record) === "wrapper").length;
console.log(`
records recovered        ${outcome.elementBounds.length.toLocaleString()}
  with a drawable extent ${withVolume.length.toLocaleString()}
  drawn                  ${selection.records.length.toLocaleString()}
  of those, uncategorised ${selection.unclassifiedCount.toLocaleString()}
  held back as wrappers  ${wrappers.toLocaleString()}
from a solid alone       ${(outcome.stats.solidOnlyElements ?? 0).toLocaleString()}
from an instance alone   ${(outcome.stats.instanceOnlyElements ?? 0).toLocaleString()}
from a sketch boundary   ${(outcome.stats.sketchBoundaryElements ?? 0).toLocaleString()} \
(${(outcome.stats.unnamedSketchElements ?? 0).toLocaleString()} of them uncategorised)
conversion took          ${(outcome.stats.durationMs / 1000).toFixed(1)}s
`);

if (jsonPath) {
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        rows,
        totals: { inIfc: totalIfc, drawn: totalDrawn },
        stats: outcome.stats,
        categories: outcome.nativeCategories?.categories,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`per-type detail written to ${jsonPath}`);
}
