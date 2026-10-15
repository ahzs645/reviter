#!/usr/bin/env node
/** Reopen serialized graphs and check every projected identity/field/cell. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { buildNativeScheduleInventory, makeNativeScheduleInventoryCsv } from "../lib/reviter/native-schedule-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
type Fields = Record<string, unknown>;
const object = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
const id = (v: unknown): string => { for (let n = 0; n < 5; n++) { if (typeof v === "number" || typeof v === "string") return String(v); const f = object(v); v = f.m_id64 ?? f.m_id; } return "unresolved"; };
export function auditNativeSchedules(report: NativeEvidenceReport, sourceBytes: Uint8Array, modelName: string) {
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (report.sourceSha256 !== sourceSha256) throw new Error("Schedule evidence does not belong to supplied source bytes.");
  const inventory = buildNativeScheduleInventory(report), classes: Record<string, number> = {};
  let mismatches = 0, checkedFields = 0, checkedCells = 0, checkedSortFields = 0, checkedFilters = 0, expressionFields = 0, nonEmptyCellText = 0;
  for (const raw of report.source.records) { const graph = object(object(raw).graph); for (const rawNode of Array.isArray(graph.objects) ? graph.objects : []) { const name = String(object(rawNode).class_name); classes[name] = (classes[name] ?? 0) + 1; } }
  const samples: unknown[] = [];
  for (const schedule of inventory.schedules) {
    const record = object(report.source.records[schedule.source.rawRecordIndex]), graph = object(record.graph), nodes = graph.objects as unknown[], schema = object(object(nodes[schedule.schemaObjectIndex]).fields);
    if (id(object(record.identity).element_id) !== schedule.elementId || id(schema.m_categoryId) !== schedule.categoryId) mismatches++;
    for (const field of schedule.fields) {
      const fields = object(object(nodes[field.source.objectIndex]).fields), ids = schema.m_fieldIds as unknown[];
      checkedFields++; if (id(ids[field.position]) !== field.fieldId || id(fields.m_paramElemId) !== field.parameterId || fields.m_columnHeading !== field.heading || fields.m_hidden !== field.hidden || fields.m_sourceType !== field.sourceTypeCode || fields.m_columnWidth !== field.columnWidthFeet) mismatches++;
      if (field.expression) expressionFields++;
    }
    for (const cell of schedule.cells) {
      const fields = object(object(nodes[cell.source.objectIndex]).fields); checkedCells++;
      if (fields.m_row !== cell.row || fields.m_column !== cell.column || fields.m_text !== cell.text || fields.m_cellType !== cell.cellTypeCode) mismatches++;
      if (cell.text.length) nonEmptyCellText++;
    }
    for (const sort of schedule.sorting) { const fields = object(object(nodes[sort.source.objectIndex]).fields); checkedSortFields++; if (id(fields.m_fieldId) !== sort.fieldId || fields.m_sortOrder !== sort.sortOrderCode || fields.m_groupingFlags !== sort.groupingFlags) mismatches++; }
    for (const filter of schedule.filters) { const fields = object(object(nodes[filter.source.objectIndex]).fields); checkedFilters++; if (id(fields.m_fieldId) !== filter.fieldId || fields.m_filterType !== filter.filterTypeCode || object(fields.m_value).m_storageType !== filter.storageTypeCode) mismatches++; }
    if (samples.length < 4) samples.push({ elementId: schedule.elementId, categoryId: schedule.categoryId, fieldIds: schedule.fields.map(f => f.fieldId), hiddenFields: schedule.fields.filter(f => f.hidden).length, sortingFields: schedule.sorting.map(f => f.fieldId), filterFields: schedule.filters.map(f => f.fieldId), storedCells: schedule.cells.length, source: schedule.source });
  }
  return { model: basename(modelName), sourceSha256, readerCommit: report.readerCommit, schemaSha256: inventory.schemaSha256, revitVersion: inventory.revitVersion, rawEvidenceStatus: report.source.status, inventoryStatus: inventory.status,
    schedules: inventory.schedules.length, checkedFields, checkedCells, checkedSortFields, checkedFilters, expressionFields, nonEmptyCellText, sourceProjectionMismatches: mismatches,
    sourceGraphClasses: Object.fromEntries(Object.entries(classes).filter(([k]) => /Schedule|TableCellData|Expression/.test(k))),
    diagnostics: inventory.diagnostics, samples, comparisonScope: "Exact source digest and independently reopened stored graph fields/IDs. Enum codes and formulas are unevaluated; cached cells are not independently regenerated Revit rows." };
}
async function run() {
  declareUsage("audit-native-schedules.ts source.rvt --evidence source-evidence.json [--out audit.json] [--csv inventory.csv]");
  const [input] = positionals("--evidence", "--out", "--csv"), evidencePath = optionValue("--evidence"); if (!input || !evidencePath) throw new Error("Supply an RVT and its native evidence report.");
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as NativeEvidenceReport;
  const audit = auditNativeSchedules(report, new Uint8Array(readFileSync(input)), input); if (audit.sourceProjectionMismatches) throw new Error("A projected schedule field/cell disagrees with source graph.");
  const csv = optionValue("--csv"); if (csv) writeFileSync(csv, makeNativeScheduleInventoryCsv(buildNativeScheduleInventory(report), { excelBom: true }));
  const encoded = JSON.stringify(audit, null, 2) + "\n", out = optionValue("--out"); if (out) { writeFileSync(out, encoded); console.log(JSON.stringify({ model: audit.model, schedules: audit.schedules, fields: audit.checkedFields, storedCells: audit.checkedCells, mismatches: audit.sourceProjectionMismatches })); } else console.log(encoded);
}
if (isEntryPoint(import.meta.url)) await run();
