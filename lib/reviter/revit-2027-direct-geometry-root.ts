import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "./revit-2027-grep-prefixes.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT } from "./revit-2027-geometry.ts";

export type Revit2027DirectGeometryRootLike = {
  children: readonly {
    sourceClassSlot: number | null;
  }[];
};

/**
 * Whether a framed Revit 2027 GRep root has a certified direct-Geometry
 * initial descriptor shape.
 *
 * The browser FIFO has exact readers for both accepted initial classes. The
 * terminal Geometry owns the Face/Edge topology; any leading GGroups are
 * replayed first and append their own children behind the older root siblings.
 * No other initial class is admitted here. In particular, the wall population
 * with leading slot-2254 GFilter descriptors remains unsupported and fails
 * closed even though its root also ends in Geometry.
 */
export function isRevit2027DirectGeometryRoot(
  root: Revit2027DirectGeometryRootLike,
): boolean {
  const { children } = root;
  if (children.length === 0) return false;
  if (
    children[children.length - 1]?.sourceClassSlot !==
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return false;
  }
  return children
    .slice(0, -1)
    .every(
      (child) =>
        child.sourceClassSlot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    );
}
