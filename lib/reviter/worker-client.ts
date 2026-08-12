/**
 * One protocol, and one client, for every worker Reviter runs.
 *
 * Five workers used to restate the same three-message protocol five times, and
 * with it five ways of deciding whether a reply still mattered: comparing an id
 * against a captured request id, comparing it against a ref, comparing worker
 * identity against a pending map, and — in the decoder — not checking at all.
 * Two shipped bugs came out of that gap between the strategies, so the guard
 * lives here now: a reply is delivered if and only if its id is still in this
 * client's pending map, and every way a request can stop mattering (a newer one
 * superseding it, an explicit `cancel`, the worker dying) is a deletion from
 * that one map.
 */

/**
 * How far along a worker says it is.
 *
 * `ratio` is the worker's own estimate, in [0, 1]. Workers that can measure
 * their input report a real fraction of it; a worker that can only tell which
 * of its fixed stages it has reached reports the fraction of stages entered,
 * which is monotonic but says nothing about time — see the DWG decoder, where
 * one stage of six holds nearly all the wall clock. Do not read a ratio as an
 * estimate of how long is left.
 */
export type WorkerProgress = {
  ratio: number;
  message: string;
};

/**
 * The only shape a Reviter worker replies in. `Result` is the one thing that
 * differs between workers; `id` identifies the request being answered, and is
 * what makes a stale reply recognisable as one.
 */
export type WorkerEnvelope<Result> =
  | ({ id: number; type: "progress" } & WorkerProgress)
  | { id: number; type: "result"; result: Result }
  | { id: number; type: "error"; error: string };

/** The shape every request shares: an id this client allocates, and a kind. */
export type WorkerRequestEnvelope = { id: number; type: string };

export type WorkerRequestHandlers<Result> = {
  onProgress?: (progress: WorkerProgress) => void;
  /** Called once, for the one reply that settles this request. */
  onResult: (result: Result) => void;
  /**
   * Called once for anything that means no result is coming: an error the
   * worker reported, a worker that died or could not start, or a reply that
   * could not be deserialised. Never called after `onResult`, and never called
   * for a request that was cancelled — a cancelled request is silent.
   */
  onError: (message: string) => void;
};

export type WorkerClientOptions = {
  /**
   * Make the worker. Called on the first request and again after one dies, so
   * anything the worker needs before its first request — a model to hold, say —
   * belongs in here rather than at the call site.
   */
  spawn: () => Worker;
  /** Reported when `spawn` throws, i.e. when the browser blocked the worker. */
  startFailureMessage: string;
  /** Reported when the worker dies without saying why. */
  deathMessage: string;
  /**
   * Reported when a reply arrives that cannot be deserialised — a different
   * failure from a worker that stopped, and worth saying so where the text
   * reaches the user. Defaults to `deathMessage`.
   */
  unreadableMessage?: string;
  /**
   * Retire the requests still in flight whenever a new one is sent. For the
   * clients where only the newest answer can still be wanted — opening a model,
   * switching floors — this is what keeps a slow earlier reply from landing on
   * top of a newer one. Off by default: the plan worker deliberately keeps
   * several requests in flight and wants every one of them.
   */
  latestOnly?: boolean;
  /**
   * The worker itself is gone: it died, or it could not be started. Called
   * before the requests in flight are failed individually, so a caller that
   * wants to stop using the worker altogether can decide that first. The client
   * has already dropped the worker by this point and will spawn a fresh one on
   * the next request.
   */
  onWorkerFailure?: (message: string) => void;
};

/**
 * A worker, the requests in flight to it, and nothing else.
 *
 * The client owns id allocation, the stale-reply guard, progress routing, both
 * failure events, cancellation and termination. It owns no policy: whether a
 * failed request is retried on the main thread, and whether a worker that died
 * is worth spawning again, stay with the caller.
 *
 * Lifecycle is the caller's too. The worker is spawned on the first request
 * (or on `start`), and lives until `terminate`. A caller that wants one worker
 * per request — the DWG decoder does, because its decoder holds a drawing's
 * worth of WASM heap — makes a client per request and terminates it on settle,
 * and pays nothing for pooling it never asked for.
 */
