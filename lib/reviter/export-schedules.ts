/**
 * Source schedules inspired by rvt-rs ifc/schedule_csv.rs at 1c3d337,
 * Apache-2.0 (docs/third-party/rvt-rs). These inventory recovered source
 * evidence; they do not reconstruct Revit's saved schedule/view definitions.
 * Bounds columns describe envelopes, never exact extrusion dimensions or room
 * area. Parameter values remain serialized in their native internal units.
 */
import type { ConvertResult, ElementBoundsRecord, LevelBand } from "./types.ts";
import type { ElementParameter } from "./element-parameters.ts";
import { parameterKind, parameterStorage } from "./parameter-specs.ts";
import { elementManifest } from "./export-report.ts";
import { categoryIfcClass } from "./ifc-category-map.ts";
import { resolveIfcClass } from "./ifc-export-semantics.ts";
import { designOptionExportDecision, type DesignOptionSelectionMode } from "./design-options.ts";

export type ScheduleCsvOptions = {
  unit?: "feet" | "metres";
  excelBom?: boolean;
  /** Default inventory includes every alternative, with membership columns. */
  designOptions?: DesignOptionSelectionMode;
};
type CsvCell = string | number | boolean | undefined | null;

/** RFC4180 quoting plus spreadsheet formula neutralization for SOURCE text. */
export function scheduleCsvCell(value: CsvCell): string {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return "";
  let text = typeof value === "number" ? (Object.is(value, -0) ? "0" : String(value)) : String(value);
  if (typeof value === "string" && /^(?:\s*[=+\-@]|[\t\r\n])/u.test(value)) text = `'${text}`;
  return /[,"\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function render(headers: readonly string[], rows: readonly CsvCell[][], options: ScheduleCsvOptions) {
  return `${options.excelBom ? "\ufeff" : ""}${[headers, ...rows].map(row => row.map(scheduleCsvCell).join(",")).join("\r\n")}\r\n`;
}
function sameValue<T>(values: readonly T[]): T | undefined {
  return values.length && values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] : undefined;
}
function levels(result: ConvertResult) {
  const levelById = new Map<number, LevelBand>();
  const grouped = new Map<number, LevelBand[]>();
  for (const level of result.levels) if (level.levelId != null) {
    const held = grouped.get(level.levelId) ?? []; held.push(level); grouped.set(level.levelId, held);
  }
  for (const [id, values] of grouped) { const level = sameValue(values); if (level) levelById.set(id, level); }
  const byElement = new Map<number, number>();
  const related = new Map<number, number[]>();
  for (const relation of result.nativeAssociatedLevelRelations ?? []) {
    const held = related.get(relation.elementId) ?? []; held.push(relation.levelId); related.set(relation.elementId, held);
  }
  for (const [element, ids] of related) { const id = sameValue(ids); if (id !== undefined) byElement.set(element, id); }
  return { levelById, byElement };
}
function sourceRecords(result: ConvertResult) {
  const grouped = new Map<number, ElementBoundsRecord[]>();
  for (const record of result.elementBounds) { const held = grouped.get(record.elementId) ?? []; held.push(record); grouped.set(record.elementId, held); }
  return grouped;
}
function sourceField<K extends keyof ElementBoundsRecord>(records: readonly ElementBoundsRecord[], key: K) {
  return sameValue(records.map(record => record[key]).filter(value => value !== undefined));
}
function selected(result: ConvertResult, optionId: number | null | undefined, options: ScheduleCsvOptions) {
  return designOptionExportDecision(optionId === undefined ? undefined : { designOptionId: optionId }, result.nativeDesignOptions, options.designOptions).include;
}
function length(value: number | undefined, options: ScheduleCsvOptions) {
  return value === undefined ? undefined : value * (options.unit === "metres" ? 0.3048 : 1);
}
function unit(options: ScheduleCsvOptions) { return options.unit === "metres" ? "m" : "ft"; }
function levelRows(level: LevelBand | undefined, options: ScheduleCsvOptions): CsvCell[] {
  return [level?.levelId, level?.name, length(level?.elevation, options), level?.elevationSource];
}

