/// <reference lib="webworker" />

import { convertRvtBytes } from "./convert.ts";
import { enrichConvertResultWithStandardsReader } from "./standards-reader.ts";
import type { WorkerRequest, WorkerResponse } from "./types.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;

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
      await enrichConvertResultWithStandardsReader(result, bytes);
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
