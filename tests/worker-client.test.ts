/**
 * The one stale-response guard the five worker clients now share.
 *
 * Every client used to re-derive this for itself — an id compared against a
 * captured request id, an id compared against a ref, worker identity plus a
 * pending map, and in the CAD decoder no check at all — and the gaps between
 * those four produced shipped bugs: an IFC comparison applied to the model that
 * replaced the one it was measured against, and a floor-region derivation filed
 * under a key nothing read. The guard is structural here: a reply is delivered
 * if and only if its id is still in the pending map, and every way a request
 * stops mattering is a deletion from that map.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WorkerClient } from "../lib/reviter/worker-client.ts";

type Posted = { id: number; type: string; payload?: string };

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: Posted[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  postMessage(message: Posted, transfer: Transferable[] = []) {
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string, event: unknown) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  reply(data: unknown) {
    this.emit("message", { data });
  }
}

type Reply = { value: string };

/** A client over `FakeWorker`, plus the log of everything its handlers saw. */
function clientUnderTest(options: { latestOnly?: boolean } = {}) {
  FakeWorker.instances = [];
  const seen: string[] = [];
  const client = new WorkerClient<Posted, Reply>({
    spawn: () => new FakeWorker() as unknown as Worker,
    startFailureMessage: "blocked",
    deathMessage: "died",
    unreadableMessage: "unreadable",
    latestOnly: options.latestOnly,
    onWorkerFailure: (message) => seen.push(`worker-failure:${message}`),
  });
  const handlers = (label: string) => ({
    onProgress: (progress: { ratio: number; message: string }) =>
      seen.push(`${label}:progress:${progress.ratio}:${progress.message}`),
    onResult: (result: Reply) => seen.push(`${label}:result:${result.value}`),
    onError: (message: string) => seen.push(`${label}:error:${message}`),
  });
  return { client, seen, handlers, worker: () => FakeWorker.instances.at(-1)! };
}

test("a superseded request's reply is dropped instead of landing on the newer one", () => {
  const { client, seen, handlers, worker } = clientUnderTest({ latestOnly: true });
  const first = client.send({ type: "convert", payload: "model-a" }, handlers("a"));
  const second = client.send({ type: "convert", payload: "model-b" }, handlers("b"));
  assert.equal(client.inFlight, 1, "only the newest request is still wanted");

  // Model A's conversion was already running and finishes anyway. This is the
  // bug shape: its answer must not be applied to the model now on screen.
  worker().reply({ id: first, type: "result", result: { value: "model-a" } });
  worker().reply({ id: first, type: "progress", ratio: 0.5, message: "late" });
  assert.deepEqual(seen, []);

  worker().reply({ id: second, type: "result", result: { value: "model-b" } });
  assert.deepEqual(seen, ["b:result:model-b"]);
  assert.equal(client.inFlight, 0);
});

test("cancel drops the answer, and says nothing to the caller that cancelled", () => {
  const { client, seen, handlers, worker } = clientUnderTest();
  const id = client.send({ type: "plan" }, handlers("plan"));
  client.cancel(id);

  worker().reply({ id, type: "progress", ratio: 0.5, message: "still going" });
  worker().reply({ id, type: "result", result: { value: "drawn" } });
  assert.deepEqual(seen, [], "a cancelled request is silent, not failed");
  assert.equal(worker().terminated, false, "cancelling is not stopping the work");
});

test("several requests in flight are each answered by their own handler", () => {
  // The plan worker deliberately keeps the visible floor and its prewarmed
  // neighbours in flight together, so nothing here supersedes anything.
  const { client, seen, handlers, worker } = clientUnderTest();
  const one = client.send({ type: "plan", payload: "level-1" }, handlers("one"));
  const two = client.send({ type: "plan", payload: "level-2" }, handlers("two"));
  assert.equal(client.inFlight, 2);
  assert.notEqual(one, two, "each request gets its own id");

  worker().reply({ id: two, type: "progress", ratio: 0.25, message: "drawing" });
  worker().reply({ id: one, type: "error", error: "no floor plate" });
  worker().reply({ id: two, type: "result", result: { value: "level-2" } });

  assert.deepEqual(seen, [
    "two:progress:0.25:drawing",
    "one:error:no floor plate",
    "two:result:level-2",
  ]);
  assert.equal(client.inFlight, 0);
});

