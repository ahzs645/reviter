/**
 * Lazy browser API over the optional Revit 2021 compatibility data.
 *
 * Importing this small module does not pull the generated 0.5 MB table into
 * the initial viewer bundle. Call `loadLegacyRevit2021Api()` only when an
 * internal inspection or migration tool needs the old API vocabulary.
 */

export type LegacyRevit2021EnumName =
  | "BuiltInCategory"
  | "BuiltInParameter"
  | "BuiltInParameterGroup"
  | "DisplayUnitType"
  | "FlowDirectionType"
  | "MEPSystemClassification"
  | "ParameterType"
  | "PipeFlowConfigurationType"
  | "UnitGroup"
  | "UnitSymbolType"
  | "UnitType";

export type LegacyRevit2021MapName =
  | "builtInCategoryLabels"
  | "builtInParameterGroupLabels"
  | "displayUnitCatalog"
  | "displayUnitSymbols"
  | "displayUnitUnitTypes"
  | "displayUnitParameterTypes"
  | "unitSymbolLabels"
  | "parameterTypeSharedData"
  | "parameterTypeUnitTypes"
  | "unitTypeCatalog"
  | "unitTypeGroups"
  | "unitTypeParameterTypes";

export type LegacyNamedValue = { name: string; value: number };

export type LegacyCategoryInfo = {
  value: number;
  names: string[];
  label?: string;
};

export type LegacyParameterTypeInfo = LegacyNamedValue & {
  sharedDataType?: string;
  unitType?: LegacyNamedValue;
};

export type LegacyUnitSymbolInfo = LegacyNamedValue & { label?: string };

export type LegacyDisplayUnitInfo = LegacyNamedValue & {
  catalog?: string;
  symbols: LegacyUnitSymbolInfo[];
  unitTypes: LegacyNamedValue[];
  parameterTypes: LegacyNamedValue[];
};

export type LegacyUnitTypeInfo = LegacyNamedValue & {
  catalog?: string;
  group?: LegacyNamedValue;
  parameterType?: LegacyNamedValue;
};

export type LegacySearchResult = LegacyNamedValue & {
  enumName: LegacyRevit2021EnumName;
  label?: string;
};

export type LegacyRevit2021Api = {
  enumNames: LegacyRevit2021EnumName[];
  enumMembers(enumName: LegacyRevit2021EnumName): LegacyNamedValue[];
  enumValue(enumName: LegacyRevit2021EnumName, memberName: string): number | undefined;
  enumMemberNames(enumName: LegacyRevit2021EnumName, value: number): string[];
  mappedValue(
    mapName: LegacyRevit2021MapName,
    memberName: string,
  ): string | string[] | undefined;
  mappedKeys(mapName: LegacyRevit2021MapName, value: string): string[];
  search(query: string | number, limit?: number): LegacySearchResult[];
  category(value: number): LegacyCategoryInfo | undefined;
  parameter(value: number): LegacyCategoryInfo | undefined;
  parameterGroup(value: number): LegacyCategoryInfo | undefined;
  parameterType(valueOrName: number | string): LegacyParameterTypeInfo | undefined;
  displayUnit(valueOrName: number | string): LegacyDisplayUnitInfo | undefined;
  unitSymbol(valueOrName: number | string): LegacyUnitSymbolInfo | undefined;
  unitType(valueOrName: number | string): LegacyUnitTypeInfo | undefined;
};

type GeneratedModule = typeof import("./legacy-revit-2021.generated.ts");

