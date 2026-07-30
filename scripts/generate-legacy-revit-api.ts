/**
 * Generate Reviter's optional Revit 2021 compatibility tables from the local
 * Revitless toolkit checkout.
 *
 * This is intentionally a mechanical data translation. It does not execute or
 * ship the C# sources, and the generated module remains isolated from Reviter's
 * clean geometry decoder.
 *
 * Usage:
 *   npm run generate:legacy-revit-api -- /path/to/revitless-toolkit-master
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
    "Pass the Revitless toolkit root: " +
      "npm run generate:legacy-revit-api -- /path/to/revitless-toolkit-master",
  );
}

const sourceRoot = resolve(toolkitRoot, "src", "Decompiled");
const extensionsRoot = join(sourceRoot, "Extensions");
const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "reviter",
  "legacy-revit-2021.generated.ts",
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

const generated = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Personal/internal Revit 2021 compatibility data mechanically transposed
 * from revitless-toolkit-master/src/Decompiled. The upstream files identify
 * Autodesk RevitAPI.dll 21.0 as their source. This optional data module is not
 * used as evidence by Reviter's clean RVT geometry decoder.
 *
 * Regenerate with:
 *   npm run generate:legacy-revit-api -- /path/to/revitless-toolkit-master
 */

export type LegacyEnumRows = Array<[name: string, value: number]>;
export type LegacyMapRows = Array<[key: string, value: string | string[]]>;

export const LEGACY_REVIT_2021_ENUMS: Record<string, LegacyEnumRows> =
${JSON.stringify(enums, null, 2)};

export const LEGACY_REVIT_2021_MAPS: Record<string, LegacyMapRows> =
${JSON.stringify(maps, null, 2)};
`;

writeFileSync(outputPath, generated);
console.log(
  `Generated ${outputPath} with ${Object.values(enums).reduce((sum, rows) => sum + rows.length, 0)
    .toLocaleString()} enum members and ${Object.values(maps)
    .reduce((sum, rows) => sum + rows.length, 0).toLocaleString()} mapping rows.`,
);