/** One row per recovered element; class/overrides share the IFC mapping code. */
export function makeElementsCsv(result: ConvertResult, options: ScheduleCsvOptions = {}): string {
  const u = unit(options);
  const grouping = sourceRecords(result);
  const nativeLevels = levels(result);
  const hosts = new Map<number, number[]>();
  for (const relation of result.nativeHostRelations ?? []) { const held = hosts.get(relation.elementId) ?? []; held.push(relation.hostId); hosts.set(relation.elementId, held); }
  const rows = elementManifest(result).map(element => {
    const records = grouping.get(element.elementId) ?? [];
    const categoryId = sourceField(records, "categoryId");
    const optionId = sourceField(records, "designOptionId");
    if (!selected(result, optionId, options)) return undefined;
    const parameters = sourceField(records, "parameters") ?? [];
    const typeParameters = sourceField(records, "typeParameters") ?? [];
    const fallback = categoryIfcClass(categoryId, { wallKind: sourceField(records, "wallKind"), parameters });
    const ifc = resolveIfcClass(fallback, parameters, typeParameters);
    const level = nativeLevels.levelById.get(nativeLevels.byElement.get(element.elementId) ?? -1);
    const bounds = element.geometry.boundsFeet;
    const material = (element.materialAssignments ?? []).map(assignment => assignment.name).filter(Boolean).join("; ");
    const membership = designOptionExportDecision(optionId === undefined ? undefined : { designOptionId: optionId }, result.nativeDesignOptions, "main-and-primary");
    const cells: CsvCell[] = [element.elementId, element.uniqueId, element.displayed, categoryId, sourceField(records, "categoryName"),
      ifc?.entity, ifc?.predefinedType.replaceAll(".", ""), ifc ? "eligible" : "suppressed-by-source-parameter",
      sourceField(records, "typeId"), sourceField(records, "typeName"), sourceField(records, "familyId"), sourceField(records, "familyName"),
      ...levelRows(level, options), material || undefined,
      ...[bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].map(value => length(value, options)),
      ...[bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z].map(value => length(value, options)),
      sameValue(hosts.get(element.elementId) ?? []), element.geometry.source, element.geometry.finalProvenance,
      optionId === null ? "main-model" : optionId, membership.reason,
    ];
    return { elevation: level?.elevation ?? Infinity, id: element.elementId, cells };
  }).filter(row => row !== undefined).sort((a, b) => a.elevation - b.elevation || a.id - b.id);
  return render(["revit_element_id", "unique_id", "displayed", "category_id", "category", "ifc_entity", "predefined_type", "ifc_parameter_decision",
    "type_element_id", "type", "family_element_id", "family", "level_element_id", "level", `level_elevation_${u}`, "level_elevation_source", "material",
    ...["min_x", "min_y", "min_z", "max_x", "max_y", "max_z", "bounds_width", "bounds_depth", "bounds_height"].map(name => `${name}_${u}`),
    "host_revit_element_id", "body_source", "final_geometry_provenance", "design_option", "primary_option_decision"], rows.map(row => row.cells), options);
}

/** Native rooms include boxless identities; area requires a recovered solid. */
export function makeNativeRoomsCsv(result: ConvertResult, options: ScheduleCsvOptions = {}): string {
  const nativeLevels = levels(result);
  const rows = (result.nativeSourceRooms ?? []).filter(room => selected(result, room.designOptionId, options)).map(room => {
    const level = nativeLevels.levelById.get(room.levelId ?? nativeLevels.byElement.get(room.elementId) ?? -1);
    const scale = options.unit === "metres" ? 0.3048 * 0.3048 : 1;
    const area = room.outlineStatus === "recovered" && room.outline && room.outline.areaSquareFeet > 0 ? room.outline.areaSquareFeet * scale : undefined;
    return { elevation: level?.elevation ?? Infinity, id: room.elementId, cells: [room.elementId, room.key, room.number, room.name,
      ...levelRows(level, options), area, room.outlineStatus, room.outline?.source, room.parameterSource,
      room.designOptionId === null ? "main-model" : room.designOptionId, room.certifiedForRouting] as CsvCell[] };
  }).sort((a, b) => a.elevation - b.elevation || a.id - b.id);
  return render(["revit_element_id", "native_room_key", "number", "name", "level_element_id", "level", `level_elevation_${unit(options)}`, "level_elevation_source",
    `area_${unit(options)}2`, "outline_status", "outline_source", "parameter_source", "design_option", "certified_for_routing"], rows.map(row => row.cells), options);
}

/** Instance/type values stay separate, including conflicting saved evidence. */
export function makeParametersCsv(result: ConvertResult, options: ScheduleCsvOptions = {}): string {
  const rows: Array<{ element: number; scope: string; parameter: number; cells: CsvCell[] }> = [];
  const seen = new Set<string>();
  for (const record of result.elementBounds) {
    if (!selected(result, record.designOptionId, options)) continue;
    for (const [scope, parameters] of [["instance", record.parameters], ["type", record.typeParameters]] as const) {
      for (const parameter of parameters ?? [] as ElementParameter[]) {
        const key = JSON.stringify([record.elementId, scope, scope === "type" ? record.typeId : undefined, parameter]);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ element: record.elementId, scope, parameter: parameter.parameterId, cells: [record.elementId, scope, scope === "type" ? record.typeId : record.elementId,
          parameter.parameterId, parameter.enumName, parameter.name, parameterStorage(parameter.parameterId), parameterKind(parameter.parameterId),
          parameter.value, parameter.valueName, "serialized_not_evaluated"] });
      }
    }
  }
  rows.sort((a, b) => a.element - b.element || a.scope.localeCompare(b.scope) || a.parameter - b.parameter);
  return render(["revit_element_id", "scope", "owner_element_id", "parameter_id", "enumerator", "name", "storage_type", "quantity_kind", "raw_value", "value_name", "value_semantics"], rows.map(row => row.cells), options);
}
