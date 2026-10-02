import pc from "polygon-clipping";
import { directoryOpenPassages, type OpenPassage, type ReviewedOpenLink } from "./directory-openings.ts";
import { isStairArea } from "./directory-stair-geometry.ts";
import { containsDirectoryRoomPoint, isHallway, isPubliclyAccessible, isWalkable, nearestRoomBoundary, roomArea, roomBuilding, type DirectoryRoom, type RoomPoint } from "./room-directory.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import type { BoundaryReference } from "./room-boundaries.ts";

export type RecoveredOpenFront = OpenPassage & {
  proof: { widthFeet: number; boundaryGapFeet: number; floorCoveredSquareFeet: number; registrationErrorFeet: number };
};
const area = (polygons: pc.MultiPolygon) => polygons.reduce((sum, polygon) => sum + roomArea(polygon[0]! as RoomPoint[]) - polygon.slice(1).reduce((s, hole) => s + roomArea(hole as RoomPoint[]), 0), 0);
const bounds = (polygon: readonly RoomPoint[]) => ({ minX: Math.min(...polygon.map(p => p[0])), maxX: Math.max(...polygon.map(p => p[0])), minY: Math.min(...polygon.map(p => p[1])), maxY: Math.max(...polygon.map(p => p[1])) });
const intersects = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>, gap = 0) => a.minX <= b.maxX + gap && a.maxX + gap >= b.minX && a.minY <= b.maxY + gap && a.maxY + gap >= b.minY;

/** A reviewed shared landing still has a stair identity for vertical routing.
 * Permit only its exact-height supported flat opening; never use stair treads
 * or the gross stair envelope as floor evidence. */
export const isPlanarCirculation = (room: DirectoryRoom) => isHallway(room) &&
  (!isStairArea(room) || room.stairAccess === "flight-and-landing" &&
    room.spaceUse?.kind === "hallway" && room.spaceUse.evidence === "user-reported");

/** Recover a doorless open front only across a small drawing-raster seam.
 * A full two-foot swept footprint must be native-floor-supported and clear of
 * registered drawing walls, native walls (including repaired joints), columns,
 * every third room and every source hole. The native door matcher is unchanged.
 * This establishes geometric reachability, never public/accessibility status.
 */
function recoverRegisteredOpenConnections(
  rooms: readonly DirectoryRoom[], candidateKeys: ReadonlySet<string>,
  reference: BoundaryReference | undefined, geometry: ArchitecturalPlanGeometry,
  circulationPair?:readonly [string,string],
): RecoveredOpenFront[] {
  if (!reference || !geometry.floors.length) return [];
  const result: RecoveredOpenFront[] = [], roomBounds = new Map(rooms.map(r => [r.key, bounds(r.polygonFeet)]));
  const eligible = rooms.filter(r => isWalkable(r) && isPubliclyAccessible(r));
  const halls = eligible.filter(isHallway);
  for (const room of eligible.filter(r => candidateKeys.has(r.key) && (circulationPair ? isPlanarCirculation(r) : !isHallway(r) && !isStairArea(r)))) {
    const section = reference.sections.find(s => s.levelId === room.levelId && s.sectionId === room.dwg?.sectionId && s.registrationErrorFeet <= .05);
    if (!section) continue;
    const nearbyHalls = halls.filter(h => h.key!==room.key && (!circulationPair||h.key===circulationPair[1]) && h.levelId === room.levelId && roomBuilding(h) === roomBuilding(room) && h.dwg?.sectionId === section.sectionId && intersects(roomBounds.get(room.key)!, roomBounds.get(h.key)!, .75));
    const candidates: { link: ReviewedOpenLink; gap: number }[] = [];
    for (const hall of nearbyHalls) for (let edge = 0; edge < room.polygonFeet.length; edge++) {
      const p = room.polygonFeet[edge]!, q = room.polygonFeet[(edge + 1) % room.polygonFeet.length]!;
      const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / .2);
      for (let i = 1; i < steps; i++) {
        const boundary: RoomPoint = [p[0] + (q[0] - p[0]) * i / steps, p[1] + (q[1] - p[1]) * i / steps];
        const nearest = nearestRoomBoundary(boundary, hall.polygonFeet), gap = nearest.distance;
        if (gap > .75) continue;
        // Perfectly coincident drawing edges also need a supported opening.
        // Their normal comes from the registered boundary itself; choose only
        // the orientation whose two interior points belong to the room/hall.
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (length < 1e-8) continue;
        // Raster outlines may overlap slightly. The nearest-outline vector then
        // points into the room and rejects an actual open front. Use the source
        // edge normal with its room side established geometrically; the hall
        // interior and full-width native barrier/floor tests still decide viability.
        const overlapping = containsDirectoryRoomPoint(boundary, hall);
        let ux = gap > 1e-8 && !overlapping ? (nearest.point[0] - boundary[0]) / gap : -(q[1] - p[1]) / length;
        let uy = gap > 1e-8 && !overlapping ? (nearest.point[1] - boundary[1]) / gap : (q[0] - p[0]) / length;
        if (!containsDirectoryRoomPoint([boundary[0] - .3 * ux, boundary[1] - .3 * uy], room)) { ux = -ux; uy = -uy; }
        const from: RoomPoint = [boundary[0] - .3 * ux, boundary[1] - .3 * uy], to: RoomPoint = [nearest.point[0] + .3 * ux, nearest.point[1] + .3 * uy];
        if (!containsDirectoryRoomPoint(from, room) || !containsDirectoryRoomPoint(to, hall)) continue;
        candidates.push({ gap, link: { id: `recovered-front:${room.key}:${hall.key}:${edge}:${i}`, levelId: room.levelId, rooms: [room.key, hall.key], from, to, widthFeet: 2, evidence: "registered-opening", sourceSha256: reference.sourceSha256 } });
      }
    }
    // Deterministic shortest seam; all accepted candidates are validated at full width.
    candidates.sort((a, b) => a.gap - b.gap || a.link.id.localeCompare(b.link.id));
    for (const candidate of candidates) {
      const a = candidate.link.from, b = candidate.link.to;
      const search = { minX: Math.min(a[0], b[0]) - 1.5, maxX: Math.max(a[0], b[0]) + 1.5, minY: Math.min(a[1], b[1]) - 1.5, maxY: Math.max(a[1], b[1]) + 1.5 };
      const localGeometry = { ...geometry, walls: geometry.walls.filter(w => intersects(search, bounds(w.polygon))), columns: geometry.columns.filter(w => intersects(search, bounds(w.polygon))) };
      const localRooms = rooms.filter(r => candidate.link.rooms.includes(r.key) || intersects(search, roomBounds.get(r.key)!));
      const passage = directoryOpenPassages(localRooms, [candidate.link], { ...reference, sections: [section] }, localGeometry)[0];
      if (!passage?.footprint) continue;
      try {
        const footprint: pc.MultiPolygon = [[passage.footprint]];
        if ([...localGeometry.walls, ...localGeometry.columns].some(w => area(pc.intersection(footprint, [w.polygon])) > 1e-8)) continue;
        const protectedHoles = rooms.flatMap(r => [...r.holesFeet ?? [], ...r.floorOpeningsFeet ?? []]).filter(h => intersects(search, bounds(h)));
        if (protectedHoles.some(h => area(pc.intersection(footprint, [h])) > 1e-8)) continue;
        let uncovered = footprint;
        for (const floor of geometry.floors.filter(f => f.length && intersects(search, bounds(f[0]!)))) {
          uncovered = pc.difference(uncovered, floor);
          if (!uncovered.length) break;
        }
        if (area(uncovered) > 1e-8) continue;
        result.push({ ...passage, proof: { widthFeet: 2, boundaryGapFeet: candidate.gap, floorCoveredSquareFeet: area(footprint), registrationErrorFeet: section.registrationErrorFeet } });
        break;
      } catch {
        // A clipping failure never authorizes an opening.
      }
    }
  }
  return result;
}

