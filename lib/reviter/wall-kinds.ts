/**
 * Whether a wall is a basic, curtain or stacked wall, from the type its own
 * record names.
 *
 * Revit writes all three as the same wall classes (`SWall`, `ArcWall`,
 * `FaceWall`); what differs is the class of the type: `BasicWallType`,
 * `CurtainWallType` or `StackedWallType`. A wall's record references its type
 * among the other ids it holds (the walls it joins, its level), and the type
 * is the one of those ids framed as a wall type.
 *
 * The scene needs this because a curtain wall is a container, whose panels and
 * mullions are drawn in its place, and it recognises one by the shape of its
 * bounds record. Two ordinary walls in the 2025 RAC sample share that shape;
 * both reference a `BasicWallType`, carry a complete native mesh, and are
 * drawn by the Autodesk Viewer, but were held back as containers.
 */
export type WallKind = "basic" | "curtain" | "stacked";

/** Wall element classes in the 2027 numbering. */
export const REVIT_2027_WALL_CLASSES: ReadonlySet<number> = new Set([
  450, // ArcWall
  1857, // FaceWall
  3899, // SWall
]);

/** Wall type classes in the 2027 numbering, and the kind each states. */
export const REVIT_2027_WALL_TYPE_KINDS: ReadonlyMap<number, WallKind> = new Map([
  [624, "basic"], // BasicWallType
  [1060, "curtain"], // CurtainWallType
  [2845, "curtain"], // NRCurtainWallType
  [2848, "curtain"], // NewCurtainWallType
  [4060, "stacked"], // StackedWallType
]);

/**
 * Each wall's kind: the kind of the one wall type among the ids its record
 * references. A wall that references none, or types of two kinds, is left
 * out rather than guessed.
 */
export function resolveWallKinds(
  wallReferences: ReadonlyMap<number, ArrayLike<number>>,
  wallTypeKinds: ReadonlyMap<number, WallKind>,
): Map<number, WallKind> {
  const kinds = new Map<number, WallKind>();
  for (const [wallId, references] of wallReferences) {
    let kind: WallKind | undefined;
    let conflicting = false;
    for (let index = 0; index < references.length; index += 1) {
      const found = wallTypeKinds.get(references[index]!);
      if (!found) continue;
      if (kind && kind !== found) conflicting = true;
      kind = found;
    }
    if (kind && !conflicting) kinds.set(wallId, kind);
  }
  return kinds;
}
