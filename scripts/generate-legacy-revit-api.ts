/**
 * How `lib/reviter/legacy-revit-2021.data.ts` was produced — and the reason it
 * cannot be produced again here.
 *
 * **This script cannot run against this repository.** It reads a
 * `src/Decompiled` tree of C# from a Revitless toolkit checkout passed as its
 * one argument, and no such tree is committed: there are zero `.cs` files and
 * zero `Decompiled` directories in this repo. Run it with no argument and it
 * throws on the missing argument; run it with any path that exists here and it
 * throws on the missing directory. It had an `npm run generate:legacy-revit-api`
 * alias until 2026-08-12; that alias was removed, because an npm script is a
 * list of things a reader can run and this is not one of them.
 *
 * It is kept, unrun, as the precise record of the transposition — which files
 * were read, which `enum` and `Dictionary` declarations were extracted, and how
 * each was parsed. That is provenance the data file cannot carry on its own,
 * and it is what a future maintainer would re-execute if the input tree ever
 * came back. The input is decompiled Autodesk assembly source; it was never
 * committed and is not this repository's to redistribute.
 *
 * If you do hold that checkout:
 *   node --experimental-strip-types scripts/generate-legacy-revit-api.ts \
 *     /path/to/revitless-toolkit-master
 *
 * The translation is mechanical. It does not execute or ship the C# sources,
 * and the emitted module is isolated from Reviter's clean-room geometry
 * decoder — it is compatibility vocabulary, never evidence.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type EnumRows = Array<[name: string, value: number]>;
type MapValue = string | string[];
type MapRows = Array<[key: string, value: MapValue]>;

const toolkitRoot = process.argv[2];
if (!toolkitRoot) {
  throw new Error(
    "Pass the Revitless toolkit root, which this repository does not contain: " +
      "node --experimental-strip-types scripts/generate-legacy-revit-api.ts " +
      "/path/to/revitless-toolkit-master",
  );
}

const sourceRoot = resolve(toolkitRoot, "src", "Decompiled");
const extensionsRoot = join(sourceRoot, "Extensions");
const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "reviter",
  "legacy-revit-2021.data.ts",
);

function source(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function enumRows(contents: string, enumName: string): EnumRows {
  const body = contents.match(
    new RegExp(`public\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
  )?.[1];
  if (!body) throw new Error(`Could not find enum ${enumName}.`);

  const rows: EnumRows = [];
  let nextValue = 0;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim().replace(/,$/, "").trim();
    if (!line || line.startsWith("[") || line.startsWith("///")) continue;
    const match = line.match(/^([A-Za-z_]\w*)\s*(?:=\s*(-?(?:\d+|0x[\dA-F]+)))?$/i);
    if (!match) throw new Error(`Unsupported ${enumName} member: ${line}`);
    const value = match[2] == null ? nextValue : Number(match[2]);
    rows.push([match[1]!, value]);
    nextValue = value + 1;
  }
  return rows;
}

function balancedBlock(contents: string, assignment: string): string {
  const assignmentAt = contents.indexOf(`${assignment} = new Dictionary`);
  if (assignmentAt < 0) throw new Error(`Could not find dictionary ${assignment}.`);
  const start = contents.indexOf("{", assignmentAt);
  if (start < 0) throw new Error(`Could not find dictionary body for ${assignment}.`);

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < contents.length; index += 1) {
    const character = contents[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") quoted = false;
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return contents.slice(start + 1, index);
  }
  throw new Error(`Unclosed dictionary ${assignment}.`);
}

function rowBlocks(block: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < block.length; index += 1) {
    const character = block[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") quoted = false;
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === "{") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        rows.push(block.slice(start, index));
        start = -1;
      }
    }
  }
  return rows;
}

function splitFirstTopLevelComma(row: string): [string, string] {
  let braceDepth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") quoted = false;
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth -= 1;
    else if (character === "," && braceDepth === 0) {
      return [row.slice(0, index).trim(), row.slice(index + 1).trim()];
    }
  }
  throw new Error(`Could not split dictionary row: ${row}`);
}

function member(expression: string): string {
  const match = expression.match(/(?:^|\.)((?:[A-Za-z_]\w*))\s*$/);
  if (!match) throw new Error(`Unsupported enum expression: ${expression}`);
  return match[1]!;
}

function stringValue(expression: string): string | undefined {
  const trimmed = expression.trim().replace(/,\s*$/, "");
  if (trimmed === "string.Empty") return "";
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) return undefined;
  return JSON.parse(trimmed) as string;
}

function dictionaryRows(contents: string, assignment: string): MapRows {
  return rowBlocks(balancedBlock(contents, assignment)).map((row): [string, MapValue] => {
    const [keyExpression, rawValue] = splitFirstTopLevelComma(row);
    const key = member(keyExpression);
    const scalarString = stringValue(rawValue);
    if (scalarString != null) return [key, scalarString];
    if (/new\s+List</.test(rawValue)) {
      return [key, [...rawValue.matchAll(/\b[A-Za-z_]\w*\.([A-Za-z_]\w*)/g)]
        .map((match) => match[1]!)];
    }
    return [key, member(rawValue.replace(/,\s*$/, "").trim())];
  });
}

const enums: Record<string, EnumRows> = {};
for (const fileName of readdirSync(sourceRoot).filter((name) => name.endsWith(".cs")).sort()) {
  const contents = source(join(sourceRoot, fileName));
  const enumName = contents.match(/public\s+enum\s+([A-Za-z_]\w*)/)?.[1];
  if (enumName) enums[enumName] = enumRows(contents, enumName);
}

const mapSpecs = [
  ["builtInCategoryLabels", "BuiltInCategoryExtensions.cs", "knownCategories"],
  ["builtInParameterGroupLabels", "BuiltInParameterGroupExtensions.cs", "builtInParameterGroup"],
  ["displayUnitCatalog", "DisplayUnitTypeExtensions.cs", "dutToCatalog"],
  ["displayUnitSymbols", "DisplayUnitTypeExtensions.cs", "dutToUnitSymType"],
  ["displayUnitUnitTypes", "DisplayUnitTypeExtensions.cs", "dutToUnitType"],
  ["displayUnitParameterTypes", "DisplayUnitTypeExtensions.cs", "dutToParameterType"],
  ["unitSymbolLabels", "UnitSymbolTypeExtensions.cs", "unitSymbolTypes"],
  ["parameterTypeSharedData", "ParameterTypeExtensions.cs", "parameterTypes2Shared"],
  ["parameterTypeUnitTypes", "ParameterTypeExtensions.cs", "parameterTypes2UnitTypes"],
  ["unitTypeCatalog", "UnitTypeExtensions.cs", "utToCatalog"],
  ["unitTypeGroups", "UnitTypeExtensions.cs", "utGroups"],
  ["unitTypeParameterTypes", "UnitTypeExtensions.cs", "parameterTypes"],
] as const;

const maps: Record<string, MapRows> = {};
for (const [outputName, fileName, assignment] of mapSpecs) {
  maps[outputName] = dictionaryRows(source(join(extensionsRoot, fileName)), assignment);
}

// Emitted without an indentation argument, deliberately. The same data
// pretty-printed ran to 34,732 lines of one scalar each, which is a diff no
// reviewer reads and a file no reader scrolls; compact JSON is 57 lines and
// the identical parse. Re-emitting it compactly was verified by parsing both
// forms and deep-comparing them.
const generated = `/**
 * Revit 2021 compatibility vocabulary — the artifact of record.
 *
 * Machine-written by \`scripts/generate-legacy-revit-api.ts\` from a local
 * Revitless toolkit checkout: the C# under
 * \`revitless-toolkit-master/src/Decompiled\`, whose upstream files name
 * Autodesk \`RevitAPI.dll\` 21.0 as their source.
 *
 * **That input tree is not in this repository**, so for every reader of this
 * repository the generator throws and this file is the only copy of the data
 * that exists. Read the generator's own header before assuming it can be
 * re-run; it records what the input was and why it is absent.
 *
 * This is optional compatibility vocabulary. It is never used as evidence by
 * Reviter's clean-room RVT geometry decoder, and it is reached only through
 * \`loadLegacyRevit2021Api()\`, which imports it dynamically so the table stays
 * out of the initial viewer bundle.
 */

export type LegacyEnumRows = Array<[name: string, value: number]>;
export type LegacyMapRows = Array<[key: string, value: string | string[]]>;

export const LEGACY_REVIT_2021_ENUMS: Record<string, LegacyEnumRows> =
${JSON.stringify(enums)};

export const LEGACY_REVIT_2021_MAPS: Record<string, LegacyMapRows> =
${JSON.stringify(maps)};
`;

writeFileSync(outputPath, generated);
console.log(
  `Generated ${outputPath} with ${Object.values(enums).reduce((sum, rows) => sum + rows.length, 0)
    .toLocaleString()} enum members and ${Object.values(maps)
    .reduce((sum, rows) => sum + rows.length, 0).toLocaleString()} mapping rows.`,
);
