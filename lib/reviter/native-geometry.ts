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
import { noteLimit } from "./limit-census.ts";
import type { CylinderPatch, PlanePatch } from "./surfaces.ts";

/** Byte stride between the three plane records of one wall. */
const PLANE_STRIDE = 105;

/** A face plane further than this from the centre is not part of the triple. */
const MAX_HALF_THICKNESS_FEET = 10;

/** Below this the two faces are the same plane and no solid is implied. */
const MIN_THICKNESS_FEET = 1e-4;

/** Solids shorter than this are degenerate rather than wall-like. */
const MIN_LENGTH_FEET = 1e-3;

/** A trim range wider than this is a construction plane, not a face. */
const MAX_QUAD_SPAN_FEET = 2_000;

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
 *
 * **The verticality test is declining raked triples correctly, and there is
 * nothing behind it to recover.** Of the 232 elements whose export footprint is
 * angled and that are still drawn as an axis-aligned box, 67 own surfaces and 33
 * have a stride-105 triple — 314 triples between them, and *not one* has all
 * three planes vertical. The other 165 own no surface at all, for the reason
 * recorded in `surfaces.ts`: they have no geometry object.
 *
 * Two things about that reading were checked afterwards and one of them was
 * wrong, so both are recorded here.
 *
 * The readings quoted as evidence of a sloped body — `uDir.z = 0.3367`,
 * `vDir.z = 0.9416` — are not one. For an orthonormal frame `uDir.z² + vDir.z² +
 * n.z² = 1`, and those two sum to 1.000, so the *normal is horizontal*: that is a
 * **vertical** plane whose parametric axes are rotated within it, which
 * `isVertical` declines for the wrong reason. Both kinds exist. Of the model's
 * 82,021 planes, 51,237 are vertical — 45,341 with `vDir` up, which is what this
 * function accepts, 5,484 with `uDir` up, and **412 with the frame tilted
 * in-plane** — against 29,994 horizontal and **790 raked**.
 *
 * And the raked case is not recoverable, which settles the question rather than
 * leaving it open. The frame-agnostic form of the wall test — three consecutive
 * planes mutually parallel, the centre midway between the faces, all three trims
 * the same size, in any orientation — was run over every stride-105 window in the
 * file: 31,153 windows, 17,181 mutually parallel, 6,553 with the centre midway,
 * 6,495 with equal trims. Of those 6,553, **6,352 are the ones this function
 * already takes**, 200 are horizontal and sit on elements with neither a bounds
 * record nor an export product, exactly **1** is a vertical tilted frame, and
 * **0 are raked**. Narrower again: 335 windows have a raked centre plane, 217
 * have one face parallel to it — the opposite side of a sloped slab — 5 have
 * both, and **0** have the centre midway between them, at 1e-6 or at 0.01 ft.
 *
 * So relaxing the test to "the normal is horizontal" would gain one triple, and a
 * raked analogue of this function has nothing to build from. What the raked
 * elements own is the *facet list* of a closed body: 24 of the 33 are
 * `Stairs Stringer Carriage`, and each owns 11 to 13 consecutive plane records —
 * written twice — that are a stringer's two vertical cheeks, its raked soffit and
 * tread, and its end caps. A sliding window of three over a facet list is what
 * the 314 triples were. Revit writes a wall as centre-plus-faces because a wall
 * is an extrusion of a stored location line; a stringer is not, and no centre
 * plane exists for it. What those facets *are* good for is `facetElevationBand`
 * below.
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
    if (separation < MIN_THICKNESS_FEET || separation > MAX_HALF_THICKNESS_FEET * 2) {
      if (separation > MAX_HALF_THICKNESS_FEET * 2) noteLimit("max-half-thickness-feet");
      continue;
    }

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

/**
 * A single trimmed plane, as the quad its parametric bounds describe.
 *
 * Elements that own surfaces but no wall triple — a stair stringer, a lone
 * panel face — would otherwise fall back to a bounding box. Drawing the plane
 * itself is closer to what the file says: it is the real face, at its real
 * orientation, over its real trim range. It is a face and not a solid, so it is
 * reported separately rather than being passed off as a rebuilt body.
 */
export type SurfaceQuad = {
  elementId: number;
  /** Corners in model feet, in trim order. */
  corners: [number, number, number][];
};

/**
 * A facet with less vertical component than this says nothing about where the
 * element stops in z. The number is not fitted: over the model's envelope-drawn
 * elements that own facets, every threshold from 1e-9 to 0.5 selects the same 79.
 * A stair stringer's facets read `|normal.z|` of exactly 0 (529 vertical cheeks),
 * 0.876–0.925 (312 raked soffits and treads) and exactly 1 (61 caps), so the
 * plateau is the whole gap between "vertical" and "sloped".
 */
