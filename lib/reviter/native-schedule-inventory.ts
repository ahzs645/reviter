/** Stored authored schedule definitions/cells. Pinned native graph schema is the
 * binary contract; Autodesk's ViewSchedule guide supplies public API context.
 * Native enum codes are retained without guessing their public API mapping.
 */
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";
import { scheduleCsvCell } from "./export-schedules.ts";
type ObjectFields = Record<string, unknown>;
export type ScheduleWitness = { objectIndex: number; className: string; pointerPath: Array<{ owner: number; field: string; pointerOffset: number; target: number }> };
export type StoredScheduleField = { fieldId: string; position: number; parameterId: string; heading: string; hidden: boolean; sourceTypeCode: number; displayTypeCode: number; columnWidthFeet: number; format: ObjectFields | null; expression: StoredScheduleExpression | null; source: ScheduleWitness };
export type StoredScheduleExpression = { className: string; objectIndex: number; fields: ObjectFields; children: StoredScheduleExpression[]; semantics: "serialized-not-evaluated" };
export type StoredScheduleCell = { sectionCode: number; row: number; column: number; text: string; cellTypeCode: number; parameterId: string | null; categoryId: string | null; storedCoverOffsets: { top: number; bottom: number; left: number; right: number }; source: ScheduleWitness };
export type StoredScheduleDimension = { valueFeet: number; source: ScheduleWitness };
export type StoredScheduleSection = {
  sectionCode: number; storedHidden: boolean | null; layoutComplete: boolean;
  rows: StoredScheduleDimension[]; columns: StoredScheduleDimension[]; source: ScheduleWitness;
};
export type StoredNativeSchedule = {
  elementId: string; name: string; title: string | null; categoryId: string; schemaObjectIndex: number;
  source: { stream: string; groupRecordOffset: number; bodySha256: string; rawRecordIndex: number };
  settings: ObjectFields; fields: StoredScheduleField[]; sorting: Array<{ fieldId: string; sortOrderCode: number; groupingFlags: number; source: ScheduleWitness }>;
  filters: Array<{ fieldId: string; filterTypeCode: number; storageTypeCode: number; storedSlots: ObjectFields; source: ScheduleWitness }>;
  cells: StoredScheduleCell[]; sections: StoredScheduleSection[]; diagnostics: string[];
};
export type NativeScheduleInventory = {
  apiVersion: 1; kind: "native-schedule-inventory"; sourceSha256: string | null; schemaSha256: string | null; readerCommit: string;
  revitVersion: number | null; status: NativeEvidenceReport["source"]["status"]; schedules: StoredNativeSchedule[];
  diagnostics: string[]; limits: typeof LIMITS; scope: string;
};
const LIMITS = { records: 4096, graphObjects: 4096, fieldsPerSchedule: 1024, cellsPerSchedule: 10_000, expressionNodes: 256, expressionDepth: 24, textCharacters: 16_384, diagnostics: 256 } as const;
const object = (v: unknown): ObjectFields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as ObjectFields : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const natural = (v: unknown): v is number => integer(v) && v >= 0;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= LIMITS.textCharacters;
function id(v: unknown): string | null {
  for (let i = 0; i < 5; i++) {
    if (integer(v)) return String(v);
    if (typeof v === "string" && /^-?(?:0|[1-9][0-9]{0,19})$/.test(v)) { const n = BigInt(v); return n >= -(1n << 63n) && n < (1n << 64n) ? n.toString() : null; }
    const fields = object(v); v = fields.m_id64 ?? fields.m_id;
  }
  return null;
}
const EXPRESSION_FIELDS: Record<string, string[]> = {
  NumberConstantExpression: ["m_value", "m_specTypeId"], ScheduleFieldExpression: ["m_fieldId"],
  BinaryOperatorExpression: ["m_binaryOperator"], FunctionExpression: ["m_function"],
  StringConstantExpression: ["m_value"], UnaryOperatorExpression: ["m_unaryOperator"],
};
const EXPRESSION_CHILDREN: Record<string, string[]> = {
  BinaryOperatorExpression: ["m_pLeftSubexpression", "m_pRightSubexpression"],
  UnaryOperatorExpression: ["m_pSubexpression"], FunctionExpression: ["m_subexpressions"],
};
function scalarRecord(fields: ObjectFields, keys: string[]): ObjectFields {
  const output: ObjectFields = {};
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "boolean" || text(value) || (typeof value === "number" && Number.isFinite(value))) output[key] = value;
    else if (text(object(value).m_typeId)) output[key] = { m_typeId: object(value).m_typeId };
    else { const n = id(value); if (n !== null) output[key] = n; }
  }
  return output;
}
export function buildNativeScheduleInventory(report: NativeEvidenceReport): NativeScheduleInventory {
  const summary = object(report.source.summary), version = summary.revit_version;
  const inventory: NativeScheduleInventory = {
    apiVersion: 1, kind: "native-schedule-inventory", sourceSha256: hash(report.sourceSha256) ? report.sourceSha256 : null,
    schemaSha256: hash(summary.schema_sha256) ? summary.schema_sha256 : null, readerCommit: report.readerCommit,
    revitVersion: natural(version) ? version : null, status: report.source.status, schedules: [], diagnostics: [], limits: LIMITS,
    scope: "Stored authored columns, filters, sort/group codes, formatting, expression trees and owned table-cell text. Table caches are not recalculated schedule body rows. No enum-code interpretation, formula execution, linked-model joins or Revit API equivalence.",
  };
  const diagnostic = (message: string) => { if (inventory.status === "complete") inventory.status = "partial"; if (inventory.diagnostics.length < LIMITS.diagnostics) inventory.diagnostics.push(message); };
  if (report.source.apiVersion !== 1 || report.source.kind !== "native-source-evidence" || !inventory.sourceSha256 || !inventory.schemaSha256 || report.readerPatch !== "native-evidence" || report.readerCommit !== "1c3d337dbd2a6810e9dfad68fe99857843d67387" || ![2024, 2025, 2026].includes(inventory.revitVersion ?? 0)) {
    inventory.status = "unsupported"; diagnostic("Exact source/schema hashes, pinned reader and qualified Revit 2024–2026 context are required."); return inventory;
  }
  if (["unsupported", "budget-blocked"].includes(inventory.status)) return inventory;
  const ownerCounts = new Map<string, number>();
  for (const raw of report.source.records) { const n = id(object(object(raw).identity).element_id); if (n) ownerCounts.set(n, (ownerCounts.get(n) ?? 0) + 1); }
  report.source.records.slice(0, LIMITS.records).forEach((raw, rawRecordIndex) => {
    const record = object(raw); if (record.class_name !== "DBViewSchedule") return;
    const graph = object(record.graph), objects = list(graph.objects).map(object), edges = list(graph.edges).map(object), root = objects[0], fields = object(root?.fields), source = object(record.source), elementId = id(object(record.identity).element_id);
    const span = (n: ObjectFields | undefined): boolean => !!n && natural(n.start) && natural(n.fields_end) && n.start < n.fields_end && natural(source.body_bytes) && n.fields_end <= source.body_bytes;
    if (record.status !== "complete_bounded_graph" || record.diagnostic != null || !elementId || BigInt(elementId) <= 0n || ownerCounts.get(elementId) !== 1 || root?.class_name !== "DBViewSchedule" || id(fields.m_id) !== elementId || !span(root) || !natural(source.body_bytes) || graph.consumed_bytes !== source.body_bytes || !hash(source.body_sha256) || !natural(source.group_record_offset) || typeof source.stream !== "string" || !/^Partitions\/\d+$/.test(source.stream) || objects.length > LIMITS.graphObjects || !text(fields.m_viewName)) { diagnostic(`Schedule ${elementId ?? "unresolved"} lacks complete unambiguous source identity/bounds.`); return; }
    const problems: string[] = [];
    const problem = (message: string) => { if (problems.length < LIMITS.diagnostics) problems.push(message); };
    const link = (owner: number, field: string, pointer: unknown, expectedClass?: string): { target: number; witness: ScheduleWitness["pointerPath"][number] } | null => {
      const p = object(pointer), n = objects[owner]; if (p.pointer_token === 0) return null;
      const es = edges.filter(e => e.source_object_index === owner && e.pointer_offset === p.offset);
      const e = es[0], target = natural(e?.target_object_index) ? e.target_object_index : null, t = target !== null ? objects[target] : undefined;
      if (es.length !== 1 || !n || !span(n) || !natural(p.offset) || p.offset < (n.start as number) || p.offset >= (n.fields_end as number) || !natural(p.pointer_token) || p.pointer_token === 0 || e.pointer_token !== p.pointer_token || e.target_class_tag !== p.class_tag || !t || !span(t) || t.token !== p.pointer_token || t.class_tag !== p.class_tag || (expectedClass && t.class_name !== expectedClass)) { problem(`${owner}.${field}: inconsistent owned pointer token/class/bounds.`); return null; }
      return { target: target!, witness: { owner, field, pointerOffset: p.offset, target: target! } };
    };
    const schemaLink = link(0, "m_pSchema", fields.m_pSchema, "ScheduleSchema");
    if (!schemaLink) { diagnostic(`Schedule ${elementId} has no proven owned ScheduleSchema.`); return; }
    const si = schemaLink.target, sf = object(objects[si].fields), categoryId = id(sf.m_categoryId);
    if (categoryId === null) { diagnostic(`Schedule ${elementId} has invalid schema category identity.`); return; }
    const schedule: StoredNativeSchedule = { elementId, name: fields.m_viewName as string, title: text(sf.m_altScheduleTitle) ? sf.m_altScheduleTitle : null, categoryId, schemaObjectIndex: si,
      source: { stream: source.stream, groupRecordOffset: source.group_record_offset, bodySha256: source.body_sha256, rawRecordIndex },
      settings: scalarRecord(sf, ["m_bIncludeLinkedFiles", "m_bMaterialSchedule", "m_bInstanceSchedule", "m_bFilterBySheet", "m_isEmbedded", "m_showGrandTotal", "m_showGrandTotalCount", "m_showGrandTotalTitle", "m_showHeaders", "m_showTitle", "m_grandTotalTitle", "m_areaSchemeId", "m_familyId", "m_roomScheduleFilter"]), fields: [], sorting: [], filters: [], cells: [], sections: [], diagnostics: problems };
    const path = [schemaLink.witness];
    const ownedArray = (owner: number, field: string, className: string, max: number, parent: ScheduleWitness["pointerPath"], visit: (target: number, witness: ScheduleWitness) => void) => {
      const saved = object(objects[owner].fields)[field]; if (!Array.isArray(saved) || saved.length > max) { problem(`${owner}.${field}: missing/over-budget pointer array.`); return; }
      const targets = new Set<number>();
      saved.forEach((p, i) => { const l = link(owner, `${field}[${i}]`, p, className); if (!l) return; if (targets.has(l.target)) { problem(`${owner}.${field}: duplicate target.`); return; } targets.add(l.target); visit(l.target, { objectIndex: l.target, className, pointerPath: [...parent, l.witness] }); });
    };
    let expressionNodes = 0;
    const expression = (target: number, ancestors: Set<number>, depth: number): StoredScheduleExpression | null => {
      const node = objects[target], className = String(node.class_name), ef = object(node.fields);
      if (depth > LIMITS.expressionDepth || ++expressionNodes > LIMITS.expressionNodes || ancestors.has(target) || !Object.hasOwn(EXPRESSION_FIELDS, className)) { problem("Expression cycle, unsupported class or expression budget reached."); return null; }
      const result: StoredScheduleExpression = { className, objectIndex: target, fields: scalarRecord(ef, EXPRESSION_FIELDS[className]), children: [], semantics: "serialized-not-evaluated" };
      const next = new Set(ancestors); next.add(target);
      for (const childField of EXPRESSION_CHILDREN[className] ?? []) {
        const ps = Array.isArray(ef[childField]) ? ef[childField] as unknown[] : [ef[childField]];
        if (ps.length > LIMITS.expressionNodes) { problem("Expression children exceed budget."); continue; }
        ps.forEach((p, i) => { const l = link(target, `${childField}[${i}]`, p); if (l) { const child = expression(l.target, next, depth + 1); if (child) result.children.push(child); } });
      }
      return result;
    };
    const fieldIds = list(sf.m_fieldIds).map(id);
    if (!Array.isArray(sf.m_fieldIds) || fieldIds.length > LIMITS.fieldsPerSchedule || fieldIds.some(n => n === null || BigInt(n) < 0n) || new Set(fieldIds).size !== fieldIds.length || !Array.isArray(sf.m_pFields) || sf.m_pFields.length !== fieldIds.length) problem("Schema field IDs/order are invalid or do not align with field pointers.");
    else ownedArray(si, "m_pFields", "ScheduleField", LIMITS.fieldsPerSchedule, path, (target, witness) => {
      const f = object(objects[target].fields), pointerOffset = witness.pointerPath.at(-1)!.pointerOffset, position = (sf.m_pFields as unknown[]).findIndex(p => object(p).offset === pointerOffset), parameterId = id(f.m_paramElemId);
      if (position < 0 || parameterId === null || !text(f.m_columnHeading) || typeof f.m_hidden !== "boolean" || !integer(f.m_sourceType) || !integer(f.m_displayType) || typeof f.m_columnWidth !== "number" || !Number.isFinite(f.m_columnWidth) || f.m_columnWidth < 0) { problem(`Field ${target} has unsupported required fields.`); return; }
      const fmt = link(target, "m_pFormatOptions", f.m_pFormatOptions, "FormatOptions"), expr = object(f.m_pExpression).pointer_token === 0 ? null : link(target, "m_pExpression", f.m_pExpression);
      schedule.fields.push({ fieldId: fieldIds[position]!, position, parameterId, heading: f.m_columnHeading, hidden: f.m_hidden, sourceTypeCode: f.m_sourceType, displayTypeCode: f.m_displayType, columnWidthFeet: f.m_columnWidth,
        format: fmt ? scalarRecord(object(objects[fmt.target].fields), ["m_accuracy", "m_unitTypeId", "m_symbolTypeId", "m_bUseDefault", "m_roundingMethod", "m_bUseGrouping", "m_bSuppressSpaces", "m_bSuppressLeadingZeros", "m_bSuppressTrailingZeros"]) : null,
        expression: expr ? expression(expr.target, new Set(), 0) : null, source: witness });
    });
    const validFieldIds = new Set(schedule.fields.map(f => f.fieldId));
    ownedArray(si, "m_sortFieldArr", "ScheduleSortField", LIMITS.fieldsPerSchedule, path, (target, witness) => {
      const f = object(objects[target].fields), fieldId = id(f.m_fieldId);
      if (!fieldId || !validFieldIds.has(fieldId) || !integer(f.m_sortOrder) || !integer(f.m_groupingFlags)) { problem(`Sort field ${target} references an unproven field or invalid codes.`); return; }
      schedule.sorting.push({ fieldId, sortOrderCode: f.m_sortOrder, groupingFlags: f.m_groupingFlags, source: witness });
    });
    ownedArray(si, "m_filterArr", "ScheduleFilter", LIMITS.fieldsPerSchedule, path, (target, witness) => {
      const f = object(objects[target].fields), value = object(f.m_value), fieldId = id(f.m_fieldId);
      if (!fieldId || !validFieldIds.has(fieldId) || !integer(f.m_filterType) || !integer(value.m_storageType)) { problem(`Filter ${target} references an unproven field or invalid codes.`); return; }
      // Preserve all typed storage slots. Native storage-code mapping has not been certified.
      const storedSlots = scalarRecord(value, ["m_dbl", "m_int", "m_elemId"]); if (text(object(value.m_str).m_str)) storedSlots.m_str = object(value.m_str).m_str;
      schedule.filters.push({ fieldId, filterTypeCode: f.m_filterType, storageTypeCode: value.m_storageType, storedSlots, source: witness });
    });
    const dataLink = object(fields.m_pData).pointer_token === 0 ? null : link(0, "m_pData", fields.m_pData, "ScheduleData");
    if (dataLink) ownedArray(dataLink.target, "m_SectionData", "ScheduleSectionData", 64, [dataLink.witness], (section, sectionWitness) => {
      const sectionFields = object(objects[section].fields), sectionCode = sectionFields.m_index;
      if (!integer(sectionCode)) { problem("Table section lacks an exact serialized index."); return; }
      const projectedSection: StoredScheduleSection = { sectionCode, storedHidden: typeof sectionFields.m_hideSection === "boolean" ? sectionFields.m_hideSection : null,
        layoutComplete: true, rows: [], columns: [], source: sectionWitness };
      if (projectedSection.storedHidden === null) { projectedSection.layoutComplete = false; problem(`Section ${sectionCode} lacks stored visibility.`); }
      for (const [field, className, valueField, dimensions, max] of [
        ["m_rows", "TableRowData", "m_dHeight", projectedSection.rows, LIMITS.cellsPerSchedule],
        ["m_cols", "TableColumnData", "m_dWidth", projectedSection.columns, LIMITS.fieldsPerSchedule],
      ] as const) {
        const saved = sectionFields[field];
        if (!Array.isArray(saved)) projectedSection.layoutComplete = false;
        ownedArray(section, field, className, max, sectionWitness.pointerPath, (target, witness) => {
          const value = object(objects[target].fields)[valueField];
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1000) { projectedSection.layoutComplete = false; problem(`Section ${sectionCode} ${valueField} is not a supported finite positive paper-space length.`); return; }
          dimensions.push({ valueFeet: value, source: witness });
        });
        if (!Array.isArray(saved) || dimensions.length !== saved.length) { projectedSection.layoutComplete = false; problem(`Section ${sectionCode} ${field} lacks a complete owned dimension sequence.`); }
      }
      schedule.sections.push(projectedSection);
      const coordinates = new Set<string>();
      const cell = (target: number, witness: ScheduleWitness) => {
        const f = object(objects[target].fields), coordinate = `${f.m_row}:${f.m_column}`;
        if (!natural(f.m_row) || !natural(f.m_column) || !text(f.m_text) || !integer(f.m_cellType) || ![f.m_coverTop, f.m_coverBottom, f.m_coverLeft, f.m_coverRight].every(v => integer(v) && Math.abs(v) <= LIMITS.cellsPerSchedule) || coordinates.has(coordinate) || schedule.cells.length >= LIMITS.cellsPerSchedule) { problem(`Cell ${target} has invalid/duplicate coordinates, text/span or exceeds budget.`); return; }
        coordinates.add(coordinate); schedule.cells.push({ sectionCode, row: f.m_row, column: f.m_column, text: f.m_text, cellTypeCode: f.m_cellType, parameterId: id(f.m_paramId), categoryId: id(f.m_categoryId), storedCoverOffsets: { top: f.m_coverTop as number, bottom: f.m_coverBottom as number, left: f.m_coverLeft as number, right: f.m_coverRight as number }, source: witness });
      };
      ownedArray(section, "m_tableCells", "TableRowCellData", LIMITS.cellsPerSchedule, sectionWitness.pointerPath, (row, rowWitness) => ownedArray(row, "m_arrCells", "TableCellData", LIMITS.fieldsPerSchedule, rowWitness.pointerPath, cell));
    });
    if (problems.length) diagnostic(`Schedule ${elementId}: ${problems.length} unresolved owned fields/cells.`);
    inventory.schedules.push(schedule);
  });
  if (report.source.records.length > LIMITS.records) diagnostic("Retained schedule records exceed adapter cap.");
  return inventory;
}
export function makeNativeScheduleInventoryCsv(inventory: NativeScheduleInventory, options: { excelBom?: boolean } = {}): string {
  const rows: unknown[][] = [["record_kind", "source_sha256", "schema_sha256", "inventory_status", "schedule_element_id", "schedule_name", "category_id", "position_or_section", "field_id_or_row", "parameter_id_or_column", "heading_or_cell_text", "hidden", "serialized_details", "source_stream", "group_record_offset", "source_object", "source_pointer_path", "body_sha256", "value_semantics"]];
  const push = (schedule: StoredNativeSchedule, kind: string, values: unknown[], witness?: ScheduleWitness) => rows.push([kind, inventory.sourceSha256, inventory.schemaSha256, inventory.status, schedule.elementId, schedule.name, schedule.categoryId, ...values, schedule.source.stream, schedule.source.groupRecordOffset, witness?.objectIndex ?? schedule.schemaObjectIndex, witness ? JSON.stringify(witness.pointerPath) : "", schedule.source.bodySha256, "serialized-not-evaluated"]);
  for (const s of inventory.schedules) {
    push(s, "schedule", [null, null, null, s.title, null, JSON.stringify(s.settings)]);
    for (const f of s.fields) push(s, "field", [f.position, f.fieldId, f.parameterId, f.heading, f.hidden, JSON.stringify({ sourceTypeCode: f.sourceTypeCode, displayTypeCode: f.displayTypeCode, columnWidthFeet: f.columnWidthFeet, format: f.format, expression: f.expression })], f.source);
    for (const f of s.sorting) push(s, "sort", [null, f.fieldId, null, null, null, JSON.stringify({ sortOrderCode: f.sortOrderCode, groupingFlags: f.groupingFlags })], f.source);
    for (const f of s.filters) push(s, "filter", [null, f.fieldId, null, null, null, JSON.stringify({ filterTypeCode: f.filterTypeCode, storageTypeCode: f.storageTypeCode, storedSlots: f.storedSlots })], f.source);
    for (const section of s.sections) push(s, "stored-section", [section.sectionCode, null, null, null, section.storedHidden, JSON.stringify({ layoutComplete: section.layoutComplete, rowHeightsFeet: section.rows.map(d => d.valueFeet), columnWidthsFeet: section.columns.map(d => d.valueFeet) })], section.source);
    for (const c of s.cells) push(s, "stored-cell", [c.sectionCode, c.row, c.column, c.text, null, JSON.stringify({ cellTypeCode: c.cellTypeCode, parameterId: c.parameterId, categoryId: c.categoryId, storedCoverOffsets: c.storedCoverOffsets })], c.source);
  }
  if (rows.length === 1) rows.push(["inventory", inventory.sourceSha256, inventory.schemaSha256, inventory.status, null, null, null, null, null, null, inventory.scope]);
  return (options.excelBom ? "\ufeff" : "") + rows.map(row => { while (row.length < rows[0].length) row.push(null); return row.map(v => scheduleCsvCell(typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null)).join(","); }).join("\r\n") + "\r\n";
}
