/** Reviewed door links whose one side is a generated native ramp landing (`landing:<rampRecipeId>:
 * upper|lower`). The landing record exists only after the reviewed ramp is rebuilt, so the link is
 * resolved then. The room side follows the ordinary reviewed-portal rule (the door adjoins the
 * room: doorCandidates, nearest room boundary). A generated landing has no drawn outline at the
 * door, so its side is the physical threshold opposite the room, one cell beyond the door leaf
 * along the door normal, and that point must stand on the landing's own original native slab;
 * reaching it from the landing is left to the exact native cell routes. Both areas must be walkable
 * public areas at one floor height, and the crossing must clear floor voids and native barriers.
 * The physical door becomes a two-owner connected door with its own portal nodes. */
import type { IndoorDataset, IndoorEdge, IndoorNode } from "./indoor-contract.ts";
import { generatedLandingDoorLinkKey, type DirectoryDoor, type DirectoryRoom, type RoomPortal, type RoomPoint } from "./room-directory.ts";
import { doorCandidates } from "./directory-navigation.ts";
import { nearestRoomBoundary } from "./room-directory.ts";

export type GeneratedLandingDoorLink = { doorId: number; levelId: number; rooms: string[] };
export function resolveGeneratedLandingDoorLinks(input: {
  dataset: IndoorDataset;
  links: readonly GeneratedLandingDoorLink[];
  directoryDoor: (levelId: number, doorId: number) => DirectoryDoor | undefined;
  area: (record: IndoorDataset["records"][number]) => DirectoryRoom;
  floorVoids: (elevationFeet: number, areas: DirectoryRoom[]) => RoomPoint[][];
  /** The point lies on the generated landing's own original native slab (exact walking support). */
  onLandingSlab: (landing: IndoorDataset["records"][number], point: RoomPoint) => boolean;
  crossesBarrier: (levelId: number, portal: RoomPortal, holes: RoomPoint[][]) => boolean;
  geo: (point: RoomPoint) => [number, number];
  metresPerFoot: number;
  existingNodeIds: ReadonlySet<string>;
}) {
  const { dataset } = input;
  const applied: { link: GeneratedLandingDoorLink; roomKeys: [string, string]; nodes: IndoorNode[]; edge: IndoorEdge }[] = [];
  const rejected: { link: GeneratedLandingDoorLink; reason: string }[] = [];
  for (const link of input.links) {
    const fail = (reason: string) => rejected.push({ link, reason });
    const keys = link.rooms.map((key) => {
      const landing = generatedLandingDoorLinkKey(key);
      return landing ? dataset.nodes.find((n) => n.id === `${landing.rampId}:${landing.end}`)?.roomKey : key;
    });
    if (keys.length !== 2 || keys.some((k) => !k) || keys[0] === keys[1]) { fail("the reviewed ramp did not build that landing."); continue; }
    const door = dataset.doors?.find((d) => d.levelId === link.levelId && d.nativeElementId === link.doorId);
    const directoryDoor = input.directoryDoor(link.levelId, link.doorId);
    if (!door || !directoryDoor || door.state === "connected" || dataset.edges.some((e) => e.id === door.id)) { fail("the physical door is missing or already connected."); continue; }
    const owners = keys.map((k) => dataset.records.find((r) => r.key === k));
    if (owners.some((r) => !r || r.levelId !== link.levelId || !r.walkable || r.access === "staff") || Math.abs(owners[0]!.elevationFeet - owners[1]!.elevationFeet) > 0.05) { fail("both areas must be walkable public areas at one floor height."); continue; }
    const areas = owners.map((r) => input.area(r!));
    const landingIndex = link.rooms.findIndex((k) => !!generatedLandingDoorLinkKey(k)), roomIndex = 1 - landingIndex;
    const room = areas[roomIndex]!, n = directoryDoor.normal, footprint = directoryDoor.footprint;
    if (!footprint || !n || !Math.hypot(n[0], n[1]) || !doorCandidates([room], directoryDoor).length) { fail("the physical door does not adjoin the room."); continue; }
    const roomPoint = [room.polygonFeet, ...(room.holesFeet ?? [])].map((loop) => nearestRoomBoundary(directoryDoor.point, loop)).sort((a, b) => a.distance - b.distance)[0]!.point;
    const unit: RoomPoint = [n[0] / Math.hypot(n[0], n[1]), n[1] / Math.hypot(n[0], n[1])];
    const along = (p: RoomPoint) => (p[0] - directoryDoor.point[0]) * unit[0] + (p[1] - directoryDoor.point[1]) * unit[1];
    const roomSide = Math.sign(along(roomPoint));
    const reach = Math.max(...footprint.map((p) => Math.abs(along(p)))) + 0.6;
    const landingPoint: RoomPoint = [directoryDoor.point[0] - roomSide * unit[0] * reach, directoryDoor.point[1] - roomSide * unit[1] * reach];
    if (!roomSide || !input.onLandingSlab(owners[landingIndex]!, landingPoint)) { fail("the door's landing-side threshold is not on the landing's original native slab."); continue; }
    const ends = landingIndex === 0 ? [landingPoint, roomPoint] : [roomPoint, landingPoint];
    const portal: RoomPortal = { doorId: link.doorId, rooms: keys as [string, string], point: directoryDoor.point, from: ends[0]!, to: ends[1]!, halfWidth: directoryDoor.halfWidth, halfHeight: directoryDoor.halfHeight, footprint, normal: n, reviewed: true };
    let holes: RoomPoint[][];
    try { holes = input.floorVoids(owners[0]!.elevationFeet, areas); } catch (error) { fail(`current native slab holes are unclassifiable: ${String(error)}`); continue; }
    if (input.crossesBarrier(link.levelId, portal, holes)) { fail("the crossing meets a floor opening, room hole or native barrier."); continue; }
    const nodes: IndoorNode[] = keys.map((key, i) => {
      const point = i ? portal.to : portal.from;
      return { id: `${door.id}:${i}`, roomKey: key!, kind: "portal", levelId: owners[i]!.levelId, building: owners[i]!.building, surfaceId: owners[i]!.surfaceId, pointFeet: [point[0], point[1], owners[i]!.elevationFeet], geographic: input.geo(point) };
    });
    if (nodes.some((n) => input.existingNodeIds.has(n.id))) { fail("door portal identities already exist."); continue; }
    const edge: IndoorEdge = { id: door.id, from: nodes[0]!.id, to: nodes[1]!.id, kind: "door", pointsFeet: nodes.map((n) => n.pointFeet), lengthMetres: Math.hypot(portal.from[0] - portal.to[0], portal.from[1] - portal.to[1]) * input.metresPerFoot, roomKeys: keys as string[], evidence: "reviewed-native-door; generated ramp landing association resolved after the reviewed ramp built its landing", nativeElementId: door.nativeElementId, accessible: "unknown", enabled: true };
    door.roomKeys = keys as string[];
    door.state = "connected";
    dataset.edges.push(edge);
    applied.push({ link, roomKeys: keys as [string, string], nodes, edge });
  }
  return { applied, rejected };
}
