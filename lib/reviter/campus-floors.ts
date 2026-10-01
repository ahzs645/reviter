import { roomBuilding, type DirectoryRoom } from "./room-directory.ts";
import type { LevelBand } from "./types.ts";

export const CAMPUS_BUILDING = "all";

/** Shared native levels, not a guessed equivalence between building floor numbers. */
export function campusFloors(rooms: readonly DirectoryRoom[], levels: readonly LevelBand[]) {
  const active = rooms.filter(r => r.status !== "deleted");
  return levels.filter(l => l.levelId != null && Number.isFinite(l.elevation) && active.some(r => r.levelId === l.levelId))
    .map(l => {
      const records = active.filter(r => r.levelId === l.levelId);
      return {
        levelId: l.levelId!, elevation: l.elevation, name: l.name ?? `Level ${l.levelId}`,
        records: records.length,
        buildings: [...new Set(records.map(roomBuilding))].sort().map(building => {
          const members = records.filter(r => roomBuilding(r) === building);
          return { building, roomKeys: members.map(r => r.key), sections: [...new Set(members.flatMap(r => r.dwg?.sectionId ? [r.dwg.sectionId] : []))].sort() };
        }),
      };
    }).sort((a, b) => a.elevation - b.elevation || a.levelId - b.levelId);
}

export function campusFloorLabel(floor: ReturnType<typeof campusFloors>[number]) {
  return `${floor.name} · ${floor.elevation.toFixed(2)} ft · #${floor.levelId} · ${floor.buildings.length} ${floor.buildings.length===1?"building":"buildings"}`;
}
