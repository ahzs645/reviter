import * as DMath from "./deterministic-math.ts";
import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import { nativeCirculationGeometryKey } from "./native-circulation-geometry.ts";
import { createNativeExactRoutingAuthority } from "./native-exact-routing-authority.ts";
import { nativeDoorFloorBlockers } from "./native-door-floor-support.ts";
import {
  createNativeExactTopologyIndex, nativeRationalPointInParts,
  nativeRationalPathSupported, nativeRationalFootprintSupported,
} from "./native-exact-planar-topology.ts";
import { nativeRationalOverlay, NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION, type NativeRationalParts } from "./native-rational-overlay.ts";
import { refineNativeTerminalPath } from "./native-terminal-refinement.ts";
import type { RoomPoint } from "./room-directory.ts";

export type NativeArrivalOwnerProposal = {
  version: 1; sourceModelSha256: string; sourceGeometryKey: string;
  exactTopologySha256: string; cellId: string; roomKey: string;
  arrivalNodeId: string; portalNodeId: string; doorId: string; nativeDoorElementId: number;
  arrivalPointFeet: [number, number, number]; portalPointFeet: [number, number, number];
  pointsFeet: [number, number, number][]; roomKeys: string[]; nativeFloorIds: number[];
  walkingStripWidthFeet: 2;
};
const same = (a: readonly number[], b: readonly number[]) => a.length === 3 &&
  b.length === 3 && a.every((n, i) => Number.isFinite(n) && n === b[i]);
const doorSignature = (edge: IndoorEdge, door: NonNullable<IndoorDataset["doors"]>[number]) =>
  JSON.stringify([edge, door]);

function fullWidthPath(parts: NativeRationalParts, path: RoomPoint[]) {
  if (!nativeRationalPathSupported(path, parts)) return false;
  const strips = path.slice(1).flatMap((b, i) => {
    const a = path[i]!, dx = b[0] - a[0], dy = b[1] - a[1], length = DMath.hypot(dx, dy);
    if (!length) return [];
    const nx = -dy / length, ny = dx / length;
    const ring: RoomPoint[] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
    return [[ring]];
  });
  return !!strips.length && nativeRationalFootprintSupported(nativeRationalOverlay("union", strips), parts);
}

/** A direct centreline can cut a diagonal jamb with its lateral strip. Try a
 * bounded final leg on the original measured door normal, away from the other
 * portal. These are only proposals: unchanged endpoints and every complete
 * two-foot strip still need the exact original own-room/physical-cell proof. */
function doorwayArrivalPath(parts: NativeRationalParts, from: RoomPoint, to: RoomPoint,
    other: readonly number[], normal: readonly number[]) {
  const direct = refineNativeTerminalPath(parts, from, to);
  if (direct && fullWidthPath(parts, direct)) return direct;
  if (normal.length !== 2 || !normal.every(Number.isFinite)) return;
  const length = DMath.hypot(...normal);
  if (!length) return;
  const sign = Math.sign((to[0] - other[0]!) * normal[0]! + (to[1] - other[1]!) * normal[1]!);
  if (!sign) return;
  const nx = normal[0]! / length * sign, ny = normal[1]! / length * sign;
  for (const distance of [1, 2, 3, 4]) {
    const anchor: RoomPoint = [to[0] + nx * distance, to[1] + ny * distance];
    if (!nativeRationalPointInParts(anchor, parts)) continue;
    const approach = refineNativeTerminalPath(parts, from, anchor);
    if (!approach) continue;
    const path = [...approach, to];
    if (fullWidthPath(parts, path)) return path;
  }
}

/** Proposals only, for one unchanged compiler phase. A small stair landing can
 * be a minority identity of a larger original physical face. An existing own
 * physical doorway plus an original, room-contained two-foot walking approach
 * can establish its lateral arrival without claiming the other rooms' cell or
 * enabling any stair flight. No point, source geometry or access is edited. */