const CAP_NORMAL_Z = 0.1;

/**
 * The elevation band the element's own faces bound it to, or null when they do
 * not bound it at all.
 *
 * **A stair sub-component's duplicated-bounds record carries the stair
 * assembly's z band, not the component's.** Of the 263 stringer carriages that
 * join an export product, 214 reach over a foot past their own box and **208 of
 * those are wrong in z alone** — their plan is right to 0.16 ft. A stringer 1.3 ft
 * deep is drawn 14.4 ft tall, from the bottom of the stair to the top, and on
 * screen that is a fin standing through the storeys below it.
 *
 * The element's analytic faces are a second, independent reading of the same
 * element, so intersecting the two can only shrink the box — the same argument
 * `clipSolidToEnvelope` rests on, and it means no element can gain extent it did
 * not have.
 *
 * **The cap test is the whole rule, and without it this is a net loss.** Applied
 * to every facet set, narrowing takes `IfcMember` centre agreement from 33.7% to
 * 61.4% *and* `IfcWallStandardCase` from 100.0% to 34.9%, flattening 27 of 43
 * walls to zero height: a wall's attributed facets are a fragment of one vertical
 * face, and a vertical face says nothing about where the wall stops. So the
 * premise is checked rather than the category being named — the set must cap the
 * element both above and below. That accepts 79 of the 174 envelope-drawn
 * elements that own facets and join a product (78 stringers and 1 stair run),
 * declines all 49 walls, all 4 `IfcWall`, both slabs and the covering, and
 * flattens nothing:
 *
 * | | shipped | narrowed |
 * | --- | --- | --- |
 * | `IfcMember` centre / size, n=83 | 33.7% / 31.3% | **63.9% / 57.8%** |
 * | median centre error | 1.811 ft | **0.082 ft** |
 * | `IfcWallStandardCase`, n=43 | 100.0% / 100.0% | 100.0% / 100.0% |
 * | `IfcStairFlight`, n=41 | 90.2% / 90.2% | 90.2% / 90.2% |
 *
 * **The gain needs the element's own faces.** Giving each accepted element
 * another accepted element's band instead scores `IfcMember` at 9.6% with 32 of
 * 83 flattened, against 63.9% and 0 flattened; against a shuffled truth the rule
 * improves 0 elements where it improves 42 against the real one.
 *
 * The one stair run the cap test accepts is excluded at the call site, not here:
 * its box came from the stair-companion record, which is already a verified
 * second reading of the same element, and narrowing that took it from 0.00 ft to
 * 2.20 ft out. A better reading is not something to intersect with a coarser one.
 *
 * It reaches 6 of the 27 elements over 10 ft past their own box, because the
 * other 21 own no facet at all — 190 of the 273 drawn stringers own none, for the
 * reason recorded in `surfaces.ts`: no anchor, no geometry object, no surfaces.
 */
export function facetElevationBand(quads: SurfaceQuad[]): { min: number; max: number } | null {
  let capsAbove = false;
  let capsBelow = false;
  let min = Infinity;
  let max = -Infinity;
  for (const quad of quads) {
    const [a, b, c] = [quad.corners[0], quad.corners[1], quad.corners[2]];
    if (!a || !b || !c) continue;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      const unitZ = nz / length;
      if (unitZ > CAP_NORMAL_Z) capsAbove = true;
      if (unitZ < -CAP_NORMAL_Z) capsBelow = true;
    }
    for (const corner of quad.corners) {
      min = Math.min(min, corner[2]);
      max = Math.max(max, corner[2]);
    }
  }
  if (!capsAbove || !capsBelow || !Number.isFinite(min)) return null;
  return { min, max };
}

export function surfaceQuadsFor(elementId: number, planes: PlanePatch[]): SurfaceQuad[] {
  const quads: SurfaceQuad[] = [];
  for (const plane of planes) {
    const du = plane.uMax - plane.uMin;
    const dv = plane.vMax - plane.vMin;
    if (du < MIN_LENGTH_FEET || dv < MIN_LENGTH_FEET) continue;
    if (du > MAX_QUAD_SPAN_FEET || dv > MAX_QUAD_SPAN_FEET) {
      noteLimit("max-quad-span-feet");
      continue;
    }
    const at = (u: number, v: number): [number, number, number] => [
      plane.origin.x + plane.uDir.x * u + plane.vDir.x * v,
      plane.origin.y + plane.uDir.y * u + plane.vDir.y * v,
      plane.origin.z + plane.uDir.z * u + plane.vDir.z * v,
    ];
    quads.push({
      elementId,
      corners: [
        at(plane.uMin, plane.vMin),
        at(plane.uMax, plane.vMin),
        at(plane.uMax, plane.vMax),
        at(plane.uMin, plane.vMax),
      ],
    });
  }
  return quads;
}

