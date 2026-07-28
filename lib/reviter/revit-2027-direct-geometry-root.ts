import {
  REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
} from "./revit-2027-gfilter.ts";
import { REVIT_2027_GARC_SOURCE_CLASS_SLOT } from "./revit-2027-garc.ts";
import { REVIT_2027_GLINE_SOURCE_CLASS_SLOT } from "./revit-2027-gline.ts";
import { REVIT_2027_GPOINT_SOURCE_CLASS_SLOT } from "./revit-2027-gpoint.ts";
import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "./revit-2027-grep-prefixes.ts";
import {
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
} from "./revit-2027-ginstance.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT } from "./revit-2027-geometry.ts";

export type Revit2027DirectGeometryRootLike = {
  children: readonly {
    sourceClassSlot: number | null;
  }[];
};

const EXACT_TESSELLATOR_CANDIDATE_SHAPES = [
  [
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  ],
  [
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  ],
  [
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  ],
] as const;

const EMBEDDED_GEOMETRY_CANDIDATE_SHAPES = [
  [
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  ],
  [
    REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
    REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
  ],
] as const;

const CONDITIONED_GEOMETRY_PREFIX_SLOTS = new Set<number>([
  REVIT_2027_GFILTER_SOURCE_CLASS_SLOT,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  REVIT_2027_GPOINT_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
]);

function hasExactSourceClassShape(
  root: Revit2027DirectGeometryRootLike,
  expected: readonly number[],
): boolean {
  return (
    root.children.length === expected.length &&
    root.children.every(
      (child, index) => child.sourceClassSlot === expected[index],
    )
  );
}

/**
 * Whether the initial source-slot vector is one of the three exact Revit 2027
 * tessellator shapes measured against the fixed RVT/IFC acceptance pair.
 *
 * This is only a syntactic candidate check. FIFO replay certifies append-only
 * descriptor tokens, complete drawable-face/nested coverage, storage limits,
 * and the independent element envelope before production output.
 */
export function isRevit2027BoundedTessellatorRoot(
  root: Revit2027DirectGeometryRootLike,
): boolean {
  return EXACT_TESSELLATOR_CANDIDATE_SHAPES.some((shape) =>
    hasExactSourceClassShape(root, shape));
}

/** Whether the root has one of the two measured embedded-column shapes. */
export function isRevit2027EmbeddedGeometryRoot(
  root: Revit2027DirectGeometryRootLike,
): boolean {
  return EMBEDDED_GEOMETRY_CANDIDATE_SHAPES.some((shape) =>
    hasExactSourceClassShape(root, shape));
}

/**
 * Whether a root is the persisted conditioned-Geometry route used by members,
 * stair flights, and slabs in the exact Revit 2027 corpus.
 *
 * At least one GFilter is required. Every prefix object has a complete,
 * selector-free browser reader and is either a condition/control, curve,
 * grouping, or instance carrier; the terminal Geometry owns the BRep faces.
 * GCylindricalHelix and every unknown slot remain excluded. This is only a
 * syntactic admission candidate: FIFO, face coverage, recursive composition,
 * storage, and the independent element-envelope gate still fail closed.
 */
export function isRevit2027ConditionedGeometryRoot(
  root: Revit2027DirectGeometryRootLike,
): boolean {
  const { children } = root;
  if (
    children.length < 2 ||
    children[children.length - 1]?.sourceClassSlot !==
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return false;
  }
  const prefix = children.slice(0, -1);
  return (
    prefix[0]?.sourceClassSlot === REVIT_2027_GFILTER_SOURCE_CLASS_SLOT &&
    prefix.every(
      (child) =>
        child.sourceClassSlot != null &&
        CONDITIONED_GEOMETRY_PREFIX_SLOTS.has(child.sourceClassSlot),
    )
  );
}

/**
 * Whether a framed Revit 2027 GRep root has a certified direct-Geometry
 * initial descriptor shape.
 *
 * The browser FIFO has exact readers for every accepted initial class. The
 * terminal Geometry owns the Face/Edge topology; leading GGroups, GFilters,
 * and GInstances append their children behind older root siblings during
 * replay.
 *
 * This classifier checks only the release-certified source-slot shape.
 * `certifyRevitGRepInitialQueue` and full FIFO replay independently require
 * append-only descriptor token ordering before any root can produce output.
 * The three non-GGroup shapes are exact, population-bounded candidates rather
 * than general admissions: complete drawable-face/nested coverage and the
 * independent element-envelope gate still fail closed downstream.
 */
export function isRevit2027DirectGeometryRoot(
  root: Revit2027DirectGeometryRootLike,
): boolean {
  const { children } = root;
  if (children.length === 0) return false;
  if (
    isRevit2027BoundedTessellatorRoot(root) ||
    isRevit2027EmbeddedGeometryRoot(root)
  ) {
    return true;
  }
  if (
    children[children.length - 1]?.sourceClassSlot !==
    REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    return false;
  }
  const directGroupShape = children
    .slice(0, -1)
    .every(
      (child) =>
        child.sourceClassSlot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  );
  return (
    directGroupShape ||
    isRevit2027ConditionedGeometryRoot(root)
  );
}
