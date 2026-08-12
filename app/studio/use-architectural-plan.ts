"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  architecturalPlanSummary,
  makeArchitecturalFloorSvg,
  type ArchitecturalPlanRoomLabel,
  type ArchitecturalPlanSummary,
  type PlanTheme,
} from "../../lib/reviter/architectural-plan.ts";
import type { DerivedRoomResult } from "../../lib/reviter/derived-rooms.ts";
import type { RoomReviewState } from "../../lib/reviter/room-review.ts";
import type { ConvertResult, ElementBoundsRecord } from "../../lib/reviter/types.ts";
import { WorkerClient } from "../../lib/reviter/worker-client.ts";
import type {
  FloorPlanResult,
  FloorPlanWorkerInit,
  FloorPlanWorkerRequest,
} from "./floor-plan.worker.ts";
import type { ReviterGlobal } from "./types.ts";

/**
 * The prebuilt plan worker a static host injects, if there is one. Read here
 * rather than through reference-model's accessor so that assembling a plan does
 * not depend on the viewer's module graph — which is also what lets the engine
 * below be exercised outside a browser.
 */
function staticPlanWorkerUrl(): string | undefined {
  return (globalThis as ReviterGlobal).__REVITER_STATIC_WORKERS__?.plan;
}

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
      familyName: record.familyName,
      typeName: record.typeName,
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

/**
 * A plan this model cannot draw — most often a level with no floor plate. Kept
 * as one shared constant so it is a stable `useSyncExternalStore` snapshot.
 */
const PLAN_FAILED = { failed: true } as const;
type PlanSnapshot = PlanEntry | typeof PLAN_FAILED | null;

function isPlanEntry(snapshot: PlanSnapshot): snapshot is PlanEntry {
  return snapshot != null && snapshot !== PLAN_FAILED;
}

type PlanClient = WorkerClient<FloorPlanWorkerRequest, FloorPlanResult>;

export type PlanEngine = {
  result: ConvertResult;
  /** Built on the first request that needs it; see `planClient`. */
  client: PlanClient | null;
  workerFailed: boolean;
  cache: Map<string, PlanEntry>;
  /** Keys that neither the worker nor the main thread can draw. */
  failed: Set<string>;
  /** Keys in flight in the worker — several at once, and all of them wanted. */
  inFlight: Set<string>;
  listeners: Set<() => void>;
};

/**
 * One assembly engine per converted model, shared by every plan surface in the
 * app so the workspace, the mini-map, and prewarms all fill one cache. Resolved
 * plans stay cached for the model's lifetime, like the lib-level plan caches.
 */
const engines = new WeakMap<ConvertResult, PlanEngine>();

/** The engine backing every plan surface for one model. Exported for tests. */
export function engineFor(result: ConvertResult): PlanEngine {
  let engine = engines.get(result);
  if (!engine) {
    engine = {
      result,
      client: null,
      workerFailed: false,
      cache: new Map(),
      failed: new Set(),
      inFlight: new Set(),
      listeners: new Set(),
    };
    engines.set(result, engine);
  }
  return engine;
}

/**
 * The worker client for one model, built on demand.
 *
 * Unlike the other four clients this one keeps several requests in flight at
 * once and wants every answer: the visible floor and its prewarmed neighbours
 * are all being drawn together, so nothing here supersedes anything.
 */
function planClient(engine: PlanEngine): PlanClient {
  engine.client ??= new WorkerClient<FloorPlanWorkerRequest, FloorPlanResult>({
    spawn: () => {
      const worker = new Worker(
        staticPlanWorkerUrl() ?? new URL("./floor-plan.worker.ts", import.meta.url),
        { type: "module" },
      );
      // The model belongs to the worker rather than to any one request, so it
      // is primed here — which also means a replacement worker re-primes itself
      // instead of answering every request with "no model yet".
      worker.postMessage(
        { type: "init", result: compactPlanResult(engine.result) } satisfies FloorPlanWorkerInit,
      );
      return worker;
    },
    startFailureMessage: "This browser blocked the floor plan worker.",
    deathMessage: "The floor plan worker stopped unexpectedly.",
    onWorkerFailure: () => {
      // The worker is not tried again for this model. Every request it was
      // serving is failed individually right after this, and each of those is
      // redrawn on the main thread by its own handler.
      engine.workerFailed = true;
    },
  });
  return engine.client;
}

