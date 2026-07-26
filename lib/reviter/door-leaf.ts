/**
 * Cutting a door leaf out of the opening its record describes.
 */
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
