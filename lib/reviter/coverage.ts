/**
 * The coverage split: for each class the paired export carries, how many of its
 * elements were found in the Revit file and how many reach the scene.
 *
 * The offline audit has reported this for a while; the studio reported only a
 * single headline match rate, which flatters the result — a class can be 100%
 * matched by id and 0% drawn. Keeping the two columns apart is the point.
 */
import type { PairedRegressionResult } from "./types";

export type ClassCoverage = {
  /** Export class name with the `IFC` prefix stripped, for display. */
  ifcType: string;
  inExport: number;
  recovered: number;
  /** Drawn count, or `null` when the match ids were not carried through. */
  drawn: number | null;
};

export function classCoverage(
  comparison: PairedRegressionResult,
  drawnElementIds: ReadonlySet<number>,
): ClassCoverage[] {
  return comparison.reference.elementTypes
    .filter((row) => row.count > 0)
    .map((row) => ({
      ifcType: row.ifcType.replace(/^IFC/, ""),
      inExport: row.count,
      recovered: row.matchedRvtRecords,
      // Without the matched ids there is no honest way to say how many of this
      // class reach the scene, so the column reports nothing rather than a
      // number it cannot stand behind.
      drawn: row.matchedIds
        ? [...row.matchedIds].filter((elementId) => drawnElementIds.has(elementId)).length
        : null,
    }))
    .sort((a, b) => b.inExport - a.inExport);
}
