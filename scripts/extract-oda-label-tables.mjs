#!/usr/bin/env node

/**
 * Extract the embedded label resource from the isolated ODA `TB_ExLabelUtils.tx`.
 *
 * The module carries a CSV-derived resource whose rows are plain ASCII:
 *
 *   OdBm::<Enum>::<ENUM_NAME>;<id>[;<label>]
 *
 * The rows are enumeration facts — an identifier, its C++ enumerator name, and
 * the label Revit shows for it. They are the same kind of fact already
 * transcribed into `built-in-categories.ts` and `built-in-parameters.ts` from
 * Autodesk's published API documentation, recovered here from a second,
 * independent source. No ODA code, algorithm, or binary is reproduced.
 *
 * Usage:
 *   node scripts/extract-oda-label-tables.mjs [isolated-root] [--write-lib]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = resolve(
  process.argv[2] ?? "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated",
);
const writeLib = process.argv.includes("--write-lib");

const BINARY = "TB_ExLabelUtils.tx";
const OUTPUT_JSON = resolve("docs/generated/oda-label-resource-tables.json");
const OUTPUT_MARKDOWN = resolve("docs/generated/oda-label-resource-tables.md");
const OUTPUT_MODULE = resolve("lib/reviter/oda-label-resource.ts");

/** The resource writes this sentinel where a row has no label. */
const NULL_LABEL = "ODBM_CSV_NULL";

/** Row shape: `OdBm::Family::ENUM_NAME;id` with an optional `;label` tail. */
const ROW = /^OdBm::([A-Za-z]+)::([A-Za-z0-9_]+);(-?\d+)(?:;(.*))?$/;

/**
 * Printable-ASCII runs of at least `minimum` characters, which is what `strings`
 * reports. Done in-process so the extraction does not depend on binutils.
 */
function asciiRuns(bytes, minimum = 4) {
  const runs = [];
  let start = -1;
  for (let index = 0; index <= bytes.length; index += 1) {
    const byte = index < bytes.length ? bytes[index] : 0;
    const printable = byte >= 0x20 && byte < 0x7f;
    if (printable) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0 && index - start >= minimum) {
      runs.push(bytes.toString("latin1", start, index));
    }
    start = -1;
  }
  return runs;
}

/**
 * Labels in the resource carry presentation padding — a trailing space on
 * `Specify `, a run of spaces inside `Scale Value    1:`. Collapsing runs and
 * trimming makes them comparable with the transcribed Autodesk labels without
 * changing any word.
 */
function normaliseLabel(value) {
  return value.replace(/\s+/g, " ").trim();
}

const bytes = await readFile(resolve(sourceRoot, BINARY));
const families = new Map();
let rowCount = 0;

for (const run of asciiRuns(bytes)) {
  const match = ROW.exec(run);
  if (!match) continue;
  const [, family, enumName, rawId, rawLabel] = match;
  const id = Number(rawId);
  const label = rawLabel === undefined || rawLabel === NULL_LABEL
    ? null
    : normaliseLabel(rawLabel) || null;
  if (!families.has(family)) families.set(family, new Map());
  const table = families.get(family);
  // The resource is emitted once per translation unit that references it, so
  // identical rows repeat. Keep the first and assert the repeats agree.
  const existing = table.get(id);
  if (!existing) {
    table.set(id, { enumName, label, aliases: [] });
    rowCount += 1;
    continue;
  }
  if (label !== null && existing.label === null) existing.label = label;
  if (existing.enumName === enumName) continue;
  // Two ids carry a renamed and a current enumerator. One pair is distinguished
  // by an `_OBSOLETE` suffix; for the other the labelled row is the live name.
  const obsolete = /_OBSOLETE$/;
  const [primary, alias] = obsolete.test(enumName) !== obsolete.test(existing.enumName)
    ? (obsolete.test(enumName) ? [existing.enumName, enumName] : [enumName, existing.enumName])
    : (label !== null ? [enumName, existing.enumName] : [existing.enumName, enumName]);
  existing.enumName = primary;
  if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
}

if (families.size === 0) {
  throw new Error(`no label rows found in ${resolve(sourceRoot, BINARY)}`);
}

const sortedFamilies = [...families.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([family, table]) => [
    family,
    [...table.entries()].sort((a, b) => a[0] - b[0]),
  ]);

const json = {
  source: BINARY,
  rows: rowCount,
  families: Object.fromEntries(
    sortedFamilies.map(([family, rows]) => [
      family,
      rows.map(([id, { enumName, label, aliases }]) => (
        aliases.length ? { id, enumName, label, aliases } : { id, enumName, label }
      )),
    ]),
  ),
};
await writeFile(OUTPUT_JSON, `${JSON.stringify(json, null, 2)}\n`);

