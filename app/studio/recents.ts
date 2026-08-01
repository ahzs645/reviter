/**
 * The recent-files list behind the empty state.
 *
 * Only a description of the file is kept — name, size, release, when it was
 * opened and how the recovery went. A File System Access handle cannot be
 * persisted in every browser this runs in, so a recent row re-opens the file
 * picker rather than pretending it can read the file again on its own.
 */

export type RecentStatus = "ready" | "partial";

export type RecentFile = {
  name: string;
  size: number;
  revitVersion: string | null;
  openedAt: number;
  status: RecentStatus;
};

const STORAGE_KEY = "reviter.recent-files.v1";
const LIMIT = 5;

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentFile>;
  return typeof entry.name === "string"
    && typeof entry.size === "number"
    && Number.isFinite(entry.size)
    && (entry.revitVersion == null || typeof entry.revitVersion === "string")
    && typeof entry.openedAt === "number"
    && (entry.status === "ready" || entry.status === "partial");
}

export function loadRecentFiles(): RecentFile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentFile).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentFiles(files: readonly RecentFile[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(files.slice(0, LIMIT)));
  } catch {
    // The list is a convenience; losing it is not worth an error.
  }
}

/** The same file opened twice is one row, moved to the top and re-stamped. */
export function mergeRecentFile(
  current: readonly RecentFile[],
  entry: RecentFile,
): RecentFile[] {
  const rest = current.filter((file) => !(file.name === entry.name && file.size === entry.size));
  return [entry, ...rest].slice(0, LIMIT);
}

/**
 * The list as an external store.
 *
 * `localStorage` is not readable while the page is server-rendered, so the list
 * cannot be React state initialised from it without the two renders disagreeing.
 * `useSyncExternalStore` is the shape React provides for exactly this: an empty
 * list is the server snapshot, the stored list is the client one, and the
 * hand-off between them is a re-render rather than a hydration mismatch.
 */
let cache: RecentFile[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: RecentFile[] = [];

export function recentFilesSnapshot(): RecentFile[] {
  if (!cache) cache = loadRecentFiles();
  return cache;
}

export function recentFilesServerSnapshot(): RecentFile[] {
  return EMPTY;
}

export function subscribeToRecentFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function recordRecentFile(entry: RecentFile): void {
  cache = mergeRecentFile(recentFilesSnapshot(), entry);
  saveRecentFiles(cache);
  for (const listener of listeners) listener();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2 h ago" — the coarse, mono-width stamp the recent list is built around. */
export function relativeTime(from: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - from);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.floor(days / 7)} weeks ago`;
}

export function fileExtensionLabel(name: string): string {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase().slice(0, 4) : "FILE";
}
