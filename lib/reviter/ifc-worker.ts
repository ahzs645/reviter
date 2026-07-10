/// <reference lib="webworker" />

import { analyzeIfcReference } from "./ifc-reference";
import type { IfcWorkerRequest, IfcWorkerResponse } from "./types";

const context = self as unknown as DedicatedWorkerGlobalScope;

context.onmessage = async (event: MessageEvent<IfcWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "analyze-ifc") return;
  try {
    const result = await analyzeIfcReference(
      request.buffer,
      request.fileName,
      request.rvt,
      ({ ratio, message }) => {
        context.postMessage({
          id: request.id,
          type: "progress",
          ratio,
          message,
        } satisfies IfcWorkerResponse);
      },
    );
    context.postMessage({ id: request.id, type: "result", result } satisfies IfcWorkerResponse);
  } catch (error) {
    context.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies IfcWorkerResponse);
  }
};
