/**
 * Reviewer assertions, kept per model in local storage.
 *
 * Keyed to the source bytes, never uploaded, and readable back into the studio
 * the next time the same file is opened. Names and lengths do not establish
 * identity: two revisions can have both in common. Assertions are about a particular
 * building, so they belong to the model rather than to the person — unlike
 * `viewer-preferences.ts`, which follows the reviewer between files.
 *
 * Only the current assertions are persisted, not the undo history. A reload is
 * a session boundary; restoring an undo stack across it would offer to undo
 * something the reviewer did days ago and no longer remembers doing.
 */
import { isElementOverride, mergeElementOverrides, type ElementOverride } from "../../lib/reviter/element-overrides.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";

const STORAGE_PREFIX = "reviter.element-overrides.v2";

type ModelIdentity = Pick<ConvertResult, "fileName" | "byteLength"> & { sourceSha256?: string };

export function elementOverrideStorageKey(result: ModelIdentity): string | null {
  const hash = result.sourceSha256;
  return hash && /^[a-f0-9]{64}$/iu.test(hash) ? `${STORAGE_PREFIX}:${hash.toLowerCase()}` : null;
}

export function loadElementOverrides(result: ModelIdentity): ElementOverride[] {
  if (typeof window === "undefined") return [];
  const key = elementOverrideStorageKey(result);
  // Old name/length-only sidecars cannot safely be attributed to these bytes.
  if (!key) return [];
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return mergeElementOverrides([], parsed.filter(isElementOverride));
  } catch {
    return [];
  }
}

export function saveElementOverrides(
  result: ModelIdentity,
  overrides: readonly ElementOverride[],
): void {
  if (typeof window === "undefined") return;
  const key = elementOverrideStorageKey(result);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(overrides));
  } catch {
    // Assertions remain available for this session when storage is unavailable.
  }
}
