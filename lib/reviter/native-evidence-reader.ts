/** On-demand source graphs and definitions, separate from the render pipeline. */
import { listNativeDrawingViews, makeNativeDrawingSvg, type NativeDrawingPreview } from "./native-drawing-svg.ts";
import type { StandardsReaderLoader } from "./standards-reader.ts";
import { buildNativeRecordInventory, NATIVE_DRAWING_ANNOTATION_CLASSES, NATIVE_DRAWING_CURVE_CLASSES, type NativeRecordInventory } from "./native-record-inventory.ts";
import { buildNativeParameterInventory, type NativeParameterInventory } from "./native-parameter-inventory.ts";
import { buildNativeScheduleInventory, type NativeScheduleInventory } from "./native-schedule-inventory.ts";
import { buildNativeSpatialOrganization, type NativeSpatialOrganization } from "./native-spatial-organization.ts";
import { readNativeSpatialCategoryEvidence } from "./native-spatial-categories.ts";
export type NativeEvidenceOptions = {
  selectedIds?: Array<number | string>;
  selectedClasses?: string[];
  maxFileBytes?: number; maxStreamBytes?: number; maxMemberBytes?: number;
  maxInflatedBytes?: number; maxGzipMembers?: number; maxGroupBytes?: number;
  maxGraphValues?: number; maxGraphObjects?: number; maxDecodedRecords?: number;
  maxRecords?: number; maxRecordBytes?: number; maxSummaryBytes?: number; maxOutputBytes?: number;
};
export type NativeSourceEvidence = {
  apiVersion: 1;
  kind: "native-source-evidence";
  status: "complete" | "partial" | "budget-blocked" | "unsupported";
  records: unknown[];
  summary: unknown;
  diagnostics: unknown;
};
export type NativeEvidenceReport = {
  sourceSha256: string | null;
  readerCommit: string;
  readerPatch: "native-evidence";
  source: NativeSourceEvidence;
  scope: string;
  recordInventory?: NativeRecordInventory;
  parameterInventory?: NativeParameterInventory;
  scheduleInventory?: NativeScheduleInventory;
  spatialOrganization?: NativeSpatialOrganization;
  drawingPreview?: NativeDrawingPreview;
};
async function readNativeSourceEvidenceRaw(bytes: Uint8Array, options: NativeEvidenceOptions = {}, loader?: StandardsReaderLoader): Promise<NativeEvidenceReport> {
  const wasm = loader ? await loader() : await import("../rvt-wasm/rvt.js");
  await wasm.default();
  const inspect = (wasm as unknown as { openNativeEvidence?: (bytes: Uint8Array, options: NativeEvidenceOptions) => NativeSourceEvidence }).openNativeEvidence;
  if (!inspect) throw new Error("This reader build does not include native source evidence.");
  const source = inspect(bytes, Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)));
  if (source.apiVersion !== 1 || source.kind !== "native-source-evidence" || !["complete", "partial", "budget-blocked", "unsupported"].includes(source.status) || !Array.isArray(source.records)) throw new Error("Unexpected native source evidence response.");
  const digest = globalThis.crypto?.subtle ? await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer) : null;
  const report: NativeEvidenceReport = {
    sourceSha256: digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") : null,
    readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", source,
    scope: "Selected stored source graphs, metadata, parameter definitions, units, bindings and extensible-storage catalog. Partial graphs retain their limits; this does not evaluate formulas, reconstruct annotations or certify geometry.",
  };
  return report;
}
function enrichNativeEvidence(bytes: Uint8Array, report: NativeEvidenceReport): NativeEvidenceReport {
  const categories = readNativeSpatialCategoryEvidence(bytes, report);
  return { ...report, recordInventory: buildNativeRecordInventory(report), parameterInventory: buildNativeParameterInventory(report),
    scheduleInventory: buildNativeScheduleInventory(report), spatialOrganization: buildNativeSpatialOrganization(report, categories) };
}
export async function readNativeSourceEvidence(bytes: Uint8Array, options: NativeEvidenceOptions = {}, loader?: StandardsReaderLoader): Promise<NativeEvidenceReport> {
  return enrichNativeEvidence(bytes, await readNativeSourceEvidenceRaw(bytes, options, loader));
}

