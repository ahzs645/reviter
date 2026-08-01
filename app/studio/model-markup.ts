/**
 * Markup persistence.
 *
 * The same contract as `model-comments.ts`, and for the same reason: markup
 * anchored in the building is a review artefact, not a scribble on the glass
 * that should die with the tab. Keyed per file so opening a second model does
 * not show the first one's redlines.
 */
import type { ConvertResult } from "../../lib/reviter";
import type { MarkupStroke } from "./viewer-tools.ts";

const STORAGE_PREFIX = "reviter.model-markup.v1";

export function modelMarkupStorageKey(result: Pick<ConvertResult, "fileName" | "byteLength">): string {
  return `${STORAGE_PREFIX}:${result.fileName}:${result.byteLength}`;
}

export function loadModelMarkup(result: Pick<ConvertResult, "fileName" | "byteLength">): MarkupStroke[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(modelMarkupStorageKey(result));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMarkupStroke);
  } catch {
    return [];
  }
}

export function saveModelMarkup(
  result: Pick<ConvertResult, "fileName" | "byteLength">,
  strokes: readonly MarkupStroke[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(modelMarkupStorageKey(result), JSON.stringify(strokes));
  } catch {
    // Markup remains available for this session when storage is unavailable.
  }
}

function isPoint3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

export function isMarkupStroke(value: unknown): value is MarkupStroke {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MarkupStroke>;
  return typeof entry.id === "string"
    && typeof entry.source === "string"
    && (entry.tool === "pencil" || entry.tool === "arrow" || entry.tool === "cloud" || entry.tool === "text")
    && Array.isArray(entry.points)
    && entry.points.length > 0
    && entry.points.every(isPoint3)
    && (!entry.pointsFeet || (Array.isArray(entry.pointsFeet) && entry.pointsFeet.every(isPoint3)))
    && typeof entry.color === "string"
    && typeof entry.worldWeight === "number"
    && Number.isFinite(entry.worldWeight);
}
