/**
 * What is about to leave the building, stated before it does.
 *
 * A Reviter IFC is a recovery, and a consumer trusts it because every product
 * carries evidence about how it was arrived at. Reviewer assertions change what
 * that file says an element *is* — a category decides its IFC class — so the
 * one moment they must be legible is the moment before export, on the way out,
 * as decoded → asserted rather than as a count.
 *
 * The rows are derived from live state rather than snapshotted, and
 * `assertionReviewDigest` exists so the caller can prove at confirm time that
 * what it is exporting is still what was reviewed. Freezing a snapshot instead
 * would not fix the divergence, it would only make it invisible.
 */
import { assertedFields, overrideFor } from "../../lib/reviter";
import type { ElementBoundsRecord, ElementOverride } from "../../lib/reviter";

export type AssertionChange = {
  field: "category" | "typeName" | "note";
  label: string;
  /** What the decoder said, or null where it said nothing. */
  decoded: string | null;
  asserted: string;
};

export type AssertionReviewRow = {
  elementId: number;
  /** The element's decoded category, for recognising it in a long list. */
  decodedCategory: string;
  changes: AssertionChange[];
  /** Null when the assertion targets an element this conversion did not recover. */
  orphaned: boolean;
};

const FIELD_LABELS: Record<AssertionChange["field"], string> = {
  category: "Category",
  typeName: "Type name",
  note: "Note",
};

export function buildAssertionReview(
  records: readonly ElementBoundsRecord[],
  overrides: readonly ElementOverride[],
): AssertionReviewRow[] {
  const byElement = new Map<number, ElementBoundsRecord>();
  for (const record of records) {
    if (!byElement.has(record.elementId)) byElement.set(record.elementId, record);
  }

  return overrides
    .map((override) => {
      const record = byElement.get(override.elementId);
      const changes: AssertionChange[] = [];
      for (const field of assertedFields(override)) {
        if (field === "category" && override.category) {
          changes.push({
            field: "category",
            label: FIELD_LABELS.category,
            decoded: record?.categoryName ?? null,
            asserted: override.category.name,
          });
        }
        if (field === "typeName" && override.typeName !== null) {
          changes.push({
            field: "typeName",
            label: FIELD_LABELS.typeName,
            decoded: record?.typeName ?? null,
            asserted: override.typeName,
          });
        }
        if (field === "note") {
          changes.push({
            field: "note",
            label: FIELD_LABELS.note,
            decoded: null,
            asserted: override.note.trim(),
          });
        }
      }
      return {
        elementId: override.elementId,
        decodedCategory: record?.categoryName ?? "Not in this conversion",
        changes,
        // An assertion made against a different conversion of the same file
        // still exports nothing, because the exporter only visits recovered
        // elements. Saying so is better than silently dropping it.
        orphaned: !record,
      };
    })
    .filter((row) => row.changes.length)
    .sort((left, right) => left.elementId - right.elementId);
}

/**
 * A stable fingerprint of exactly what was reviewed.
 *
 * Compared at confirm time against a freshly derived one. Any difference means
 * the assertions moved while the dialog was open, and the export is refused in
 * favour of a re-review rather than exporting something nobody looked at.
 */
export function assertionReviewDigest(rows: readonly AssertionReviewRow[]): string {
  return rows
    .map((row) => `${row.elementId}:${row.changes.map((change) => `${change.field}=${change.asserted}`).join("|")}`)
    .join(";");
}

/** The assertion for one element, for the dock's editor. */
export function assertionFor(
  overrides: readonly ElementOverride[],
  elementId: number | null,
): ElementOverride | null {
  return elementId == null ? null : overrideFor(overrides, elementId);
}
