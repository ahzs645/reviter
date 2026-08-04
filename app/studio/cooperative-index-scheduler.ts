export type IndexSchedulerEnvironment = {
  requestIdle?: (callback: () => void, options: { timeout: number }) => number;
  cancelIdle?: (handle: number) => void;
  scheduleTask: (callback: () => void) => number;
  cancelTask: (handle: number) => void;
};

type PendingYield = {
  resolve: (active: boolean) => void;
  idleHandle?: number;
  taskHandle?: number;
};

/**
 * Cooperative scheduler for main-thread spatial-index construction.
 *
 * Prewarming yields to browser idle periods. If Walk is requested while a
 * surface build is in flight, `promote()` immediately reschedules the pending
 * yield as a zero-delay task and keeps subsequent chunks responsive without
 * paying an idle timeout for each one. Cancellation resolves a pending yield,
 * so an evicted or changed source can never publish stale data later.
 */
export class CooperativeIndexScheduler {
  private readonly environment: IndexSchedulerEnvironment;
  private pending: PendingYield | null = null;
  private cancelled = false;
  private foreground = false;
  private yieldCount = 0;

  constructor(environment: IndexSchedulerEnvironment) {
    this.environment = environment;
  }

  get priority(): "idle" | "foreground" {
    return this.foreground ? "foreground" : "idle";
  }

  get yields(): number {
    return this.yieldCount;
  }

  yield(): Promise<boolean> {
    if (this.cancelled) return Promise.resolve(false);
    if (this.pending) throw new Error("Index scheduler yields must be sequential");
    this.yieldCount += 1;
    return new Promise<boolean>((resolve) => {
      this.pending = { resolve };
      this.schedulePending();
    });
  }

  promote(): void {
    if (this.cancelled || this.foreground) return;
    this.foreground = true;
    const pending = this.pending;
    if (!pending || pending.idleHandle == null) return;
    this.environment.cancelIdle?.(pending.idleHandle);
    delete pending.idleHandle;
    pending.taskHandle = this.environment.scheduleTask(() => this.complete(pending));
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    const pending = this.pending;
    if (!pending) return;
    if (pending.idleHandle != null) this.environment.cancelIdle?.(pending.idleHandle);
    if (pending.taskHandle != null) this.environment.cancelTask(pending.taskHandle);
    this.pending = null;
    pending.resolve(false);
  }

  private schedulePending(): void {
    const pending = this.pending;
    if (!pending) return;
    if (!this.foreground && this.environment.requestIdle) {
      pending.idleHandle = this.environment.requestIdle(
        () => this.complete(pending),
        { timeout: 50 },
      );
      return;
    }
    pending.taskHandle = this.environment.scheduleTask(() => this.complete(pending));
  }

  private complete(pending: PendingYield): void {
    if (this.pending !== pending) return;
    this.pending = null;
    pending.resolve(!this.cancelled);
  }
}

export function browserIndexSchedulerEnvironment(): IndexSchedulerEnvironment {
  let nextTaskHandle = 1;
  const tasks = new Map<number, () => void>();
  const channel = new MessageChannel();
  channel.port1.onmessage = (event: MessageEvent<number>) => {
    const callback = tasks.get(event.data);
    if (!callback) return;
    tasks.delete(event.data);
    callback();
  };
  return {
    requestIdle: typeof window.requestIdleCallback === "function"
      ? (callback, options) => window.requestIdleCallback(callback, options)
      : undefined,
    cancelIdle: typeof window.cancelIdleCallback === "function"
      ? (handle) => window.cancelIdleCallback(handle)
      : undefined,
    // MessageChannel posts a new task without the nested setTimeout clamp. It
    // still yields to input and rendering between chunks, but a promoted Walk
    // build does not accumulate several milliseconds of timer delay per slice.
    scheduleTask: (callback) => {
      const handle = nextTaskHandle++;
      tasks.set(handle, callback);
      channel.port2.postMessage(handle);
      return handle;
    },
    cancelTask: (handle) => tasks.delete(handle),
  };
}
