/**
 * Real element solids built from native surface patches.
 *
 * A wall's geometry is written as three consecutive plane records at a 105-byte
 * stride: the centre plane first, then the two face planes offset by half the
 * wall thickness along the plane normal. That triple is everything needed to
 * reconstruct the wall as Revit modelled it:
 *
 * - location line: `origin + t·uDir` for `t` in `[uMin, uMax]`
 * - height: `origin.z + vMin` to `origin.z + vMax`
 * - thickness: the separation of the two face planes along `uDir × vDir`
 *
 * This is an oriented solid, not an axis-aligned envelope. A wall at 30° to the
 * model axes is drawn at 30°, with its true length and thickness, where the
 * bounding-box path could only draw the box enclosing it.
 *
 * The trim range is the wall *before* Revit's join trimming, so a solid built
 * this way runs slightly long where walls meet — by exactly half the thickness
 * of the wall it joins. That is the modelled extent, and it is what the file
 * says.
 */
import type { PlanePatch } from "./surfaces.ts";

/** Byte stride between the three plane records of one wall. */
const PLANE_STRIDE = 105;

/** A face plane further than this from the centre is not part of the triple. */
const MAX_HALF_THICKNESS_FEET = 10;

/** Below this the two faces are the same plane and no solid is implied. */
const MIN_THICKNESS_FEET = 1e-4;

/** Solids shorter than this are degenerate rather than wall-like. */
const MIN_LENGTH_FEET = 1e-3;

export type WallSolid = {
  elementId: number;
  /** Location line in model feet, before join trimming. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  baseElevation: number;
  topElevation: number;
  thickness: number;
};

function isVertical(plane: PlanePatch): boolean {
  return Math.abs(Math.abs(plane.vDir.z) - 1) <= 1e-9;
}

/** In-plane normal, `uDir × vDir`. */
function normal(plane: PlanePatch): { x: number; y: number; z: number } {
  const { uDir: u, vDir: v } = plane;
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
}

/**
 * Build wall solids from one element's attributed planes. Planes are grouped
 * into runs of three at the fixed stride; the first of a run is the centre.
 */
export function wallSolidsFor(elementId: number, planes: PlanePatch[]): WallSolid[] {
  const solids: WallSolid[] = [];
  const sorted = [...planes].sort((a, b) => a.offset - b.offset);

  for (let index = 0; index + 2 < sorted.length; index += 1) {
    const centre = sorted[index]!;
    const faceA = sorted[index + 1]!;
    const faceB = sorted[index + 2]!;
    if (faceA.offset - centre.offset !== PLANE_STRIDE) continue;
    if (faceB.offset - faceA.offset !== PLANE_STRIDE) continue;
    if (!isVertical(centre) || !isVertical(faceA) || !isVertical(faceB)) continue;

    const axis = normal(centre);
    const separation = Math.abs(
      (faceB.origin.x - faceA.origin.x) * axis.x +
        (faceB.origin.y - faceA.origin.y) * axis.y +
        (faceB.origin.z - faceA.origin.z) * axis.z,
    );
    if (separation < MIN_THICKNESS_FEET || separation > MAX_HALF_THICKNESS_FEET * 2) continue;

    const start = {
      x: centre.origin.x + centre.uDir.x * centre.uMin,
      y: centre.origin.y + centre.uDir.y * centre.uMin,
    };
    const end = {
      x: centre.origin.x + centre.uDir.x * centre.uMax,
      y: centre.origin.y + centre.uDir.y * centre.uMax,
    };
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_LENGTH_FEET) continue;

    solids.push({
      elementId,
      start,
      end,
      baseElevation: centre.origin.z + centre.vMin,
      topElevation: centre.origin.z + centre.vMax,
      thickness: separation,
    });
    index += 2;
  }
  return solids;
}

/** Build solids for every element that has an attributed plane triple. */
export function wallSolids(planesByElement: Map<number, PlanePatch[]>): WallSolid[] {
  const solids: WallSolid[] = [];
  for (const [elementId, planes] of planesByElement) {
    for (const solid of wallSolidsFor(elementId, planes)) solids.push(solid);
  }
  return solids;
}
