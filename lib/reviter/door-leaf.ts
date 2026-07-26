/**
 * Cutting a door leaf out of the opening its record describes.
 */
import { instanceCorners, type InstancePlacement, type LocalBounds } from "./instanced-geometry.ts";
import type { ElementBoundsRecord } from "./types";

/** How far outside a wall's height band a door may sit and still be its door. */
const DOOR_HOST_HEIGHT_SLACK_FEET = 1;

/** A wall run a door can be hosted in: a centreline, a thickness, a height band. */
export type WallRun = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness: number;
  minZ: number;
  maxZ: number;
};

/**
 * The door leaf, cut out of the opening the record actually describes.
 *
 * A door's duplicated-bounds record is not the door: measured against the
 * paired export the long horizontal axis is already right — ratio 1.022, median
 * difference 0.08 ft — while the short one is **5.1× too big**, 3.50 ft where
 * the export says 0.66. 86% of the boxes are square in plan, which is the shape
 * of a quarter-circle swing rather than of a door. The record is the opening
 * plus the arc the leaf sweeps through.
 *
 * The leaf is what is left when the swing is cut off: the record's own extent
 * along the wall the door sits in, the wall's thickness across it, centred on
 * the wall's centreline. Both of those come from the model itself — walls
 * rebuilt from native surfaces carry a centreline and a thickness — so this
 * needs no reference file. On the supplied model 1,121 of 1,399 doors find a
 * host wall, and their median plan centre error goes from 1.455 ft to 0.000 and
 * their size error from 2.910 ft to 0.167.
 *
 * **This is the fallback, and it is a poor one.** The wall gives the door the
 * *wall's* thickness, which is right on centre and wrong on size: measured
 * against the export the doors drawn this way scored 97.1% on centre and only
 * **68.3% on size**, median 0.164 ft, against 99.5% / 99.5% for the doors whose
 * own shape could be read. It now runs for 31 elements rather than 395, and
 * every door moved off it gained. It stays because for those 31 there is
 * nothing else: no shape object anywhere in the stream.
 */
export function doorLeafCorners(
  record: ElementBoundsRecord,
  walls: WallRun[],
): [number, number, number][] | null {
  const { min, max } = record.boundsFeet;
  const centreX = (min.x + max.x) / 2;
  const centreY = (min.y + max.y) / 2;
  const centreZ = (min.z + max.z) / 2;
  const spanX = max.x - min.x;
  const spanY = max.y - min.y;
  const halfWidth = Math.max(spanX, spanY) / 2;
  if (halfWidth <= 0) return null;

  let best: { wall: WallRun; distance: number; fx: number; fy: number; ux: number; uy: number } | null = null;
  for (const wall of walls) {
    if (centreZ < wall.minZ - DOOR_HOST_HEIGHT_SLACK_FEET) continue;
    if (centreZ > wall.maxZ + DOOR_HOST_HEIGHT_SLACK_FEET) continue;
    const dx = wall.x1 - wall.x0;
    const dy = wall.y1 - wall.y0;
    const length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = Math.max(0, Math.min(1, ((centreX - wall.x0) * dx + (centreY - wall.y0) * dy) / length2));
    const fx = wall.x0 + dx * t;
    const fy = wall.y0 + dy * t;
    const distance = Math.hypot(centreX - fx, centreY - fy);
    // A door is in its own wall, so the centreline has to pass within the
    // door's own half width; anything further away is a different wall.
    if (distance > halfWidth) continue;
    const length = Math.sqrt(length2);
    if (!best || distance < best.distance) {
      best = { wall, distance, fx, fy, ux: dx / length, uy: dy / length };
    }
  }
  if (!best) return null;

  // Along the wall the record is already right, so its own extent on the axis
  // the wall runs along is the leaf width.
  const along = Math.abs(best.ux) > Math.abs(best.uy) ? spanX : spanY;
  const halfAlong = along / 2;
  const halfThick = best.wall.thickness / 2;
  const ring: [number, number][] = [
    [-halfAlong, -halfThick],
    [halfAlong, -halfThick],
    [halfAlong, halfThick],
    [-halfAlong, halfThick],
  ];
  const place = (s: number, t: number, z: number): [number, number, number] => [
    best!.fx + best!.ux * s - best!.uy * t,
    best!.fy + best!.uy * s + best!.ux * t,
    z,
  ];
  return [
    ...ring.map(([s, t]) => place(s, t, min.z)),
    ...ring.map(([s, t]) => place(s, t, max.z)),
  ];
}

