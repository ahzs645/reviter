import { decodeRvtMaterialDefinitions } from "./native-decoder.ts";
import { partAtomMetadataFromSummary } from "./part-atom.ts";
import { STANDARDS_READER_RANGE_LABEL, standardsReaderSupports } from "./reader-support.ts";
import type { ConvertResult, MaterialData, ReaderDiagnostics } from "./types.ts";
import { decodeNativeMepModel, mergeNativeMepEvidence, MEP_MODEL_READER_COMMIT } from "./native-mep-model.ts";
import { decodeNativeIfcSemanticModel, IFC_SEMANTIC_READER_COMMIT } from "./native-ifc-semantic-model.ts";

export type RvtWasmModule = {
  default: (input?: unknown) => Promise<unknown>;
  quickSummary: (bytes: Uint8Array) => {
    version?: number;
    class_name_count?: number;
    partatom?: unknown;
  };
  openRvtBytesWithDiagnosticsModeAndLimits: (bytes: Uint8Array, mode: string, limits: Record<string, number>) => {
    diagnostics?: Record<string, unknown>;
    model?: {
      [key: string]: unknown;
      materials?: Array<{
        name?: string;
        color_packed?: number | null;
        transparency?: number | null;
      }>;
    };
  };
};

export type StandardsEvidence = { diagnostics: ReaderDiagnostics; materials: MaterialData[]; sourceModel?: unknown; readerVersion?: number };
export type StandardsReaderLoader = () => Promise<RvtWasmModule>;
const defaultLoader: StandardsReaderLoader = async () => import("../rvt-wasm/rvt.js") as unknown as RvtWasmModule;

export async function readStandardsEvidence(bytes: Uint8Array, loader: StandardsReaderLoader = defaultLoader): Promise<StandardsEvidence> {
  try {
    const wasm = await loader();
    await wasm.default();
    const summary = wasm.quickSummary(bytes);
    const partAtom = partAtomMetadataFromSummary(summary);
    const summaryVersion = summary.version ?? 0;
    if (!standardsReaderSupports(summaryVersion)) {
      return { diagnostics: {
          available: true,
          supportedVersion: false,
          productionElements: 0,
          diagnosticCandidates: 0,
          exportLevel: "unsupported-version",
          summary: `The Rust/WASM reader opened the container and inventoried ${summary.class_name_count?.toLocaleString() ?? "unknown"} schema classes, but Revit ${summaryVersion || "unknown"} is outside its verified ${STANDARDS_READER_RANGE_LABEL} range. Reviter's own decoders are unaffected and are selected separately by release.`,
          warnings: ["Standards-aware element and material decoding was skipped for this unverified Revit version."],
          partAtom,
        }, materials: [] };
    }
    // Reviter has already built the scene. Bound this optional diagnostics
    // walk independently and keep its quality mode explicit.
    const result = wasm.openRvtBytesWithDiagnosticsModeAndLimits(bytes, "scaffold", {
      max_scan_bytes: 16 * 1024 * 1024,
      max_candidates: 10_000,
      max_trial_offsets: 1_000_000,
      max_record_decode_bytes: 1024 * 1024,
      max_container_records: 256,
    });
    const diagnostics = (result.diagnostics ?? {}) as {
      input?: { revit_version?: number };
      decoded?: { production_walker_elements?: number; diagnostic_proxy_candidates?: number };
      confidence?: { level?: string };
      warnings?: string[];
    };
    const version = diagnostics.input?.revit_version ?? 0;
    const productionElements = diagnostics.decoded?.production_walker_elements ?? 0;
    const diagnosticCandidates = diagnostics.decoded?.diagnostic_proxy_candidates ?? 0;
    const supportedVersion = standardsReaderSupports(version);
    const materials = decodeRvtMaterialDefinitions(result.model?.materials ?? []);
    return { diagnostics: {
        available: true,
        supportedVersion,
        productionElements,
        diagnosticCandidates,
        exportLevel: diagnostics.confidence?.level ?? (productionElements ? "partial" : "scaffold"),
        summary: productionElements
          ? `${productionElements} standards-aware building elements and ${materials.length} material definitions were decoded.`
          : `${materials.length} native material definitions were decoded; element geometry remains scaffold-only.`,
        warnings: (diagnostics.warnings ?? []).slice(0, 4),
        partAtom,
      }, materials, sourceModel: result.model, readerVersion: version };
  } catch (error) {
    return { diagnostics: {
        available: false,
        supportedVersion: false,
        productionElements: 0,
        diagnosticCandidates: 0,
        exportLevel: "unavailable",
        summary: `The optional Rust reader stopped on this file (${error instanceof Error ? error.message : String(error)}). Reviter's own decoders are unaffected and produced everything shown; shapes are approximate where the file's geometry is not decoded.`,
        warnings: [],
      }, materials: [] };
  }
}

