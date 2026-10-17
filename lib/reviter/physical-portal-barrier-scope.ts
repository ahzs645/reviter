/** Physical doors/openings are compiled on a declared native plane. Directory
 * room/node level identities may differ for raised or split-level rooms; they
 * cannot select the wall inventory or aperture list for the physical crossing.
 * Missing scope is a refusal, never an empty-barrier fallback. */
export function physicalPortalBarrierScope<Geometry, Opening>(
  portalId: string,
  physicalLevels: ReadonlyMap<string, number>,
  geometries: ReadonlyMap<number, Geometry>,
  openings: ReadonlyMap<number, readonly Opening[]>,
): { levelId: number; geometry: Geometry; openings: readonly Opening[] } | undefined {
  const levelId = physicalLevels.get(portalId);
  if (levelId === undefined) return undefined;
  const geometry = geometries.get(levelId), planeOpenings = openings.get(levelId);
  if (geometry === undefined || planeOpenings === undefined) return undefined;
  return { levelId, geometry, openings: planeOpenings };
}