function notify(engine: PlanEngine) {
  for (const listener of engine.listeners) listener();
}

function resolveSynchronously(engine: PlanEngine, key: string, request: PlanRequestParts) {
  // A browser that blocks module workers still gets the feature, at the cost
  // of the old synchronous pause. This is also the retry for a plan the worker
  // reported an error for: the worker only holds the category-filtered clone,
  // so a request that failed there can still succeed against the full result.
  try {
    const entry = {
      svg: makeArchitecturalFloorSvg(engine.result, request.levelId, {
        connectedLevelIds: request.connectedLevelIds,
        rotationQuarterTurns: request.rotationQuarterTurns,
        derivedRooms: request.derivedRooms ?? false,
        roomLabels: request.roomLabels ?? undefined,
        theme: request.theme,
      }),
      summary: architecturalPlanSummary(engine.result, request.levelId, {
        connectedLevelIds: request.connectedLevelIds,
      }),
    };
    engine.cache.set(key, entry);
    engine.failed.delete(key);
    notify(engine);
  } catch {
    // Levels without floor plates throw here. Record that so the surfaces stop
    // waiting on a plan that is never coming: an unrecorded failure leaves
    // `building` true forever, pinning the previous floor's drawing on screen
    // and, with it, the previous floor's coordinate frame.
    engine.failed.add(key);
    notify(engine);
  }
}

type PlanRequestParts = {
  levelId: number;
  connectedLevelIds: readonly number[];
  rotationQuarterTurns: number;
  derivedRooms: DerivedRoomResult | null;
  roomLabels?: Readonly<Record<string, ArchitecturalPlanRoomLabel>> | null;
  /** The ink the plan is drawn in; part of the cache key, not a CSS concern. */
  theme: PlanTheme;
};

const optionIdentity = new WeakMap<object, number>();
let optionIdentityCounter = 0;

function identityOf(value: object | null | undefined): number {
  if (!value) return 0;
  let id = optionIdentity.get(value);
  if (id == null) { id = ++optionIdentityCounter; optionIdentity.set(value, id); }
  return id;
}

function planKey(parts: PlanRequestParts): string {
  return `${parts.levelId}|${[...parts.connectedLevelIds].join(",")}|${parts.rotationQuarterTurns}` +
    `|${identityOf(parts.derivedRooms)}|${identityOf(parts.roomLabels)}|${parts.theme}`;
}

/**
 * Accepted Room-review names/numbers for the visible derived regions, keyed by
 * candidate key — the labels the plan renderer swaps in for F-numbers.
 */
export function acceptedRoomLabels(
  derivedRooms: DerivedRoomResult | null,
  roomReview: RoomReviewState | undefined,
): Readonly<Record<string, ArchitecturalPlanRoomLabel>> | null {
  if (!derivedRooms || !roomReview?.rooms.length) return null;
  const byCandidate = new Map(roomReview.rooms.map((room) => [room.candidateKey, room]));
  const labels: Record<string, ArchitecturalPlanRoomLabel> = {};
  for (const room of derivedRooms.rooms) {
    const review = byCandidate.get(room.key);
    if (review?.disposition !== "accepted") continue;
    const name = review.details.name.trim();
    const number = review.details.number.trim();
    if (name || number) labels[room.key] = { ...(name && { name }), ...(number && { number }) };
  }
  return Object.keys(labels).length ? labels : null;
}

