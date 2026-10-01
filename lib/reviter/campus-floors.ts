import { roomBuilding, type DirectoryRoom, type RoomDirectoryData } from "./room-directory.ts";
import type { LevelBand } from "./types.ts";

export const CAMPUS_BUILDING = "all";
export type CampusStoreyReview = { id: string; name: string; levelIds: number[]; evidence: "user-reported" };

export function validateCampusStoreys(groups: readonly CampusStoreyReview[], rooms: readonly DirectoryRoom[]) {
  const assigned = new Set<number>(), ids = new Set<string>();
  const nativeIds = new Set(rooms.map(r => r.levelId));
  if (!Array.isArray(groups) || groups.length > 100) throw new Error("Campus storeys must be reviewed groups of native levels.");
  for (const group of groups) {
    if (!group || typeof group.id !== "string" || !group.id || group.id.length > 200 || ids.has(group.id)
      || typeof group.name !== "string" || !group.name.trim() || group.name.length > 200
      || group.evidence !== "user-reported" || !Array.isArray(group.levelIds) || group.levelIds.length < 2 || group.levelIds.length > 50
      || group.levelIds.some((id: number) => !Number.isSafeInteger(id) || !nativeIds.has(id))) {
      throw new Error("Campus storeys need a unique identity, a name, reported evidence and at least two existing native levels.");
    }
    for (const id of group.levelIds) {
      if (assigned.has(id)) throw new Error("A native level can belong to only one campus storey.");
      assigned.add(id);
    }
    ids.add(group.id);
  }
}

/** Update only the semantic grouping; source heights, geometry and navigation survive. */
export function saveCampusStorey(data: RoomDirectoryData, review: CampusStoreyReview): RoomDirectoryData {
  const saved = {...review, name: review.name.trim(), levelIds: [...review.levelIds]};
  const groups = [...data.campusStoreys ?? []];
  const index = groups.findIndex(g => g.id === saved.id);
  if (index < 0) groups.push(saved); else groups[index] = saved;
  validateCampusStoreys(groups, data.annotations);
  return {...data, campusStoreys: groups};
}

export function ungroupCampusStorey(data: RoomDirectoryData, id: string): RoomDirectoryData {
  return {...data, campusStoreys: (data.campusStoreys ?? []).filter(g => g.id !== id)};
}

/** Shared native levels, not a guessed equivalence between building floor numbers. */
export function campusFloors(rooms: readonly DirectoryRoom[], levels: readonly LevelBand[], reviews: readonly CampusStoreyReview[] = []) {
  const active = rooms.filter(r => r.status !== "deleted");
  const mapped = levels.filter(l => l.levelId != null && Number.isFinite(l.elevation) && active.some(r => r.levelId === l.levelId));
  const groups = mapped.filter(l=>!reviews.some(r=>r.levelIds.includes(l.levelId!))).map(l=>({name:l.name??`Level ${l.levelId}`,levelIds:[l.levelId!],reviewed:false}));
  for(const review of reviews){const ids=review.levelIds.filter(id=>mapped.some(l=>l.levelId===id));if(ids.length)groups.push({name:review.name,levelIds:ids,reviewed:true});}
  return groups
    .map(l => {
      const nativeLevels=mapped.filter(level=>l.levelIds.includes(level.levelId!)).sort((a,b)=>a.elevation-b.elevation||a.levelId!-b.levelId!);
      const records = active.filter(r => l.levelIds.includes(r.levelId));
      return {
        levelId: nativeLevels[0]!.levelId!, levelIds:nativeLevels.map(l=>l.levelId!), elevation: nativeLevels[0]!.elevation, name: l.name, reviewed:l.reviewed,
        nativeLevels:nativeLevels.map(l=>({levelId:l.levelId!,elevation:l.elevation})),
        records: records.length,
        buildings: [...new Set(records.map(roomBuilding))].sort().map(building => {
          const members = records.filter(r => roomBuilding(r) === building);
          return { building, roomKeys: members.map(r => r.key), sections: [...new Set(members.flatMap(r => r.dwg?.sectionId ? [r.dwg.sectionId] : []))].sort() };
        }),
      };
    }).sort((a, b) => a.elevation - b.elevation || a.levelId - b.levelId);
}

export function campusFloorLabel(floor: ReturnType<typeof campusFloors>[number]) {
  const height=floor.nativeLevels.map(l=>l.elevation.toFixed(2)).join(" / ");
  const ids=floor.levelIds.map(id=>`#${id}`).join(" + ");
  return `${floor.name} · ${height} ft · ${ids} · ${floor.buildings.length} ${floor.buildings.length===1?"building":"buildings"}`;
}
