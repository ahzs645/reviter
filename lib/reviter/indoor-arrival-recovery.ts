import { indoorRegionBlocker } from "./indoor-region.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import type { DirectoryRoom, RoomPoint } from "./room-directory.ts";

/** Exact segment coverage by the union of native slab polygons, including holes.
 * Missing native floors never enable arrival recovery. No door envelope fills a
 * slab gap, and no point sampling can skip a thin unsupported interval. */
export function nativeArrivalFloorSupport(
  geometry: Pick<ArchitecturalPlanGeometry, "floors">,
): ((a: RoomPoint, b: RoomPoint) => boolean) | undefined {
  if (!geometry.floors.length) return undefined;
  const floors: DirectoryRoom[] = geometry.floors.filter(f => f[0]?.length).map((f,i) => ({
    key: `native-floor:${i}`, levelId: 1, building: "native", confidence: 1,
    polygonFeet: f[0]! as RoomPoint[], holesFeet: f.slice(1) as RoomPoint[][],
    labelPointFeet: f[0]![0]! as RoomPoint,
  }));
  if (!floors.length) return undefined;
  const blocked = indoorRegionBlocker(floors, [], []);
  return (a,b) => !blocked(a,b);
}
