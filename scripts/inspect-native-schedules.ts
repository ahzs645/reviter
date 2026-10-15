#!/usr/bin/env node
/** Native authored schedule inventory, with an exact-byte evidence reuse gate. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readNativeSourceEvidence, type NativeEvidenceReport } from "../lib/reviter/native-evidence-reader.ts";
import { buildNativeScheduleInventory, makeNativeScheduleInventoryCsv } from "../lib/reviter/native-schedule-inventory.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
async function run() {
  declareUsage("inspect-native-schedules.ts model.rvt [--evidence source-evidence.json] [--out inventory.json] [--csv inventory.csv] [--evidence-out source-evidence.json]");
  const [input] = positionals("--evidence", "--out", "--csv", "--evidence-out"); if (!input) throw new Error("Supply a source RVT file.");
  const bytes = new Uint8Array(readFileSync(input)), evidencePath = optionValue("--evidence");
  const report: NativeEvidenceReport = evidencePath ? JSON.parse(readFileSync(evidencePath, "utf8")) : await readNativeSourceEvidence(bytes, { selectedClasses: ["DBViewSchedule"], maxRecords: 512 }, async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js");
    await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
    return wasm as unknown as RvtWasmModule;
  });
  if (report.sourceSha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Schedule evidence does not belong to the supplied RVT bytes.");
  const evidenceOutput = optionValue("--evidence-out"); if (evidenceOutput) writeFileSync(evidenceOutput, JSON.stringify(report, null, 2) + "\n");
  const inventory = buildNativeScheduleInventory(report), csv = optionValue("--csv"), output = optionValue("--out");
  if (csv) writeFileSync(csv, makeNativeScheduleInventoryCsv(inventory, { excelBom: true }));
  const json = JSON.stringify(inventory, null, 2) + "\n";
  if (output) { writeFileSync(output, json); console.log(JSON.stringify({ status: inventory.status, schedules: inventory.schedules.length, fields: inventory.schedules.reduce((n, s) => n + s.fields.length, 0), storedCells: inventory.schedules.reduce((n, s) => n + s.cells.length, 0), sourceSha256: inventory.sourceSha256 })); }
  else console.log(json);
}
if (isEntryPoint(import.meta.url)) await run();
