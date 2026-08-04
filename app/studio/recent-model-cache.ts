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

async function pruneCache(database: IDBDatabase): Promise<void> {
  const read = database.transaction(STORE_NAME, "readonly");
  const readDone = transactionDone(read);
  const all = await requestResult(read.objectStore(STORE_NAME).getAll());
  await readDone;
  if (!Array.isArray(all) || all.length <= CACHE_LIMIT) return;
  const stale = all
    .filter(isStoredRecentModel)
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(CACHE_LIMIT);
  if (!stale.length) return;
  const remove = database.transaction(STORE_NAME, "readwrite");
  const removeDone = transactionDone(remove);
  for (const entry of stale) remove.objectStore(STORE_NAME).delete(entry.key);
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
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
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
    store.put(record);
    const saved = await done;
    // Keep storage bounded by the same number of rows shown in Recent. This is
    // based on cachedAt rather than key ordering, so reopening a model refreshes
    // its place in the LRU set.
    if (saved) await pruneCache(database);
    return saved;
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
