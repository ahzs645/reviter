"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  architecturalPlanSummary,
  makeArchitecturalFloorSvg,
  type ArchitecturalPlanSummary,
} from "../../lib/reviter/architectural-plan.ts";
import type { DerivedRoomResult } from "../../lib/reviter/derived-rooms.ts";
import type { ConvertResult, ElementBoundsRecord } from "../../lib/reviter/types.ts";
import type {
  FloorPlanWorkerRequest,
  FloorPlanWorkerResponse,
} from "./floor-plan.worker.ts";

const PLAN_CATEGORY_IDS = new Set([
  -2_000_032, // Floors
  -2_000_011, -2_000_170, -2_000_171, // Walls
  -2_000_023, // Doors
  -2_000_014, // Windows
  -2_000_100, -2_000_133, // Columns
]);

/** The record subset the plan composer reads, cloneable into a worker. */
function compactPlanResult(result: ConvertResult): ConvertResult {
  const relevant = (record: ElementBoundsRecord) =>
    PLAN_CATEGORY_IDS.has(record.categoryId ?? 0) ||
    record.categoryName === "Stairs Landings" ||
    record.categoryName === "Stairs Runs";
  return {
    levels: result.levels,
    nativeAssociatedLevelRelations: result.nativeAssociatedLevelRelations,
    elementBounds: result.elementBounds.filter(relevant).map((record) => ({
      elementId: record.elementId,
      stream: record.stream,
      chunkIndex: record.chunkIndex,
      rawOffset: record.rawOffset,
      recordOffset: record.recordOffset,
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      boundsFeet: record.boundsFeet,
      loops: record.loops,
      solid: record.solid,
      solids: record.solids,
      arcs: record.arcs,
      orientedBox: record.orientedBox,
      stairTreads: record.stairTreads,
    })),
  } as unknown as ConvertResult;
}

type PlanEntry = { svg: string; summary: ArchitecturalPlanSummary };

type PlanEngine = {
  result: ConvertResult;
  worker: Worker | null;
  workerFailed: boolean;
  cache: Map<string, PlanEntry>;
  pending: Map<number, string>;
  nextId: number;
  listeners: Set<() => void>;
};

/**
 * One assembly engine per converted model, shared by every plan surface in the
 * app so the workspace, the mini-map, and prewarms all fill one cache. Resolved
 * plans stay cached for the model's lifetime, like the lib-level plan caches.
 */
const engines = new WeakMap<ConvertResult, PlanEngine>();

function engineFor(result: ConvertResult): PlanEngine {
  let engine = engines.get(result);
  if (!engine) {
    engine = {
      result,
      worker: null,
      workerFailed: false,
      cache: new Map(),
      pending: new Map(),
      nextId: 0,
      listeners: new Set(),
    };
    engines.set(result, engine);
  }
  return engine;
}

function notify(engine: PlanEngine) {
  for (const listener of engine.listeners) listener();
}

function resolveSynchronously(engine: PlanEngine, key: string, request: PlanRequestParts) {
  // A browser that blocks module workers still gets the feature, at the cost
  // of the old synchronous pause.
  try {
    const entry = {
      svg: makeArchitecturalFloorSvg(engine.result, request.levelId, {
        connectedLevelIds: request.connectedLevelIds,
        rotationQuarterTurns: request.rotationQuarterTurns,
        derivedRooms: request.derivedRooms ?? false,
      }),
      summary: architecturalPlanSummary(engine.result, request.levelId, {
        connectedLevelIds: request.connectedLevelIds,
      }),
    };
    engine.cache.set(key, entry);
    notify(engine);
  } catch {
    // Levels without floor plates surface as the empty state downstream.
  }
}

type PlanRequestParts = {
  levelId: number;
  connectedLevelIds: readonly number[];
  rotationQuarterTurns: number;
  derivedRooms: DerivedRoomResult | null;
};

const derivedRoomsIdentity = new WeakMap<DerivedRoomResult, number>();
let derivedRoomsCounter = 0;