/**
 * The leaf, taken from the door's own shared shape.
 *
 * A door family caches its shape in one of two forms, and this reads both.
 * Where the shape is the door's **B-rep**, `readLocalShape` has already turned
 * its trimmed planes into the leaf and flags it, and there is nothing to fold.
 * Where the shape is the cached **AABB**, that box is the *swing* and folding it
 * is what makes it a door.
 *
 * The swing is written in the family's local frame as
 *
 * ```text
 * [-w/2, -R, 0] .. [+w/2, +t, H]
 * ```
 *
 * The width is symmetric about the local origin, the height starts at it, and
 * the plan axis the arc sweeps through is *asymmetric*: the radius `R`, which is
 * about a leaf width, on one side, and on the other side `t` — the door's own
 * half thickness. Over 1,046 doors the median local box is 3.333 x 3.311 x 6.916
 * ft, square in plan, which is why transforming it untouched scores worse than
 * the record and why reading placements bought doors nothing at first.
 *
 * Folding that axis to `±min(|lo|, |hi|)` is the leaf, and it takes the
 * thickness from the door rather than from the wall it happens to sit in. The
 * swing axis is local y for 1,067 of 1,067 doors and local z starts at 0 for
 * 1,067 of 1,067, but it is found rather than assumed, because a mirrored family
 * inverts the sign.
 *
 * On the 1,067 doors this reaches, the wall-derived leaf's 75.0% centre and
 * 51.6% size agreement become **100.0% and 99.9%**, median 0.000 ft on both,
 * with 1,065 sizes better and none worse. The controls isolate every part:
 * without the fold 0.0/0.0, folding the wrong plan axis 0.0/0.0, a shuffled
 * origin 0.0 on centre, a shuffled basis 26.5 on size, a shape shuffled between
 * doors 53.6, and folding to the *wall's* thickness instead of the door's own
 * 71.0 — that last one being what taking the thickness from the door is worth.
 *
 * It stays scoped to doors: the same fold would change 4,153 of 6,480 shared
 * shapes, so it is a fact about door families, not about the shape reader.
 *
 * **Between the two forms this route now reaches 1,801 elements against 1,220,
 * and the host wall is down to 31 of them from 395.** That is where the door row
 * of the overlay went: 89.0% / 82.2% on centre and size to **99.2% / 99.1%**,
 * over 1,824 drawn doors rather than 1,641. The wall fallback was never the
 * problem it looked like — it is accurate on centre and wrong on *size*, 97.1%
 * against 68.3%, because it takes the thickness from whatever wall the door
 * happens to sit in. Every door that stops needing it gains 30 points of size
 * agreement.
 */
/** Share of the swing axis's own span by which it must sit off centre. */
const SWING_ASYMMETRY_FLOOR = 0.1;

/**
 * Smallest extent, on every axis, a leaf may have and still be a leaf.
 *
 * A shape can read as a valid box and have no size — the six subnormal doubles
 * of a field table order correctly and are finite. Five doors were drawn to one
 * of those: eight identical corners, a door rendered as a **point**, and the
 * worst size disagreement in the class at 7.63 ft. Their own envelope
 * reproduces the export to 0.00 ft, so the fallback is not a guess; it is the
 * reading that was already there and was being replaced by nothing.
 */
const MIN_LEAF_EXTENT_FEET = 1e-3;

/** True when eight world corners enclose something rather than a point. */
function hasExtent(corners: [number, number, number][]): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (const corner of corners) {
      low = Math.min(low, corner[axis]!);
      high = Math.max(high, corner[axis]!);
    }
    if (!(high - low > MIN_LEAF_EXTENT_FEET)) return false;
  }
  return true;
}

export function doorLeafFromShape(
  placement: InstancePlacement,
  shape: LocalBounds,
): [number, number, number][] | null {
  // A shape read out of the door's own B-rep is the leaf already; the fold
  // below is for the cached AABB, which is the swing. Both are symmetric in
  // plan once read, so the fold cannot tell them apart and used to decline the
  // B-rep — which sent 154 doors to the host wall for a thickness they carry
  // themselves, 68.3% size agreement where the door's own shape gives 99.5%.
  if (shape.leaf) {
    const corners = instanceCorners(placement, shape);
    return hasExtent(corners) ? corners : null;
  }
  const [minX, minY, minZ] = shape.min;
  const [maxX, maxY, maxZ] = shape.max;
  const spans = [maxX - minX, maxY - minY];
  if (spans.some((span) => !(span > 0))) return null;

  // The swing axis is the plan axis whose extent is not centred on the local
  // origin; the other is the leaf's width. A shape symmetric in both is not a
  // swing and has nothing to fold — folding it would be a no-op that quietly
  // replaced the record with the shape's own box, so such a door is declined
  // and keeps the wall-derived leaf. On the doors this reaches, the swing axis
  // is off centre by 84% of its own span, so the floor is not a close call.
  const offCentre = [Math.abs(minX + maxX), Math.abs(minY + maxY)];
  const swingAxis = offCentre[1]! > offCentre[0]! ? 1 : 0;
  if (offCentre[swingAxis]! < spans[swingAxis]! * SWING_ASYMMETRY_FLOOR) return null;
  const lo = swingAxis === 0 ? minX : minY;
  const hi = swingAxis === 0 ? maxX : maxY;
  const halfThickness = Math.min(Math.abs(lo), Math.abs(hi));
  if (!(halfThickness > 0)) return null;

  const folded: LocalBounds = swingAxis === 0
    ? { elementId: shape.elementId, min: [-halfThickness, minY, minZ], max: [halfThickness, maxY, maxZ] }
    : { elementId: shape.elementId, min: [minX, -halfThickness, minZ], max: [maxX, halfThickness, maxZ] };
  const corners = instanceCorners(placement, folded);
  return hasExtent(corners) ? corners : null;
}
