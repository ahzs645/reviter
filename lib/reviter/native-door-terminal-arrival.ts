import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import type { DirectoryRoom, RoomPoint } from "./room-directory.ts";
import { nativeCirculationGeometryKey } from "./native-circulation-geometry.ts";
import { nativeRationalOverlay, rational, type NativeRationalParts, type NativeRationalPoint } from "./native-rational-overlay.ts";
import { nativeRationalPointInParts, nativeRationalPointInRing, nativeRationalPathSupported, nativeRationalFootprintSupported } from "./native-exact-planar-topology.ts";
import * as DMath from "./deterministic-math.ts";

type Cell = NonNullable<IndoorDataset["circulationGeometry"]>["cells"][number];
export type NativeDoorTerminalArrivalSource = {
  sourceModelSha256: string;
  sourceRoomsSha256: string;
  annotation: DirectoryRoom;
};
/** The caller must use the current independent original-source authority.
 * A prepared descriptor, display polygon, serialized proof flag or cached
 * unchecked list cannot implement these two callbacks. No authority is issued
 * by this proposal helper. Missing original evidence returns no proposal. */
export type NativeDoorTerminalArrivalChecks = {
  /** Original free cell plus only this existing branch's independently checked
   * own native-door threshold half; never the raw aperture or another door. */
  physicalApproachParts: (cell: Cell, existingApproach: IndoorEdge) => NativeRationalParts | undefined;
  originalEdge: (edge: IndoorEdge) => boolean;
};
export type NativeDoorTerminalArrivalProposal = {
  version: 1;
  sourceModelSha256: string;
  sourceRoomsSha256: string;
  sourceGeometryKey: string;
  exactTopologySha256: string;
  roomKey: string;
  originalArrivalNodeId: string;
  originalArrivalPointFeet: [number, number, number];
  originalLabelPointFeet: RoomPoint;
  proposedArrivalNodeId: string;
  proposedArrivalPointFeet: [number, number, number];
  /** This is an existing point INSIDE the source room, beside its native door.
   * It is not the doorway threshold or the original drawing text anchor.
   * At-doorway/hallway stops still need the calculator's actual entering door. */
  arrivalSemantics: "inside-at-native-door-approach";
  nativeDoorElementId: number;
  doorEdgeId: string;
  lateralApproachEdgeId: string;
  cellId: string;
  nativeFloorIds: number[];
  roomKeys: string[];
  walkingStripWidthFeet: 2;
};
const samePoint = (a: readonly number[], b: readonly number[]) => a.length === 3 && b.length === 3 &&
  a.every((value, index) => Number.isFinite(value) && value === b[index]);
const strictInside = (point: readonly number[], parts: NativeRationalParts) => {
  const exact: NativeRationalPoint = [rational(point[0]!), rational(point[1]!)];
  return parts.some(part => !!part.length && nativeRationalPointInRing(exact, part[0]!) === 1 &&
    part.slice(1).every(hole => nativeRationalPointInRing(exact, hole) === 0));
};
function wholeWalkingStrip(path: [number, number, number][], parts: NativeRationalParts) {
  if (!nativeRationalPathSupported(path, parts)) return false;
  const strips = path.slice(1).flatMap((b, index) => {
    const a = path[index]!, dx = b[0] - a[0], dy = b[1] - a[1], length = DMath.hypot(dx, dy);
    if (!length) return [];
    const nx = -dy / length, ny = dx / length;
    const ring: RoomPoint[] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
    return [[ring]];
  });
  return !!strips.length && nativeRationalFootprintSupported(nativeRationalOverlay("union", strips), parts);
}

/** Proposal only; deliberately unwired. A source drawing can place its text
 * label outside its own derived polygon and omit a distinct routePointFeet.
 * Use only the UNIQUE existing measured own-door portal, with an existing
 * full-width physical native-cell approach already owned by the same room.
 * No new point, nearest-door search, branch, owner, review or access is created.
 * The caller retains the source label/orphan seed and adopts the pointer only
 * after current original physical AND policy replay in both directions.
 *
 * The existing centreline must stay in the original room outline. Its entire
 * two-foot body strip must fit the independent original native cell and named
 * source floors, retaining its independently checked own threshold half.
 * The approximate DWG label contour is not a physical wall;
 * all cell/branch/door owner identities and their permissions remain required. */
