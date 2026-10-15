#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import { makeNativeDrawingSvg } from "../lib/reviter/native-drawing-svg.ts";
import { buildNativeRecordInventory, NATIVE_DRAWING_ANNOTATION_CLASSES } from "../lib/reviter/native-record-inventory.ts";
import { buildNativeParameterInventory } from "../lib/reviter/native-parameter-inventory.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
async function run() {
  declareUsage("export-native-drawing.ts model.rvt --view-id 123 --out annotation-preview.svg [--report preview.json] [--evidence-out evidence.json] [--classes TextNote,IndependentTag]");
  const [input] = positionals("--view-id", "--out", "--report", "--evidence-out", "--classes");
  const viewId = optionValue("--view-id"), output = optionValue("--out");
  if (!input || !viewId || !output || !/^[1-9]\d{0,19}$/.test(viewId)) throw new Error("Supply a source RVT, positive exact --view-id and --out SVG.");
  const bytes = new Uint8Array(readFileSync(input));
  const loader = async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js");
    await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) });
    return wasm as unknown as RvtWasmModule;
  };
  const viewReport = await readNativeSourceEvidence(bytes, { selectedIds: [viewId], selectedClasses: [], maxRecords: 1 }, loader);
  const report = await readNativeSourceEvidence(bytes, {
    selectedClasses: optionValue("--classes")?.split(",") ?? [...NATIVE_DRAWING_ANNOTATION_CLASSES],
    maxRecords: 2048, maxDecodedRecords: 4096, maxOutputBytes: 64 * 1024 * 1024,
  }, loader);
  const context = (report: typeof viewReport) => JSON.stringify([report.sourceSha256, report.readerCommit, report.readerPatch, (report.source.summary as {revit_version?:number})?.revit_version, (report.source.summary as {schema_sha256?:string})?.schema_sha256]);
  if (context(viewReport) !== context(report)) throw new Error(`View and annotation byte/schema contexts disagree: ${context(viewReport)} / ${context(report)}; annotation diagnostics ${JSON.stringify(report.source.diagnostics)}`);
  // Select the view separately so a large annotation selection cannot evict it.
  report.source.records = [...viewReport.source.records, ...report.source.records];
  const statuses = [report.source.status, viewReport.source.status];
  report.source.status = statuses.includes("budget-blocked") ? "budget-blocked" : statuses.includes("unsupported") ? "unsupported" : statuses.every(s => s === "complete") ? "complete" : "partial";
  report.source.diagnostics = { annotationSelection: report.source.diagnostics, viewSelection: viewReport.source.diagnostics };
  report.recordInventory = buildNativeRecordInventory(report);
  report.parameterInventory = buildNativeParameterInventory(report);
  if (optionValue("--evidence-out")) writeFileSync(optionValue("--evidence-out")!, JSON.stringify(report));
  const preview = makeNativeDrawingSvg(report, { viewId });
  if (optionValue("--report")) writeFileSync(optionValue("--report")!, JSON.stringify({ ...preview, svg: undefined }, null, 2) + "\n");
  if (!preview.svg) throw new Error(`No supported source annotation preview: ${preview.diagnostics.at(-1)}`);
  writeFileSync(output, preview.svg);
  console.log(JSON.stringify({ status: preview.status, sourceSha256: preview.sourceSha256, viewId, primitives: preview.primitives.length, owners: preview.renderedElementIds.length, omitted: preview.omitted.length, bytes: Buffer.byteLength(preview.svg), sourceStatus: report.source.status }));
}
if (isEntryPoint(import.meta.url)) await run();
