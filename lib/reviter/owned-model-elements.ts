import { registerReleaseMarker } from "./release-markers.ts";
import { categoryDisplayName } from "./native-categories.ts";
import { meshBoundsByElement } from "./mesh-element-bounds.ts";
import type { ElementBoundsRecord, MeshData, Vec3 } from "./types.ts";

const classes = new Map<string, number>();
for (const [name, index] of Object.entries({
  SWall: 3899,
  Ceiling: 766,
  FaceRoof: 1842,
  SweepHost: 4298,
})) {
  classes.set(
    name,
    registerReleaseMarker(name, index, (value) => {
      classes.set(name, value);
    }),
  );
}
const categories = new Map<string, number>([
  ["SWall", -2000011],
  ["Ceiling", -2000038],
  ["FaceRoof", -2000035],
  ["SweepHost", -2001392],
]);

export function physicalModelCategory(
  classIndex: number | null,
  headerCategory: number | undefined,
): number | null {
  if (headerCategory == null) return null;
  for (const [name, slot] of classes)
    if (slot === classIndex && categories.get(name) === headerCategory) return headerCategory;
  return null;
}

/** Nearby facade objects can justify hiding an envelope proxy, but do not
 * prove that a physical wall's own BRep is a curtain-system container. */
export function heldNativeWrapperIds(
  wrappers: readonly ElementBoundsRecord[], records: readonly ElementBoundsRecord[],
  physical: ReadonlyMap<number, number>,
  ownership: readonly { ownerId: number; elementId: number }[],
): Set<number> {
  const facadeIds = new Set(records.filter(r => r.categoryId === -2000170 || r.categoryId === -2000171).map(r => r.elementId));
  const facadeOwners = new Set(ownership.filter(r => facadeIds.has(r.elementId)).map(r => r.ownerId));
  return new Set(wrappers.filter(r => physical.get(r.elementId) !== -2000011 || facadeOwners.has(r.elementId)).map(r => r.elementId));
}

/** Class + owned header prove a placed model element even when its bounds
 * record is absent. Only an admitted complete mesh may create its UI record;
 * this never creates an envelope proxy for an undecoded roof or slab edge.
 */
export function appendOwnedNativeRecords(
  records: ElementBoundsRecord[],
  meshes: readonly MeshData[],
  origin: Vec3,
  proven: ReadonlyMap<number, number>,
): void {
  const known = new Set(records.map((r) => r.elementId));
  for (const [id, b] of meshBoundsByElement(meshes, origin)) {
    const categoryId = proven.get(id);
    if (categoryId == null || known.has(id)) continue;
    records.push({
      elementId: id,
      stream: "Partitions/102+103",
      chunkIndex: 0,
      rawOffset: 0,
      recordOffset: 0,
      categoryId,
      categoryName: categoryDisplayName(categoryId),
      categorySource: "element-header",
      boundsFeet: { min: { x: b[0]!, y: b[1]!, z: b[2]! }, max: { x: b[3]!, y: b[4]!, z: b[5]! } },
      renderGeometryProvenance: "native",
      boundsFromNativeMesh: true,
    });
    known.add(id);
  }
}
