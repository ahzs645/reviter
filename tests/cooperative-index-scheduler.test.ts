import assert from "node:assert/strict";
import test from "node:test";

import {
  CooperativeIndexScheduler,
  type IndexSchedulerEnvironment,
} from "../app/studio/cooperative-index-scheduler.ts";

function controlledEnvironment() {
  let nextHandle = 1;
  const idle = new Map<number, () => void>();
  const tasks = new Map<number, () => void>();
  const environment: IndexSchedulerEnvironment = {
    requestIdle: (callback) => {
      const handle = nextHandle++;
      idle.set(handle, callback);
      return handle;
    },
    cancelIdle: (handle) => idle.delete(handle),
    scheduleTask: (callback) => {
      const handle = nextHandle++;
      tasks.set(handle, callback);
      return handle;
    },
    cancelTask: (handle) => tasks.delete(handle),
  };
  const runFirst = (callbacks: Map<number, () => void>) => {
    const entry = callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return;
    callbacks.delete(entry[0]);
    entry[1]();
  };
  return { environment, idle, tasks, runFirst };
}

test("idle prewarm promotes its pending yield when Walk is requested", async () => {
  const controlled = controlledEnvironment();
  const scheduler = new CooperativeIndexScheduler(controlled.environment);
  const yielded = scheduler.yield();
  assert.equal(controlled.idle.size, 1);
  assert.equal(controlled.tasks.size, 0);

  scheduler.promote();
  assert.equal(scheduler.priority, "foreground");
  assert.equal(controlled.idle.size, 0);
  assert.equal(controlled.tasks.size, 1);
  controlled.runFirst(controlled.tasks);
  assert.equal(await yielded, true);

  const nextYield = scheduler.yield();
  assert.equal(controlled.idle.size, 0);
  assert.equal(controlled.tasks.size, 1);
  controlled.runFirst(controlled.tasks);
  assert.equal(await nextYield, true);
  assert.equal(scheduler.yields, 2);
});

test("cancelling a source resolves and removes an outstanding idle yield", async () => {
  const controlled = controlledEnvironment();
  const scheduler = new CooperativeIndexScheduler(controlled.environment);
  const yielded = scheduler.yield();
  scheduler.cancel();

  assert.equal(await yielded, false);
  assert.equal(controlled.idle.size, 0);
  assert.equal(controlled.tasks.size, 0);
  assert.equal(await scheduler.yield(), false);
});

test("optional collision work can remain idle beside a promoted surface build", () => {
  const controlled = controlledEnvironment();
  const surface = new CooperativeIndexScheduler(controlled.environment);
  const collision = new CooperativeIndexScheduler(controlled.environment);
  void surface.yield();
  void collision.yield();
  surface.promote();

  assert.equal(surface.priority, "foreground");
  assert.equal(collision.priority, "idle");
  assert.equal(controlled.tasks.size, 1);
  assert.equal(controlled.idle.size, 1);
  surface.cancel();
  collision.cancel();
});
