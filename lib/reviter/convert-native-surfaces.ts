/**
 * Native surface patches, gathered into the shapes they describe.
 *
 * The page walk collects trimmed planes and cylinders one at a time, attributed
 * to whichever element owns them. This stage is the first that looks at an
 * element's patches as a set: a triple of planes is a wall's location line and
 * thickness, a cylinder triple is a curved wall's arc, and whatever is left is
 * still a set of real faces worth drawing.
 *
 * Nothing here reads the file, and nothing here consults the element records —
 * these are readings of the geometry alone, which is what makes them usable as
 * an independent cross-check on the records later.
 */
import { instanceCorners } from "./instanced-geometry.ts";
import { surfaceQuadsFor, wallArcs, wallSolids } from "./native-geometry.ts";

import type { InstancePlacement, LocalBounds } from "./instanced-geometry.ts";
import type { CylinderPatch, PlanePatch } from "./surfaces.ts";

type WallSolid = ReturnType<typeof wallSolids>[number];
type WallArc = ReturnType<typeof wallArcs>[number];
type SurfaceQuads = ReturnType<typeof surfaceQuadsFor>;

export type NativeSurfacesInput = {
  planesByElement: Map<number, PlanePatch[]>;
  cylindersByElement: Map<number, CylinderPatch[]>;
  instancePlacements: Map<number, InstancePlacement>;
  /** Shared local shapes, keyed by the geometry id a placement points at. */
  localBounds: Map<number, LocalBounds>;
};

export type NativeSurfaces = {
  /** Every solid an element was rebuilt from. */
  solidGroups: Map<number, WallSolid[]>;
  /** The longest of them: the body properties and picking report. */
  solidsByElement: Map<number, WallSolid>;
  arcsByElement: Map<number, WallArc[]>;
  /** Placed instances resolved against their shared shape. */
  orientedBoxes: Map<number, [number, number, number][]>;
  faceReadBoxes: Set<number>;
  /** Faces of elements with no rebuilt solid, which are drawn instead of a box. */
  quadsByElement: Map<number, SurfaceQuads>;
  /** Faces of every element that has them, solid or not. */
  allSurfaceQuadsByElement: Map<number, SurfaceQuads>;
};

export function reconstructNativeSurfaces(
  input: NativeSurfacesInput,
): NativeSurfaces {
  const { planesByElement, cylindersByElement, instancePlacements, localBounds } =
    input;
  // An element can own more than one solid — a wall built from several
  // segments. All of them are kept and all of them are drawn; the longest is
  // singled out only as the body that properties and picking report, which is
  // what one-record-per-element requires.
  const allSolids = wallSolids(planesByElement);
  const solidGroups = new Map<number, ReturnType<typeof wallSolids>>();
  const solidsByElement = new Map<number, ReturnType<typeof wallSolids>[number]>();
  const solidLength = (candidate: (typeof allSolids)[number]) =>
    Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);
  for (const solid of allSolids) {
    const group = solidGroups.get(solid.elementId);
    if (group) group.push(solid);
    else solidGroups.set(solid.elementId, [solid]);
    const existing = solidsByElement.get(solid.elementId);
    if (!existing || solidLength(solid) > solidLength(existing)) {
      solidsByElement.set(solid.elementId, solid);
    }
  }

  // A curved wall has no straight location line, so `wallSolidsFor` cannot
  // see it and it falls back to the rectangle enclosing the whole arc.
  const arcsByElement = new Map<number, ReturnType<typeof wallArcs>>();
  for (const arc of wallArcs(cylindersByElement)) {
    const group = arcsByElement.get(arc.elementId);
    if (group) group.push(arc);
    else arcsByElement.set(arc.elementId, [arc]);
  }

  // Loadable families are placed rather than written out: each instance holds
  // a rigid transform and points at a shared shape. Resolving the pair gives
  // the instance its true orientation instead of an axis-aligned envelope.
  const orientedBoxes = new Map<number, [number, number, number][]>();
  // Elements whose box was read from the bounding faces of their own B-rep.
  // The agreement check in `convert-element-geometry.ts` assumes the box and
  // the element's own bounds record are readings of the same thing, and for a
  // casement window they are not — see `LocalBounds.faceRead`.
  const faceReadBoxes = new Set<number>();
  for (const [elementId, placement] of instancePlacements) {
    const shape = localBounds.get(placement.geometryId);
    if (!shape) continue;
    if (shape.faceRead) faceReadBoxes.add(elementId);
    orientedBoxes.set(elementId, instanceCorners(placement, shape));
  }

  // Elements with surfaces that do not form a wall triple still have real
  // faces; drawing those beats falling back to a bounding box.
  const quadsByElement = new Map<number, ReturnType<typeof surfaceQuadsFor>>();
  const allSurfaceQuadsByElement =
    new Map<number, ReturnType<typeof surfaceQuadsFor>>();
  for (const [elementId, planes] of planesByElement) {
    const quads = surfaceQuadsFor(elementId, planes);
    if (!quads.length) continue;
    allSurfaceQuadsByElement.set(elementId, quads);
    if (!solidsByElement.has(elementId)) quadsByElement.set(elementId, quads);
  }

  return {
    solidGroups,
    solidsByElement,
    arcsByElement,
    orientedBoxes,
    faceReadBoxes,
    quadsByElement,
    allSurfaceQuadsByElement,
  };
}