export class WorkerClient<Request extends WorkerRequestEnvelope, Result> {
  readonly #options: WorkerClientOptions;
  readonly #pending = new Map<number, WorkerRequestHandlers<Result>>();
  #worker: Worker | null = null;
  #nextId = 1;

  constructor(options: WorkerClientOptions) {
    this.#options = options;
  }

  /** How many requests are still expecting a reply. Exported for tests. */
  get inFlight(): number {
    return this.#pending.size;
  }

  /**
   * Spawn the worker now, without sending anything, so its module graph loads
   * while the caller finishes reading the file it is about to send. Returns
   * false when the browser blocked the worker.
   */
  start(): boolean {
    return this.#worker !== null || this.#spawn() !== null;
  }

  /**
   * Send one request and route its replies to `handlers`. Returns the id the
   * request was given, which `cancel` takes.
   */
  send(
    body: Omit<Request, "id">,
    handlers: WorkerRequestHandlers<Result>,
    transfer: Transferable[] = [],
  ): number {
    if (this.#options.latestOnly) this.cancel();
    const id = this.#nextId++;
    const worker = this.#worker ?? this.#spawn();
    if (!worker) {
      handlers.onError(this.#options.startFailureMessage);
      return id;
    }
    this.#pending.set(id, handlers);
    worker.postMessage({ ...body, id }, transfer);
    return id;
  }

  /**
   * Stop waiting for a reply: for one request, or for every request in flight.
   *
   * This drops the answer, not the work. A worker already inside a synchronous
   * conversion runs it to completion — `convertRvtBytes` cannot be interrupted,
   * and neither can LibreDWG — and its reply is discarded when it arrives. What
   * cancelling buys is that the stale answer can no longer be applied to the
   * wrong model, and that a queue of superseded requests settles into nothing
   * instead of redrawing the screen N times. To actually stop the work, the
   * worker has to go: `terminate`.
   */
  cancel(id?: number): void {
    if (id == null) this.#pending.clear();
    else this.#pending.delete(id);
  }

  /** Stop the worker and forget every request in flight. */
  terminate(): void {
    this.#discardWorker();
    this.#pending.clear();
  }

  #spawn(): Worker | null {
    let worker: Worker;
    try {
      worker = this.#options.spawn();
    } catch {
      this.#fail(this.#options.startFailureMessage);
      return null;
    }
    worker.addEventListener("message", (event: MessageEvent<WorkerEnvelope<Result>>) => {
      if (this.#worker !== worker) return;
      const message = event.data;
      // The whole stale guard, in one line: an id nobody is waiting for belongs
      // to a request that has been superseded, cancelled, or already answered —
      // or to no request of ours at all.
      const handlers = message && this.#pending.get(message.id);
      if (!handlers) return;
      if (message.type === "progress") {
        handlers.onProgress?.(message);
        return;
      }
      this.#pending.delete(message.id);
      if (message.type === "error") handlers.onError(message.error);
      else handlers.onResult(message.result);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      if (this.#worker !== worker) return;
      this.#fail(event.message || this.#options.deathMessage);
    });
    worker.addEventListener("messageerror", () => {
      // A reply that cannot be deserialised names no request, so it fails every
      // request in flight. Left unhandled — as it was in three of the five
      // clients — it fails nothing, and the caller waits for a reply that has
      // already been delivered and thrown away.
      if (this.#worker !== worker) return;
      this.#fail(this.#options.unreadableMessage ?? this.#options.deathMessage);
    });
    this.#worker = worker;
    return worker;
  }

  /** The worker is gone: tell the caller, then fail everything it was serving. */
  #fail(message: string): void {
    this.#discardWorker();
    const stranded = [...this.#pending.values()];
    this.#pending.clear();
    this.#options.onWorkerFailure?.(message);
    for (const handlers of stranded) handlers.onError(message);
  }

  #discardWorker(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