export function proposeNativeDoorTerminalArrival(data: IndoorDataset,
    source: NativeDoorTerminalArrivalSource, checks: NativeDoorTerminalArrivalChecks): NativeDoorTerminalArrivalProposal | undefined {
  const annotation = source.annotation, room = data.records.find(record => record.key === annotation?.key),
    geometry = data.circulationGeometry, sha = data.source.modelSha256;
  if (!annotation || !room || room.arrivalNodeId || room.stair || !room.circulation || !room.walkable || room.access === "staff" ||
      source.sourceModelSha256 !== sha || source.sourceRoomsSha256 !== data.source.roomsSha256 ||
      annotation.routePointFeet !== undefined || annotation.levelId !== room.levelId || annotation.number !== room.number ||
      annotation.spaceUse?.kind !== "hallway" || annotation.spaceUse.evidence !== "user-reported" ||
      JSON.stringify(annotation.dwg) !== JSON.stringify(room.properties.dwg) || !annotation.dwg ||
      !/^[a-f\d]{64}$/i.test(String(annotation.dwg.sha256)) ||
      !geometry?.exactTopology || geometry.sourceModelSha256 !== sha ||
      geometry.sourceGeometryKey !== nativeCirculationGeometryKey(data) ||
      !geometry.preparedRoomKeys?.includes(room.key) ||
      data.walkingSupport?.sourceModelSha256 !== sha ||
      typeof checks.physicalApproachParts !== "function" || typeof checks.originalEdge !== "function") return;
  const nodes = new Map(data.nodes.map(node => [node.id, node])), records = new Map(data.records.map(record => [record.key, record])),
    seed = nodes.get(`arrival:${room.key}`), original = [annotation.polygonFeet, ...(annotation.holesFeet ?? [])];
  if (!seed || seed.kind !== "arrival" || seed.roomKey !== room.key || seed.levelId !== room.levelId || seed.surfaceId !== room.surfaceId ||
      seed.pointFeet[2] !== room.elevationFeet || !seed.pointFeet.every(Number.isFinite) ||
      annotation.labelPointFeet[0] !== seed.pointFeet[0] || annotation.labelPointFeet[1] !== seed.pointFeet[1] ||
      JSON.stringify(original) !== JSON.stringify(room.properties.originalSourceRingsFeet ?? room.ringsFeet) ||
      data.edges.some(edge => edge.enabled && (edge.from === seed.id || edge.to === seed.id))) return;
  const own = nativeRationalOverlay("intersection", [original], [room.ringsFeet]);
  if (!own.length || nativeRationalPointInParts(seed.pointFeet, nativeRationalOverlay("union", [original]))) return;
  const permitted = (keys: string[]) => keys.every(key => records.get(key)?.walkable && records.get(key)?.access !== "staff");
  const candidates: NativeDoorTerminalArrivalProposal[] = [];
  const measuredOwnDoors = (data.doors ?? []).filter(door => door.state === "connected" &&
    door.levelId === room.levelId && door.roomKeys.includes(room.key) &&
    Number.isSafeInteger(door.nativeElementId) && door.nativeElementId > 0 && !!door.hostWallNativeElementId);
  if (measuredOwnDoors.length !== 1) return;
  for (const door of measuredOwnDoors) {
    if (door.state !== "connected" || door.levelId !== room.levelId || !door.roomKeys.includes(room.key) ||
        !Number.isSafeInteger(door.nativeElementId) || door.nativeElementId! <= 0 || !door.hostWallNativeElementId ||
        door.roomKeys.length !== 2 || new Set(door.roomKeys).size !== 2 || !permitted(door.roomKeys)) continue;
    const edge = data.edges.find(item => item.id === door.id);
    if (!edge || !edge.enabled || edge.kind !== "door" || edge.nativeElementId !== door.nativeElementId || edge.sourceDoorProof ||
        edge.roomKeys.length !== 2 || new Set(edge.roomKeys).size !== 2 ||
        edge.roomKeys.some(key => !door.roomKeys.includes(key)) || !checks.originalEdge(edge)) continue;
    for (const portalId of [edge.from, edge.to]) {
      const portal = nodes.get(portalId), other = nodes.get(portalId === edge.from ? edge.to : edge.from);
      if (!portal || !other || portal.kind !== "portal" || portal.roomKey !== room.key || portal.levelId !== room.levelId ||
          portal.surfaceId !== room.surfaceId || portal.pointFeet[2] !== room.elevationFeet || !portal.pointFeet.every(Number.isFinite) || !strictInside(portal.pointFeet, own) ||
          other.roomKey === room.key || !edge.roomKeys.includes(other.roomKey) || other.levelId !== room.levelId ||
          other.pointFeet[2] !== room.elevationFeet || !other.pointFeet.every(Number.isFinite) || !permitted([other.roomKey]) ||
          !samePoint(edge.pointsFeet[0]!, nodes.get(edge.from)!.pointFeet) ||
          !samePoint(edge.pointsFeet.at(-1)!, nodes.get(edge.to)!.pointFeet)) continue;
      for (const approach of data.edges) {
        if (!approach.enabled || approach.kind !== "walk" || !approach.nativeCellId || !approach.roomKeys.includes(room.key) ||
            (approach.from !== portal.id && approach.to !== portal.id) || !checks.originalEdge(approach)) continue;
        const cell = geometry.cells.find(item => item.id === approach.nativeCellId),
          peer = nodes.get(approach.from === portal.id ? approach.to : approach.from);
        if (!cell?.exactFaceId || !cell.roomKeys.includes(room.key) || !cell.levelIds.includes(room.levelId) ||
            cell.elevationFeet !== room.elevationFeet || !cell.nativeFloorIds.length || cell.accessZoneId !== undefined ||
            !peer || peer.roomKey !== room.key || peer.levelId !== room.levelId || peer.surfaceId !== room.surfaceId ||
            peer.pointFeet[2] !== room.elevationFeet || !nativeRationalPointInParts(peer.pointFeet, own) ||
            !samePoint(approach.pointsFeet[0]!, nodes.get(approach.from)!.pointFeet) ||
            !samePoint(approach.pointsFeet.at(-1)!, nodes.get(approach.to)!.pointFeet) ||
            approach.pointsFeet.some(point => point[2] !== room.elevationFeet || !point.every(Number.isFinite)) ||
            !nativeRationalPathSupported(approach.pointsFeet, own) ||
            !permitted([...cell.roomKeys, ...approach.roomKeys, ...edge.roomKeys])) continue;
        const floors = data.walkingSupport.floors.filter(floor => cell.nativeFloorIds.includes(floor.nativeElementId) &&
          floor.elevationFeet === cell.elevationFeet).flatMap(floor => floor.partsFeet ?? [floor.ringsFeet]);
        if (cell.nativeFloorIds.some(id => !data.walkingSupport!.floors.some(floor => floor.nativeElementId === id &&
            floor.elevationFeet === cell.elevationFeet))) continue;
        const physical = checks.physicalApproachParts(cell, approach);
        if (!physical?.length || !floors.length) continue;
        const supported = nativeRationalOverlay("intersection", physical, floors);
        if (!wholeWalkingStrip(approach.pointsFeet, supported)) continue;
        candidates.push({ version: 1, sourceModelSha256: sha, sourceRoomsSha256: data.source.roomsSha256,
          sourceGeometryKey: geometry.sourceGeometryKey, exactTopologySha256: geometry.exactTopology.geometrySha256,
          roomKey: room.key, originalArrivalNodeId: seed.id, originalArrivalPointFeet: [...seed.pointFeet],
          originalLabelPointFeet: [...annotation.labelPointFeet], proposedArrivalNodeId: portal.id,
          proposedArrivalPointFeet: [...portal.pointFeet], arrivalSemantics: "inside-at-native-door-approach",
          nativeDoorElementId: door.nativeElementId, doorEdgeId: edge.id, lateralApproachEdgeId: approach.id,
          cellId: cell.id, nativeFloorIds: [...cell.nativeFloorIds], walkingStripWidthFeet: 2,
          roomKeys: [...new Set([room.key, ...cell.roomKeys, ...approach.roomKeys, ...edge.roomKeys])].sort() });
      }
    }
  }
  // A closer/first portal cannot disambiguate multiple actual source entries.
  return new Set(candidates.map(candidate => candidate.proposedArrivalNodeId)).size === 1 ? candidates[0] : undefined;
}
