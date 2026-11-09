#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { readNativeSourceEvidence } from "../lib/reviter/native-evidence-reader.ts";
import { readNativeSpatialCategoryEvidence } from "../lib/reviter/native-spatial-categories.ts";
import { NATIVE_SPATIAL_ORGANIZATION_CLASSES, buildNativeSpatialOrganization, makeNativeSpatialOrganizationCsv } from "../lib/reviter/native-spatial-organization.ts";
import type { RvtWasmModule } from "../lib/reviter/standards-reader.ts";
import { declareUsage, isEntryPoint, optionValue, positionals } from "./lib/rvt-harness.ts";
async function run() {
  declareUsage("inspect-native-spatial-organization.ts model.rvt [--out inventory.json] [--csv inventory.csv] [--summary summary.json]");
  const [input] = positionals("--out", "--csv", "--summary"); if (!input) throw new Error("Supply a source RVT file.");
  const bytes = new Uint8Array(readFileSync(input));
  const report = await readNativeSourceEvidence(bytes, { selectedClasses: [...NATIVE_SPATIAL_ORGANIZATION_CLASSES], maxRecords: 2048, maxOutputBytes: 32 * 1024 * 1024 }, async () => {
    const wasm = await import("../lib/rvt-wasm/rvt.js"); await wasm.default({ module_or_path: readFileSync(new URL("../lib/rvt-wasm/rvt_bg.wasm", import.meta.url)) }); return wasm as unknown as RvtWasmModule;
  });
  const categories = readNativeSpatialCategoryEvidence(bytes, report), inventory = buildNativeSpatialOrganization(report, categories);
  const out = optionValue("--out"), csv = optionValue("--csv"), summary = optionValue("--summary");
  if (out) writeFileSync(out, JSON.stringify(inventory, null, 2) + "\n");
  if (csv) writeFileSync(csv, makeNativeSpatialOrganizationCsv(inventory));
  const stats = { sourceSha256: inventory.sourceSha256, schemaSha256: inventory.schemaSha256, status: inventory.status, nativeReaderStatus: report.source.status, nativeReaderClasses: (report.source.summary as Record<string, unknown>).classes, spatialKinds: inventory.spatialElements.reduce<Record<string, number>>((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a; }, {}), sourceCategoryProof: { status: categories.status, retainedHeaderWitnesses: categories.records.length, inflatedBytes: categories.inflatedBytes, diagnostics: categories.diagnostics }, areaSchemes: inventory.areaSchemes.length, revisions: inventory.revisions.length, revisionCatalogs: inventory.revisionCatalog.length, worksetVisibilityRecords: inventory.worksetVisibility.length, sites: inventory.sites.length, coordinates: inventory.coordinates, limitations: inventory.limitations };
  if (summary) writeFileSync(summary, JSON.stringify(stats, null, 2) + "\n");
  console.log(JSON.stringify(stats, null, 2));
}
if (isEntryPoint(import.meta.url)) await run();
