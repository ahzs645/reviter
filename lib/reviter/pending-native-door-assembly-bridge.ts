import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import type { IndoorDataset, IndoorEdge, IndoorNode } from "./indoor-contract.ts";
import { nativeRouteBlocker, type RoomPoint, type RoomPortal, type RouteOpening } from "./room-directory.ts";

type Door = NonNullable<IndoorDataset["doors"]>[number];
type Geometry = Pick<ArchitecturalPlanGeometry, "walls" | "columns">;
type Wall = Geometry["walls"][number];
type Original = {
  sourceModelSha256: string;
  physicalLevelId: number;
  elevationFeet: number;
  door: Door;
  from: RoomPoint;
  to: RoomPoint;
  /** The original producer order: near-left/right, far-right/left. */
  footprintFeet: [RoomPoint, RoomPoint, RoomPoint, RoomPoint];
  legacyBlockingNativeElementIds: readonly number[];
  geometry: Geometry;
  /** The actual source walking constructor's complete two-foot query. */
  checkOriginalBridge: () => boolean;
};
type Snapshot = Omit<Original, "geometry"> & { legacyWalls: Wall[] };
export type PendingNativeDoorAssemblyCandidate = Readonly<{ kind: "private-native-door-assembly-candidate" }>;
export type PendingNativeDoorAssemblyBridge = Readonly<{ kind: "private-native-door-assembly-portal" }>;
const candidates = new WeakMap<PendingNativeDoorAssemblyCandidate, Snapshot>();
const portals = new WeakMap<PendingNativeDoorAssemblyBridge, Snapshot & { roomKeys: readonly string[] }>();
const point = (a: readonly number[] | undefined, b: readonly number[] | undefined) => !!a && !!b &&
  a.length >= 2 && a.length <= 3 && a.length === b.length && a.every((v, i) => Number.isFinite(v) && Object.is(v, b[i]));
const ring = (a: readonly RoomPoint[] | undefined, b: readonly RoomPoint[] | undefined) => !!a && !!b &&
  a.length >= 3 && a.length === b.length && a.every((p, i) => p.length === 2 && point(p, b[i]));
const doorMatches = (a: Door, b: Door) => a.id === b.id && a.levelId === b.levelId &&
  a.nativeElementId === b.nativeElementId && a.hostWallNativeElementId === b.hostWallNativeElementId &&
  point(a.pointFeet, b.pointFeet) && point(a.normalFeet, b.normalFeet) && ring(a.footprintFeet, b.footprintFeet);
const wallMatches = (a: Wall, b: Wall) => a.elementId === b.elementId && a.approximate === b.approximate && ring(a.polygon, b.polygon);

/** Private, operation-local carry-through of the original ownership query.
 * This is never serialized into data or accepted from an issue/receipt flag.
 * It authorizes only rechecking the same original bridge against that original
 * source constructor, then replacing its identical gross legacy rectangles in
 * the later legacy check. It grants no access/body-clearance qualification. */
export function capturePendingNativeDoorAssemblyCandidate(original: Original): PendingNativeDoorAssemblyCandidate | undefined {
  const ids = original.legacyBlockingNativeElementIds;
  if (!/^[a-f0-9]{64}$/.test(original.sourceModelSha256) || !Number.isSafeInteger(original.physicalLevelId) ||
    !Number.isFinite(original.elevationFeet) || !ids.length || new Set(ids).size !== ids.length ||
    ids.some(id => !Number.isSafeInteger(id) || id <= 0) || !point(original.from, original.from) ||
    !point(original.to, original.to) || original.from.length !== 2 || original.to.length !== 2 ||
    original.footprintFeet.length !== 4 || !ring(original.footprintFeet, original.footprintFeet) ||
    !doorMatches(original.door, original.door)) return;
  const legacyWalls = original.geometry.walls.filter(w => ids.includes(w.elementId));
  if (ids.some(id => !legacyWalls.some(w => w.elementId === id)) || legacyWalls.some(w => !wallMatches(w, w)) || !original.checkOriginalBridge()) return;
  const token: PendingNativeDoorAssemblyCandidate = Object.freeze({ kind: "private-native-door-assembly-candidate" });
  candidates.set(token, { sourceModelSha256: original.sourceModelSha256, physicalLevelId: original.physicalLevelId,
    elevationFeet: original.elevationFeet, checkOriginalBridge: original.checkOriginalBridge,
    door: structuredClone(original.door), from: [...original.from], to: [...original.to], footprintFeet: structuredClone(original.footprintFeet),
    legacyBlockingNativeElementIds: [...ids], legacyWalls: structuredClone(legacyWalls) });
  return token;
}

