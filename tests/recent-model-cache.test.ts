import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheRecentModel,
  cacheRecentSource,
  currentParserCacheVersion,
  loadCachedRecentModel,
  recentModelCacheKey,
} from "../app/studio/recent-model-cache.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

test("the parsed cache version follows the deployed build", () => {
  const previous = globalThis.__REVITER_BUILD_VERSION__;
  try {
    globalThis.__REVITER_BUILD_VERSION__ = "commit-a";
    assert.equal(currentParserCacheVersion(), "2:commit-a");
    globalThis.__REVITER_BUILD_VERSION__ = "commit-b";
    assert.equal(currentParserCacheVersion(), "2:commit-b");
  } finally {
    globalThis.__REVITER_BUILD_VERSION__ = previous;
  }
});

test("an unstamped dev runtime has a stable page-session version", () => {
  const previous = globalThis.__REVITER_BUILD_VERSION__;
  try {
    globalThis.__REVITER_BUILD_VERSION__ = undefined;
    const first = currentParserCacheVersion();
    assert.equal(currentParserCacheVersion(), first);
    assert.match(first, /^2:session-[a-z0-9]+-[a-z0-9]+$/);
    assert.notEqual(first, "2:development");
  } finally {
    globalThis.__REVITER_BUILD_VERSION__ = previous;
  }
});

test("cache keys distinguish revisions without exposing file contents", () => {
  const first = recentModelCacheKey({ name: "Model.rvt", size: 123, lastModified: 1 });
  const second = recentModelCacheKey({ name: "Model.rvt", size: 123, lastModified: 2 });
  assert.notEqual(first, second);
  assert.equal(first, '["Model.rvt",123,1]');
});

/*
 * Everything below drives the IndexedDB half of the cache against an in-memory
 * stand-in. The point of the stand-in is its failure mode: a store that refuses
 * writes once it is full is the condition the cache has to survive, and there
 * is no way to reach it from Node otherwise.
 */

const STORE_NAME = "models";
const CACHE_LIMIT = 5;

type StoredRow = Record<string, unknown>;

class FakeRequest<T> {
  result: T | undefined = undefined;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeObjectStore {
  readonly transaction: FakeTransaction;
  readonly rows: Map<string, StoredRow>;

  constructor(transaction: FakeTransaction, rows: Map<string, StoredRow>) {
    this.transaction = transaction;
    this.rows = rows;
  }

  private orderedKeys(): string[] {
    return [...this.rows.keys()].sort();
  }

  put(record: StoredRow) {
    return this.transaction.enqueue(() => {
      const key = record.key;
      if (typeof key !== "string") throw new Error("DataError");
      this.transaction.database.admit(key, record, this.rows);
      this.rows.set(key, record);
      return key;
    });
  }

  get(key: string) {
    return this.transaction.enqueue(() => this.rows.get(key));
  }

  getAll() {
    return this.transaction.enqueue(() => this.orderedKeys().map((key) => this.rows.get(key)!));
  }

  getAllKeys() {
    return this.transaction.enqueue(() => this.orderedKeys());
  }

  delete(key: string) {
    return this.transaction.enqueue(() => void this.rows.delete(key));
  }

  clear() {
    return this.transaction.enqueue(() => void this.rows.clear());
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private readonly queue: (() => void)[] = [];
  private scheduled = false;
  private settled = false;
  readonly database: FakeDatabase;

  constructor(database: FakeDatabase) {
    this.database = database;
  }

  objectStore(name: string): FakeObjectStore {
    const rows = this.database.stores.get(name);
    if (!rows) throw new Error(`NotFoundError: ${name}`);
    return new FakeObjectStore(this, rows);
  }

  enqueue<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.queue.push(() => {
      try {
        request.result = run();
        request.onsuccess?.();
      } catch {
        // An unhandled request error aborts the transaction it belongs to,
        // which is what a quota rejection does to the write that provoked it.
        request.onerror?.();
        this.settled = true;
        this.onerror?.();
      }
    });
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.drain());
    }
    return request;
  }

  private drain() {
    for (const operation of this.queue) {
      if (this.settled) return;
      operation();
    }
    this.queue.length = 0;
    if (this.settled) return;
    this.settled = true;
    this.oncomplete?.();
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, StoredRow>>();
  readonly objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  /** Bytes of source the store holds before it starts rejecting writes. */
  quotaBytes = Number.POSITIVE_INFINITY;
  /** A store that cannot grow at all, whatever room is made for it. */
  rejectWrites = false;
  writeAttempts = 0;
  closed = false;

  createObjectStore(name: string) {
    this.stores.set(name, new Map());
  }

  transaction() {
    if (this.closed) throw new Error("InvalidStateError: the database is closed");
    return new FakeTransaction(this);
  }

  close() {
    this.closed = true;
  }

  private static sizeOf(record: StoredRow): number {
    return record.source instanceof Blob ? record.source.size : 0;
  }

  /** The quota check a real store applies at write time. */
  admit(key: string, record: StoredRow, rows: Map<string, StoredRow>) {
    this.writeAttempts += 1;
    if (this.rejectWrites) throw new Error("QuotaExceededError");
    let used = 0;
    for (const [existing, row] of rows) if (existing !== key) used += FakeDatabase.sizeOf(row);
    if (used + FakeDatabase.sizeOf(record) > this.quotaBytes) {
      throw new Error("QuotaExceededError");
    }
  }

  rows(): StoredRow[] {
    return [...(this.stores.get(STORE_NAME)?.values() ?? [])];
  }

  keys(): string[] {
    return this.rows().map((row) => String(row.key)).sort();
  }
}

