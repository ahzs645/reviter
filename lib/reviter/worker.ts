/// <reference lib="webworker" />

import { convertRvtBytes } from "./convert";
import type { MaterialData, ReaderDiagnostics, WorkerRequest, WorkerResponse } from "./types";

const context = self as unknown as DedicatedWorkerGlobalScope;

type RvtWasmModule = {
  default: () => Promise<unknown>;
  quickSummary: (bytes: Uint8Array) => { version?: number; class_name_count?: number };
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

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function decodedMaterials(
  source: Array<{ name?: string; color_packed?: number | null; transparency?: number | null }>,
): MaterialData[] {
  return source.flatMap((material) => {
    if (!material.name) return [];
    const packed = material.color_packed;
    const rgb = packed == null
      ? [0.522, 0.522, 0.522]
      : [
          srgbToLinear((packed & 0xff) / 255),
          srgbToLinear(((packed >> 8) & 0xff) / 255),
          srgbToLinear(((packed >> 16) & 0xff) / 255),
        ];
    return [{
      name: material.name,
      baseColorLinear: [rgb[0]!, rgb[1]!, rgb[2]!, 1 - Math.max(0, Math.min(1, material.transparency ?? 0))] as [number, number, number, number],
      metallic: /metal|steel|alum|iron|chrome/i.test(material.name) ? 0.8 : 0,
      roughness: /glass|polish|chrome/i.test(material.name) ? 0.2 : 0.7,
      doubleSided: true,
      source: "rvt-material" as const,
      assignedElements: 0,
    }];
  });
}

async function readStandardsEvidence(bytes: Uint8Array): Promise<StandardsEvidence> {
  try {
    const wasm = (await import("../rvt-wasm/rvt.js")) as RvtWasmModule;
    await wasm.default();
    const summary = wasm.quickSummary(bytes);
    const summaryVersion = summary.version ?? 0;
    if (summaryVersion < 2016 || summaryVersion > 2026) {
      return { diagnostics: {
          available: true,
          supportedVersion: false,
          productionElements: 0,
          diagnosticCandidates: 0,
          exportLevel: "unsupported-version",
          summary: `The Rust/WASM reader opened the container and inventoried ${summary.class_name_count?.toLocaleString() ?? "unknown"} schema classes, but Revit ${summaryVersion || "unknown"} is outside its verified 2016–2026 range.`,
          warnings: ["Standards-aware element and material decoding was skipped for this unverified Revit version."],
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
    const supportedVersion = version >= 2016 && version <= 2026;
    const materials = decodedMaterials(result.model?.materials ?? []);
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
      const evidence = await readStandardsEvidence(bytes);
      result.readerDiagnostics = evidence.diagnostics;
      if (evidence.materials.length) {
        result.materials.push(...evidence.materials);
        result.decoderCoverage.nativeMaterialDefinitions = evidence.materials.length;
        result.decoderCoverage.materialFidelity = "native-definitions-unassigned";
        result.decoderCoverage.activeDecoders.push("rvt-rs-material-fields-v1");
        result.warnings.push(
          `${evidence.materials.length} native RVT material definitions were decoded, but element-to-material assignments and texture assets are not decoded yet.`,
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
