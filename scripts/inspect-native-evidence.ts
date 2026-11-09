#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import { NATIVE_RECORD_INVENTORY_CLASSES, makeNativeRecordInventoryCsv } from "../lib/reviter/native-record-inventory.ts";
import { NATIVE_PARAMETER_DEFINITION_CLASSES, makeNativeParameterInventoryCsv } from "../lib/reviter/native-parameter-inventory.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
async function run() {
  declareUsage("inspect-native-evidence.ts model.rvt [--out evidence.json] [--records-csv records.csv] [--definitions-csv definitions.csv] [--ids 123,456] [--classes TextNote,Dimension]");
  const [input] = positionals("--out", "--records-csv", "--definitions-csv", "--ids", "--classes");
  if (!input) throw new Error("Supply a source RVT file.");
  const selectedIds = optionValue("--ids")?.split(",");
  const report = await readNativeSourceEvidence(new Uint8Array(readFileSync(input)), {
    selectedIds,
    selectedClasses: optionValue("--classes")?.split(",") ?? (selectedIds ? [] : [...new Set([...NATIVE_RECORD_INVENTORY_CLASSES, ...NATIVE_PARAMETER_DEFINITION_CLASSES])]),
  }, async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js");
    await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
    return wasm as unknown as RvtWasmModule;
  });
  const recordsCsv = optionValue("--records-csv"), definitionsCsv = optionValue("--definitions-csv");
  if (recordsCsv) writeFileSync(recordsCsv, makeNativeRecordInventoryCsv(report.recordInventory!));
  if (definitionsCsv) writeFileSync(definitionsCsv, makeNativeParameterInventoryCsv(report.parameterInventory!));
  const output = JSON.stringify(report, null, 2) + "\n";
  const path = optionValue("--out");
  if (path) { writeFileSync(path, output); console.log(JSON.stringify({ status: report.source.status, records: report.source.records.length, sourceSha256: report.sourceSha256, bytes: Buffer.byteLength(output) })); }
  else console.log(output);
}
if (isEntryPoint(import.meta.url)) await run();
