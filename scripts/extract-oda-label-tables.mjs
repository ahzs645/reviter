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

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = resolve(
  process.argv[2] ?? "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated",
);
const writeLib = process.argv.includes("--write-lib");

const BINARY = "TB_ExLabelUtils.tx";
const DESCRIPTOR_BINARY = "TB_Base.tx";
const OUTPUT_JSON = resolve("docs/generated/oda-label-resource-tables.json");
const OUTPUT_DESCRIPTORS = resolve("docs/generated/oda-parameter-descriptors.json");
const OUTPUT_COMPOSITION = resolve("docs/generated/oda-release-composition-ranges.json");
const OUTPUT_MARKDOWN = resolve("docs/generated/oda-label-resource-tables.md");
const OUTPUT_MODULE = resolve("lib/reviter/oda-label-resource.ts");

/** The resource writes this sentinel where a row has no label. */
const NULL_LABEL = "ODBM_CSV_NULL";

/**
 * Row shape: `OdBm::Family::ENUM_NAME;id` with an optional `;label` tail.
 *
 * A `MAPPING;` prefix marks the rows of a separate table that lists which
 * parameters have enumerated values. Those rows carry no label, but two of them
 * are the only place in the file that names a parameter by its live enumerator
 * rather than an `_OBSOLETE` one, so they are read for the name alone.
 */
const ROW = /^(?:MAPPING;)?OdBm::([A-Za-z]+)::([A-Za-z0-9_]+);(-?\d+)(?:;(.*))?$/;

/**
 * Printable-ASCII runs of at least `minimum` characters, which is what `strings`
 * reports. Done in-process so the extraction does not depend on binutils.
 *
 * Every `OdBm::` row in this module is pure ASCII, and each one is terminated by
 * a CRLF or a NUL, so nothing the extractor reads is truncated here. That is not
 * true of the module's sibling tables: 182 rows across the unit-symbol and
 * enumerated-value tables carry bytes above 0x7f — `BTU/(h·ft²·°F)`, `90°
 * Counterclockwise` — and this scan would split them silently, leaving a prefix
 * that still parses. Anything reading those tables needs a UTF-8 scan first.
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
  // An id recurs when a label table and the enumerated-value table both name it.
  // Every such recurrence is label-less, so this only ever fills a gap.
  if (label !== null && existing.label === null) existing.label = label;
  if (existing.enumName === enumName) continue;
  if (label !== null && existing.label !== null && label !== existing.label) {
    // Never observed. If it ever happens the tie-break below would pair one
    // row's name with the other's label, so refuse rather than invent a row.
    throw new Error(
      `conflicting labels for ${family} ${id}: "${existing.label}" vs "${label}"`,
    );
  }
  // Four ids carry both a renamed and a live enumerator. Three are distinguished
  // by an `_OBSOLETE` suffix; for the fourth the labelled row is the live name.
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

/**
 * `g_Parameters` in `TB_Base.tx`: one descriptor per `BuiltInParameter`.
 *
 * A length-prefixed record table, `[u32 15]` then, for each parameter,
 * `i64 id`, `u32 storage`, `u32 0`, then UTF-16 spec, group, a `u16`, the
 * label, and the parameter's Forge type id. It is self-terminating — the
 * records tile the symbol exactly — so a run that does not land on the final
 * byte has mis-read the layout and is rejected rather than truncated.
 *
 * This is a second table from the same SDK and it is a strict superset of the
 * label CSV: every id agrees, no label conflicts, and 20 further ids appear
 * that the CSV omits because Revit shows them no label. `-1001101` is one, and
 * it is the id whose stored value reproduces the paired IFC export's wall
 * extrusion depth.
 */
const STORAGE_TYPES = ["Integer", "Double", "String", "ElementId", "None"];

function readParameterDescriptors(bytes, symbolOffset, symbolSize) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + symbolOffset, symbolSize);
  const decoder = new TextDecoder("utf-16le");
  let cursor = 4;
  const text = () => {
    const units = view.getUint32(cursor, true);
    cursor += 4;
    const value = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + cursor, units * 2));
    cursor += units * 2;
    return value;
  };
  const rows = [];
  while (cursor < symbolSize) {
    const id = Number(view.getBigInt64(cursor, true));
    cursor += 8;
    const storage = view.getUint32(cursor, true);
    cursor += 8;
    const spec = text();
    const group = text();
    cursor += 2;
    const label = text();
    const typeId = text();
    rows.push({
      id,
      storage: STORAGE_TYPES[storage] ?? `Unknown ${storage}`,
      spec: spec || null,
      group: group || null,
      label: label ? normaliseLabel(label) : null,
      typeId: typeId || null,
    });
  }
  if (cursor !== symbolSize) {
    throw new Error(`g_Parameters did not tile its symbol: stopped at ${cursor} of ${symbolSize}`);
  }
  return rows;
}

