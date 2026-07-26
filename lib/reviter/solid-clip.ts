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
