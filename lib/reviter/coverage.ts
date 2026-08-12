/**
 * The coverage split: for each class the paired export carries, how many of its
 * elements the scan proved real, how many were recovered with an envelope, and
 * how many reach the scene.
 *
 * The offline audit has reported this for a while; the studio reported only a
 * single headline match rate, which flatters the result — a class can be 100%
 * matched by id and 0% drawn. The three columns have different fixes behind
 * them, which is the whole reason for keeping them apart.
 */
import type { PairedRegressionResult } from "./types.ts";

export type ClassCoverage = {
  /** Export class name with the `IFC` prefix stripped, for display. */
  ifcType: string;
  inExport: number;
  /** Element ids the scan proved exist in the Revit file. */
  seen: number;
  /** Of those, the ones that reached the converter with an envelope. */
  recovered: number | null;
  /** Of those, the ones drawn into the scene. */
  drawn: number | null;
};

export function classCoverage(
  comparison: PairedRegressionResult,
  recoveredElementIds: ReadonlySet<number>,
  drawnElementIds: ReadonlySet<number>,
): ClassCoverage[] {
  return comparison.reference.elementTypes
    // A class none of whose elements carries a Revit id — storeys, the site,
    // the building itself, annotation — cannot be joined at all, so its
    // coverage is unmeasurable rather than zero. Showing it as an empty row
    // would read as a failure that is not one.
    .filter((row) => row.count > 0 && row.tagged > 0)
    .map((row) => {
      // Without the matched ids there is no honest way to say how many of this
      // class got past the scan, so those columns report nothing rather than a
      // number they cannot stand behind.
      const matched = row.matchedIds ? [...row.matchedIds] : null;
      return {
        ifcType: row.ifcType.replace(/^IFC/, ""),
        inExport: row.count,
        seen: row.matchedRvtRecords,
        recovered: matched?.filter((elementId) => recoveredElementIds.has(elementId)).length ?? null,
        drawn: matched?.filter((elementId) => drawnElementIds.has(elementId)).length ?? null,
      };
    })
    .sort((a, b) => b.inExport - a.inExport);
}
