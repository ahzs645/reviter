/**
 * The plan engine behind the floor browser and the mini-map. The React wrapper
 * around it is DOM behaviour and is checked in a browser, but the engine — what
 * happens to a request the worker cannot answer — is plain objects and a
 * `postMessage` pair, so it is pinned down here.
 *
 * The case that matters is a level with no floor plate. The worker replies with
 * an error for those routinely, and a reply that was dropped left the surface
 * waiting forever on a plan that was never coming: "Assembling floor plan…"
 * pinned on over the *previous* floor's drawing, whose bounds the mini-map then
 * used to convert clicks for the floor now selected.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  engineFor,
  planSnapshot,
  planStateFor,
  requestPlan,
  type PlanEngine,
} from "../app/studio/use-architectural-plan.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type PostedMessage = { type: string; id?: number };

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: PostedMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  /** What the worker would reply to, in the order the engine asked. */
  planRequests(): PostedMessage[] {
    return this.posted.filter((message) => message.type === "plan");
  }

  emitMessage(data: unknown) {
    for (const handler of this.listeners.get("message") ?? []) handler({ data });
  }

  emitError() {
    for (const handler of this.listeners.get("error") ?? []) handler({});
  }
}

function withFakeWorker<T>(body: () => T): T {
  const globals = globalThis as { Worker?: typeof Worker };
  const previous = globals.Worker;
  FakeWorker.instances = [];
  globals.Worker = FakeWorker as unknown as typeof Worker;
  try {
    return body();
  } finally {
    if (previous) globals.Worker = previous;
    else delete globals.Worker;
  }
}

/** A model whose only level has no recovered floor plate — the routine failure. */
function undrawableModel(): ConvertResult {
  return {
    levels: [{ levelId: 7, elevation: 0, name: "Level 7" }],
    nativeAssociatedLevelRelations: [],
    elementBounds: [],
  } as unknown as ConvertResult;
}

/** A model with one square floor plate, which the plan renderer can draw. */
function drawableModel(): ConvertResult {
  const corners = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]];
  return {
    levels: [{ levelId: 2, elevation: 0, name: "Level 1" }],
    nativeAssociatedLevelRelations: [{ elementId: 100, levelId: 2 }],
    elementBounds: [{
      elementId: 100,
      stream: "Floors/1",
      chunkIndex: 0,
      rawOffset: 0,
      recordOffset: 0,
      categoryId: -2_000_032,
      categoryName: "Floors",
      boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 1 } },
      loops: [corners],
    }],
  } as unknown as ConvertResult;
}

function partsFor(levelId: number) {
  return {
    levelId,
    connectedLevelIds: [levelId],
    rotationQuarterTurns: 0,
    derivedRooms: null,
    roomLabels: null,
    theme: "light" as const,
  };
}

function countNotifications(engine: PlanEngine): () => number {
  let notifications = 0;
  engine.listeners.add(() => { notifications += 1; });
  return () => notifications;
}

test("a plan the worker cannot draw ends the wait instead of hanging on it", () => {
  withFakeWorker(() => {
    const model = undrawableModel();
    const engine = engineFor(model);
    const notifications = countNotifications(engine);

    requestPlan(engine, "level-7", partsFor(7));
    const worker = FakeWorker.instances[0]!;
    assert.equal(worker.planRequests().length, 1);
    assert.equal(engine.inFlight.size, 1);
    assert.equal(planStateFor(planSnapshot(engine, "level-7"), null, "level-7").building, true);

    // What the worker posts for a level with no floor plate.
    worker.emitMessage({
      id: worker.planRequests()[0]!.id,
      type: "error",
      error: "Revit level 7 contains no recovered Floors sketch boundaries.",
    });

    assert.equal(engine.inFlight.size, 0, "the request is no longer in flight");
    assert.equal(engine.cache.has("level-7"), false, "there is no plan to cache");
    assert.equal(engine.failed.has("level-7"), true, "but the failure is recorded");
    assert.ok(notifications() > 0, "the surfaces are told the wait is over");

    const state = planStateFor(planSnapshot(engine, "level-7"), null, "level-7");
    assert.equal(state.building, false);
    assert.equal(state.svg, null);
  });
});

test("a failed plan is not re-posted to the worker on every effect run", () => {
  withFakeWorker(() => {
    const engine = engineFor(undrawableModel());
    requestPlan(engine, "level-7", partsFor(7));
    const worker = FakeWorker.instances[0]!;
    worker.emitMessage({ id: worker.planRequests()[0]!.id, type: "error", error: "no floor plate" });

    requestPlan(engine, "level-7", partsFor(7));
    requestPlan(engine, "level-7", partsFor(7));
    assert.equal(worker.planRequests().length, 1, "the same throw would only be repeated");
    assert.equal(engine.inFlight.size, 0);
  });
});