function createApi(data: GeneratedModule): LegacyRevit2021Api {
  const nameToValue = new Map<string, Map<string, number>>();
  const valueToNames = new Map<string, Map<number, string[]>>();
  const relations = new Map<string, Map<string, string | string[]>>();

  for (const [enumName, rows] of Object.entries(data.LEGACY_REVIT_2021_ENUMS)) {
    const byName = new Map<string, number>();
    const byValue = new Map<number, string[]>();
    for (const [name, value] of rows) {
      byName.set(name, value);
      const aliases = byValue.get(value) ?? [];
      aliases.push(name);
      byValue.set(value, aliases);
    }
    nameToValue.set(enumName, byName);
    valueToNames.set(enumName, byValue);
  }
  for (const [mapName, rows] of Object.entries(data.LEGACY_REVIT_2021_MAPS)) {
    relations.set(mapName, new Map(rows));
  }

  const enumNames = Object.keys(data.LEGACY_REVIT_2021_ENUMS) as LegacyRevit2021EnumName[];

  function enumValue(enumName: LegacyRevit2021EnumName, memberName: string) {
    return nameToValue.get(enumName)?.get(memberName);
  }

  function enumMemberNames(enumName: LegacyRevit2021EnumName, value: number) {
    return [...(valueToNames.get(enumName)?.get(value) ?? [])];
  }

  function member(enumName: LegacyRevit2021EnumName, valueOrName: number | string) {
    if (typeof valueOrName === "string") {
      const value = enumValue(enumName, valueOrName);
      return value == null ? undefined : { name: valueOrName, value };
    }
    const name = enumMemberNames(enumName, valueOrName)[0];
    return name ? { name, value: valueOrName } : undefined;
  }

  function mappedValue(mapName: LegacyRevit2021MapName, memberName: string) {
    const value = relations.get(mapName)?.get(memberName);
    return Array.isArray(value) ? [...value] : value;
  }

  function mappedText(mapName: LegacyRevit2021MapName, memberName: string) {
    const value = mappedValue(mapName, memberName);
    return typeof value === "string" ? value : undefined;
  }

  function mappedKeys(mapName: LegacyRevit2021MapName, value: string) {
    const matches: string[] = [];
    for (const [key, mapped] of relations.get(mapName) ?? []) {
      if (Array.isArray(mapped) ? mapped.includes(value) : mapped === value) matches.push(key);
    }
    return matches;
  }

  function mappedMembers(
    mapName: LegacyRevit2021MapName,
    key: string,
    enumName: LegacyRevit2021EnumName,
  ): LegacyNamedValue[] {
    const values = mappedValue(mapName, key);
    const names = Array.isArray(values) ? values : values == null ? [] : [values];
    const seen = new Set<string>();
    return names.flatMap((name) => {
      if (seen.has(name)) return [];
      seen.add(name);
      const value = enumValue(enumName, name);
      return value == null ? [] : [{ name, value }];
    });
  }

  function categoryLike(
    enumName: "BuiltInCategory" | "BuiltInParameter" | "BuiltInParameterGroup",
    labelMap: LegacyRevit2021MapName | undefined,
    value: number,
  ): LegacyCategoryInfo | undefined {
    const names = enumMemberNames(enumName, value);
    if (!names.length) return undefined;
    const label = labelMap
      ? names.map((name) => mappedText(labelMap, name)).find((candidate) => candidate != null)
      : undefined;
    return { value, names, ...(label != null ? { label } : {}) };
  }

  const api: LegacyRevit2021Api = {
    enumNames,
    enumMembers(enumName) {
      return (data.LEGACY_REVIT_2021_ENUMS[enumName] ?? [])
        .map(([name, value]) => ({ name, value }));
    },
    enumValue,
    enumMemberNames,
    mappedValue,
    mappedKeys,
    search(query, limit = 50) {
      const normalized = String(query).trim().toLowerCase();
      if (!normalized || limit <= 0) return [];
      const exactNumber = /^-?\d+$/.test(normalized) ? Number(normalized) : undefined;
      const results: LegacySearchResult[] = [];
      for (const enumName of enumNames) {
        for (const [name, value] of data.LEGACY_REVIT_2021_ENUMS[enumName] ?? []) {
          let label: string | undefined;
          if (enumName === "BuiltInCategory") {
            label = mappedText("builtInCategoryLabels", name);
          } else if (enumName === "BuiltInParameterGroup") {
            label = mappedText("builtInParameterGroupLabels", name);
          } else if (enumName === "UnitSymbolType") {
            label = mappedText("unitSymbolLabels", name);
          }
          if (
            exactNumber == null
              ? !name.toLowerCase().includes(normalized) &&
                !label?.toLowerCase().includes(normalized)
              : value !== exactNumber
          ) continue;
          results.push({ enumName, name, value, ...(label != null ? { label } : {}) });
          if (results.length >= limit) return results;
        }
      }
      return results;
    },
    category(value) {
      return categoryLike("BuiltInCategory", "builtInCategoryLabels", value);
    },
    parameter(value) {
      return categoryLike("BuiltInParameter", undefined, value);
    },
    parameterGroup(value) {
      return categoryLike("BuiltInParameterGroup", "builtInParameterGroupLabels", value);
    },
    parameterType(valueOrName) {
      const item = member("ParameterType", valueOrName);
      if (!item) return undefined;
      const sharedDataType = mappedText("parameterTypeSharedData", item.name);
      const unitType = mappedMembers("parameterTypeUnitTypes", item.name, "UnitType")[0];
      return {
        ...item,
        ...(sharedDataType != null ? { sharedDataType } : {}),
        ...(unitType ? { unitType } : {}),
      };
    },
    displayUnit(valueOrName) {
      const item = member("DisplayUnitType", valueOrName);
      if (!item) return undefined;
      const symbols = mappedMembers("displayUnitSymbols", item.name, "UnitSymbolType")
        .map((symbol): LegacyUnitSymbolInfo => {
          const label = mappedText("unitSymbolLabels", symbol.name);
          return { ...symbol, ...(label != null ? { label } : {}) };
        });
      const catalog = mappedText("displayUnitCatalog", item.name);
      return {
        ...item,
        ...(catalog != null ? { catalog } : {}),
        symbols,
        unitTypes: mappedMembers("displayUnitUnitTypes", item.name, "UnitType"),
        parameterTypes: mappedMembers(
          "displayUnitParameterTypes",
          item.name,
          "ParameterType",
        ),
      };
    },
    unitSymbol(valueOrName) {
      const item = member("UnitSymbolType", valueOrName);
      if (!item) return undefined;
      const label = mappedText("unitSymbolLabels", item.name);
      return { ...item, ...(label != null ? { label } : {}) };
    },
    unitType(valueOrName) {
      const item = member("UnitType", valueOrName);
      if (!item) return undefined;
      const catalog = mappedText("unitTypeCatalog", item.name);
      const group = mappedMembers("unitTypeGroups", item.name, "UnitGroup")[0];
      const parameterType = mappedMembers(
        "unitTypeParameterTypes",
        item.name,
        "ParameterType",
      )[0];
      return {
        ...item,
        ...(catalog != null ? { catalog } : {}),
        ...(group ? { group } : {}),
        ...(parameterType ? { parameterType } : {}),
      };
    },
  };
  return api;
}

let apiPromise: Promise<LegacyRevit2021Api> | undefined;

export function loadLegacyRevit2021Api(): Promise<LegacyRevit2021Api> {
  apiPromise ??= import("./legacy-revit-2021.generated.ts").then(createApi);
  return apiPromise;
}
