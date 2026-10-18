import { containsRoomPoint, type RoomPoint } from "./room-directory.ts";

type Room = { key: string; levelId: number; ringsFeet: RoomPoint[][] };
type Door = { levelId: number; footprintFeet?: RoomPoint[]; normalFeet?: RoomPoint };
const inside = (point: RoomPoint, room: Room) =>
  !!room.ringsFeet[0] && containsRoomPoint(point, room.ringsFeet[0]) &&
  !room.ringsFeet.slice(1).some(hole => containsRoomPoint(point, hole));

/** Discovery only. Find the FIRST source-room identity along each original
 * doorway normal ray. Do not select a corridor behind an intervening room.
 * Samples only propose endpoints; full-width, slab, material and access checks
 * remain separate. No source owner, boundary, portal or graph edge is edited.
 */
export function proposeNativeDoorSides(rooms: readonly Room[], door: Door,
  maximumDepthFeet = 8) {
  if (!Number.isFinite(maximumDepthFeet) || maximumDepthFeet <= 0 || maximumDepthFeet > 20)
    throw Error("Invalid doorway discovery depth");
  const footprint = door.footprintFeet, normal = door.normalFeet;
  if (!footprint?.length || !normal?.every(Number.isFinite) || normal.length !== 2 ||
      footprint.some(p => p.length !== 2 || !p.every(Number.isFinite))) return { status: "missing-native-threshold" as const };
  const length = Math.hypot(...normal);
  if (Math.abs(length-1) > 1e-5) return { status: "missing-native-threshold" as const };
  const nx = normal[0]/length, ny = normal[1]/length, ux = -ny, uy = nx;
  const ns = footprint.map(p => p[0]*nx+p[1]*ny), us = footprint.map(p => p[0]*ux+p[1]*uy);
  const lo = Math.min(...ns), hi = Math.max(...ns), left = Math.min(...us), right = Math.max(...us), mid = (left+right)/2;
  if (right-left < 2) return { status: "narrow-native-threshold" as const };
  const candidates = rooms.filter(room => room.levelId === door.levelId);
  const samples = [...new Set([left+(right-left)*.25, mid, right-(right-left)*.25, mid-1, mid+1])];
  const side = (sign: number) => {
    const edgeN = sign < 0 ? lo : hi, dx = nx*sign, dy = ny*sign;
    const votes = samples.map(u => {
      const origin: RoomPoint = [ux*u+nx*edgeN, uy*u+ny*edgeN];
      const hits = candidates.flatMap(room => {
        if (inside(origin, room)) return [{ room, depth: .075 }];
        let first = Infinity;
        for (const ring of room.ringsFeet) for (let i=0;i<ring.length;i++) {
          const a = ring[i]!, b = ring[(i+1)%ring.length]!, ex = b[0]-a[0], ey = b[1]-a[1];
          const den = dx*ey-dy*ex;
          if (!den) continue;
          const px = a[0]-origin[0], py = a[1]-origin[1], t = (px*ey-py*ex)/den, v = (px*dy-py*dx)/den;
          if (t < 0 || t+.075 > maximumDepthFeet || v < 0 || v > 1) continue;
          const depth = t+.075;
          if (inside([origin[0]+dx*depth, origin[1]+dy*depth],room)) first = Math.min(first,depth);
        }
        return Number.isFinite(first) ? [{ room, depth:first }] : [];
      }).sort((a,b)=>a.depth-b.depth);
      if (!hits.length) return undefined;
      if (hits.some(hit => hit.room.key !== hits[0]!.room.key && Math.abs(hit.depth-hits[0]!.depth)<1e-7)) return undefined;
      return hits[0];
    });
    if (votes.some(v=>!v) || new Set(votes.map(v=>v!.room.key)).size !== 1) return undefined;
    const depth = Math.max(...votes.map(v=>v!.depth));
    const endpoint: RoomPoint = [ux*mid+nx*(edgeN+sign*depth),uy*mid+ny*(edgeN+sign*depth)];
    if (!inside(endpoint,votes[0]!.room)) return undefined;
    return { roomKey:votes[0]!.room.key, depthFeet:depth, pointFeet:endpoint };
  };
  const from = side(-1), to = side(1);
  return from && to && from.roomKey !== to.roomKey
    ? { status:"proposed" as const, from, to, discoveryMaximumDepthFeet:maximumDepthFeet,
      authorityGranted:false as const }
    : { status:"unresolved-source-sides" as const, from, to, authorityGranted:false as const };
}