test("an error message and an error event are handled the same way", () => {
  withFakeWorker(() => {
    // Error event: every request in flight died with the worker, not just the
    // one that happened to create it.
    const eventEngine = engineFor(undrawableModel());
    requestPlan(eventEngine, "level-7", partsFor(7));
    requestPlan(eventEngine, "level-8", partsFor(8));
    const worker = FakeWorker.instances[0]!;
    assert.equal(eventEngine.inFlight.size, 2);
    worker.emitError();

    assert.equal(worker.terminated, true);
    assert.equal(eventEngine.workerFailed, true);
    assert.equal(eventEngine.inFlight.size, 0);
    assert.deepEqual([...eventEngine.failed].sort(), ["level-7", "level-8"]);

    // Error message: the same outcome for the surface that is waiting.
    const messageEngine = engineFor(undrawableModel());
    requestPlan(messageEngine, "level-7", partsFor(7));
    const second = FakeWorker.instances[1]!;
    second.emitMessage({ id: second.planRequests()[0]!.id, type: "error", error: "no floor plate" });

    assert.deepEqual(
      planStateFor(planSnapshot(messageEngine, "level-7"), null, "level-7"),
      planStateFor(planSnapshot(eventEngine, "level-7"), null, "level-7"),
    );
  });
});

test("a plan the worker returns is cached and ends the wait", () => {
  withFakeWorker(() => {
    const engine = engineFor(undrawableModel());
    const notifications = countNotifications(engine);
    requestPlan(engine, "level-7", partsFor(7));
    const worker = FakeWorker.instances[0]!;
    const summary = { levelId: 7, floors: 1 };

    worker.emitMessage({
      id: worker.planRequests()[0]!.id,
      type: "result",
      result: { svg: "<svg data-plan/>", summary },
    });

    assert.equal(engine.failed.has("level-7"), false);
    assert.equal(notifications(), 1);
    const state = planStateFor(planSnapshot(engine, "level-7"), null, "level-7");
    assert.equal(state.svg, "<svg data-plan/>");
    assert.equal(state.summary, summary);
    assert.equal(state.building, false);
  });
});

test("a request the worker failed is retried against the full model", () => {
  withFakeWorker(() => {
    // The worker only holds a category-filtered clone, so an error from it is
    // not proof the plan cannot be drawn — the retry happens here, and only a
    // failure here is recorded as one.
    const engine = engineFor(drawableModel());
    requestPlan(engine, "level-2", partsFor(2));
    const worker = FakeWorker.instances[0]!;

    worker.emitMessage({
      id: worker.planRequests()[0]!.id,
      type: "error",
      error: "the worker lost the floors",
    });

    assert.equal(engine.failed.has("level-2"), false, "the main thread could draw it");
    const state = planStateFor(planSnapshot(engine, "level-2"), null, "level-2");
    assert.equal(state.building, false);
    assert.equal(state.summary?.levelId, 2);
    // The drawing carries this floor's own frame, which is what the mini-map
    // measures clicks against.
    assert.match(state.svg ?? "", /data-plan-min-x-feet="-2\.5"/u);
  });
});

test("the previous floor is held over while assembling, and dropped once there is nothing to wait for", () => {
  withFakeWorker(() => {
    const engine = engineFor(undrawableModel());
    const previous = { svg: "<svg id='ground-floor'/>", summary: { levelId: 1 } as never };

    // Still assembling: the last drawing stays on screen.
    const waiting = planStateFor(null, previous, "level-7");
    assert.equal(waiting.svg, previous.svg);
    assert.equal(waiting.building, true);

    // Nothing to wait for: holding the old drawing over would also hold over
    // the bounds the mini-map reads out of it, and a click meant for this floor
    // would be resolved in the previous floor's frame.
    requestPlan(engine, "level-7", partsFor(7));
    const worker = FakeWorker.instances[0]!;
    worker.emitMessage({ id: worker.planRequests()[0]!.id, type: "error", error: "no floor plate" });
    const settled = planStateFor(planSnapshot(engine, "level-7"), previous, "level-7");
    assert.equal(settled.svg, null);
    assert.equal(settled.summary, null);
    assert.equal(settled.building, false);

    // No plan requested at all is not a wait either.
    assert.deepEqual(planStateFor(null, previous, null), {
      svg: null,
      summary: null,
      building: false,
    });
  });
});
