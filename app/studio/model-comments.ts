import type { ConvertResult } from "../../lib/reviter";
import type { ModelComment } from "./viewer-tools.ts";

const STORAGE_PREFIX = "reviter.model-comments.v1";

export function modelCommentStorageKey(result: Pick<ConvertResult, "fileName" | "byteLength">): string {
  return `${STORAGE_PREFIX}:${result.fileName}:${result.byteLength}`;
}

export function loadModelComments(result: Pick<ConvertResult, "fileName" | "byteLength">): ModelComment[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(modelCommentStorageKey(result));
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isModelComment);
  } catch {
    return [];
  }
}

export function saveModelComments(
  result: Pick<ConvertResult, "fileName" | "byteLength">,
  comments: readonly ModelComment[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(modelCommentStorageKey(result), JSON.stringify(comments));
  } catch {
    // Comments remain available for this session when storage is unavailable.
  }
}

function isPoint3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

export function isModelComment(value: unknown): value is ModelComment {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ModelComment>;
  return typeof entry.id === "string"
    && typeof entry.text === "string"
    && (entry.status === "open" || entry.status === "resolved")
    && typeof entry.source === "string"
    && isPoint3(entry.scenePosition)
    && (!entry.modelPositionFeet || isPoint3(entry.modelPositionFeet))
    && Boolean(entry.viewpoint)
    && isPoint3(entry.viewpoint?.position)
    && isPoint3(entry.viewpoint?.target)
    && isPoint3(entry.viewpoint?.up)
    && typeof entry.viewpoint?.fov === "number";
}