/** Separate bounded view/annotation selections prevent a busy document from
 * evicting its selected view frame. Unsupported/budget-blocked passes are never
 * merged into a valid source context. All adapters rebuild after the merge. */
export type NativeDrawingReadOptions = { includeDetailCurves?: boolean };
export async function readNativeDrawingEvidence(bytes: Uint8Array, viewId: string, loader?: StandardsReaderLoader, options: NativeDrawingReadOptions = {}): Promise<NativeEvidenceReport> {
  if (!/^[1-9]\d{0,19}$/.test(viewId) || BigInt(viewId) > (1n << 64n) - 1n) throw new Error("A positive exact native view ID is required.");
  if (bytes.byteLength > 256 * 1024 * 1024) throw new Error("Source drawing file budget exceeded.");
  const immutable = bytes.slice();
  const finish = (raw: NativeEvidenceReport): NativeEvidenceReport => {
    const report = enrichNativeEvidence(immutable, raw);
    return { ...report, drawingPreview: makeNativeDrawingSvg(report, { viewId }) };
  };
  const view = await readNativeSourceEvidenceRaw(immutable, { selectedIds: [viewId], selectedClasses: [], maxRecords: 1 }, loader);
  const context = (report: NativeEvidenceReport): string | null => {
    const summary = report.source.summary as { revit_version?: number; schema_sha256?: string } | null;
    if (["unsupported", "budget-blocked"].includes(report.source.status) || !report.sourceSha256 || !/^[a-f0-9]{64}$/.test(report.sourceSha256) || report.readerCommit !== "1c3d337dbd2a6810e9dfad68fe99857843d67387" || report.readerPatch !== "native-evidence" || ![2024,2025,2026].includes(summary?.revit_version ?? 0) || !/^[a-f0-9]{64}$/.test(summary?.schema_sha256 ?? "")) return null;
    return JSON.stringify([report.sourceSha256,report.readerCommit,report.readerPatch,summary!.revit_version,summary!.schema_sha256]);
  };
  if (!context(view) || !listNativeDrawingViews(view).some(record => record.elementId === viewId)) return finish(view);
  const annotations = await readNativeSourceEvidenceRaw(immutable, {
    selectedClasses: [...NATIVE_DRAWING_ANNOTATION_CLASSES], maxRecords: 2048, maxDecodedRecords: 4096, maxOutputBytes: 64 * 1024 * 1024,
  }, loader);
  if (!context(annotations)) return finish(annotations);
  if (context(view) !== context(annotations)) throw new Error("Native view and annotation source SHA, reader, schema or release contexts disagree.");
  // Detailed curves use a separate bounded pass. A crowded curve selection
  // cannot evict an already verified view or discard its supported text/tags.
  const curves = options.includeDetailCurves ? await readNativeSourceEvidenceRaw(immutable, {
    selectedClasses: [...NATIVE_DRAWING_CURVE_CLASSES], maxRecords: 2048, maxDecodedRecords: 4096, maxOutputBytes: 64 * 1024 * 1024,
  }, loader) : null;
  const curveContext = curves ? context(curves) : null;
  if (curveContext && context(view) !== curveContext) throw new Error("Native view and detail-curve source SHA, reader, schema or release contexts disagree.");
  const acceptedCurves = curveContext ? curves : null;
  const report: NativeEvidenceReport = {
    ...annotations,
    scope: `${annotations.scope} The selected view and annotation records use separate bounded selections from identical bytes/schema. The partial SVG does not regenerate a Revit drawing or certify navigation.`,
    source: {
      ...annotations.source,
      status: view.source.status === "complete" && annotations.source.status === "complete" && (!curves || acceptedCurves?.source.status === "complete") ? "complete" : "partial",
      records: [...view.source.records, ...annotations.source.records, ...acceptedCurves?.source.records ?? []],
      diagnostics: { viewSelection: view.source.diagnostics, annotationSelection: annotations.source.diagnostics, sameByteSchemaContext: true,
        ...(curves ? { detailCurveSelection: { status: curves.source.status, accepted: acceptedCurves !== null, diagnostics: curves.source.diagnostics } } : {}) },
    },
  };
  return finish(report);
}
