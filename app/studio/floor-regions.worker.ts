/// <reference lib="webworker" />

import { deriveRoomsForLevels, type DerivedRoomResult } from "../../lib/reviter/derived-rooms.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import type { WorkerEnvelope } from "../../lib/reviter/worker-client.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;

export type FloorRegionsRequest = {
  id: number;
  type: "floor-regions";
  levelIds: number[];
  /** Category-filtered clone of the ConvertResult, sent with each request. */
  result: ConvertResult;
};

export type FloorRegionsResponse = WorkerEnvelope<DerivedRoomResult>;

context.onmessage = (event: MessageEvent<FloorRegionsRequest>) => {
  const request = event.data;
  // A worker that answers anything posted at it answers strangers too. This is
  // the same guard the other four workers have always had.
  if (!request || request.type !== "floor-regions") return;
  try {
    context.postMessage({
      id: request.id,
      type: "result",
      result: deriveRoomsForLevels(request.result, request.levelIds),
    } satisfies FloorRegionsResponse);
  } catch (error) {
    context.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies FloorRegionsResponse);
  }
};
