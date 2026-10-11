/** Compiler-only checks of a drawing-backed door (reviewed-drawn-doors.ts): the native host, the
 * floor and obstacles under the aperture, and the two rooms on either side. Every failure refuses
 * the record; nothing is inferred from proximity, and no native door identity is invented. */
import * as DMath from "./deterministic-math.ts";
import pc from "polygon-clipping";
import type { ConvertResult } from "./types.ts";
import { nearestRoomBoundary, type DirectoryDoor, type DirectoryRoom, type RoomPoint, type RoomPortal } from "./room-directory.ts";
import { doorCandidates } from "./directory-navigation.ts";
import {
  DWG_DRAWN_DOOR_LIMITS,
  dwgDrawnDoorDatasetId,
  dwgDrawnDoorElementId,
  type DwgDrawnDoorDrawingProof,
  type DwgDrawnDoorPatch,
} from "./reviewed-drawn-doors.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

type Rings = RoomPoint[][];
const area = (ps: Rings[]) =>
  ps.reduce(
    (s, rs) =>
      s +
      rs.reduce(
        (a, r, i) =>
          a + (i ? -1 : 1) * Math.abs(r.reduce((t, p, j) => { const q = r[(j + 1) % r.length]!; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2,
        0,
      ),
    0,
  );
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]!;
const frame = (p: DwgDrawnDoorPatch) => {
  const n = p.normalFeet,
    u: RoomPoint = [-n[1], n[0]],
    as = p.apertureFeet.map((q) => dot(q, u)),
    ns = p.apertureFeet.map((q) => dot(q, n));
  return { n, u, lo: Math.min(...as), hi: Math.max(...as), n0: Math.min(...ns), n1: Math.max(...ns) };
};
const at = (u: RoomPoint, n: RoomPoint, a: number, b: number): RoomPoint => [a * u[0] + b * n[0], a * u[1] + b * n[1]];

/** Host, aperture and support checks against the native model at this level's plan cut. */
export function verifyDwgDrawnDoorHost(
  model: ConvertResult,
  p: DwgDrawnDoorPatch,
  g: {
    walls: { elementId: number; polygon: RoomPoint[]; approximate?: boolean }[];
    columns: { polygon: RoomPoint[] }[];
    floors: RoomPoint[][][];
    doors?: { elementId: number; polygon: RoomPoint[]; approximate?: boolean }[];
  },
) {
  const refuse = (why: string): never => {
    throw new Error(`Drawing-backed door ${p.id} refused: ${why}.`);
  };
  const L = DWG_DRAWN_DOOR_LIMITS,
    hostId = p.hostWallNativeElementId,
    host = model.elementBounds.find((r) => r.elementId === hostId),
    solid = host?.solid,
    parts = g.walls.filter((w) => w.elementId === hostId);
  if (host?.categoryId !== -2000011 || host.wallKind !== "basic" || host.renderGeometryProvenance !== "native" || !solid || !(solid.thickness > 0))
    refuse(`#${hostId} is not a solid native basic wall`);
  if (parts.length !== 1 || parts[0]!.approximate) refuse(`#${hostId} has no single precise plan section at this level`);
  if (JSON.stringify(parts.map((w) => w.polygon)) !== JSON.stringify(p.wallEvidence[0]!.partsFeet)) refuse(`the recorded original faces of #${hostId} are stale`);
  const { n, u, lo, hi, n0, n1 } = frame(p),
    ring = parts[0]!.polygon,
    face = ring.length === 5 && ring[0]![0] === ring[4]![0] && ring[0]![1] === ring[4]![1] ? ring.slice(0, 4) : ring,
    direction: RoomPoint = [solid!.end.x - solid!.start.x, solid!.end.y - solid!.start.y],
    length = DMath.hypot(...direction);
  const rectangular = (r: RoomPoint[]) =>
    r.length === 4 &&
    r.every((q, i) => {
      const next = r[(i + 1) % 4]!;
      return Math.abs(dot([next[0] - q[0], next[1] - q[1]], u)) <= 1e-6 || Math.abs(dot([next[0] - q[0], next[1] - q[1]], n)) <= 1e-6;
    });
  if (!length || Math.abs(dot(direction, n)) > length * 1e-6) refuse(`the aperture normal is not across host #${hostId}`);
  if (!rectangular(face) || !rectangular(p.apertureFeet)) refuse(`the host section or aperture is not a rectangle across the wall`);
  const hostU = face.map((q) => dot(q, u)),
    hostN = face.map((q) => dot(q, n)),
    h0 = Math.min(...hostN),
    h1 = Math.max(...hostN);
  // The aperture is the host's exact face-to-face depth, inside its length: otherwise the host
  // wall is not at that position.
  if (
    Math.abs(h1 - h0 - solid!.thickness) > 1e-6 ||
    Math.abs(n0 - h0) > 1e-6 ||
    Math.abs(n1 - h1) > 1e-6 ||
    lo < Math.min(...hostU) + 0.01 ||
    hi > Math.max(...hostU) - 0.01 ||
    Math.abs(area(pc.intersection([p.apertureFeet], [ring]) as Rings[]) - (hi - lo) * (h1 - h0)) > 1e-6
  )
    refuse(`host wall #${hostId} is not at the aperture position`);
  if (hi - lo < L.minWidthFeet || hi - lo > L.maxWidthFeet || n1 - n0 > L.maxDepthFeet) refuse(`the aperture is ${(hi - lo).toFixed(3)} ft by ${(n1 - n0).toFixed(3)} ft`);
  const centre: RoomPoint = at(u, n, (lo + hi) / 2, (n0 + n1) / 2);
  if (DMath.hypot(p.pointFeet[0] - centre[0], p.pointFeet[1] - centre[1]) > 1e-6) refuse("the door point is not the aperture centre");
  // A native door hosted here, or any physical door, wall or column in the opening, vetoes it.
  const hosted = new Set((model.nativeHostRelations ?? []).filter((r) => r.hostId === hostId).map((r) => r.elementId));
  for (const door of model.elementBounds.filter((r) => r.categoryId === -2000023 && hosted.has(r.elementId))) {
    const box = door.orientedBox ?? [];
    const du = box.length
      ? box.map((q) => dot(q, u))
      : [dot([door.boundsFeet.min.x, door.boundsFeet.min.y], u), dot([door.boundsFeet.max.x, door.boundsFeet.max.y], u)];
    if (Math.max(...du) > lo && Math.min(...du) < hi) refuse(`native door #${door.elementId} is hosted in the opening; use a native-door aperture kind`);
  }
  if ((g.doors ?? []).some((d) => area(pc.intersection([p.apertureFeet], [d.polygon]) as Rings[]) > 0.001)) refuse("the aperture meets a physical door");
  if (g.walls.some((w) => w.elementId !== hostId && area(pc.intersection([p.apertureFeet], [w.polygon]) as Rings[]) > 0.001)) refuse("the aperture meets a foreign wall");
  if (g.columns.some((c) => area(pc.intersection([p.apertureFeet], [c.polygon]) as Rings[]) > 0.001)) refuse("the aperture meets a column");
  // Full width supported by the exact native floor under the opening and on both sides.
  const s = L.thresholdStripFeet,
    strip = (a: number, b: number): RoomPoint[] => [at(u, n, lo, a), at(u, n, hi, a), at(u, n, hi, b), at(u, n, lo, b)];
  if (!g.floors.length || [p.apertureFeet, strip(n0 - s, n0), strip(n1, n1 + s)].some((r) => area(pc.difference([r], ...g.floors) as Rings[]) > 0.001))
    refuse("the opening is not fully supported by native floor on both sides");
  if (model.elementBounds.some((r) => r.elementId === dwgDrawnDoorElementId(p.levelId, p.id))) refuse("its synthetic door identity collides with a model element");
}

/** Ordinary reviewed-portal rule: both rooms adjoin the opening (doorCandidates, nearest room
 * boundary), on opposite sides of the wall, and the leaf opens into the recorded room. */
export function dwgDrawnDoorPortal(p: DwgDrawnDoorPatch, rooms: readonly DirectoryRoom[], proof: DwgDrawnDoorDrawingProof): RoomPortal {
  const refuse = (why: string): never => {
    throw new Error(`Drawing-backed door ${p.id} refused: ${why}.`);
  };
  const xs = p.apertureFeet.map((q) => q[0]),
    ys = p.apertureFeet.map((q) => q[1]),
    door: DirectoryDoor = {
      id: dwgDrawnDoorElementId(p.levelId, p.id),
      point: p.pointFeet,
      halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2,
      halfHeight: (Math.max(...ys) - Math.min(...ys)) / 2,
      footprint: p.apertureFeet,
      normal: p.normalFeet,
    },
    { n, n0, n1 } = frame(p),
    candidates = doorCandidates(rooms, door);
  const ends = p.roomKeys.map((key) => {
    const room = candidates.find((r) => r.key === key && r.levelId === p.levelId);
    if (!room) return refuse(`room ${key} does not adjoin the opening`);
    const near = [room.polygonFeet, ...(room.holesFeet ?? [])].map((loop) => nearestRoomBoundary(p.pointFeet, loop)).sort((a, b) => a.distance - b.distance)[0]!.point,
      offset = dot([near[0] - p.pointFeet[0], near[1] - p.pointFeet[1]], n);
    return { key, point: near, side: Math.abs(offset) >= (n1 - n0) / 2 - DWG_DRAWN_DOOR_LIMITS.dwgToleranceFeet ? Math.sign(offset) : 0 };
  });
  if (!ends[0]!.side || !ends[1]!.side || ends[0]!.side === ends[1]!.side) refuse("the two rooms are not on either side of the wall");
  if (ends.find((e) => e.key === p.swing.intoRoomKey)!.side !== proof.openSide) refuse(`the drawn leaf does not open into ${p.swing.intoRoomKey}`);
  return {
    doorId: door.id,
    rooms: [p.roomKeys[0], p.roomKeys[1]],
    point: p.pointFeet,
    from: ends[0]!.point,
    to: ends[1]!.point,
    halfWidth: door.halfWidth,
    halfHeight: door.halfHeight,
    footprint: p.apertureFeet,
    normal: p.normalFeet,
    reviewed: true,
  };
}

/** The synthetic dataset door record (one per applied drawing-backed door). */
export function dwgDrawnDoorDatasetDoor(p: DwgDrawnDoorPatch): NonNullable<IndoorDataset["doors"]>[number] {
  return {
    id: dwgDrawnDoorDatasetId(p),
    levelId: p.levelId,
    nativeElementId: dwgDrawnDoorElementId(p.levelId, p.id),
    hostWallNativeElementId: p.hostWallNativeElementId,
    pointFeet: p.pointFeet,
    footprintFeet: p.apertureFeet,
    normalFeet: p.normalFeet,
    roomKeys: [...p.roomKeys],
    state: "connected",
    drawingBackedPatchId: p.id,
  };
}