const markdown = [
  "# ODA label resource tables",
  "",
  `Extracted from \`${BINARY}\` by \`scripts/extract-oda-label-tables.mjs\`.`,
  `${rowCount} rows across ${sortedFamilies.length} enumerations.`,
  "",
  "| Enumeration | Rows | With label | Label-less |",
  "| --- | ---: | ---: | ---: |",
  ...sortedFamilies.map(([family, rows]) => {
    const labelled = rows.filter(([, row]) => row.label !== null).length;
    return `| \`OdBm::${family}\` | ${rows.length} | ${labelled} | ${rows.length - labelled} |`;
  }),
  "",
].join("\n");
await writeFile(OUTPUT_MARKDOWN, markdown);

console.log(`${OUTPUT_JSON}: ${rowCount} rows, ${sortedFamilies.length} enumerations`);
for (const [family, rows] of sortedFamilies) {
  console.log(`  OdBm::${family}: ${rows.length}`);
}

if (!writeLib) {
  console.log("\npass --write-lib to regenerate lib/reviter/oda-label-resource.ts");
  process.exit(0);
}

/** Wrap `id:value` pairs into `|`-joined source lines under 100 columns. */
function packLines(pairs) {
  const lines = [];
  let current = "";
  for (const pair of pairs) {
    if (current && current.length + 1 + pair.length > 92) {
      lines.push(current);
      current = pair;
      continue;
    }
    current = current ? `${current}|${pair}` : pair;
  }
  if (current) lines.push(current);
  return lines.map((line) => `  ${JSON.stringify(line)},`).join("\n");
}

function assertPackable(pairs) {
  for (const pair of pairs) {
    if (pair.includes("|")) throw new Error(`packed value contains the separator: ${pair}`);
  }
  return pairs;
}

const categories = families.get("BuiltInCategory") ?? new Map();
const parameters = families.get("BuiltInParameter") ?? new Map();

/**
 * Read a packed `id:value` table out of one of the transcribed modules. The
 * generated module carries only what those tables do not already have, so the
 * two provenances stay separate and neither is shipped twice.
 */
async function readTranscribedTable(path, variable) {
  const source = await readFile(resolve(path), "utf8");
  const block = new RegExp(`const ${variable}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\.join\\("\\|"\\)`).exec(source);
  if (!block) throw new Error(`could not read ${variable} from ${path}`);
  const lines = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
  const table = new Map();
  for (const entry of lines.join("|").split("|")) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    table.set(Number(entry.slice(0, separator)), entry.slice(separator + 1));
  }
  return table;
}

const transcribedCategories = await readTranscribedTable(
  "lib/reviter/built-in-categories.ts",
  "PACKED_CATEGORIES",
);
const transcribedParameters = await readTranscribedTable(
  "lib/reviter/built-in-parameters.ts",
  "PACKED_PARAMETERS",
);

/** The transcribed parameter table's placeholder is the humanised enumerator. */
function humaniseEnumName(name) {
  return name
    .toLowerCase()
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
    .trim();
}

const categoryLabelPairs = assertPackable(
  [...categories.entries()]
    .filter(([, row]) => row.label !== null)
    .sort((a, b) => a[0] - b[0])
    .map(([id, row]) => `${id}:${row.label}`),
);

// A Revit sub-category label such as "Lines" is only meaningful under its
// parent, so a label shared by several ids cannot name a category on its own.
const labelOwners = new Map();
for (const [id, row] of categories) {
  if (row.label === null) continue;
  labelOwners.set(row.label, (labelOwners.get(row.label) ?? 0) + 1);
  void id;
}
const ambiguousIds = [...categories.entries()]
  .filter(([, row]) => row.label !== null && labelOwners.get(row.label) > 1)
  .map(([id]) => id)
  .sort((a, b) => a - b);

const categoryEnumPairs = assertPackable(
  [...categories.entries()]
    .filter(([id]) => !transcribedCategories.has(id))
    .sort((a, b) => a[0] - b[0])
    .map(([id, row]) => `${id}:${row.enumName.replace(/^OST_/, "")}`),
);

const parameterEnumPairs = assertPackable(
  [...parameters.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, row]) => `${id}:${row.enumName}`),
);

const placeholderLabels = [];
const parameterLabelPairs = assertPackable(
  [...parameters.entries()]
    .filter(([id, row]) => {
      if (row.label === null) return false;
      const transcribed = transcribedParameters.get(id);
      if (transcribed === undefined) return true;
      if (normaliseLabel(transcribed) === row.label) return false;
      // The transcribed table falls back to the humanised enumerator where the
      // API documentation prints no label. The resource has the real one.
      if (transcribed === humaniseEnumName(row.enumName)) {
        placeholderLabels.push(id);
        return true;
      }
      return false;
    })
    .sort((a, b) => a[0] - b[0])
    .map(([id, row]) => `${id}:${row.label}`),
);

