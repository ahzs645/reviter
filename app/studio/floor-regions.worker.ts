/// <reference lib="webworker" />

import { deriveRoomsForLevels, type DerivedRoomResult } from "../../lib/reviter/derived-rooms.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;

type Request = { id: number; levelIds: number[]; result: ConvertResult };
type Response = { id: number; result?: DerivedRoomResult; error?: string };

context.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    context.postMessage({
      id: request.id,
      result: deriveRoomsForLevels(request.result, request.levelIds),
    } satisfies Response);
  } catch (error) {
    context.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies Response);
  }
};
