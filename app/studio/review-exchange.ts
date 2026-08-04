/**
 * Portable review sidecars.
 *
 * Geometry stays in the source RVT. These small JSON files carry only review
 * data plus enough source identity to keep someone from placing it over a
 * different building by mistake. Annotation anchors are already stored in
 * canonical model feet, while comments additionally retain their viewpoint.
 */
import type { ConvertResult } from "../../lib/reviter/types.ts";
import {
  isReviewedGap,
  isReviewedRoom,
  type RoomReviewSidecar,
  type RoomReviewState,
} from "../../lib/reviter/room-review.ts";
import { isModelComment } from "./model-comments.ts";
import { isMarkupStroke } from "./model-markup.ts";
import type { MarkupStroke, ModelComment } from "./viewer-tools.ts";

const REVIEW_VERSION = 1;

export type ReviewModelIdentity = Pick<ConvertResult, "fileName" | "byteLength">;

export type CommentsSidecar = {
  format: "reviter-comments";
  version: typeof REVIEW_VERSION;
  exportedAt: string;
  model: ReviewModelIdentity;
  coordinateSystem: "revit-model-feet";
  comments: ModelComment[];
};

export type MarkupSidecar = {
  format: "reviter-markup";
  version: typeof REVIEW_VERSION;
  exportedAt: string;
  model: ReviewModelIdentity;
  coordinateSystem: "revit-model-feet";
  markup: MarkupStroke[];
};

export type ReviewSidecar = CommentsSidecar | MarkupSidecar | RoomReviewSidecar;

export function roomModelFingerprint(result: ConvertResult): string {
  const identities = (result.nativeIdentity?.identities ?? [])
    .map((identity) => identity.uniqueId)
    .sort();
  let hash = 0x811c9dc5;
  const signature = identities.length
    ? `${identities.length}:${identities[0]}:${identities.at(-1)}:${result.origin.x}:${result.origin.y}:${result.origin.z}`
    : `${result.fileName}:${result.byteLength}:${result.elementBounds.length}:${result.origin.x}:${result.origin.y}:${result.origin.z}`;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function modelIdentity(result: ReviewModelIdentity): ReviewModelIdentity {
  return { fileName: result.fileName, byteLength: result.byteLength };
}

export function makeCommentsSidecar(
  result: ReviewModelIdentity,
  comments: readonly ModelComment[],
  exportedAt = new Date().toISOString(),
): string {
  const sidecar: CommentsSidecar = {
    format: "reviter-comments",
    version: REVIEW_VERSION,
    exportedAt,
    model: modelIdentity(result),
    coordinateSystem: "revit-model-feet",
    comments: [...comments],
  };
  return JSON.stringify(sidecar, null, 2);
}

export function makeMarkupSidecar(
  result: ReviewModelIdentity,
  markup: readonly MarkupStroke[],
  exportedAt = new Date().toISOString(),
): string {
  const sidecar: MarkupSidecar = {
    format: "reviter-markup",
    version: REVIEW_VERSION,
    exportedAt,
    model: modelIdentity(result),
    coordinateSystem: "revit-model-feet",
    markup: [...markup],
  };
  return JSON.stringify(sidecar, null, 2);
}

export function makeRoomReviewSidecar(
  result: ConvertResult,
  review: RoomReviewState,
  exportedAt = new Date().toISOString(),
): string {
  const sidecar: RoomReviewSidecar = {
    format: "reviter-room-review",
    version: REVIEW_VERSION,
    algorithmVersion: 1,
    exportedAt,
    model: {
      fileName: result.fileName,
      byteLength: result.byteLength,
      fingerprint: roomModelFingerprint(result),
    },
    coordinateSystem: "revit-model-feet",
    rooms: review.rooms,
    gaps: review.gaps,
  };
  return JSON.stringify(sidecar, null, 2);
}

function isModelIdentity(value: unknown): value is ReviewModelIdentity {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<ReviewModelIdentity>;
  return typeof model.fileName === "string"
    && typeof model.byteLength === "number"
    && Number.isSafeInteger(model.byteLength)
    && model.byteLength > 0;
}

export function parseReviewSidecar(text: string): ReviewSidecar {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a readable Reviter review file.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("This is not a Reviter comments or markup file.");
  }
  const sidecar = value as Partial<ReviewSidecar> & Record<string, unknown>;
  if (sidecar.version !== REVIEW_VERSION) {
    throw new Error(`Unsupported Reviter review version: ${String(sidecar.version ?? "missing")}.`);
  }
  if (!isModelIdentity(sidecar.model)) {
    throw new Error("The review file does not identify its source model.");
  }
  if (sidecar.coordinateSystem !== "revit-model-feet") {
    throw new Error("The review file uses an unsupported coordinate system.");
  }
  if (sidecar.format === "reviter-comments") {
    if (!Array.isArray(sidecar.comments) || !sidecar.comments.every(isModelComment)) {
      throw new Error("The comments review file contains an invalid comment.");
    }
    return sidecar as CommentsSidecar;
  }
  if (sidecar.format === "reviter-markup") {
    if (!Array.isArray(sidecar.markup) || !sidecar.markup.every(isMarkupStroke)) {
      throw new Error("The markup review file contains an invalid stroke.");
    }
    return sidecar as MarkupSidecar;
  }
  if (sidecar.format === "reviter-room-review") {
    const candidate = sidecar as Partial<RoomReviewSidecar>;
    if (candidate.algorithmVersion !== 1
      || typeof candidate.model?.fingerprint !== "string"
      || !Array.isArray(candidate.rooms) || candidate.rooms.length > 50_000 || !candidate.rooms.every(isReviewedRoom)
      || !Array.isArray(candidate.gaps) || candidate.gaps.length > 100_000 || !candidate.gaps.every(isReviewedGap)) {
      throw new Error("The room review file contains invalid or unsupported room data.");
    }
    return candidate as RoomReviewSidecar;
  }
  throw new Error("This is not a Reviter comments, markup, or room review file.");
}