/** Build solids for every element that has an attributed plane triple. */
export function wallSolids(planesByElement: Map<number, PlanePatch[]>): WallSolid[] {
  const solids: WallSolid[] = [];
  for (const [elementId, planes] of planesByElement) {
    for (const solid of wallSolidsFor(elementId, planes)) solids.push(solid);
  }
  return solids;
}

/**
 * A curved wall segment, as an annulus sector.
 *
 * A straight wall is three plane records at a 105-byte stride — centre, then the
 * two faces half a thickness out. A curved wall is written exactly the same way,
 * in cylinder records at their own 137-byte stride: the centre cylinder carries
 * the centreline radius and the two faces carry that radius plus and minus half
 * the thickness. The test is arithmetic rather than positional — the middle
 * record's radius is the mean of the outer two — so a run of unrelated cylinders
 * cannot pass it.
 *
 * **Verification against the paired IFC export.** 42 stride-137 triples exist in
 * the supplied project and 27 have the centre radius, on 27 elements the export
 * types `IfcWallStandardCase`. For every one of the 27 the median distance from
 * an export vertex to the annulus sector is **0.0000 ft**; 18 have every vertex
 * within a foot. Against a shuffled pairing, **0 of 27** are within half a foot.
 * The larger worst-vertex figures are elements the export writes as an arc plus
 * straight runs, where the arc is exact over its own sweep and the residual is
 * the part of the element the arc does not cover.
 */
export type WallArc = {
  elementId: number;
  centre: { x: number; y: number };
  /** Centreline radius; the faces sit half a thickness either side. */
  radius: number;
  thickness: number;
  /** Sweep in radians, in the record's own basis. */
  startAngle: number;
  endAngle: number;
  baseElevation: number;
  topElevation: number;
  xDir: { x: number; y: number };
  yDir: { x: number; y: number };
};

/** Byte stride between the three cylinder records of one curved wall. */
const CYLINDER_STRIDE = 137;

/** The middle radius must be the mean of the outer two to within this. */
const CENTRE_RADIUS_TOLERANCE = 1e-6;

/** A sweep below this is a numerical artefact rather than an arc. */
const MIN_SWEEP_RADIANS = 1e-4;

export function wallArcsFor(elementId: number, cylinders: CylinderPatch[]): WallArc[] {
  const arcs: WallArc[] = [];
  const sorted = [...cylinders].sort((a, b) => a.offset - b.offset);

  for (let index = 0; index + 2 < sorted.length; index += 1) {
    const centre = sorted[index]!;
    const faceA = sorted[index + 1]!;
    const faceB = sorted[index + 2]!;
    if (faceA.offset - centre.offset !== CYLINDER_STRIDE) continue;
    if (faceB.offset - faceA.offset !== CYLINDER_STRIDE) continue;

    const mean = (faceA.radius + faceB.radius) / 2;
    if (Math.abs(mean - centre.radius) > CENTRE_RADIUS_TOLERANCE) continue;

    const thickness = Math.abs(faceB.radius - faceA.radius);
    if (thickness < MIN_THICKNESS_FEET || thickness > MAX_HALF_THICKNESS_FEET * 2) {
      if (thickness > MAX_HALF_THICKNESS_FEET * 2) noteLimit("max-half-thickness-feet");
      continue;
    }

    const sweep = Math.abs(centre.uMax - centre.uMin);
    if (sweep < MIN_SWEEP_RADIANS || sweep > 2 * Math.PI + MIN_SWEEP_RADIANS) continue;
    if (centre.radius < MIN_LENGTH_FEET) continue;

    arcs.push({
      elementId,
      centre: { x: centre.origin.x, y: centre.origin.y },
      radius: centre.radius,
      thickness,
      startAngle: Math.min(centre.uMin, centre.uMax),
      endAngle: Math.max(centre.uMin, centre.uMax),
      baseElevation: centre.origin.z + centre.vMin,
      topElevation: centre.origin.z + centre.vMax,
      xDir: { x: centre.xDir.x, y: centre.xDir.y },
      yDir: { x: centre.yDir.x, y: centre.yDir.y },
    });
    index += 2;
  }
  return arcs;
}

/** Build curved-wall arcs for every element that has a cylinder triple. */
export function wallArcs(cylindersByElement: Map<number, CylinderPatch[]>): WallArc[] {
  const arcs: WallArc[] = [];
  for (const [elementId, cylinders] of cylindersByElement) {
    for (const arc of wallArcsFor(elementId, cylinders)) arcs.push(arc);
  }
  return arcs;
}