/** Only the portal actually selected by the original ownership producer binds
 * a candidate. A successful but subsequently rejected candidate cannot leak. */
export function bindPendingNativeDoorAssemblyPortal(candidate: PendingNativeDoorAssemblyCandidate, portal: RoomPortal): PendingNativeDoorAssemblyBridge | undefined {
  const original = candidates.get(candidate);
  if (!original || portal.doorId !== original.door.nativeElementId || !point(portal.point, original.door.pointFeet) ||
    !point(portal.from, original.from) || !point(portal.to, original.to) ||
    !point(portal.normal, original.door.normalFeet) || !ring(portal.footprint, original.door.footprintFeet) ||
    portal.rooms.length !== 2 || portal.rooms[0] === portal.rooms[1] || portal.rooms.some(key => typeof key !== "string" || !key)) return;
  const token: PendingNativeDoorAssemblyBridge = Object.freeze({ kind: "private-native-door-assembly-portal" });
  portals.set(token, { ...original, roomKeys: [...portal.rooms] });
  return token;
}

export function pendingNativeDoorAssemblyGeometry<G extends Geometry>(
  proof: PendingNativeDoorAssemblyBridge,
  current: { sourceModelSha256: string; physicalLevelId: number; door: Door; edge: IndoorEdge;
    from: IndoorNode; to: IndoorNode; geometry: G; openings: readonly RouteOpening[] },
): G | undefined {
  const original = portals.get(proof), { edge, from, to, door, geometry } = current;
  if (!original || current.sourceModelSha256 !== original.sourceModelSha256 || current.physicalLevelId !== original.physicalLevelId ||
    !doorMatches(original.door, door) || door.state !== "connected" || edge.kind !== "door" || edge.id !== original.door.id ||
    edge.nativeElementId !== original.door.nativeElementId || edge.pointsFeet.length !== 0 ||
    edge.from !== `${edge.id}:0` || edge.to !== `${edge.id}:1` ||
    from.id !== edge.from || to.id !== edge.to || edge.roomKeys.length !== 2 ||
    edge.roomKeys.some((key, i) => key !== original.roomKeys[i]) || door.roomKeys.length !== 2 ||
    door.roomKeys.some((key, i) => key !== original.roomKeys[i]) || from.roomKey !== original.roomKeys[0] || to.roomKey !== original.roomKeys[1] ||
    !point(from.pointFeet, [...original.from, original.elevationFeet]) || !point(to.pointFeet, [...original.to, original.elevationFeet])) return;
  const currentWalls = geometry.walls.filter(w => original.legacyBlockingNativeElementIds.includes(w.elementId));
  // A later repaired/derived rectangle with the same native owner must not
  // inherit this proof. All original records, multiplicities and coordinates
  // must still match; every unrelated wall/column remains in the final check.
  if (currentWalls.length !== original.legacyWalls.length || currentWalls.some((w, i) => !wallMatches(w, original.legacyWalls[i]!)) ||
    !original.checkOriginalBridge()) return;
  const remaining = { ...geometry, walls: geometry.walls.filter(w => !original.legacyBlockingNativeElementIds.includes(w.elementId)) };
  const blocked = nativeRouteBlocker(remaining, current.openings), corners = original.footprintFeet;
  if (blocked(corners[0], corners[3]) || blocked(original.from, original.to) || blocked(corners[1], corners[2])) return;
  return remaining;
}
