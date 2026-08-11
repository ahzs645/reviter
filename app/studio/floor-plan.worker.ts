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

export type FloorPlanWorkerResponse = {
  id: number;
  svg?: string;
  summary?: ArchitecturalPlanSummary;
  error?: string;
};

let model: ConvertResult | null = null;

context.onmessage = (event: MessageEvent<FloorPlanWorkerInit | FloorPlanWorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    model = request.result;
    return;
  }
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
      svg: makeArchitecturalFloorSvg(model, request.levelId, options),
      summary: architecturalPlanSummary(model, request.levelId, options),
    } satisfies FloorPlanWorkerResponse);
  } catch (error) {
    context.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies FloorPlanWorkerResponse);
  }
};
