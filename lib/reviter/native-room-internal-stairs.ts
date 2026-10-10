import polygonClipping from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset, IndoorRecord } from "./indoor-contract.ts";
import { roomArea, type DirectoryRoom, type RoomPoint } from "./room-directory.ts";
import { isStairArea } from "./directory-stair-geometry.ts";
import { nativePhysicalLevelAssignment, type NativePhysicalLevelData } from "./native-physical-level-records.ts";

/** Steps inside one room (theatre seating, a raised dais) belong to that room.
 * They never become a stair connector or an inter-floor link. */
export const NATIVE_ROOM_INTERNAL_STAIRS_VERSION = "native-room-internal-stairs-v1";
export const ROOM_INTERNAL_STAIR_FRACTION = 0.7;

type Ring = RoomPoint[];
type Point3 = [number, number, number];
const partsArea = (parts: Ring[][]) =>
  parts.reduce((s, p) => s + roomArea(p[0]!) - p.slice(1).reduce((h, r) => h + roomArea(r), 0), 0);
const closed = (ring: readonly RoomPoint[]) => [...ring, ring[0]!] as RoomPoint[];
const roomGeom = (room: DirectoryRoom) =>
  [room.polygonFeet, ...(room.holesFeet ?? [])].map(closed);

export type NativeStairTreads = { stairElementId: number; treads: Point3[][]; lowFeet: number; highFeet: number };

/** Persisted assemblies with retained native tread topology. */
export function nativeStairTreadSets(model: Pick<ConvertResult, "elementBounds" | "nativeStairAssemblies">): NativeStairTreads[] {
  const bounds = new Map(model.elementBounds.map(r => [r.elementId, r]));
  const out: NativeStairTreads[] = [];
  for (const assembly of model.nativeStairAssemblies ?? []) {
    const runs = assembly.runAndLandingIds.map(id => bounds.get(id)).filter(r => r?.stairTreads?.length);
    if (!runs.length) continue;
    out.push({
      stairElementId: assembly.stairElementId,
      treads: runs.flatMap(r => r!.stairTreads!) as Point3[][],
      lowFeet: Math.min(...runs.map(r => r!.boundsFeet.min.z)),
      highFeet: Math.max(...runs.map(r => r!.boundsFeet.max.z)),
    });
  }
  return out;
}

/** The ONE non-stair room holding >=70% of the stair's tread footprint, provided
 * no stair room of its own lists or overlaps the flight. Rooms are restricted to
 * levels within the flight's vertical span (1 ft tolerance). */
export function roomInternalStairOwner(
  stair: NativeStairTreads,
  rooms: readonly DirectoryRoom[],
  levelElevation: (levelId: number) => number | undefined,
): DirectoryRoom | undefined {
  const polygons = stair.treads
    .map(t => t.map(p => [p[0], p[1]] as RoomPoint))
    .filter(t => t.length >= 3 && roomArea(t) >= 0.01);
  if (!polygons.length) return undefined;
  try {
    const geoms = polygons.map(t => [closed(t)] as never);
    const footprint = polygonClipping.union(geoms[0]!, ...geoms.slice(1)) as unknown as Ring[][];
    const total = partsArea(footprint);
    if (!(total > 0)) return undefined;
    const pts = polygons.flat();
    const fb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    const spanning = rooms.filter(r => {
      const z = levelElevation(r.levelId);
      return z !== undefined && z >= stair.lowFeet - 1 && z <= stair.highFeet + 1;
    });
    if (spanning.some(r => isStairArea(r) && r.stairFlightIds?.includes(stair.stairElementId))) return undefined;
    const inRange = spanning.filter(r => {
      const xs = r.polygonFeet.map(p => p[0]), ys = r.polygonFeet.map(p => p[1]);
      return Math.min(...xs) <= fb[2]! && Math.max(...xs) >= fb[0]! && Math.min(...ys) <= fb[3]! && Math.max(...ys) >= fb[1]!;
    });
    const overlap = (room: DirectoryRoom) =>
      partsArea(polygonClipping.intersection(footprint as never, roomGeom(room) as never) as unknown as Ring[][]);
    if (inRange.some(r => isStairArea(r) && overlap(r) > 0.5))
      return undefined;
    const owners = inRange.filter(r => !isStairArea(r) && overlap(r) >= ROOM_INTERNAL_STAIR_FRACTION * total);
    return owners.length === 1 ? owners[0] : undefined;
  } catch {
    return undefined;
  }
}

