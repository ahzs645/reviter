/** On-demand source graphs and definitions, separate from the render pipeline. */
import type { StandardsReaderLoader } from "./standards-reader.ts";
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
};
export async function readNativeSourceEvidence(bytes: Uint8Array, options: NativeEvidenceOptions = {}, loader?: StandardsReaderLoader): Promise<NativeEvidenceReport> {
  const wasm = loader ? await loader() : await import("../rvt-wasm/rvt.js");
  await wasm.default();
  const inspect = (wasm as unknown as { openNativeEvidence?: (bytes: Uint8Array, options: NativeEvidenceOptions) => NativeSourceEvidence }).openNativeEvidence;
  if (!inspect) throw new Error("This reader build does not include native source evidence.");
  const source = inspect(bytes, Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)));
  if (source.apiVersion !== 1 || source.kind !== "native-source-evidence" || !["complete", "partial", "budget-blocked", "unsupported"].includes(source.status) || !Array.isArray(source.records)) throw new Error("Unexpected native source evidence response.");
  const digest = globalThis.crypto?.subtle ? await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer) : null;
  return {
    sourceSha256: digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") : null,
    readerCommit: "1c3d337dbd2a6810e9dfad68fe99857843d67387", readerPatch: "native-evidence", source,
    scope: "Selected stored source graphs, metadata, parameter definitions, units, bindings and extensible-storage catalog. Partial graphs retain their limits; this does not evaluate formulas, reconstruct annotations or certify geometry.",
  };
}
