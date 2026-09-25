/**
 * A straight wall's full thickness, from its own envelope.
 *
 * A wall's centre-plane triple (`native-geometry.ts`) is three vertical planes
 * half a thickness apart. In the 2027 UNBC project those are the wall's outer
 * faces. In the 2024 and 2025 samples they are usually its core: a layered
 * wall there is written with the triple around the structural layers, and the
 * finishes lie outside it, so the rebuilt wall came out 0.30 ft thick where
 * Revit draws 0.45 ft, and 0.05 ft where it draws 0.51 ft.
 *
 * The wall's own duplicated-bounds record is the envelope of its whole body.
 * For a wall running along a model axis, that envelope's extent across the
 * wall is the thickness directly, and its middle is the wall's middle. Joined
 * to the Autodesk Viewer's own geometry of the same files, for every straight,
 * axis-aligned wall that has both, that extent is Autodesk's thickness to
 * within 0.02 ft: 877 of 877 in the 2024 Snowdon sample, 146 of 146 in the
 * 2025 technical school and 4,801 of 4,801 in the 2027 UNBC project. The
 * triple agreed on 130, 8 and 4,799 of them.
 *
 * A wall at an angle to the axes, or one built from segments that are not on
 * one line, has no such reading: its envelope mixes length into thickness.
 * Those keep the triple.
 */
import type { ElementBoundsRecord } from "./types.ts";

const WALL_CATEGORY_ID = -2_000_011;

/** A run whose direction has less than this across an axis runs along it. */
const AXIS_TOLERANCE = 1e-3;

/** Segments whose lines are this close across the wall are one line. */
const COLLINEAR_TOLERANCE_FEET = 1e-3;

/** How far a face may sit outside the envelope and still be inside it. */
const ENVELOPE_SLACK_FEET = 0.01;

/** Below this the envelope adds nothing to the triple. */
const MIN_WIDENING_FEET = 1e-3;

/** The triple's own limit on a wall's thickness (`MAX_HALF_THICKNESS_FEET`). */
const MAX_THICKNESS_FEET = 20;

/**
 * Widen each straight, axis-aligned wall to its envelope's extent across it,
 * centred on the envelope. Returns how many walls were widened.
 */
export function widenWallsToEnvelope(records: readonly ElementBoundsRecord[]): number {
  let widened = 0;
  for (const record of records) {
    // A synthesised envelope is built from the solid, so it cannot correct it.
    if (record.categoryId !== WALL_CATEGORY_ID || record.arcs?.length || record.recordOffset < 0) continue;
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    if (!solids.length) continue;

    // The axis across the wall, if every segment runs along the other one.
    const along = (axis: "x" | "y") => solids.every((solid) => {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return false;
      return Math.abs((axis === "x" ? dy : dx) / length) < AXIS_TOLERANCE;
    });
    const across = along("x") ? "y" : along("y") ? "x" : null;
    if (!across) continue;

    const lines = solids.map((solid) => (solid.start[across] + solid.end[across]) / 2);
    if (Math.max(...lines) - Math.min(...lines) > COLLINEAR_TOLERANCE_FEET) continue;

    const low = record.boundsFeet.min[across];
    const high = record.boundsFeet.max[across];
    const span = high - low;
    if (span > MAX_THICKNESS_FEET) continue;
    const inside = solids.every((solid, index) =>
      lines[index]! - solid.thickness / 2 >= low - ENVELOPE_SLACK_FEET &&
      lines[index]! + solid.thickness / 2 <= high + ENVELOPE_SLACK_FEET);
    if (!inside) continue;
    if (solids.every((solid) => span - solid.thickness < MIN_WIDENING_FEET)) continue;

    const middle = (low + high) / 2;
    for (const solid of solids) {
      solid.start = { ...solid.start, [across]: middle };
      solid.end = { ...solid.end, [across]: middle };
      solid.thickness = span;
    }
    widened += 1;
  }
  return widened;
}