export function createNativeArrivalOwnerQuery(data: IndoorDataset) {
  const geometry = data.circulationGeometry;
  if (!data.nativeIndoorEnvelopes || !geometry?.exactTopology ||
      geometry.sourceModelSha256 !== data.source.modelSha256 ||
      geometry.sourceGeometryKey !== nativeCirculationGeometryKey(data) ||
      data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256)
    return (_arrivalId: string, _cellId: string): NativeArrivalOwnerProposal | undefined => undefined;
  const index = createNativeExactTopologyIndex(geometry.exactTopology, {
    sourceModelSha256: data.source.modelSha256, sourceGeometryKey: geometry.sourceGeometryKey,
    kernelVersion: NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION,
  });
  const nodes = new Map(data.nodes.map(node => [node.id, node])),
    nodePoints = new Map(data.nodes.map(node => [node.id, [...node.pointFeet]])),
    records = new Map(data.records.map(record => [record.key, record])),
    cells = new Map(geometry.cells.map(cell => [cell.id, cell])),
    doors = new Map((data.doors ?? []).map(door => [door.id, door]));
  const sources = data.edges.flatMap(edge => {
    const door = doors.get(edge.id);
    return edge.kind === "door" && edge.enabled && door?.state === "connected" &&
      edge.nativeElementId !== undefined && edge.nativeElementId === door.nativeElementId &&
      !!door.hostWallNativeElementId && edge.roomKeys.length === 2 &&
      new Set(edge.roomKeys).size === 2 && edge.roomKeys.every(key => door.roomKeys.includes(key))
      ? [{ edge, door, signature: doorSignature(edge, door) }] : [];
  });
  let authority: ReturnType<typeof createNativeExactRoutingAuthority> | undefined,
    blockedDoors: Set<string> | undefined;
  return (arrivalId: string, cellId: string): NativeArrivalOwnerProposal | undefined => {
    const arrival = nodes.get(arrivalId), cell = cells.get(cellId),
      owner = arrival && records.get(arrival.roomKey);
    if (!arrival || !cell || !owner || arrival.kind !== "arrival" ||
        arrival.id !== `arrival:${owner.key}` || owner.access === "staff" || !owner.walkable ||
        !same(arrival.pointFeet, nodePoints.get(arrival.id)!) ||
        arrival.levelId !== owner.levelId || !cell.levelIds.includes(owner.levelId) ||
        arrival.surfaceId !== owner.surfaceId || arrival.pointFeet[2] !== owner.elevationFeet ||
        owner.elevationFeet !== cell.elevationFeet || cell.roomKeys.includes(owner.key) ||
        (owner.arrivalNodeId !== undefined && owner.arrivalNodeId !== arrival.id) ||
        cell.accessZoneId !== undefined || !geometry.preparedRoomKeys?.includes(owner.key) ||
        cell.roomKeys.some(key => !records.get(key)?.walkable || records.get(key)?.access === "staff")) return;
    if (!cell.nativeFloorIds.length || cell.nativeFloorIds.some(id => !data.walkingSupport!.floors.some(floor =>
        floor.nativeElementId === id && floor.elevationFeet === cell.elevationFeet))) return;
    const pure = cell.exactFaceId && index.parts(cell.exactFaceId);
    if (!pure) return;
    authority ??= createNativeExactRoutingAuthority(data);
    blockedDoors ??= nativeDoorFloorBlockers(data);
    const physical = authority(cell.elevationFeet, pure);
    let owned = nativeRationalOverlay("intersection", physical, [owner.ringsFeet]);
    const namedFloors = data.walkingSupport!.floors.filter(floor => cell.nativeFloorIds.includes(floor.nativeElementId) && floor.elevationFeet === cell.elevationFeet).flatMap(floor => floor.partsFeet ?? [floor.ringsFeet]);
    owned = nativeRationalOverlay("intersection", owned, namedFloors);
    const original = owner.properties.originalSourceRingsFeet as RoomPoint[][] | undefined;
    if (original) owned = nativeRationalOverlay("intersection", owned, [original]);
    if (!nativeRationalPointInParts(arrival.pointFeet, owned)) return;
    for (const { edge, door, signature } of sources) {
      if (doorSignature(edge, door) !== signature || blockedDoors.has(edge.id) ||
          !edge.roomKeys.includes(owner.key) ||
          edge.roomKeys.some(key => !records.get(key)?.walkable || records.get(key)?.access === "staff")) continue;
      for (const id of [edge.from, edge.to]) {
        const portal = nodes.get(id), other = nodes.get(id === edge.from ? edge.to : edge.from);
        if (!portal || !other || portal.kind !== "portal" || portal.roomKey !== owner.key ||
            portal.levelId !== owner.levelId || portal.surfaceId !== owner.surfaceId ||
            !same(portal.pointFeet, nodePoints.get(id)!) ||
            !same(other.pointFeet, nodePoints.get(other.id)!) ||
            !same(id === edge.from ? edge.pointsFeet.at(-1)! : edge.pointsFeet[0]!, other.pointFeet) ||
            other.pointFeet[2] !== cell.elevationFeet ||
            !same(id === edge.from ? edge.pointsFeet[0]! : edge.pointsFeet.at(-1)!, portal.pointFeet) ||
            portal.pointFeet[2] !== cell.elevationFeet ||
            other.roomKey === owner.key || !edge.roomKeys.includes(other.roomKey) ||
            !nativeRationalPointInParts(portal.pointFeet, owned)) continue;
        const path = doorwayArrivalPath(owned,
          [arrival.pointFeet[0], arrival.pointFeet[1]], [portal.pointFeet[0], portal.pointFeet[1]],
          other.pointFeet, door.normalFeet ?? []);
        if (!path) continue;
        return { version: 1, sourceModelSha256: data.source.modelSha256,
          sourceGeometryKey: geometry.sourceGeometryKey,
          exactTopologySha256: geometry.exactTopology!.geometrySha256, cellId, roomKey: owner.key,
          arrivalNodeId: arrival.id, portalNodeId: portal.id, doorId: door.id,
          nativeDoorElementId: door.nativeElementId,
          arrivalPointFeet: [...arrival.pointFeet], portalPointFeet: [...portal.pointFeet],
          pointsFeet: path.map(p => [p[0], p[1], cell.elevationFeet]),
          roomKeys: [...new Set([...cell.roomKeys, owner.key, ...edge.roomKeys])].sort(),
          nativeFloorIds: [...cell.nativeFloorIds], walkingStripWidthFeet: 2 };
      }
    }
  };
}
