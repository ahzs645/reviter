"use client";

/**
 * Decode a DWG into a plan SVG, off the main thread.
 *
 * The worker is created per decode and terminated after: a survey drawing holds
 * the WASM heap for its entity count, and keeping that alive for a session in
 * which one DWG was opened once is a poor trade. The decoder module itself is
 * only imported inside the worker, so nothing about LibreDWG is fetched until a
 * DWG is actually chosen.
 */
import type {
  DwgWorkerRequest,
  DwgWorkerResult,
  DwgWorkerSheet,
} from "../../lib/reviter/dwg-worker.ts";
import { WorkerClient } from "../../lib/reviter/worker-client.ts";
import { staticWorkerUrl } from "./reference-model.ts";

export type DecodedDwgSheet = DwgWorkerSheet;

export type DecodedDwg = {
  svg: string;
  entityCount: number;
  droppedCount: number;
  layerNames: string[];
  sectionCount: number;
  /** Named plans read off the drawing's own layouts; empty when it has none. */
  sheets: DecodedDwgSheet[];
  feetPerUnit: number | null;
  insunits: number | null;
};

export function decodeDwg(
  bytes: ArrayBuffer,
  onProgress?: (stage: string) => void,
): Promise<DecodedDwg> {
  return new Promise((resolve, reject) => {
    // One client per decode, terminated on settle, so the worker's lifetime is
    // exactly this promise's. Nothing here is pooled or reused, and the shared
    // client charges nothing for the pooling this call site does not want.
    const client = new WorkerClient<DwgWorkerRequest, DwgWorkerResult>({
      spawn: () => new Worker(
        staticWorkerUrl("dwg") ?? new URL("../../lib/reviter/dwg-worker.ts", import.meta.url),
        { type: "module" },
      ),
      startFailureMessage: "This browser blocked the CAD decoder worker.",
      // No main-thread fallback on purpose. Decoding this drawing takes nine
      // seconds of uninterruptible WASM; running it here would freeze the tab
      // rather than degrade, so a blocked worker is reported instead.
      deathMessage: "The CAD decoder worker could not start.",
    });
    const settle = (finish: () => void) => { client.terminate(); finish(); };
    client.send({ type: "dwg", bytes }, {
      onProgress: (progress) => onProgress?.(progress.message),
      onResult: (result) => settle(() => resolve({
        svg: result.svg,
        entityCount: result.entityCount,
        droppedCount: result.droppedCount,
        layerNames: result.layerNames,
        sectionCount: result.sections.length,
        sheets: result.sheets,
        feetPerUnit: result.feetPerUnit,
        insunits: result.insunits,
      })),
      onError: (message) => settle(() => reject(new Error(message))),
    }, [bytes]);
  });
}
