import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";

/**
 * Owner-reviewed place-label decisions. A label is either an alias of another place (two
 * numbers on one room: both stay searchable and lead to the same place) or retired as a place
 * of its own (an "Office" label on a corridor bay, a storage number inside a stair enclosure,
 * a copy zone in a corridor): its number stays searchable and leads to the place it is part of.
 * Metadata only: room identities, boundaries, doors, access and routes are unchanged, and the
 * label's source annotation is kept. Each record binds the room key and the number it reviewed,
 * and names the place on the same level that the label leads to.
 */
export type ReviewedPlaceLabel = {
  id: string;
  roomKey: string;
  /** The label's room number when it was reviewed; a renumbered room is no longer covered. */
  number: string;
  action: "alias" | "retire";
  /** alias: the place this label also names. retire: the place it is part of. */
  placeRoomKey: string;
  decisionId: string;
  evidence: "user-reported";
  reason: string;
  notes?: string;
};
export type ReviewedPlaceLabels = {
  version: 1;
  sourceModelSha256: string;
  labels: ReviewedPlaceLabel[];
};
const sha = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const text = (s: unknown, max: number) =>
  typeof s === "string" && s.length <= max && !!s.trim();
const FIELDS = new Set([
  "id",
  "roomKey",
  "number",
  "action",
  "placeRoomKey",
  "decisionId",
  "evidence",
  "reason",
  "notes",
]);
export function validateReviewedPlaceLabels(
  value: unknown,
  records: readonly { key: string; number?: string; levelId: number }[],
  modelSha256?: string,
): asserts value is ReviewedPlaceLabels | undefined {
  if (value === undefined) return;
  const v = value as ReviewedPlaceLabels;
  if (
    !v ||
    typeof v !== "object" ||
    v.version !== 1 ||
    !sha(v.sourceModelSha256) ||
    (modelSha256 !== undefined && v.sourceModelSha256 !== modelSha256) ||
    !Array.isArray(v.labels) ||
    v.labels.length > 60_000
  )
    throw new Error("Invalid reviewed place labels: version, model or list.");
  const byKey = new Map(records.map((r) => [r.key, r]));
  const ids = new Set<string>(),
    covered = new Set<string>();
  for (const l of v.labels) {
    if (
      !l ||
      typeof l !== "object" ||
      Object.keys(l).some((k) => !FIELDS.has(k)) ||
      !text(l.id, 300) ||
      ids.has(l.id) ||
      !text(l.roomKey, 200) ||
      covered.has(l.roomKey) ||
      typeof l.number !== "string" ||
      l.number.length > 100 ||
      !["alias", "retire"].includes(l.action) ||
      !text(l.placeRoomKey, 200) ||
      l.placeRoomKey === l.roomKey ||
      !text(l.decisionId, 200) ||
      l.evidence !== "user-reported" ||
      !text(l.reason, 4000) ||
      (l.notes !== undefined && (typeof l.notes !== "string" || l.notes.length > 10_000))
    )
      throw new Error(`Invalid reviewed place label: ${String(l?.id)}`);
    const room = byKey.get(l.roomKey);
    if (!room || (room.number ?? "") !== l.number)
      throw new Error(
        `Reviewed place label ${l.id} no longer matches its room ${l.roomKey} (${l.number}).`,
      );
    const place = byKey.get(l.placeRoomKey);
    if (!place || place.levelId !== room.levelId)
      throw new Error(
        `Reviewed place label ${l.id} names a place that is absent or on another level.`,
      );
    ids.add(l.id);
    covered.add(l.roomKey);
  }
  // A label leads to a place that is itself a place: no chains or cycles.
  for (const l of v.labels)
    if (covered.has(l.placeRoomKey))
      throw new Error(
        `Reviewed place label ${l.id} leads to ${l.placeRoomKey}, which is itself an alias or retired label.`,
      );
}
export const reviewedPlaceLabel = (data: IndoorDataset, key: string) =>
  data.reviewedPlaceLabels?.labels.find((l) => l.roomKey === key);
/** The keys of one native area that are places of their own: an owner-reviewed alias or
 * retired label is folded into its place when that place shares the area (otherwise it keeps
 * its own identity there, so no area loses its only place). */
export function reviewedSeparatePlaceKeys(
  data: IndoorDataset,
  keys: Iterable<string>,
) {
  const all = new Set(keys);
  if (!data.reviewedPlaceLabels?.labels.length) return [...all];
  return [...all].filter((key) => {
    const label = reviewedPlaceLabel(data, key);
    return !label || !all.has(label.placeRoomKey);
  });
}
/** The place a label leads to: its alias/part-of place, or itself. */
export const reviewedPlaceKey = (data: IndoorDataset, key: string) =>
  reviewedPlaceLabel(data, key)?.placeRoomKey ?? key;
/** Search text a place gains from the labels that alias it or were retired into it. */
export function reviewedPlaceSearchText(
  data: IndoorDataset,
  room: Pick<IndoorRecord, "key">,
) {
  const labels = data.reviewedPlaceLabels?.labels.filter(
    (l) => l.placeRoomKey === room.key,
  );
  if (!labels?.length) return "";
  const records = new Map(data.records.map((r) => [r.key, r]));
  return labels
    .flatMap((l) => {
      const r = records.get(l.roomKey);
      return l.action === "alias" ? [l.number, r?.name ?? ""] : [l.number];
    })
    .filter(Boolean)
    .join(" ");
}