/** Read a symbol's file offset and size from `nm -S`. */
function symbolExtent(path, symbol) {
  const listing = spawnSync("nm", ["-S", "--defined-only", path], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout ?? "";
  const row = listing.split("\n").find((line) => line.trim().endsWith(` ${symbol}`));
  if (!row) return undefined;
  const [address, size] = row.trim().split(/\s+/);
  return { offset: Number.parseInt(address, 16), size: Number.parseInt(size, 16) };
}

let descriptors = [];
const descriptorPath = resolve(sourceRoot, DESCRIPTOR_BINARY);
const descriptorExtent = symbolExtent(descriptorPath, "g_Parameters");
if (!descriptorExtent) {
  console.warn(`skipping ${DESCRIPTOR_BINARY}: g_Parameters not found (is nm available?)`);
} else {
  const descriptorBytes = await readFile(descriptorPath);
  descriptors = readParameterDescriptors(
    descriptorBytes,
    descriptorExtent.offset,
    descriptorExtent.size,
  );
  const labelled = families.get("BuiltInParameter") ?? new Map();
  for (const row of descriptors) {
    const known = labelled.get(row.id);
    if (known && known.label !== null && row.label !== null && known.label !== row.label) {
      throw new Error(`descriptor label disagrees for ${row.id}: "${known.label}" vs "${row.label}"`);
    }
  }
  await writeFile(OUTPUT_DESCRIPTORS, `${JSON.stringify({
    source: DESCRIPTOR_BINARY,
    symbol: "g_Parameters",
    rows: descriptors.length,
    parameters: descriptors,
  }, null, 2)}\n`);
  console.log(`${OUTPUT_DESCRIPTORS}: ${descriptors.length} parameter descriptors`);
}

/**
 * `<Class>ComposeForLoad<startYear><endYear>` in `TB_LoaderBase.tx`.
 *
 * ODA composes a class from the file's own schema, so these are not layouts.
 * What they are is a map of where a class's composition is release-dependent:
 * `Element` is composed one way for 2011-2013, again for 2014, again for
 * 2015-2019, and again for 2019-2025. A rule fitted to one release holds across
 * its own range and is unproven outside it.
 *
 * Read as a boundary map only. A class with a single range is not evidence that
 * it is absent from other releases — an unchanged class needs no second
 * routine — so absence is not decodable from this alone.
 */
const COMPOSE_FOR_LOAD = /\b([A-Za-z_][A-Za-z0-9_]*)ComposeForLoad(\d{4})(\d{4})\b/g;

function readCompositionRanges(path) {
  const listing = spawnSync("nm", ["-D", "-C", path], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).stdout ?? "";
  const byClass = new Map();
  for (const [, className, from, to] of listing.matchAll(COMPOSE_FOR_LOAD)) {
    if (!byClass.has(className)) byClass.set(className, new Set());
    byClass.get(className).add(`${from}-${to}`);
  }
  return [...byClass.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([className, ranges]) => ({ class: className, ranges: [...ranges].sort() }));
}

const compositionRanges = readCompositionRanges(resolve(sourceRoot, "TB_LoaderBase.tx"));
if (compositionRanges.length > 0) {
  await writeFile(OUTPUT_COMPOSITION, `${JSON.stringify({
    source: "TB_LoaderBase.tx",
    symbol: "<Class>ComposeForLoad<startYear><endYear>",
    classes: compositionRanges.length,
    ranges: compositionRanges.reduce((n, row) => n + row.ranges.length, 0),
    composition: compositionRanges,
  }, null, 2)}\n`);
  console.log(`${OUTPUT_COMPOSITION}: ${compositionRanges.length} classes, ${
    compositionRanges.reduce((n, row) => n + row.ranges.length, 0)} ranges`);
} else {
  console.warn("skipping TB_LoaderBase.tx: no ComposeForLoad symbols (is nm available?)");
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

/** Display form the transcribed table falls back to when no label is adopted. */
function humaniseCategoryName(name) {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

// A Revit sub-category label such as "Lines" is only meaningful under its
// parent, so a label shared by several ids cannot name a category on its own.
const labelOwners = new Map();
for (const [, row] of categories) {
  if (row.label === null) continue;
  labelOwners.set(row.label, (labelOwners.get(row.label) ?? 0) + 1);
}

// A label also has to be unique against the names the ids that adopt no label
// keep. `OST_StairsRailing` is "Railings" in Revit, but `OST_Railings` is a
// different id whose enumerator already reads "Railings", so adopting the label
// would put two categories under one name.
//
// Testing a label against every other id's *fallback* is too strict, because
// most ids never use their fallback: `OST_Curtain_Systems` would read "Curtain
// Systems", but it has its own label, "Ruled Curtain System", so it never
// collides with `OST_CurtainSystems`. The test has to be against the names
// actually displayed, which is a fixpoint — withdrawing one adoption can only
// ever resolve collisions, never create them, so it converges.
const everyCategoryId = new Set([...transcribedCategories.keys(), ...categories.keys()]);
const fallbackName = new Map();
for (const id of everyCategoryId) {
  const enumName = transcribedCategories.get(id)
    ?? categories.get(id).enumName.replace(/^OST_/, "");
  fallbackName.set(id, humaniseCategoryName(enumName));
}

const adopted = new Set(
  [...categories.entries()]
    .filter(([, row]) => row.label !== null && labelOwners.get(row.label) === 1)
    .map(([id]) => id),
);
const displayName = (id) => (adopted.has(id) ? categories.get(id).label : fallbackName.get(id));

for (;;) {
  const owners = new Map();
  for (const id of everyCategoryId) {
    const name = displayName(id);
    if (!owners.has(name)) owners.set(name, []);
    owners.get(name).push(id);
  }
  const collisions = [...owners.values()].filter((sharing) => sharing.length > 1);
  if (collisions.length === 0) break;
  let withdrawn = 0;
  for (const sharing of collisions) {
    for (const id of sharing) if (adopted.delete(id)) withdrawn += 1;
  }
  if (withdrawn === 0) {
    throw new Error("display names collide with no adoption left to withdraw");
  }
}

const ambiguousIds = [...categories.entries()]
  .filter(([id, row]) => row.label !== null && !adopted.has(id))
  .map(([id]) => id)
  .sort((a, b) => a - b);

const categoryEnumPairs = assertPackable(
  [...categories.entries()]
    .filter(([id]) => !transcribedCategories.has(id))
    .sort((a, b) => a[0] - b[0])
    .map(([id, row]) => `${id}:${row.enumName.replace(/^OST_/, "")}`),
);

/**
 * Forge parameter type ids for the ids the label tables do not name.
 *
 * 18 of the 20 have one. The prefix and the version suffix are dropped, so
 * `autodesk.revit.parameter:wallHeightParam` ships as `wallHeightParam`.
 */
const parameterTypeNamePairs = assertPackable(
  descriptors
    .filter((row) => row.typeId !== null && !parameters.has(row.id))
    .sort((a, b) => a.id - b.id)
    .map((row) => `${row.id}:${row.typeId.replace(/^autodesk\.revit\.parameter:/, "").replace(/-\d+\.\d+\.\d+$/, "")}`),
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
 * Categories whose label cannot name them on its own.
 *
 * Most are labels Revit shows nested under a parent and reuses across siblings:
 * \`Lines\` alone names 5 categories and \`<Hidden Lines>\` names 65. One is a label
 * that collides with the enumerator-derived name another category keeps —
 * \`OST_StairsRailing\` is "Railings" in Revit, but \`OST_Railings\` is a different
 * id that already reads that way and has no label of its own to take instead.
 */
const AMBIGUOUS_CATEGORY_LABEL_IDS = [
${packLines(ambiguousIds.map(String))}
].join("|").split("|").map(Number);

/** \`id:ENUM_NAME\` pairs joined by \`|\`. */
const PACKED_PARAMETER_ENUM_NAMES = [
${packLines(parameterEnumPairs)}
].join("|");

/**
 * \`id:name\` pairs joined by \`|\`: the Forge parameter type id, stripped of its
 * \`autodesk.revit.parameter:\` prefix and version, for parameters that neither
 * label table names.
 */
const PACKED_PARAMETER_TYPE_NAMES = [
${packLines(parameterTypeNamePairs)}
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
let parameterTypeNames: Map<number, string> | undefined;
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

/**
 * Autodesk's Forge name for a parameter neither label table names, such as
 * \`wallHeightParam\` for \`-1001101\`.
 *
 * These parameters exist and are typed, they simply carry no label because
 * Revit does not surface them. Naming one is better than printing its number.
 */
export function parameterTypeName(parameterId: number): string | undefined {
  parameterTypeNames ??= unpack(PACKED_PARAMETER_TYPE_NAMES);
  return parameterTypeNames.get(parameterId);
}

/** Label Revit shows for a parameter id. */
export function odaParameterLabel(parameterId: number): string | undefined {
  parameterLabels ??= unpack(PACKED_PARAMETER_LABELS);
  return parameterLabels.get(parameterId);
}
`;

await writeFile(OUTPUT_MODULE, moduleSource);
console.log(`\n${OUTPUT_MODULE}: ${categoryLabelPairs.length} category labels, ${categoryEnumPairs.length} category names, ${ambiguousIds.length} ambiguous, ${parameterEnumPairs.length} parameter names, ${parameterTypeNamePairs.length} type names, ${parameterLabelPairs.length} parameter labels`);
