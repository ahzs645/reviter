/// <reference lib="webworker" />

import {
  architecturalPlanSummary,
  makeArchitecturalFloorSvg,
  type ArchitecturalPlanRoomLabel,
  type ArchitecturalPlanSummary,
  type PlanTheme,
} from "../../lib/reviter/architectural-plan.ts";
import type { DerivedRoomResult } from "../../lib/reviter/derived-rooms.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import type { WorkerEnvelope } from "../../lib/reviter/worker-client.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;

export type FloorPlanWorkerInit = {
  type: "init";
  /** Category-filtered clone of the ConvertResult; sent once per model. */
  result: ConvertResult;
};

export type FloorPlanWorkerRequest = {
  type: "plan";
  id: number;
  levelId: number;
  connectedLevelIds: number[];
  rotationQuarterTurns: number;
  derivedRooms: DerivedRoomResult | null;
  roomLabels: Readonly<Record<string, ArchitecturalPlanRoomLabel>> | null;
  /** Which ink to draw in; the SVG carries its own stylesheet. */
  theme: PlanTheme;
};

/** One drawn plan: the SVG and the summary measured from the same options. */
export type FloorPlanResult = {
  svg: string;
  summary: ArchitecturalPlanSummary;
};

export type FloorPlanWorkerResponse = WorkerEnvelope<FloorPlanResult>;

let model: ConvertResult | null = null;

context.onmessage = (event: MessageEvent<FloorPlanWorkerInit | FloorPlanWorkerRequest>) => {
  const request = event.data;
  if (!request) return;
  if (request.type === "init") {
    model = request.result;
    return;
  }
  if (request.type !== "plan") return;
  try {
    if (!model) throw new Error("The floor plan worker has no model yet.");
    const options = {
      connectedLevelIds: request.connectedLevelIds,
      rotationQuarterTurns: request.rotationQuarterTurns,
      derivedRooms: request.derivedRooms ?? false,
      roomLabels: request.roomLabels ?? undefined,
      theme: request.theme,
    };
    context.postMessage({
      id: request.id,
      type: "result",
      result: {
        svg: makeArchitecturalFloorSvg(model, request.levelId, options),
        summary: architecturalPlanSummary(model, request.levelId, options),
      },
    } satisfies FloorPlanWorkerResponse);
  } catch (error) {
    context.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies FloorPlanWorkerResponse);
  }
};
