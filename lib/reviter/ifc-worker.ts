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
    const transfers: Transferable[] = [];
    for (const mesh of result.referenceMeshes) {
      transfers.push(mesh.positions.buffer, mesh.indices.buffer);
      if (mesh.elementIds) transfers.push(mesh.elementIds.buffer);
    }
    if (result.reference.geometricShapeDifferentElementIds) {
      transfers.push(result.reference.geometricShapeDifferentElementIds.buffer);
    }
    if (result.reference.directRoofGeometryElementIds) {
      transfers.push(result.reference.directRoofGeometryElementIds.buffer);
    }
    if (result.reference.completeRampAggregateElementIds) {
      transfers.push(result.reference.completeRampAggregateElementIds.buffer);
    }
    context.postMessage(
      { id: request.id, type: "result", result } satisfies IfcWorkerResponse,
      transfers,
    );
  } catch (error) {
    context.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies IfcWorkerResponse);
  }
};