/**
 * Install the fake factory plus a monotonic clock — rows are ordered by
 * `cachedAt`, and real millisecond stamps collide inside one test — then put
 * both back.
 */
async function withFakeIndexedDb(body: (database: FakeDatabase) => Promise<void>): Promise<void> {
  const database = new FakeDatabase();
  const globals = globalThis as { indexedDB?: IDBFactory };
  const previousFactory = globals.indexedDB;
  const previousNow = Date.now;
  let clock = 1_700_000_000_000;
  Date.now = () => (clock += 1_000);
  globals.indexedDB = {
    open: () => {
      const request = {
        result: database,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (!database.stores.size) request.onupgradeneeded?.();
        // Every open of the cache is a fresh handle onto the same store.
        database.closed = false;
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  try {
    await body(database);
  } finally {
    Date.now = previousNow;
    if (previousFactory) globals.indexedDB = previousFactory;
    else delete globals.indexedDB;
  }
}

function sourceFile(name: string, bytes: number): File {
  return new File(["x".repeat(bytes)], name, { type: "application/rvt", lastModified: 1 });
}

function keyOf(name: string, bytes: number): string {
  return recentModelCacheKey({ name, size: bytes, lastModified: 1 });
}

/** A row that parses, seeded straight into the store like an earlier session's. */
function seedRow(database: FakeDatabase, name: string, bytes: number, cachedAt: number) {
  const store = database.stores.get(STORE_NAME) ?? new Map<string, StoredRow>();
  database.stores.set(STORE_NAME, store);
  store.set(keyOf(name, bytes), {
    key: keyOf(name, bytes),
    name,
    size: bytes,
    type: "application/rvt",
    lastModified: 1,
    source: new Blob(["x".repeat(bytes)]),
    parserVersion: currentParserCacheVersion(),
    cachedAt,
  });
}

/** A row that no longer parses — a leftover from an older stored shape. */
function seedCorruptRow(database: FakeDatabase, key: string) {
  const store = database.stores.get(STORE_NAME) ?? new Map<string, StoredRow>();
  database.stores.set(STORE_NAME, store);
  store.set(key, { key, name: "Legacy.rvt", cachedAt: 1 });
}

test("a full cache evicts to make room for the next model instead of rejecting it", async () => {
  await withFakeIndexedDb(async (database) => {
    // Five twenty-byte sources exactly fill the quota, so the sixth can only
    // land if something is given up first.
    database.quotaBytes = 100;
    for (let index = 0; index < CACHE_LIMIT; index += 1) {
      assert.equal(await cacheRecentSource(sourceFile(`Model-${index}.rvt`, 20)), true);
    }
    assert.equal(database.rows().length, CACHE_LIMIT);

    assert.equal(await cacheRecentSource(sourceFile("Model-5.rvt", 20)), true);
    assert.equal(database.rows().length, CACHE_LIMIT);
    assert.ok(database.keys().includes(keyOf("Model-5.rvt", 20)));
    // The oldest went, and only the oldest.
    assert.ok(!database.keys().includes(keyOf("Model-0.rvt", 20)));
    assert.ok(database.keys().includes(keyOf("Model-1.rvt", 20)));
  });
});

test("eviction still runs when the write itself is rejected", async () => {
  await withFakeIndexedDb(async (database) => {
    for (let index = 0; index < CACHE_LIMIT; index += 1) {
      await cacheRecentSource(sourceFile(`Model-${index}.rvt`, 20));
    }
    // A store that refuses every write is the deadlock this cache used to fall
    // into: pruning was gated on the write, and the write is what quota blocks.
    database.rejectWrites = true;
    database.writeAttempts = 0;

    assert.equal(await cacheRecentSource(sourceFile("Model-5.rvt", 20)), false);
    assert.equal(database.writeAttempts, 1, "the write was attempted and refused");
    assert.equal(database.rows().length, CACHE_LIMIT - 1, "the write failed, eviction did not");
    assert.ok(!database.keys().includes(keyOf("Model-0.rvt", 20)));

    // Pruning down to a reserved slot is bounded: repeated refusals free the
    // one slot the incoming row needs and then stop draining the cache.
    assert.equal(await cacheRecentSource(sourceFile("Model-6.rvt", 20)), false);
    assert.equal(database.rows().length, CACHE_LIMIT - 1);

    // And the room that was made is real, so the cache recovers on its own the
    // moment the store accepts writes again.
    database.rejectWrites = false;
    assert.equal(await cacheRecentSource(sourceFile("Model-5.rvt", 20)), true);
    assert.equal(database.rows().length, CACHE_LIMIT);
    assert.ok(database.keys().includes(keyOf("Model-5.rvt", 20)));
  });
});

test("rows that no longer parse are dropped rather than counted against the limit", async () => {
  await withFakeIndexedDb(async (database) => {
    seedCorruptRow(database, '["Legacy-a.rvt",1,1]');
    seedCorruptRow(database, '["Legacy-b.rvt",2,1]');
    seedCorruptRow(database, '["Legacy-c.rvt",3,1]');
    seedRow(database, "Keep-a.rvt", 20, 10);
    seedRow(database, "Keep-b.rvt", 20, 20);
    assert.equal(database.rows().length, 5);

    assert.equal(await cacheRecentSource(sourceFile("Fresh.rvt", 20)), true);
    assert.deepEqual(database.keys(), [
      keyOf("Fresh.rvt", 20),
      keyOf("Keep-a.rvt", 20),
      keyOf("Keep-b.rvt", 20),
    ].sort());
  });
});

test("reopening a cached model refreshes it without evicting a neighbour", async () => {
  await withFakeIndexedDb(async (database) => {
    for (let index = 0; index < CACHE_LIMIT; index += 1) {
      seedRow(database, `Model-${index}.rvt`, 20, 10 + index);
    }
    const before = database.keys();

    assert.equal(await cacheRecentSource(sourceFile("Model-0.rvt", 20)), true);
    assert.deepEqual(database.keys(), before, "the reserved slot is the row being rewritten");
    assert.equal(database.rows().length, CACHE_LIMIT);
  });
});

test("a cached model round-trips, and a stale parser version keeps only the source", async () => {
  await withFakeIndexedDb(async (database) => {
    const previous = globalThis.__REVITER_BUILD_VERSION__;
    try {
      globalThis.__REVITER_BUILD_VERSION__ = "commit-a";
      const file = sourceFile("Tower.rvt", 32);
      const result = { ok: true, levels: [] } as unknown as ConvertResult;
      assert.equal(await cacheRecentModel(file, result), true);

      const hit = await loadCachedRecentModel({ name: "Tower.rvt", size: 32, lastModified: 1 });
      assert.ok(hit);
      assert.equal(hit.file.name, "Tower.rvt");
      assert.equal(hit.file.size, 32);
      assert.equal((hit.result as { ok?: boolean } | null)?.ok, true);

      // A new deployment keeps the retained source but must reparse it.
      globalThis.__REVITER_BUILD_VERSION__ = "commit-b";
      const stale = await loadCachedRecentModel({ name: "Tower.rvt", size: 32, lastModified: 1 });
      assert.ok(stale);
      assert.equal(stale.result, null);
      assert.equal(stale.file.size, 32);
      assert.equal(database.rows().length, 1);
    } finally {
      globalThis.__REVITER_BUILD_VERSION__ = previous;
    }
  });
});