/** Preserve the ordinary-room recovery API and its eligibility policy. */
export function recoverRegisteredOpenFronts(rooms:readonly DirectoryRoom[],candidateKeys:ReadonlySet<string>,reference:BoundaryReference|undefined,geometry:ArchitecturalPlanGeometry):RecoveredOpenFront[]{
 return recoverRegisteredOpenConnections(rooms,candidateKeys,reference,geometry);
}

/** A prepared native floor profile at each room's physical height is mandatory.
 * Infer every neighboring coplanar circulation pair, even when each already has
 * another entrance. All source/native wall, column, third-room, void, complete
 * two-foot floor coverage and saved registration proofs are unchanged. This
 * cannot bridge different storeys, stair flights, buildings or drawing sections.
 */
export function recoverRegisteredCirculationSeams(rooms:readonly DirectoryRoom[],reference:BoundaryReference|undefined,geometry:ArchitecturalPlanGeometry,floorSupport:ReadonlyMap<string,{elevationFeet:number;floors:ArchitecturalPlanGeometry["floors"]}>):RecoveredOpenFront[]{
 if(!reference)return [];
 const halls=rooms.filter(r=>isWalkable(r)&&isPubliclyAccessible(r)&&isPlanarCirculation(r));
 const result:RecoveredOpenFront[]=[];
 for(let i=0;i<halls.length;i++)for(let j=i+1;j<halls.length;j++){
  const a=halls[i]!,b=halls[j]!,af=floorSupport.get(a.key),bf=floorSupport.get(b.key);
  if(a.levelId!==b.levelId||roomBuilding(a)!==roomBuilding(b)||a.dwg?.sectionId!==b.dwg?.sectionId||!a.dwg?.sectionId||a.dwg?.sha256!==reference.sourceSha256||b.dwg?.sha256!==reference.sourceSha256||(a.circulationGroup&&a.circulationGroup===b.circulationGroup))continue;
  if(!af||!bf||!Number.isFinite(af.elevationFeet)||!Number.isFinite(bf.elevationFeet)||Math.abs(af.elevationFeet-bf.elevationFeet)>.05||!af.floors.length||!bf.floors.length||!intersects(bounds(a.polygonFeet),bounds(b.polygonFeet),.75))continue;
  // Each side must independently support the complete bridge. Associated slab
  // unions and the other room's different-height floor cannot fill its holes.
  const forward=recoverRegisteredOpenConnections(rooms,new Set([a.key]),reference,{...geometry,floors:af.floors},[a.key,b.key]);
  for(const front of forward){
   try{let uncovered:pc.MultiPolygon=[[front.footprint!]];for(const floor of bf.floors){uncovered=pc.difference(uncovered,floor);if(!uncovered.length)break;}if(area(uncovered)>1e-8)continue;}catch{continue;}
   result.push({...front,openingId:front.openingId.replace('recovered-front:','recovered-circulation-seam:')});
  }
 }
 return result;
}