function planKey(parts: PlanRequestParts): string {
  let roomsKey = "none";
  if (parts.derivedRooms) {
    let id = derivedRoomsIdentity.get(parts.derivedRooms);
    if (id == null) { id = ++derivedRoomsCounter; derivedRoomsIdentity.set(parts.derivedRooms, id); }
    roomsKey = String(id);
  }
  return `${parts.levelId}|${[...parts.connectedLevelIds].join(",")}|${parts.rotationQuarterTurns}|${roomsKey}`;
}

function requestPlan(engine: PlanEngine, key: string, parts: PlanRequestParts) {
  if (engine.cache.has(key)) return;
  for (const pendingKey of engine.pending.values()) if (pendingKey === key) return;
  if (engine.workerFailed) { resolveSynchronously(engine, key, parts); return; }
  if (!engine.worker) {
    try {
      const worker = new Worker(
        new URL("./floor-plan.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (event: MessageEvent<FloorPlanWorkerResponse>) => {
        if (engine.worker !== worker) return;
        const pendingKey = engine.pending.get(event.data.id);
        if (pendingKey == null) return;
        engine.pending.delete(event.data.id);
        if (event.data.error || !event.data.svg || !event.data.summary) return;
        engine.cache.set(pendingKey, { svg: event.data.svg, summary: event.data.summary });
        notify(engine);
      });
      worker.addEventListener("error", () => {
        if (engine.worker !== worker) return;
        worker.terminate();
        engine.worker = null;
        engine.workerFailed = true;
        engine.pending.clear();
        resolveSynchronously(engine, key, parts);
      });
      worker.postMessage({ type: "init", result: compactPlanResult(engine.result) });
      engine.worker = worker;
    } catch {
      engine.workerFailed = true;
      resolveSynchronously(engine, key, parts);
      return;
    }
  }
  const id = engine.nextId++;
  engine.pending.set(id, key);
  engine.worker.postMessage({
    type: "plan",
    id,
    levelId: parts.levelId,
    connectedLevelIds: [...parts.connectedLevelIds],
    rotationQuarterTurns: parts.rotationQuarterTurns,
    derivedRooms: parts.derivedRooms,
  } satisfies FloorPlanWorkerRequest);
}

export type ArchitecturalPlanState = {
  /** The current plan SVG, or the previous one while the next is assembling. */
  svg: string | null;
  summary: ArchitecturalPlanSummary | null;
  /** True while the requested plan is still assembling off the main thread. */
  building: boolean;
};

/**
 * Assemble architectural plan SVGs in a dedicated worker so switching floors
 * never blocks the page. The previous plan stays on screen, flagged as
 * `building`, until the next one arrives; resolved plans are cached and
 * neighbours can be prewarmed for instant browsing.
 */
export function useArchitecturalPlan(
  result: ConvertResult,
  parts: PlanRequestParts | null,
  prewarm: readonly { levelId: number; connectedLevelIds: readonly number[] }[] = [],
): ArchitecturalPlanState {
  const engine = engineFor(result);
  const key = parts ? planKey(parts) : null;

  const subscribe = useCallback((listener: () => void) => {
    engine.listeners.add(listener);
    return () => {
      engine.listeners.delete(listener);
      if (!engine.listeners.size) {
        // Last plan surface closed: stop the worker, keep the resolved cache.
        engine.worker?.terminate();
        engine.worker = null;
        engine.pending.clear();
      }
    };
  }, [engine]);
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? engine.cache.get(key) ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (!parts || !key) return;
    requestPlan(engine, key, parts);
    for (const neighbour of prewarm) {
      const neighbourParts: PlanRequestParts = {
        ...neighbour,
        rotationQuarterTurns: 0,
        derivedRooms: null,
      };
      requestPlan(engine, planKey(neighbourParts), neighbourParts);
    }
  }, [engine, key, parts, prewarm]);

  // Render-phase adjustment (the sanctioned "previous renders" pattern): keep
  // the last resolved plan on screen while the next one assembles.
  const [previous, setPrevious] = useState<{ key: string; entry: PlanEntry } | null>(null);
  if (key && entry && previous?.key !== key) {
    setPrevious({ key, entry });
  }

  return useMemo(() => ({
    svg: entry?.svg ?? previous?.entry.svg ?? null,
    summary: entry?.summary ?? previous?.entry.summary ?? null,
    building: Boolean(key && !entry),
  }), [entry, key, previous]);
}
