import type { IndoorDataset } from "./indoor-contract.ts";
import type { DirectoryRoom, RoomPoint } from "./room-directory.ts";
import { nativeFloorUnion } from "./native-circulation-clearance.ts";

/** One immutable compilation phase. Strict portal voids are holes in the union
 * of current original native slab material; registered annotation holes remain
 * metadata. A hole covered by another exact slab is supported floor. */
export function createNativePortalFloorVoidQuery(data: IndoorDataset) {
  const cache = new Map<number, RoomPoint[][]>();
  return (elevationFeet: number, rooms: DirectoryRoom[]): RoomPoint[][] => {
    if (!data.nativeIndoorEnvelopes)
      return rooms.flatMap((r) => [
        ...(r.holesFeet ?? []),
        ...(r.floorOpeningsFeet ?? []),
      ]);
    if (cache.has(elevationFeet)) return cache.get(elevationFeet)!;
    if (
      data.walkingSupport?.version !== 1 ||
      data.walkingSupport.sourceModelSha256 !== data.source.modelSha256
    )
      throw new Error(
        "Current original native floor support is unavailable for doorway void review.",
      );
    const floors = data.walkingSupport.floors
      .filter((f) => Math.abs(f.elevationFeet - elevationFeet) < 0.05)
      .flatMap((f) => f.partsFeet ?? [f.ringsFeet]);
    if (!floors.length)
      throw new Error(
        "The physical doorway plane has no current original native floor support.",
      );
    const holes = nativeFloorUnion(floors).flatMap((part) => part.slice(1));
    cache.set(elevationFeet, holes);
    return holes;
  };
}
