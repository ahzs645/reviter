#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
async function run() {
  declareUsage("inspect-native-evidence.ts model.rvt [--out evidence.json] [--ids 123,456] [--classes TextNote,Dimension]");
  const [input] = positionals("--out", "--ids", "--classes");
  if (!input) throw new Error("Supply a source RVT file.");
  const report = await readNativeSourceEvidence(new Uint8Array(readFileSync(input)), {
    selectedIds: optionValue("--ids")?.split(","),
    selectedClasses: optionValue("--classes")?.split(","),
  }, async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js");
    await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
    return wasm as unknown as RvtWasmModule;
  });
  const output = JSON.stringify(report, null, 2) + "\n";
  const path = optionValue("--out");
  if (path) { writeFileSync(path, output); console.log(JSON.stringify({ status: report.source.status, records: report.source.records.length, sourceSha256: report.sourceSha256, bytes: Buffer.byteLength(output) })); }
  else console.log(output);
}
if (isEntryPoint(import.meta.url)) await run();
