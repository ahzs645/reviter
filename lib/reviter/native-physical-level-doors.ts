import { directoryDoorReviews, type DoorReview, type ReviewedDoorLink } from "./directory-navigation.ts";
import { nativePhysicalLevelAssignments } from "./native-physical-level-records.ts";
import type { DirectoryDoor, DirectoryRoom } from "./room-directory.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

/** Doors of a native level whose identity-level review found no portal may
 * still join rooms LABELLED ON that physical level (native-physical-level-
 * records): a raised Floor 1.25 room registered on Floor 1 is entered through
 * Floor 1.25 doors. The ordinary door review (door adjoins both rooms, no third
 * room, same floor height later) is rerun with those rooms added; only a door
 * left unmatched by the identity review and now joining at least one such room
 * changes. Room identities, levels and coordinates are unchanged. */
export function physicalLevelDoorReviews(
  dataset: Pick<IndoorDataset, "records" | "nativeLevels" | "walkingSupport" | "nativePhysicalLevels">,
  sourceRooms: readonly DirectoryRoom[],
  levelId: number,
  reviews: DoorReview[],
  doors: readonly DirectoryDoor[],
  reviewed: readonly ReviewedDoorLink[] = [],
  explicitReviews: readonly ReviewedDoorLink[] = reviewed,
): { doorId: number; roomKeys: string[] }[] {
  const moved = nativePhysicalLevelAssignments(dataset as never);
  const physical = sourceRooms.filter((r) => r.levelId !== levelId && moved.get(r.key)?.physicalLevelId === levelId);
  if (!physical.length || !reviews.some((r) => !r.portal)) return [];
  const keys = new Set(physical.map((r) => r.key));
  const extended = new Map(directoryDoorReviews([...sourceRooms.filter((r) => r.levelId === levelId), ...physical], doors, reviewed, explicitReviews).map((r) => [r.door.id, r]));
  const changed: { doorId: number; roomKeys: string[] }[] = [];
  for (const review of reviews) {
    if (review.portal) continue;
    const alternative = extended.get(review.door.id);
    if (!alternative?.portal || !alternative.portal.rooms.some((k) => keys.has(k))) continue;
    review.portal = alternative.portal;
    review.state = "connected";
    review.candidates = alternative.candidates;
    changed.push({ doorId: review.door.id, roomKeys: [...alternative.portal.rooms] });
  }
  return changed;
}