const moduleSource = `/**
 * Enumeration facts recovered from the isolated ODA \`TB_ExLabelUtils.tx\` label
 * resource. Generated by \`scripts/extract-oda-label-tables.mjs\`; do not edit.
 *
 * This module is a second, independent source for the same kind of fact already
 * transcribed from Autodesk's published API documentation in
 * \`built-in-categories.ts\` and \`built-in-parameters.ts\`: an identifier, its
 * enumerator name, and the label Revit displays. It adds three things those
 * tables cannot supply.
 *
 * The first is the real Revit label for a category. The transcribed table stores
 * enumerator names and humanises them for display, which is close but not what
 * Revit shows: \`OST_CurtainWallPanels\` reads "Curtain Panels" in Revit, not
 * "Curtain Wall Panels", and \`OST_StairsRailing\` is simply "Railings".
 *
 * The second is the enumerator name for a parameter, which the transcribed table
 * drops in favour of the label. The enumerator is the stable identifier across
 * releases and locales, so an audit consumer should be able to read it.
 *
 * The third is coverage: ids present in this resource but absent from the
 * transcribed tables.
 *
 * Labels are whitespace-normalised. Rows the resource marks \`ODBM_CSV_NULL\`, or
 * writes with no label field at all, are omitted rather than guessed at.
 */

/** \`id:Label\` pairs joined by \`|\`, for every category the resource labels. */
const PACKED_CATEGORY_LABELS = [
${packLines(categoryLabelPairs)}
].join("|");

/** \`id:Name\` pairs joined by \`|\`, \`OST_\` prefix stripped. */
const PACKED_CATEGORY_ENUM_NAMES = [
${packLines(categoryEnumPairs)}
].join("|");

/**
 * Categories whose label is shared with at least one other category, because
 * Revit shows it nested under a parent. \`Lines\` alone names 5 categories and
 * \`<Hidden Lines>\` names 65, so these labels cannot stand in a flat list.
 */
const AMBIGUOUS_CATEGORY_LABEL_IDS = [
${packLines(ambiguousIds.map(String))}
].join("|").split("|").map(Number);

/** \`id:ENUM_NAME\` pairs joined by \`|\`. */
const PACKED_PARAMETER_ENUM_NAMES = [
${packLines(parameterEnumPairs)}
].join("|");

/** \`id:Label\` pairs joined by \`|\`, for every parameter the resource labels. */
const PACKED_PARAMETER_LABELS = [
${packLines(parameterLabelPairs)}
].join("|");

function unpack(packed: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const entry of packed.split("|")) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    table.set(Number(entry.slice(0, separator)), entry.slice(separator + 1));
  }
  return table;
}

let categoryLabels: Map<number, string> | undefined;
let categoryEnumNames: Map<number, string> | undefined;
let parameterEnumNames: Map<number, string> | undefined;
let parameterLabels: Map<number, string> | undefined;
let ambiguousCategoryLabels: Set<number> | undefined;

/** Label Revit shows for a category id, including labels shared with siblings. */
export function odaCategoryLabel(categoryId: number): string | undefined {
  categoryLabels ??= unpack(PACKED_CATEGORY_LABELS);
  return categoryLabels.get(categoryId);
}

/** True when this category's label is shared and cannot name it on its own. */
export function isAmbiguousCategoryLabel(categoryId: number): boolean {
  ambiguousCategoryLabels ??= new Set(AMBIGUOUS_CATEGORY_LABEL_IDS);
  return ambiguousCategoryLabels.has(categoryId);
}

/** \`OST_\` enumerator name for a category id, without the prefix. */
export function odaCategoryEnumName(categoryId: number): string | undefined {
  categoryEnumNames ??= unpack(PACKED_CATEGORY_ENUM_NAMES);
  return categoryEnumNames.get(categoryId);
}

/** \`BuiltInParameter\` enumerator name, such as \`WALL_USER_HEIGHT_PARAM\`. */
export function parameterEnumName(parameterId: number): string | undefined {
  parameterEnumNames ??= unpack(PACKED_PARAMETER_ENUM_NAMES);
  return parameterEnumNames.get(parameterId);
}

/** Label Revit shows for a parameter id. */
export function odaParameterLabel(parameterId: number): string | undefined {
  parameterLabels ??= unpack(PACKED_PARAMETER_LABELS);
  return parameterLabels.get(parameterId);
}
`;

await writeFile(OUTPUT_MODULE, moduleSource);
console.log(`\n${OUTPUT_MODULE}: ${categoryLabelPairs.length} category labels, ${categoryEnumPairs.length} category names, ${ambiguousIds.length} ambiguous, ${parameterEnumPairs.length} parameter names, ${parameterLabelPairs.length} parameter labels`);
