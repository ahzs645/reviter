/**
 * Clipping a rebuilt solid to the element's own envelope.
 *
 * The two are independent readings of one element — a trim range off the native
 * centre plane, and the duplicated-bounds record — so where they disagree the
 * shorter one is not a guess. See the block comment at the call site in
 * `convert.ts` for the measurements and the controls.
 */
import type { Bounds3 } from "./types";
import type { WallSolid } from "./native-geometry.ts";

/** Below this a clipped run is degenerate, and the solid is left alone. */
const MIN_CLIPPED_LENGTH_FEET = 0.05;

/**
 * How far a solid's centreline may sit outside its own envelope before the two
 * readings are taken to be about different elements.
 *
 * This is numeric slack and nothing else: two solids in the supplied project
 * miss their envelope by 1e-4 ft, which is a rounded corner rather than a
 * disagreement, while the thinnest wall in the model is 60 mm — 0.197 ft — so a
 * twentieth of a foot is far below any real dimension here. **The value is not
 * on a cliff.** Over the records the scene draws, every threshold from 0.0002 ft
 * to 0.2252 ft selects the same eleven solids; they miss by 0.23, 0.23, 0.49,
 * 3.61, 5.47, 7.88, 11.35, 14.62, 16.02, 36.03 and 243.19 ft.
 *
 * Half of the solid's *own* thickness — how far the drawn box reaches from the
 * centreline — was measured as the alternative with no fitted number in it, and
 * it spares one of the eleven: 1193382, whose duplicated-bounds record is
 * 0.1 x 0.0 ft and reproduces its export box exactly, carrying a solid 12.31 ft
 * long. A rule that keeps that one is the worse rule.
 */
const STRAY_SLACK_FEET = 0.05;

/**
 * Does a solid's centreline meet the element's own envelope in plan?
 *
 * **A solid that shares no point with its own envelope is not the element's
 * solid.** The two are independent readings — a trim range off a native centre
 * plane, and the duplicated-bounds record — and the record is the reading that
 * has been checked: for the 106 `IfcWall` and 6,045 `IfcWallStandardCase`
 * records that carry a real one, the envelope reproduces the export's box corner
 * for corner within 0.001 ft for 100.0% and 99.4% of them. So where the two
 * disagree completely, rather than merely by the join trimming `clipSolidToEnvelope`
 * absorbs, the solid is a surface attribution that went to the wrong element.
 *
 * 147 of the 6,756 solids that sit on a record with a real bounds block fail
 * this test, and **11 of them are on records the scene draws** — 6 walls, 4
 * curtain panels and 1 mullion. Four of the eleven are carried by a *second*
 * element as well, which settles it outright: a plane triple is one body, so two
 * owners is a misattribution however the boxes are read. For three of those the
 * co-owner's envelope reproduces the solid's own length and thickness to 0.01 ft
 * — 1501065's box is 0.39 x 29.89 ft against a solid 29.37 ft long and 0.394
 * thick, and the solid was being drawn on 1501060 and 1501062 as well.
 *
 * Dropping them improves 6 of the 11 and worsens 0, taking the elements drawn
 * over 10 ft past their own export box from 35 to 29 and the worst single case
 * from **260.3 ft to 19.8**; the other 5 are drawn from a placed oriented box,
 * which already outranks the solid, so nothing on screen changes for them.
 *
 * **The per-class agreement percentages cannot judge this rule and were not
 * used to fit it.** Falling back to the envelope always scores better on a box
 * metric, because the envelope *is* the export's box for 99.4% of walls: the same
 * containment test against the envelope of the element one id below rejects 3,342
 * of 5,354 solids and against a shuffled envelope 5,356, and both come out
 * *higher* on `IfcWallStandardCase` size — 95.7% and 97.0% against 92.4% — while
 * throwing away the orientation of thousands of correctly rebuilt walls. What
 * separates the rule from those controls is its specificity: keyed on the
 * element's own envelope it fires on **11 of 5,354**, 0.2%, against 62% and 100%.
 */
export function solidBelongsToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const minX = envelope.min.x - STRAY_SLACK_FEET;
  const minY = envelope.min.y - STRAY_SLACK_FEET;
  const maxX = envelope.max.x + STRAY_SLACK_FEET;
  const maxY = envelope.max.y + STRAY_SLACK_FEET;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(solid.start.x, solid.start.y) || inside(solid.end.x, solid.end.y)) return true;

  // Liang–Barsky again: a run can cross the envelope with neither end inside it,
  // and a wall whose record is a fragment of its own length does exactly that.
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  let enter = 0;
  let exit = 1;
  const limits: [number, number][] = [
    [-dx, solid.start.x - minX],
    [dx, maxX - solid.start.x],
    [-dy, solid.start.y - minY],
    [dy, maxY - solid.start.y],
  ];
  for (const [direction, distance] of limits) {
    if (Math.abs(direction) < 1e-12) {
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  return exit > enter;
}

/**
 * Clip a solid's centreline to the envelope's plan extent, in place.
 *
 * Returns true when the run was shortened. A solid that lies wholly outside its
 * own envelope, or that would clip to nothing, is left as it is: that is a
 * disagreement to report rather than a length to invent.
 */
export function clipSolidToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_CLIPPED_LENGTH_FEET) return false;

  // Liang–Barsky against the plan rectangle, in the run's own parameter.
  let enter = 0;
  let exit = 1;
  const limits: [number, number, number][] = [
    [-dx, solid.start.x - envelope.min.x, 0],
    [dx, envelope.max.x - solid.start.x, 0],
    [-dy, solid.start.y - envelope.min.y, 0],
    [dy, envelope.max.y - solid.start.y, 0],
  ];
  for (const [direction, distance] of limits) {
    if (Math.abs(direction) < 1e-12) {
      // Parallel to this edge: outside it means there is nothing to clip to.
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  if (exit <= enter) return false;
  if (enter <= 1e-9 && exit >= 1 - 1e-9) return false;
  if ((exit - enter) * length < MIN_CLIPPED_LENGTH_FEET) return false;

  const at = (t: number) => ({ x: solid.start.x + dx * t, y: solid.start.y + dy * t });
  const clippedStart = at(enter);
  const clippedEnd = at(exit);
  solid.start = { ...solid.start, x: clippedStart.x, y: clippedStart.y };
  solid.end = { ...solid.end, x: clippedEnd.x, y: clippedEnd.y };
  return true;
}
