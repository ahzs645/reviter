/** Conservative suppression of family-local records left at the project datum. */
import { boundsOfRecords } from "./bounds-records.ts";
import type { ElementBoundsRecord } from "./types.ts";

/** The measured residual UNBC pile reaches 1.93 ft from the datum. */
const RESIDUAL_DATUM_RADIUS_FEET = 2.25;

/** Component files and a handful of genuine elements must not look like a pile. */
const MIN_BUILDING_RECORDS = 500;
const MIN_BUILDING_SPAN_FEET = 50;
const MIN_RESIDUAL_PILE_RECORDS = 24;

/**
 * Categories whose unplaced definitions commonly carry family-local bounds:
 * Doors, Windows, Curtain Wall Panels and Railing Top Rail.
 *
 * Keyed by id. As a name set this silently lost curtain panels and top rails
 * the moment Revit's own labels replaced the enumerator-derived names, which
 * left the residual pile below its minimum and switched the cleanup off.
 */
const FAMILY_LOCAL_CATEGORY_IDS = new Set([
  -2_000_023,
  -2_000_014,
  -2_000_170,
  -2_000_946,
]);

function isFamilyLocalCategory(record: ElementBoundsRecord) {
  return record.categoryId == null || FAMILY_LOCAL_CATEGORY_IDS.has(record.categoryId);
}

/**
 * Find a dense residual pile after the first, tighter datum cleanup.
 *
 * Placed instances and level-related elements are preserved even when their
 * geometry genuinely touches the project origin. This is deliberately a
 * density rule: one real door at (0, 0) is architecture; dozens of unrelated
 * family records at nearly the same point are local definitions.
 */
export function residualDatumPileElementIds(
  records: readonly ElementBoundsRecord[],
  placedElementIds: ReadonlySet<number>,
  levelRelatedElementIds: ReadonlySet<number>,
): Set<number> {
  if (records.length <= MIN_BUILDING_RECORDS) return new Set();
  const spread = boundsOfRecords(records);
  const planSpan = Math.max(spread.max.x - spread.min.x, spread.max.y - spread.min.y);
  if (planSpan <= MIN_BUILDING_SPAN_FEET) return new Set();

  const candidates = records.filter((record) => {
    if (placedElementIds.has(record.elementId) || levelRelatedElementIds.has(record.elementId)) {
      return false;
    }
    if (!isFamilyLocalCategory(record)) return false;
    const { min, max } = record.boundsFeet;
    const centerX = (min.x + max.x) / 2;
    const centerY = (min.y + max.y) / 2;
    return Math.abs(centerX) <= RESIDUAL_DATUM_RADIUS_FEET &&
      Math.abs(centerY) <= RESIDUAL_DATUM_RADIUS_FEET;
  });
  if (candidates.length < MIN_RESIDUAL_PILE_RECORDS) return new Set();
  return new Set(candidates.map((record) => record.elementId));
}