export type NativeSteppedRoomArrival = {
  roomKey: string;
  levelId: number;
  elevationFeet: number;
  pointFeet: RoomPoint;
  stairElementIds: number[];
  aisleNativeFloorIds: number[];
};

/** Widest horizontal span through the piece's mid-height: a deterministic interior point. */
function interiorPoint(piece: Ring[]): RoomPoint | undefined {
  const ys = piece[0]!.map(p => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  for (const t of [0.5, 0.25, 0.75, 0.375, 0.625]) {
    const y = lo + (hi - lo) * t;
    const xs: number[] = [];
    for (const ring of piece)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    xs.sort((m, n) => m - n);
    let best: [number, number] | undefined;
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (!best || xs[i + 1]! - xs[i]! > best[1] - best[0]) best = [xs[i]!, xs[i + 1]!];
    if (best && best[1] - best[0] > 1e-6) return [(best[0] + best[1]) / 2, y];
  }
  return undefined;
}

/** A stepped room (theatre) whose native floor descends to an offset physical
 * level is reached from its identity level: its arrival sits on the top aisle,
 * the part of the room on slabs at the identity level's elevation. No route is
 * created down the steps and access/accessibility are not inferred. */
export function nativeSteppedRoomArrivals(
  model: Pick<ConvertResult, "elementBounds" | "nativeStairAssemblies">,
  dataset: Pick<IndoorDataset, "nativeLevels" | "records" | "walkingSupport" | "nativePhysicalLevels">,
  rooms: readonly DirectoryRoom[],
): Map<string, NativeSteppedRoomArrival> {
  const out = new Map<string, NativeSteppedRoomArrival>();
  if (!dataset.nativePhysicalLevels || !dataset.walkingSupport) return out;
  const elevation = (id: number) => dataset.nativeLevels.find(l => l.id === id)?.elevationFeet;
  const stairs = nativeStairTreadSets(model);
  const internal = new Map<string, number[]>();
  for (const stair of stairs) {
    const owner = roomInternalStairOwner(stair, rooms, elevation);
    if (owner) internal.set(owner.key, [...internal.get(owner.key) ?? [], stair.stairElementId]);
  }
  for (const record of dataset.records as IndoorRecord[]) {
    const ids = internal.get(record.key);
    if (!ids) continue;
    const assignment = nativePhysicalLevelAssignment(dataset as unknown as NativePhysicalLevelData, record);
    const top = elevation(record.levelId), bottom = assignment && elevation(assignment.physicalLevelId);
    if (!assignment || top === undefined || bottom === undefined) continue;
    const spans = ids.filter(id => {
      const s = stairs.find(x => x.stairElementId === id)!;
      return Math.abs(s.lowFeet - Math.min(top, bottom)) <= 1 && Math.abs(s.highFeet - Math.max(top, bottom)) <= 1;
    });
    if (!spans.length) continue;
    const slabs = dataset.walkingSupport.floors.filter(f => Math.abs(f.elevationFeet - top) < 0.05);
    try {
      const outline = record.ringsFeet.map(closed);
      const aisle: Ring[][] = [];
      const floorIds: number[] = [];
      for (const f of slabs)
        for (const part of f.partsFeet ?? [f.ringsFeet]) {
          const cut = polygonClipping.intersection(outline as never, part.map(closed) as never) as unknown as Ring[][];
          if (partsArea(cut) > 1) { aisle.push(...cut); if (!floorIds.includes(f.nativeElementId)) floorIds.push(f.nativeElementId); }
        }
      if (!aisle.length) continue;
      const piece = aisle.reduce((a, b) => (partsArea([b]) > partsArea([a]) ? b : a));
      const point = interiorPoint(piece);
      if (!point) continue;
      out.set(record.key, { roomKey: record.key, levelId: record.levelId, elevationFeet: top, pointFeet: point,
        stairElementIds: spans.sort((a, b) => a - b), aisleNativeFloorIds: floorIds.sort((a, b) => a - b) });
    } catch {
      /* Invalid outline or slab: keep the source arrival. */
    }
  }
  return out;
}
