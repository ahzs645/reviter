export type Revit2027PlacementGeometrySource =
  | "direct-owner"
  | "composed-direct-nested-owner"
  | "composed-referenced-owner";

export type Revit2027PlacementGeometrySelection<Geometry> = {
  geometry: Geometry;
  source: Revit2027PlacementGeometrySource;
};

export function collectRevit2027PlacementGeometryTargetIds(
  placements: Iterable<{ geometryId: number }>,
  completedDirectOwnerElementIds: ReadonlySet<bigint>,
): Set<number> {
  const targets = new Set<number>();
  for (const placement of placements) {
    if (
      Number.isSafeInteger(placement.geometryId) &&
      !completedDirectOwnerElementIds.has(BigInt(placement.geometryId))
    ) {
      targets.add(placement.geometryId);
    }
  }
  return targets;
}

export function selectRevit2027PlacementGeometry<Geometry>(
  geometryOwnerId: number,
  directNestedOwnerIds: ReadonlySet<number>,
  directOwners: ReadonlyMap<number, Geometry>,
  completeDirectNestedOwners: ReadonlyMap<number, Geometry>,
  completeReferencedOwners: ReadonlyMap<number, Geometry>,
): Revit2027PlacementGeometrySelection<Geometry> | undefined {
  if (directNestedOwnerIds.has(geometryOwnerId)) {
    const geometry = completeDirectNestedOwners.get(geometryOwnerId);
    return geometry
      ? { geometry, source: "composed-direct-nested-owner" }
      : undefined;
  }
  const direct = directOwners.get(geometryOwnerId);
  if (direct) return { geometry: direct, source: "direct-owner" };
  const referenced = completeReferencedOwners.get(geometryOwnerId);
  return referenced
    ? { geometry: referenced, source: "composed-referenced-owner" }
    : undefined;
}
