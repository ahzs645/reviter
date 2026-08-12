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
import type {
  FloorPlanWorkerRequest,
  FloorPlanWorkerResponse,
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

/** A request in flight in the worker, with the parts needed to redo it here. */
type PendingPlan = { key: string; parts: PlanRequestParts };

export type PlanEngine = {
  result: ConvertResult;
  worker: Worker | null;
  workerFailed: boolean;
  cache: Map<string, PlanEntry>;
  /** Keys that neither the worker nor the main thread can draw. */
  failed: Set<string>;
  pending: Map<number, PendingPlan>;
  nextId: number;
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
      worker: null,
      workerFailed: false,
      cache: new Map(),
      failed: new Set(),
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
  if (engine.cache.has(key) || engine.failed.has(key)) return;
  for (const pending of engine.pending.values()) if (pending.key === key) return;
  if (engine.workerFailed) { resolveSynchronously(engine, key, parts); return; }
  if (!engine.worker) {
    try {
      const worker = new Worker(
        staticPlanWorkerUrl() ?? new URL("./floor-plan.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.addEventListener("message", (event: MessageEvent<FloorPlanWorkerResponse>) => {
        if (engine.worker !== worker) return;
        const pending = engine.pending.get(event.data.id);
        if (!pending) return;
        engine.pending.delete(event.data.id);
        if (event.data.error || !event.data.svg || !event.data.summary) {
          // Same treatment as the `error` event below. Dropping the request
          // here instead left the entry null with nothing pending, and the
          // effect cannot retry because neither the key nor the parts changed.
          resolveSynchronously(engine, pending.key, pending.parts);
          return;
        }
        engine.cache.set(pending.key, { svg: event.data.svg, summary: event.data.summary });
        engine.failed.delete(pending.key);
        notify(engine);
      });
      worker.addEventListener("error", () => {
        if (engine.worker !== worker) return;
        worker.terminate();
        engine.worker = null;
        engine.workerFailed = true;
        // Every request in flight died with the worker, not just the one that
        // happened to create it.
        const stranded = [...engine.pending.values()];
        engine.pending.clear();
        for (const request of stranded) {
          resolveSynchronously(engine, request.key, request.parts);
        }
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
  engine.pending.set(id, { key, parts });
  engine.worker.postMessage({
    type: "plan",
    id,
    levelId: parts.levelId,
    connectedLevelIds: [...parts.connectedLevelIds],
    rotationQuarterTurns: parts.rotationQuarterTurns,
    derivedRooms: parts.derivedRooms,
    roomLabels: parts.roomLabels ?? null,
    theme: parts.theme,
  } satisfies FloorPlanWorkerRequest);
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
        engine.worker?.terminate();
        engine.worker = null;
        engine.pending.clear();
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
