/// <reference lib="webworker" />

import { convertRvtBytes } from "./convert";
import type { ReaderDiagnostics, WorkerRequest, WorkerResponse } from "./types";

const context = self as unknown as DedicatedWorkerGlobalScope;

type RvtWasmModule = {
  default: () => Promise<unknown>;
  quickSummary: (bytes: Uint8Array) => { version?: number; class_name_count?: number };
  openRvtBytesWithDiagnostics: (bytes: Uint8Array) => {
    diagnostics?: Record<string, unknown>;
  };
};

async function readStandardsDiagnostics(bytes: Uint8Array): Promise<ReaderDiagnostics> {
  try {
    const wasm = (await import("../rvt-wasm/rvt.js")) as RvtWasmModule;
    await wasm.default();
    const summary = wasm.quickSummary(bytes);
    const summaryVersion = summary.version ?? 0;
    if (summaryVersion < 2016 || summaryVersion > 2026) {
      return {
        available: true,
        supportedVersion: false,
        productionElements: 0,
        diagnosticCandidates: 0,
        exportLevel: "unsupported-version",
        summary: `The Rust/WASM reader opened the container and inventoried ${summary.class_name_count?.toLocaleString() ?? "unknown"} schema classes, but Revit ${summaryVersion || "unknown"} is outside its verified 2016–2026 range.`,
        warnings: ["Standards-aware element decoding was skipped for this unverified Revit version."],
      };
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
    const supportedVersion = version >= 2016 && version <= 2026;
    return {
      available: true,
      supportedVersion,
      productionElements,
      diagnosticCandidates,
      exportLevel: diagnostics.confidence?.level ?? (productionElements ? "partial" : "scaffold"),
      summary: productionElements
        ? `${productionElements} standards-aware building elements were decoded.`
        : "No validated building elements were decoded; standards-aware IFC is scaffold-only.",
      warnings: (diagnostics.warnings ?? []).slice(0, 4),
    };
  } catch (error) {
    return {
      available: false,
      supportedVersion: false,
      productionElements: 0,
      diagnosticCandidates: 0,
      exportLevel: "unavailable",
      summary: `The optional standards-aware reader could not complete: ${error instanceof Error ? error.message : String(error)}`,
      warnings: [],
    };
  }
}

context.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "convert") return;

  try {
    const bytes = new Uint8Array(request.buffer);
    const result = convertRvtBytes(
      bytes,
      request.fileName,
      request.options,
      ({ ratio, message }) => {
        const progress: WorkerResponse = {
          id: request.id,
          type: "progress",
          ratio: ratio * 0.82,
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
      result.readerDiagnostics = await readStandardsDiagnostics(bytes);
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