export function assertSidecarMatchesModel(
  sidecar: ReviewSidecar,
  result: ReviewModelIdentity | ConvertResult,
): void {
  if (sidecar.format === "reviter-room-review") {
    if (!("nativeIdentity" in result) || !("elementBounds" in result) || !("origin" in result)) {
      throw new Error("The open model cannot be fingerprinted for room review import.");
    }
    if (sidecar.model.fingerprint === roomModelFingerprint(result)) return;
    throw new Error(`This room review belongs to ${sidecar.model.fileName}, not the open ${result.fileName} source model.`);
  }
  if (sidecar.model.byteLength === result.byteLength) return;
  throw new Error(
    `This review belongs to ${sidecar.model.fileName}, not the open ${result.fileName} source file.`,
  );
}

/** Keep local comments, taking the newer edit when the same comment was shared back. */
export function mergeComments(
  current: readonly ModelComment[],
  imported: readonly ModelComment[],
): ModelComment[] {
  const incoming = new Map(imported.map((comment) => [comment.id, comment]));
  const merged = current.map((comment) => {
    const candidate = incoming.get(comment.id);
    if (!candidate) return comment;
    incoming.delete(comment.id);
    return Date.parse(candidate.updatedAt) >= Date.parse(comment.updatedAt) ? candidate : comment;
  });
  return [...merged, ...incoming.values()];
}

/** Markup strokes are immutable; importing adds only strokes not already present. */
export function mergeMarkup(
  current: readonly MarkupStroke[],
  imported: readonly MarkupStroke[],
): MarkupStroke[] {
  const ids = new Set(current.map((stroke) => stroke.id));
  return [...current, ...imported.filter((stroke) => !ids.has(stroke.id))];
}
