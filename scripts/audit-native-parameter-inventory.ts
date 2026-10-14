#!/usr/bin/env node
/** Compare normalized slots to the native reader projection using the same source bytes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { buildNativeParameterInventory, makeNativeParameterInventoryCsv } from "../lib/reviter/native-parameter-inventory.ts";
import type { NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";

export function auditNativeParameterInventory(report: NativeEvidenceReport, sourceBytes: Uint8Array, modelName: string) {
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (report.sourceSha256 !== sourceSha256) throw new Error("Parameter evidence does not belong to the supplied model bytes.");
  const inventory = buildNativeParameterInventory(report);
  const observed = new Map<string, Array<{ storage: string; raw: unknown }>>();
  for (const unknown of report.source.records) {
    const r = unknown as { identity?: { element_id?: number | string }; saved_metadata?: { resolved_family_parameters?: Array<{ parameter_id: number | string; storage_type: string; raw_value: unknown }> } };
    for (const p of r.saved_metadata?.resolved_family_parameters ?? []) {
      const key = `${r.identity?.element_id}:${p.parameter_id}`, values = observed.get(key) ?? [];
      values.push({ storage: p.storage_type, raw: p.raw_value }); observed.set(key, values);
    }
  }
  let agreed = 0, mismatched = 0, typedOwnerValues = 0;
  const samples: unknown[] = [];
  for (const v of inventory.values) {
    if (v.valueSource === "owner-typed-parameter-set") { typedOwnerValues++; continue; }
    const projected = observed.get(`${v.ownerElementId}:${v.parameterId}`) ?? [];
    const equal = projected.length === 1 && projected[0].storage === v.storageType && (v.storageType === "Integer" || v.storageType === "ElementId" ? String(projected[0].raw) === v.rawValue : projected[0].raw === v.rawValue);
    if (equal) agreed++; else mismatched++;
    if (samples.length < 12) samples.push({ ownerElementId: v.ownerElementId, parameterId: v.parameterId, storageType: v.storageType, rawValue: v.rawValue, agreesWithNativeReader: equal, source: v.source, expressionPointer: v.expressionPointer });
  }
  const unresolvedReasons: Record<string, number> = {};
  for (const s of inventory.unresolvedSlots) unresolvedReasons[s.reason] = (unresolvedReasons[s.reason] ?? 0) + 1;
  return {
    model: basename(modelName), sourceSha256, readerCommit: report.readerCommit, schemaSha256: inventory.schemaSha256,
    rawEvidenceStatus: report.source.status, inventoryStatus: inventory.status,
    retainedRecords: report.source.records.length,
    definitions: inventory.definitions.length,
    definitionsWithRetainedOwnerEdge: inventory.definitions.filter(d => d.source !== null).length,
    backlinkValidatedBindings: inventory.bindings.length,
    displayUnitResolvedDefinitions: inventory.definitions.filter(d => d.displayUnitResolution === "resolved-native-project-units").length,
    displayUnitConflictDefinitions: inventory.definitions.filter(d => d.displayUnitResolution === "conflicting-native-project-units").length,
    acceptedValues: inventory.values.length, acceptedFamilySlotsAgreeWithNativeReader: agreed,
    acceptedFamilySlotsDisagreeWithNativeReader: mismatched, typedOwnerValues, unresolvedReasons,
    selectedNativeResolvedSlots: [...observed.values()].reduce((sum, values) => sum + values.length, 0),
    diagnostics: inventory.diagnostics, samples,
    comparisonScope: "Same-byte native reader and independently validated owner pointer/concrete definition joins; this is serialized source evidence, not a Revit API or evaluated-formula oracle.",
  };
}
async function run() {
  declareUsage("audit-native-parameter-inventory.ts source.rvt --evidence source-evidence.json [--out audit.json] [--csv inventory.csv]");
  const [input] = positionals("--evidence", "--out", "--csv"), evidencePath = optionValue("--evidence");
  if (!input || !evidencePath) throw new Error("Supply an RVT and its native evidence report.");
  const report = JSON.parse(readFileSync(evidencePath, "utf8")) as NativeEvidenceReport;
  const audit = auditNativeParameterInventory(report, new Uint8Array(readFileSync(input)), input);
  if (audit.acceptedFamilySlotsDisagreeWithNativeReader) throw new Error("An accepted family slot disagrees with the reader projection.");
  const csv = optionValue("--csv"); if (csv) writeFileSync(csv, makeNativeParameterInventoryCsv(buildNativeParameterInventory(report), { excelBom: true }));
  const out = optionValue("--out"), encoded = JSON.stringify(audit, null, 2) + "\n";
  if (out) { writeFileSync(out, encoded); console.log(JSON.stringify({ model: audit.model, definitions: audit.definitions, values: audit.acceptedValues, matchedFamilySlots: audit.acceptedFamilySlotsAgreeWithNativeReader, mismatchedFamilySlots: audit.acceptedFamilySlotsDisagreeWithNativeReader })); }
  else console.log(encoded);
}
if (isEntryPoint(import.meta.url)) await run();