test("a worker that dies fails everything it was serving, once, and is replaced", () => {
  const { client, seen, handlers, worker } = clientUnderTest();
  client.send({ type: "plan", payload: "level-1" }, handlers("one"));
  client.send({ type: "plan", payload: "level-2" }, handlers("two"));
  const dead = worker();
  dead.emit("error", { message: "" });

  assert.deepEqual(seen, ["worker-failure:died", "one:error:died", "two:error:died"]);
  assert.equal(dead.terminated, true);
  assert.equal(client.inFlight, 0);

  // A reply from the corpse is nobody's request any more.
  dead.reply({ id: 1, type: "result", result: { value: "too late" } });
  assert.equal(seen.length, 3);

  client.send({ type: "plan", payload: "level-3" }, handlers("three"));
  assert.notEqual(worker(), dead, "the next request gets a fresh worker");
  worker().reply({ id: 3, type: "result", result: { value: "level-3" } });
  assert.equal(seen.at(-1), "three:result:level-3");
});

test("a reply that cannot be read is reported as that, not as a worker that stopped", () => {
  const { client, seen, handlers, worker } = clientUnderTest();
  client.send({ type: "convert" }, handlers("convert"));
  worker().emit("messageerror", {});
  assert.deepEqual(seen, ["worker-failure:unreadable", "convert:error:unreadable"]);
});

test("a worker the browser blocks fails the request that needed it", () => {
  const seen: string[] = [];
  const client = new WorkerClient<Posted, Reply>({
    spawn: () => { throw new Error("blocked by policy"); },
    startFailureMessage: "blocked",
    deathMessage: "died",
    onWorkerFailure: (message) => seen.push(`worker-failure:${message}`),
  });
  assert.equal(client.start(), false);
  client.send({ type: "convert" }, {
    onResult: () => seen.push("result"),
    onError: (message) => seen.push(`error:${message}`),
  });
  assert.deepEqual(seen, [
    "worker-failure:blocked",
    "worker-failure:blocked",
    "error:blocked",
  ]);
  assert.equal(client.inFlight, 0);
});

test("the request carries the id it was given, and its transfer list", () => {
  const { client, handlers, worker } = clientUnderTest();
  const bytes = new ArrayBuffer(8);
  const id = client.send({ type: "dwg" }, handlers("dwg"), [bytes]);
  assert.deepEqual(worker().posted, [{ type: "dwg", id }]);
  assert.deepEqual(worker().transfers, [[bytes]]);
});

test("a message from a stranger is not a reply to anything", () => {
  // The floor-region worker had no discriminant on its request and its client
  // no id check on the reply, so anything posted at either was acted on.
  const { client, seen, handlers, worker } = clientUnderTest();
  client.send({ type: "regions" }, handlers("regions"));
  worker().reply({ hello: "from an extension" });
  worker().reply(undefined);
  worker().reply({ id: 999, type: "result", result: { value: "nobody asked" } });
  assert.deepEqual(seen, []);
  assert.equal(client.inFlight, 1, "the real request is still waiting");
});

test("terminate stops the worker and forgets what it was serving", () => {
  const { client, seen, handlers, worker } = clientUnderTest();
  client.send({ type: "convert" }, handlers("convert"));
  const stopped = worker();
  client.terminate();

  assert.equal(stopped.terminated, true);
  assert.equal(client.inFlight, 0);
  stopped.reply({ id: 1, type: "result", result: { value: "too late" } });
  assert.deepEqual(seen, [], "no failure is reported for work the caller ended");
});
