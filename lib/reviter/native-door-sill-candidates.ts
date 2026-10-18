import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import { nativeRationalAreaCompare } from "./native-exact-planar-topology.ts";
import { nativeRationalOverlay } from "./native-rational-overlay.ts";

/** Source-pattern discovery, NOT a traversability or stepping certificate.
 * Require a persisted own-host mullion, an original native oriented body,
 * matching leaf/sill elevations and positive exact material inside the doorway.
 * The 150 mm discovery cap is not a walking/accessibility allowance.
 */
export function nativeDoorSillCandidates(model: Pick<ConvertResult, "elementBounds" | "nativeHostRelations">,
  data: IndoorDataset, levelIds: readonly number[], maximumHeightMillimetres = 150) {
  if (!Number.isFinite(maximumHeightMillimetres) || maximumHeightMillimetres <= 30.48 || maximumHeightMillimetres > 300)
    throw Error("Invalid sill-discovery height budget");
  if (data.nativeMaterialSections?.sourceModelSha256 !== data.source.modelSha256)
    throw Error("Current model-bound native material sections are required");
  const bounds = new Map(model.elementBounds.map(e => [e.elementId, e]));
  const elevations = new Map(data.nativeLevels.map(l => [l.id, l.elevationFeet]));
  const children = new Map<number, number[]>();
  const hostOf = new Map<number, number>();
  for (const relation of model.nativeHostRelations ?? []) {
    if (relation.evidence !== "persisted") continue;
    hostOf.set(relation.elementId, relation.hostId);
    const list = children.get(relation.hostId) ?? [];
    list.push(relation.elementId); children.set(relation.hostId,list);
  }
  return (data.doors ?? []).flatMap(door => {
    if (!levelIds.includes(door.levelId) || !door.footprintFeet) return [];
    const z = elevations.get(door.levelId), hostId = door.hostWallNativeElementId;
    const leaf = bounds.get(door.nativeElementId), host = hostId && bounds.get(hostId);
    if (z === undefined || !hostId || !leaf || !host || host.wallKind !== "curtain" ||
        hostOf.get(door.nativeElementId) !== hostId) return [];
    const rows = data.nativeMaterialSections!.levels.filter(row => row.levelId === door.levelId &&
      row.elevationFeet === z && row.cutElevationFeet === z+.1);
    const members = (children.get(hostId) ?? []).flatMap(id => {
      const member = bounds.get(id);
      if (member?.categoryId !== -2000171 || member.renderGeometryProvenance !== "native" ||
          member.orientedBox?.length !== 8 || member.boundsFeet.min.z !== z ||
          member.boundsFeet.max.z !== leaf.boundsFeet.min.z ||
          member.boundsFeet.max.z <= z+.1 || (member.boundsFeet.max.z-z)*304.8 > maximumHeightMillimetres) return [];
      const source = rows.flatMap(row => row.sections).filter(section => section.nativeElementId === id);
      const parts = source.flatMap(section => section.partsFeet);
      if (!parts.length || nativeRationalAreaCompare(nativeRationalOverlay("intersection", [[door.footprintFeet!]], parts),[]) <= 0) return [];
      return [{ nativeElementId:id, heightMillimetres:(member.boundsFeet.max.z-z)*304.8,
        baseElevationFeet:z, topElevationFeet:member.boundsFeet.max.z,
        categoryId:member.categoryId, originalOrientedBox:member.orientedBox,
        exactMaterialIntersectsOriginalDoor:true as const,
        originalPartsFeet:parts }];
    });
    if (!members.length) return [];
    return [{ doorId:door.id, nativeDoorElementId:door.nativeElementId, levelId:door.levelId,
      elevationFeet:z, nativeHostElementId:hostId, originalDoor:door,
      doorLeafBaseFeet:leaf.boundsFeet.min.z, members,
      existingPortalEdgeIds:data.edges.filter(e=>e.kind==="door" && e.enabled && e.nativeElementId===door.nativeElementId).map(e=>e.id),
      authorityGranted:false as const }];
  });
}
