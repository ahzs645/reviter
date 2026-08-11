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
import type { DwgWorkerRequest, DwgWorkerResponse } from "../../lib/reviter/dwg-worker.ts";
import { staticWorkerUrl } from "./reference-model.ts";

export type DecodedDwg = {
  svg: string;
  entityCount: number;
  droppedCount: number;
  layerNames: string[];
  sectionCount: number;
  feetPerUnit: number | null;
  insunits: number | null;
};

export function decodeDwg(
  bytes: ArrayBuffer,
  onProgress?: (stage: string) => void,
): Promise<DecodedDwg> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      const url = staticWorkerUrl("dwg")
        ?? new URL("../../lib/reviter/dwg-worker.ts", import.meta.url);
      worker = new Worker(url, { type: "module" });
    } catch {
      reject(new Error("This browser blocked the CAD decoder worker."));
      return;
    }
    const finish = (settle: () => void) => { worker.terminate(); settle(); };

    worker.addEventListener("message", (event: MessageEvent<DwgWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") { onProgress?.(message.stage); return; }
      if (message.type === "error") {
        finish(() => reject(new Error(message.error)));
        return;
      }
      finish(() => resolve({
        svg: message.svg,
        entityCount: message.entityCount,
        droppedCount: message.droppedCount,
        layerNames: message.layerNames,
        sectionCount: message.sections.length,
        feetPerUnit: message.feetPerUnit,
        insunits: message.insunits,
      }));
    });
    worker.addEventListener("error", () => {
      // No main-thread fallback on purpose. Decoding this drawing takes nine
      // seconds of uninterruptible WASM; running it here would freeze the tab
      // rather than degrade, so a blocked worker is reported instead.
      finish(() => reject(new Error("The CAD decoder worker could not start.")));
    });
    worker.postMessage({ type: "dwg", id: 1, bytes } satisfies DwgWorkerRequest, [bytes]);
  });
}
