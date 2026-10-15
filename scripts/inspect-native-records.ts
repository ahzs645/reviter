#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { buildNativeRecordInventory, makeNativeRecordInventoryCsv, NATIVE_RECORD_INVENTORY_CLASSES } from "../lib/reviter/native-record-inventory.ts";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";

async function run() {
  declareUsage("inspect-native-records.ts model.rvt [--out inventory.json] [--csv records.csv] [--classes DBViewPlan,Grid] [--max-records 128]");
  const [input] = positionals("--out", "--csv", "--classes", "--max-records");
  if (!input) throw new Error("Supply a source RVT file.");
  const maxRecords = Number(optionValue("--max-records") ?? 128);
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 2048) throw new Error("--max-records must be between 1 and 2048.");
  const report = await readNativeSourceEvidence(new Uint8Array(readFileSync(input)), {
    selectedClasses: optionValue("--classes")?.split(",") ?? [...NATIVE_RECORD_INVENTORY_CLASSES], maxRecords,
  }, async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js");
    await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
    return wasm as unknown as RvtWasmModule;
  });
  const inventory = buildNativeRecordInventory(report);
  // The report contains the raw fallback graphs referred to by inventory rows.
  const output = JSON.stringify({ ...report, recordInventory: inventory }, null, 2) + "\n";
  const out = optionValue("--out"), csv = optionValue("--csv");
  if (out) writeFileSync(out, output);
  if (csv) writeFileSync(csv, makeNativeRecordInventoryCsv(inventory, { excelBom: true }));
  if (!out && !csv) console.log(output);
  else console.log(JSON.stringify({ status: inventory.status, records: inventory.records.length, fields: inventory.coverage.projectedFields, fallbackRecords: inventory.fallbacks.length, sourceSha256: inventory.sourceSha256, out: out ?? null, csv: csv ?? null }));
}
if (isEntryPoint(import.meta.url)) await run();
