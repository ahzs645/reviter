#!/usr/bin/env node
/** Reopen serialized graphs and check every projected identity/field/cell. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { buildNativeScheduleInventory, makeNativeScheduleInventoryCsv } from "../lib/reviter/native-schedule-inventory.ts";
import { buildNativeCachedScheduleLayout, makeNativeScheduleHtml } from "../lib/reviter/native-schedule-html.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, hasFlag, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
type Fields = Record<string, unknown>;
const object = (v: unknown): Fields => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Fields : {};
const id = (v: unknown): string => { for (let n = 0; n < 5; n++) { if (typeof v === "number" || typeof v === "string") return String(v); const f = object(v); v = f.m_id64 ?? f.m_id; } return "unresolved"; };
export function auditNativeSchedules(report: NativeEvidenceReport, sourceBytes: Uint8Array, modelName: string) {
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (report.sourceSha256 !== sourceSha256) throw new Error("Schedule evidence does not belong to supplied source bytes.");
  const inventory = buildNativeScheduleInventory(report), classes: Record<string, number> = {};
  let mismatches = 0, checkedFields = 0, checkedCells = 0, checkedSortFields = 0, checkedFilters = 0, expressionFields = 0, nonEmptyCellText = 0;
  for (const raw of report.source.records) { const graph = object(object(raw).graph); for (const rawNode of Array.isArray(graph.objects) ? graph.objects : []) { const name = String(object(rawNode).class_name); classes[name] = (classes[name] ?? 0) + 1; } }
  let checkedRowDimensions = 0, checkedColumnDimensions = 0, sourceTopologyMismatches = 0, checkedReciprocalRectangles = 0, checkedCoveredCells = 0, hiddenSections = 0;
  let previewSections = 0, previewCells = 0, previewMerges = 0;
  const samples: unknown[] = [];
  for (const schedule of inventory.schedules) {
    const record = object(report.source.records[schedule.source.rawRecordIndex]), graph = object(record.graph), nodes = graph.objects as unknown[], schema = object(object(nodes[schedule.schemaObjectIndex]).fields);
    if (id(object(record.identity).element_id) !== schedule.elementId || id(schema.m_categoryId) !== schedule.categoryId) mismatches++;
    const layout = buildNativeCachedScheduleLayout(inventory, schedule.elementId), preview = makeNativeScheduleHtml(inventory, { scheduleId: schedule.elementId, includeHiddenSections: true });
    previewSections += preview.renderedSections; previewCells += preview.renderedCells; previewMerges += preview.renderedMerges;
    for (const section of schedule.sections) {
      const fields = object(object(nodes[section.source.objectIndex]).fields);
      if (fields.m_hideSection !== section.storedHidden || fields.m_index !== section.sectionCode) sourceTopologyMismatches++;
      if (section.storedHidden) hiddenSections++;
      for (const [pointerField, valueField, dimensions] of [["m_rows", "m_dHeight", section.rows], ["m_cols", "m_dWidth", section.columns]] as const) {
        const pointers = Array.isArray(fields[pointerField]) ? fields[pointerField] as unknown[] : [], edges = Array.isArray(graph.edges) ? graph.edges as unknown[] : [];
        if (pointers.length !== dimensions.length) sourceTopologyMismatches++;
        dimensions.forEach((dimension, i) => {
          if (pointerField === "m_rows") checkedRowDimensions++; else checkedColumnDimensions++;
          const p = object(pointers[i]), matched = edges.map(object).filter(e => e.source_object_index === section.source.objectIndex && e.pointer_offset === p.offset);
          const native = object(nodes[dimension.source.objectIndex]);
          if (matched.length !== 1 || matched[0].target_object_index !== dimension.source.objectIndex || native.token !== p.pointer_token || native.class_tag !== p.class_tag || object(native.fields)[valueField] !== dimension.valueFeet) sourceTopologyMismatches++;
        });
      }
      const groups = new Map<string, { bounds: number[]; objects: number[]; coordinates: Set<string> }>();
      for (const cell of schedule.cells.filter(c => c.sectionCode === section.sectionCode)) {
        const f = object(object(nodes[cell.source.objectIndex]).fields), row = f.m_row as number, col = f.m_column as number;
        const bounds = [row + (f.m_coverTop as number), row + (f.m_coverBottom as number), col + (f.m_coverLeft as number), col + (f.m_coverRight as number)], key = bounds.join(":");
        const group = groups.get(key) ?? { bounds, objects: [], coordinates: new Set<string>() }; group.objects.push(cell.source.objectIndex); group.coordinates.add(`${row}:${col}`); groups.set(key, group);
      }
      const merges = layout.sections.find(s => s.sectionCode === section.sectionCode)?.merges ?? [];
      let expectedMerges = 0;
      for (const group of groups.values()) {
        const [top, bottom, left, right] = group.bounds, area = (bottom - top + 1) * (right - left + 1); if (area <= 1) continue;
        expectedMerges++; checkedReciprocalRectangles++; checkedCoveredCells += group.objects.length;
        if (group.objects.length !== area || top < 0 || bottom >= section.rows.length || left < 0 || right >= section.columns.length) sourceTopologyMismatches++;
        for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) if (!group.coordinates.has(`${row}:${col}`)) sourceTopologyMismatches++;
        const merge = merges.find(m => m.top === top && m.bottom === bottom && m.left === left && m.right === right);
        if (!merge || JSON.stringify([...group.objects].sort((a, b) => a - b)) !== JSON.stringify(merge.memberObjectIndices)) sourceTopologyMismatches++;
      }
      if (merges.length !== expectedMerges) sourceTopologyMismatches++;
    }
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
    cachedLayout: { checkedRowDimensions, checkedColumnDimensions, checkedReciprocalRectangles, checkedCoveredCells, hiddenSections, previewSections, previewCells, previewMerges, sourceTopologyMismatches },
    sourceGraphClasses: Object.fromEntries(Object.entries(classes).filter(([k]) => /Schedule|TableCellData|Expression/.test(k))),
    diagnostics: inventory.diagnostics, samples, comparisonScope: "Exact source digest and independently reopened stored graph fields/IDs. Enum codes and formulas are unevaluated; cached cells are not independently regenerated Revit rows." };
}
/** Synthetic corruptions of a qualified actual-model baseline. */
export function auditNativeScheduleNegativeLayouts(report: NativeEvidenceReport) {
  const inventory = buildNativeScheduleInventory(report), schedule = inventory.schedules.find(s => s.cells.some(c => c.storedCoverOffsets.top !== 0 || c.storedCoverOffsets.left !== 0));
  if (!schedule) return [];
  const covered = schedule.cells.find(c => c.storedCoverOffsets.top !== 0 || c.storedCoverOffsets.left !== 0)!, sectionCode = covered.sectionCode;
  return ["missing-owned-cached-cell", "covered-nonanchor-text", "broken-native-dimension-token"].map(syntheticMutation => {
    let candidate = structuredClone(inventory);
    if (syntheticMutation === "broken-native-dimension-token") {
      const raw = structuredClone(report), section = schedule.sections.find(s => s.sectionCode === sectionCode)!;
      const record = raw.source.records[schedule.source.rawRecordIndex] as { graph: { objects: Array<{ fields: Record<string, unknown> }> } };
      const pointer = (record.graph.objects[section.source.objectIndex].fields.m_cols as Array<{ pointer_token: number }>)[0]; pointer.pointer_token--;
      candidate = buildNativeScheduleInventory(raw);
    } else {
      const selected = candidate.schedules.find(s => s.elementId === schedule.elementId)!;
      if (syntheticMutation === "missing-owned-cached-cell") selected.cells = selected.cells.filter(c => c.source.objectIndex !== covered.source.objectIndex);
      else selected.cells.find(c => c.source.objectIndex === covered.source.objectIndex)!.text = "Synthetic retained text must never disappear";
    }
    const preview = makeNativeScheduleHtml(candidate, { scheduleId: schedule.elementId, includeHiddenSections: true }), omission = preview.omittedSections.find(s => s.sectionCode === sectionCode);
    if (!omission || !["partial", "unsupported"].includes(preview.status) || preview.html?.includes(`data-section-code="${sectionCode}"`)) throw new Error(`Synthetic layout corruption was not explicitly omitted: ${syntheticMutation}.`);
    return { scheduleId: schedule.elementId, sectionCode, syntheticMutation, status: preview.status, omittedSectionReason: omission.reason, passed: true };
  });
}
async function run() {
  declareUsage("audit-native-schedules.ts source.rvt --evidence source-evidence.json [--out audit.json] [--csv inventory.csv] [--negative-layouts]");
  const [input] = positionals("--evidence", "--out", "--csv"), evidencePath = optionValue("--evidence"); if (!input || !evidencePath) throw new Error("Supply an RVT and its native evidence report.");
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as NativeEvidenceReport;
  const audit = auditNativeSchedules(report, new Uint8Array(readFileSync(input)), input); if (audit.sourceProjectionMismatches) throw new Error("A projected schedule field/cell disagrees with source graph.");
  if (audit.cachedLayout.sourceTopologyMismatches) throw new Error("A cached schedule layout disagrees with native dimensions/reciprocal source rectangles.");
  const csv = optionValue("--csv"); if (csv) writeFileSync(csv, makeNativeScheduleInventoryCsv(buildNativeScheduleInventory(report), { excelBom: true }));
  const encoded = JSON.stringify({ ...audit, ...(hasFlag("--negative-layouts") ? { negativeLayoutCases: auditNativeScheduleNegativeLayouts(report), negativeScope: "Synthetic corruptions of the actual-model positive baseline; hashes identify original source bytes, not modified RVT files." } : {}) }, null, 2) + "\n", out = optionValue("--out"); if (out) { writeFileSync(out, encoded); console.log(JSON.stringify({ model: audit.model, schedules: audit.schedules, fields: audit.checkedFields, storedCells: audit.checkedCells, mismatches: audit.sourceProjectionMismatches })); } else console.log(encoded);
}
if (isEntryPoint(import.meta.url)) await run();
