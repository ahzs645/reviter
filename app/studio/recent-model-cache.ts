import type { ConvertResult } from "../../lib/reviter/types.ts";
import type { RecentFile } from "./recents.ts";

/**
 * The browser cache is intentionally separate from the small Recent index in
 * localStorage. IndexedDB can retain the source Blob and typed-array-heavy
 * conversion result, while localStorage lets the empty state render its five
 * labels synchronously during hydration.
 */
const DATABASE_NAME = "reviter.recent-models";
const DATABASE_VERSION = 1;
const STORE_NAME = "models";
const CACHE_LIMIT = 5;
// Increment whenever the serialized ConvertResult shape or recovery semantics
// change. This remains an explicit invalidation lever in addition to the build
// or page-session version below.
const PARSER_CACHE_SCHEMA = 2;
// Hosts without an injected deployment id (notably the local dev server) get
// one stable id for this JavaScript runtime. Recent opens in the same page can
// reuse a parse, while a full refresh creates a new id and reparses from the
// retained source Blob. A refresh is also what replaces an already-running
// conversion worker after parser code changes.
const runtimeNonce = Math.random().toString(36).slice(2) || "0";
const UNSTAMPED_RUNTIME_VERSION = `session-${Date.now().toString(36)}-${runtimeNonce}`;

type StoredRecentModel = {
  key: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  source: Blob;
  result?: ConvertResult;
  parserVersion: string;
  cachedAt: number;
};

export type CachedRecentModel = {
  file: File;
  /** Null means that the source is available but this deployment must reparse it. */
  result: ConvertResult | null;
};

declare global {
  // Set by the static GitHub Pages entry before React is mounted. Other hosts
  // use a page-session id until they provide their own build id.
  var __REVITER_BUILD_VERSION__: string | undefined;
}

export function currentParserCacheVersion(): string {
  return `${PARSER_CACHE_SCHEMA}:${globalThis.__REVITER_BUILD_VERSION__ ?? UNSTAMPED_RUNTIME_VERSION}`;
}

export function recentModelCacheKey(
  file: Pick<RecentFile, "name" | "size" | "lastModified">,
): string {
  return JSON.stringify([file.name, file.size, file.lastModified ?? 0]);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

/**
 * Keep storage bounded by the same number of rows shown in Recent, dropping the
 * least recently opened first. Ordering is by cachedAt rather than by key, so
 * reopening a model refreshes its place in the LRU set.
 *
 * `incomingKey` is the row that is about to be written: a slot is reserved for
 * it, because a store that is already at the limit has to give something up
 * before the next put can fit rather than after.
 */
async function pruneCache(database: IDBDatabase, incomingKey?: string): Promise<void> {
  const read = database.transaction(STORE_NAME, "readonly");
  const readDone = transactionDone(read);
  const store = read.objectStore(STORE_NAME);
  // Both requests are issued before either is awaited, so the read transaction
  // is never asked to stay alive across a turn of the event loop.
  const valuesPending = requestResult(store.getAll());
  const keysPending = requestResult(store.getAllKeys());
  await readDone;
  const values = await valuesPending;
  const keys = await keysPending;
  if (!Array.isArray(values) || !Array.isArray(keys) || values.length !== keys.length) return;

  const doomed: IDBValidKey[] = [];
  const live: { key: IDBValidKey; cachedAt: number }[] = [];
  for (const [index, value] of values.entries()) {
    const key = keys[index]!;
    // A row that no longer parses can never be served, so it is deleted on
    // sight instead of counting against the budget. Counting them was enough
    // to let a handful of corrupt rows occupy the cache permanently.
    if (isStoredRecentModel(value)) live.push({ key, cachedAt: value.cachedAt });
    else doomed.push(key);
  }
  const budget = CACHE_LIMIT - (incomingKey == null ? 0 : 1);
  const others = live
    .filter((row) => row.key !== incomingKey)
    .sort((a, b) => b.cachedAt - a.cachedAt);
  for (const row of others.slice(budget)) doomed.push(row.key);

  if (!doomed.length) return;
  const remove = database.transaction(STORE_NAME, "readwrite");
  const removeDone = transactionDone(remove);
  for (const key of doomed) remove.objectStore(STORE_NAME).delete(key);
  await removeDone;
}

function isStoredRecentModel(value: unknown): value is StoredRecentModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredRecentModel>;
  return typeof record.key === "string"
    && typeof record.name === "string"
    && typeof record.size === "number"
    && typeof record.type === "string"
    && typeof record.lastModified === "number"
    && record.source instanceof Blob
    && typeof record.parserVersion === "string"
    && typeof record.cachedAt === "number"
    && (record.result == null || record.result.ok === true);
}

export async function loadCachedRecentModel(
  file: Pick<RecentFile, "name" | "size" | "lastModified">,
): Promise<CachedRecentModel | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const stored = await requestResult(
      transaction.objectStore(STORE_NAME).get(recentModelCacheKey(file)),
    );
    if (!isStoredRecentModel(stored)) return null;
    const source = new File([stored.source], stored.name, {
      type: stored.type,
      lastModified: stored.lastModified,
    });
    return {
      file: source,
      result: stored.parserVersion === currentParserCacheVersion()
        ? stored.result ?? null
        : null,
    };
  } catch {
    return null;
  } finally {
    database.close();
  }
}

async function storeRecentModel(
  file: File,
  result: ConvertResult | undefined,
): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    const record: StoredRecentModel = {
      key: recentModelCacheKey({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }),
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      source: file,
      result,
      parserVersion: currentParserCacheVersion(),
      cachedAt: Date.now(),
    };
    // Prune before the write, never after it. A full store rejects the put with
    // a QuotaExceededError, which aborts the transaction — so eviction gated on
    // that write is starved by exactly the condition it exists to relieve, and
    // the cache stays wedged full until the browser evicts the whole origin.
    await pruneCache(database, record.key);
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    return await done;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export function cacheRecentModel(file: File, result: ConvertResult): Promise<boolean> {
  return storeRecentModel(file, result);
}

/** Retain a retryable source even when conversion ended with a partial/error row. */
export function cacheRecentSource(file: File): Promise<boolean> {
  return storeRecentModel(file, undefined);
}

export async function deleteCachedRecentModel(
  file: Pick<RecentFile, "name" | "size" | "lastModified">,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(recentModelCacheKey(file));
    await done;
  } catch {
    // Cache deletion is best effort; the row has already left the visible index.
  } finally {
    database.close();
  }
}

export async function clearCachedRecentModels(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).clear();
    await done;
  } catch {
    // Cache deletion is best effort; the visible Recent index is already empty.
  } finally {
    database.close();
  }
}
