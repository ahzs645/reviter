/// <reference lib="webworker" />

import { convertRvtBytes } from "./convert";
import { decodeRvtMaterialDefinitions } from "./native-decoder";
import { partAtomMetadataFromSummary } from "./part-atom";
import {
  STANDARDS_READER_RANGE_LABEL,
  standardsReaderSupports,
} from "./reader-support";
import type { MaterialData, ReaderDiagnostics, WorkerRequest, WorkerResponse } from "./types";

const context = self as unknown as DedicatedWorkerGlobalScope;

type RvtWasmModule = {
  default: () => Promise<unknown>;
  quickSummary: (bytes: Uint8Array) => {
    version?: number;
    class_name_count?: number;
    partatom?: unknown;
  };
  openRvtBytesWithDiagnostics: (bytes: Uint8Array) => {
    diagnostics?: Record<string, unknown>;
    model?: {
      materials?: Array<{
        name?: string;
        color_packed?: number | null;
        transparency?: number | null;
      }>;
    };
  };
};

type StandardsEvidence = { diagnostics: ReaderDiagnostics; materials: MaterialData[] };

async function readStandardsEvidence(bytes: Uint8Array): Promise<StandardsEvidence> {
  try {
    const wasm = (await import("../rvt-wasm/rvt.js")) as RvtWasmModule;
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
    const result = wasm.openRvtBytesWithDiagnostics(bytes);
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
      }, materials };
  } catch (error) {
    return { diagnostics: {
        available: false,
        supportedVersion: false,
        productionElements: 0,
        diagnosticCandidates: 0,
        exportLevel: "unavailable",
        summary: `The optional standards-aware reader could not complete: ${error instanceof Error ? error.message : String(error)}`,
        warnings: [],
      }, materials: [] };
  }
}

context.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "convert") return;

  try {
    const bytes = new Uint8Array(request.buffer);
    let lastPostedRatio = -1;
    const result = convertRvtBytes(
      bytes,
      request.fileName,
      request.options,
      ({ ratio, message }) => {
        // The converter reports page-level detail for CLI diagnostics. The
        // redesigned browser shell displays a percentage rather than those
        // messages, so forwarding sub-percent changes only makes React render
        // hundreds of times during a large partition scan. Keep the progress
        // bar smooth while leaving the worker's actual conversion untouched.
        const scaledRatio = ratio * 0.82;
        if (scaledRatio < 0.82 && scaledRatio - lastPostedRatio < 0.005) return;
        lastPostedRatio = scaledRatio;
        const progress: WorkerResponse = {
          id: request.id,
          type: "progress",
          ratio: scaledRatio,
          message,
        };
        context.postMessage(progress);
      },
    );

    if (result.ok) {
      context.postMessage({
        id: request.id,
        type: "progress",
        ratio: 0.86,
        message: "Checking standards-aware element evidence",
      } satisfies WorkerResponse);
      const evidence = await readStandardsEvidence(bytes);
      result.readerDiagnostics = evidence.diagnostics;
      if (!result.partAtom && evidence.diagnostics.partAtom) {
        result.partAtom = evidence.diagnostics.partAtom;
      }
      if (evidence.materials.length) {
        result.materials.push(...evidence.materials);
        result.decoderCoverage.nativeMaterialDefinitions = evidence.materials.length;
        const hasNativeAssignments =
          result.decoderCoverage.nativeMaterialAssignments > 0;
        result.decoderCoverage.materialFidelity = hasNativeAssignments
          ? "native-assigned"
          : "native-definitions-unassigned";
        result.decoderCoverage.activeDecoders.push("rvt-rs-material-fields-v1");
        result.warnings.push(
          hasNativeAssignments
            ? `${evidence.materials.length} native RVT material definitions were decoded; geometry-level assignments are available, but per-face assignments and texture assets are not decoded yet.`
            : `${evidence.materials.length} native RVT material definitions were decoded, but element-to-material assignments and texture assets are not decoded yet.`,
        );
      }
      context.postMessage({
        id: request.id,
        type: "progress",
        ratio: 1,
        message: "Ready",
      } satisfies WorkerResponse);
    }

    const response: WorkerResponse = { id: request.id, type: "result", result };
    if (result.ok) {
      const transfers: Transferable[] = [];
      for (const mesh of result.meshes) {
        transfers.push(mesh.positions.buffer, mesh.indices.buffer, mesh.colors.buffer);
        if (mesh.elementIds) transfers.push(mesh.elementIds.buffer);
      }
      if (result.elementIndex) {
        transfers.push(
          result.elementIndex.uniqueElementIds.buffer,
          result.elementIndex.partitionRecordIds.buffer,
        );
      }
      context.postMessage(response, transfers);
    } else {
      context.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    context.postMessage(response);
  }
};