/** Fill missing type fields through exact declared identities. Existing type or
 * symbol disagreements remain visible as limitations and never rewrite a record. */
export function supplementNativeIfcTypes(result: ConvertResult): { typeIds: number; typeNames: number; conflicts: number } {
  const evidence = result.nativeIfcSemanticEvidence;
  const counts = { typeIds: 0, typeNames: 0, conflicts: 0 };
  if (!evidence || evidence.revitVersion !== result.decoderCoverage.revitVersion) return counts;
  const declared = new Set(result.elementIndex?.uniqueElementIds.length
    ? result.elementIndex.uniqueElementIds : result.nativeIdentity?.identities.map(identity => identity.elementId) ?? []);
  const source = new Map(evidence.elements.map(element => [element.elementId, element]));
  for (const record of result.elementBounds) {
    const info = source.get(record.elementId), typeId = info?.typeId;
    if (typeId == null || !Number.isSafeInteger(typeId) || typeId <= 0 || !declared.has(typeId) || !declared.has(record.elementId)) continue;
    const existingId = record.typeId ?? record.familySymbolId;
    if ((existingId != null && existingId !== typeId) || (record.typeName && info?.typeName && record.typeName !== info.typeName)) { counts.conflicts++; continue; }
    if (record.typeId == null) { record.typeId = typeId; counts.typeIds++; }
    if (!record.typeName && info?.typeName) { record.typeName = info.typeName; counts.typeNames++; }
  }
  if (counts.conflicts) evidence.limitations.push(`${counts.conflicts} existing type identities or names disagreed with the reader model; their source fields were preserved.`);
  return counts;
}

/** Optional source semantics never replace Reviter's geometry or material assignments. */
export async function enrichConvertResultWithStandardsReader(
  result: ConvertResult,
  bytes: Uint8Array,
  loader?: StandardsReaderLoader,
): Promise<StandardsEvidence> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
    result.sourceSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const evidence = await readStandardsEvidence(bytes, loader);
  result.readerDiagnostics = evidence.diagnostics;
  if (!result.partAtom && evidence.diagnostics.partAtom) result.partAtom = evidence.diagnostics.partAtom;
  // Unjoined definitions retain their own evidence list. Name equality does
  // not establish material identity, so they cannot alter scene assignments.
  result.standardsReaderMaterials = evidence.materials;
  if (evidence.sourceModel && evidence.readerVersion === result.decoderCoverage.revitVersion) {
    const declaredElementIds = new Set(result.elementIndex?.uniqueElementIds.length
      ? result.elementIndex.uniqueElementIds
      : result.nativeIdentity?.identities.map(identity => identity.elementId) ?? []);
    const projection = decodeNativeMepModel(evidence.sourceModel, {
      revitVersion: evidence.readerVersion,
      declaredElementIds,
      readerCommit: MEP_MODEL_READER_COMMIT,
      readerMode: "scaffold",
      partial: evidence.diagnostics.warnings.length > 0,
    });
    result.nativeMepEvidence = mergeNativeMepEvidence(result.nativeMepEvidence, projection);
    result.nativeIfcSemanticEvidence = decodeNativeIfcSemanticModel(evidence.sourceModel, {
      revitVersion: evidence.readerVersion, declaredElementIds,
      readerCommit: IFC_SEMANTIC_READER_COMMIT, readerMode: "scaffold",
    });
    supplementNativeIfcTypes(result);
  }
  return evidence;
}
