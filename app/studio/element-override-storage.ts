/**
 * Reviewer assertions, kept per model in local storage.
 *
 * The same contract as `model-comments.ts` and `model-markup.ts`: keyed to the
 * file's name and length, never uploaded, and readable back into the studio the
 * next time the same file is opened. Assertions are about a particular
 * building, so they belong to the model rather than to the person — unlike
 * `viewer-preferences.ts`, which follows the reviewer between files.
 *
 * Only the current assertions are persisted, not the undo history. A reload is
 * a session boundary; restoring an undo stack across it would offer to undo
 * something the reviewer did days ago and no longer remembers doing.
 */
import { isElementOverride, type ElementOverride } from "../../lib/reviter";
import type { ConvertResult } from "../../lib/reviter";

const STORAGE_PREFIX = "reviter.element-overrides.v1";

type ModelIdentity = Pick<ConvertResult, "fileName" | "byteLength">;

export function elementOverrideStorageKey(result: ModelIdentity): string {
  return `${STORAGE_PREFIX}:${result.fileName}:${result.byteLength}`;
}

export function loadElementOverrides(result: ModelIdentity): ElementOverride[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(elementOverrideStorageKey(result));
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isElementOverride);
  } catch {
    return [];
  }
}

export function saveElementOverrides(
  result: ModelIdentity,
  overrides: readonly ElementOverride[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(elementOverrideStorageKey(result), JSON.stringify(overrides));
  } catch {
    // Assertions remain available for this session when storage is unavailable.
  }
}