/** Queue one plan, in the worker when there is one. Exported for tests. */
export function requestPlan(engine: PlanEngine, key: string, parts: PlanRequestParts) {
  // A key that failed on both threads is deterministic — the same inputs throw
  // again — so it is left alone rather than re-posted on every effect run.
  if (engine.cache.has(key) || engine.failed.has(key) || engine.inFlight.has(key)) return;
  if (engine.workerFailed) { resolveSynchronously(engine, key, parts); return; }
  engine.inFlight.add(key);
  planClient(engine).send({
    type: "plan",
    levelId: parts.levelId,
    connectedLevelIds: [...parts.connectedLevelIds],
    rotationQuarterTurns: parts.rotationQuarterTurns,
    derivedRooms: parts.derivedRooms,
    roomLabels: parts.roomLabels ?? null,
    theme: parts.theme,
  }, {
    onResult: (plan) => {
      engine.inFlight.delete(key);
      engine.cache.set(key, plan);
      engine.failed.delete(key);
      notify(engine);
    },
    onError: () => {
      // The same treatment whether the worker reported the error, died, or
      // never started. Dropping the request instead left the entry null with
      // nothing in flight, and the effect cannot retry because neither the key
      // nor the parts changed.
      engine.inFlight.delete(key);
      resolveSynchronously(engine, key, parts);
    },
  });
}

export type ArchitecturalPlanState = {
  /** The current plan SVG, or the previous one while the next is assembling. */
  svg: string | null;
  summary: ArchitecturalPlanSummary | null;
  /** True while the requested plan is still assembling off the main thread. */
  building: boolean;
};

/** What the engine currently knows about one key: drawn, undrawable, or neither. */
export function planSnapshot(engine: PlanEngine, key: string | null): PlanSnapshot {
  if (!key) return null;
  return engine.cache.get(key) ?? (engine.failed.has(key) ? PLAN_FAILED : null);
}

/**
 * Derive what the surfaces render. The previous plan is held over only while
 * the next one is still coming: once a key is known to be undrawable there is
 * nothing to wait for, and holding another floor's drawing over would also
 * hold over the bounds that drawing is measured in — which is how a click
 * meant for one storey used to be resolved in another storey's frame.
 */
export function planStateFor(
  snapshot: PlanSnapshot,
  previous: PlanEntry | null,
  key: string | null,
): ArchitecturalPlanState {
  const entry = isPlanEntry(snapshot) ? snapshot : null;
  const building = Boolean(key) && snapshot == null;
  const shown = entry ?? (building ? previous : null);
  return { svg: shown?.svg ?? null, summary: shown?.summary ?? null, building };
}

/**
 * Assemble architectural plan SVGs in a dedicated worker so switching floors
 * never blocks the page. The previous plan stays on screen, flagged as
 * `building`, until the next one arrives; resolved plans are cached and
 * neighbours can be prewarmed for instant browsing.
 */
export function useArchitecturalPlan(
  result: ConvertResult,
  parts: PlanRequestParts | null,
  prewarm: readonly { levelId: number; connectedLevelIds: readonly number[]; theme: PlanTheme }[] = [],
): ArchitecturalPlanState {
  const engine = engineFor(result);
  const key = parts ? planKey(parts) : null;

  const subscribe = useCallback((listener: () => void) => {
    engine.listeners.add(listener);
    return () => {
      engine.listeners.delete(listener);
      if (!engine.listeners.size) {
        // Last plan surface closed: stop the worker, keep the resolved cache.
        // The client stays and spawns a fresh worker if a surface reopens.
        engine.client?.terminate();
        engine.inFlight.clear();
      }
    };
  }, [engine]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => planSnapshot(engine, key),
    () => null,
  );
  const entry = isPlanEntry(snapshot) ? snapshot : null;

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

  return useMemo(
    () => planStateFor(snapshot, previous?.entry ?? null, key),
    [key, previous, snapshot],
  );
}
