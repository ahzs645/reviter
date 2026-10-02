import pc from "polygon-clipping";
import type { IndoorDataset } from "./indoor-contract.ts";

type Point = [number, number];
type Ring = Point[];
type Rings = Ring[];
type Parts = Rings[];
type Box = [number, number, number, number];
type Interior = { roomKey: string; levelId: number; ringsFeet: Rings };
const REACH = 3;
const CONTACT = 0.015; // feet; only existing wall material can be claimed
const bounds = (rings: Rings): Box => {
  const points = rings.flat();
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
};
const intersects = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const expand = (a: Box): Box => [a[0] - REACH, a[1] - REACH, a[2] + REACH, a[3] + REACH];
const dot = (p: Point, axis: Point) => p[0] * axis[0] + p[1] * axis[1];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const edges = (ring: Ring): [Point, Point][] => ring.flatMap((a, i) => {
  const b = ring[(i + 1) % ring.length];
  return Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6 ? [[a, b] as [Point, Point]] : [];
});
function normalize(rings: Rings, origin: Point): Rings {
  if (!rings.length || rings.some(r => r.length < 3 || r.some(p => p.length !== 2 || !p.every(Number.isFinite))))
    throw new Error("Invalid presentation polygon");
  return rings.map(ring => {
    const points: Ring = ring.map(p => [Math.round((p[0] - origin[0]) * 10_000) / 10_000,
      Math.round((p[1] - origin[1]) * 10_000) / 10_000]);
    if (points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop();
    return points;
  });
}
function contact(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = subtract(b, a), cd = subtract(d, c);
  const length = Math.hypot(...ab), other = Math.hypot(...cd);
  if (length < 0.05 || other < 0.05) return false;
  const axis: Point = [ab[0] / length, ab[1] / length], normal: Point = [-axis[1], axis[0]];
  if (Math.abs(dot(cd, axis)) / other < 0.99999 ||
    Math.abs(dot(subtract(c, a), normal)) > CONTACT || Math.abs(dot(subtract(d, a), normal)) > CONTACT) return false;
  const start = dot(subtract(c, a), axis), end = dot(subtract(d, a), axis);
  return Math.min(length, Math.max(start, end)) - Math.max(0, Math.min(start, end)) > 0.05;
}
function band([a, b]: [Point, Point]): Rings {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) * REACH / length, dy = (b[1] - a[1]) * REACH / length;
  return [[[a[0] - dx - dy, a[1] - dy + dx], [b[0] + dx - dy, b[1] + dy + dx],
    [b[0] + dx + dy, b[1] + dy - dx], [a[0] - dx + dy, a[1] - dy - dx]]];
}
function union(parts: Parts): Parts {
  if (!parts.length) return [];
  const sorted = [...parts].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return pc.union(sorted[0], ...sorted.slice(1));
}
type Rectangle = { axis: Point; normal: Point; u0: number; u1: number; v0: number; v1: number };
function rectangle(rings: Rings): Rectangle | null {
  if (rings.length !== 1 || rings[0].length !== 4) return null;
  const segments = edges(rings[0]);
  if (segments.length !== 4) return null;
  const longest = segments.map(([a, b]) => subtract(b, a)).sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0];
  const length = Math.hypot(...longest);
  const axis: Point = [longest[0] / length, longest[1] / length], normal: Point = [-axis[1], axis[0]];
  const projected = rings[0].map(p => [dot(p, axis), dot(p, normal)] as Point);
  const [u0, v0, u1, v1] = bounds([projected]);
  if (u1 - u0 < 3 * (v1 - v0) || v1 - v0 <= 0) return null;
  const tolerance = 0.001;
  if (projected.some(([u, v]) => Math.min(Math.abs(u - u0), Math.abs(u - u1)) > tolerance ||
    Math.min(Math.abs(v - v0), Math.abs(v - v1)) > tolerance)) return null;
  return { axis, normal, u0, u1, v0, v1 };
}
function side(rect: Rectangle, touching: [Point, Point][]): -1 | 1 | null {
  const sides = new Set<number>();
  for (const [a, b] of touching) {
    const direction = subtract(b, a), length = Math.hypot(...direction);
    if (Math.abs(dot(direction, rect.axis)) / length < 0.99999) continue;
    const v = (dot(a, rect.normal) + dot(b, rect.normal)) / 2;
    if (Math.abs(v - rect.v0) <= CONTACT) sides.add(-1);
    if (Math.abs(v - rect.v1) <= CONTACT) sides.add(1);
  }
  return sides.size === 1 ? [...sides][0] as -1 | 1 : null;
}
function wallSlice(rect: Rectangle, u0: number, u1: number, v0: number, v1: number): Rings {
  return [[[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) =>
    [u * rect.axis[0] + v * rect.normal[0], u * rect.axis[1] + v * rect.normal[1]] as Point)];
}
function half(rect: Rectangle, side: -1 | 1): Rings {
  const middle = (rect.v0 + rect.v1) / 2;
  const v0 = side === -1 ? rect.v0 : middle, v1 = side === -1 ? middle : rect.v1;
  return wallSlice(rect, rect.u0, rect.u1, v0, v1);
}
function longitudinalSpan(rect: Rectangle, touching: [Point, Point][], ownerSide: -1 | 1 | null): [number, number] | null {
  if (!ownerSide) return null;
  const face = ownerSide === -1 ? rect.v0 : rect.v1;
  const points = touching.filter(([a, b]) => Math.abs(dot(a, rect.normal) - face) <= CONTACT &&
    Math.abs(dot(b, rect.normal) - face) <= CONTACT).flat();
  return points.length ? [Math.min(...points.map(p => dot(p, rect.axis))), Math.max(...points.map(p => dot(p, rect.axis)))] : null;
}
function canonical(parts: Parts, origin: Point): Parts {
  const rings = (ring: Ring): Ring => {
    const restored: Ring = ring.map(([x, y]) => [x + origin[0], y + origin[1]]);
    if (restored[0][0] === restored.at(-1)![0] && restored[0][1] === restored.at(-1)![1]) restored.pop();
    let start = 0;
    for (let i = 1; i < restored.length; i++)
      if (restored[i][0] < restored[start][0] || (restored[i][0] === restored[start][0] && restored[i][1] < restored[start][1])) start = i;
    const ordered = [...restored.slice(start), ...restored.slice(0, start)];
    return [...ordered, ordered[0]];
  };
  return parts.map(part => [rings(part[0]), ...part.slice(1).map(rings).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Prepared roofs for verified room interiors. Added area is capped by native
 * walls; never grow a room into free floor to hide an incomplete source corner.
 * Straight rectangular shared walls split at their centerline. Ambiguous shared
 * material is left neutral for a separate same-height separator layer. This
 * function neither edits source geometry nor authorizes a routing connection. */
export function prepareRoomBlocks(
  interiors: Interior[],
  walls: IndoorDataset["walls"],
  doors: NonNullable<IndoorDataset["doors"]>,
  protectedAreas: { levelId: number; ringsFeet: Rings }[],
): Map<string, Parts> {
  const result = new Map<string, Parts>();
  for (const levelId of new Set(interiors.map(r => r.levelId))) {
    const input = interiors.filter(r => r.levelId === levelId);
    const valid = input.filter(r => r.ringsFeet.length && r.ringsFeet.every(ring => ring.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite))));
    if (!valid.length) continue;
    const boxes = valid.map(r => bounds(r.ringsFeet));
    const origin: Point = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1]))];
    const rooms = valid.map(r => ({ ...r, rings: normalize(r.ringsFeet, origin), box: expand(bounds(r.ringsFeet)), claims: [] as Parts }));
    const cutters: { rings: Rings; box: Box }[] = [];
    for (const area of [...protectedAreas.filter(a => a.levelId === levelId), ...doors.filter(d => d.levelId === levelId && d.footprintFeet).map(d => ({ ringsFeet: [d.footprintFeet!] }))]) {
      try { cutters.push({ rings: normalize(area.ringsFeet, origin), box: bounds(area.ringsFeet) }); } catch { /* Invalid source cannot establish a cut. */ }
    }
    // Process each native footprint independently; local unions avoid the huge
    // campus-wide wall union and preserve precise rectangular partition axes.
    for (const wall of walls.filter(w => w.levelId === levelId && w.kind === "wall")) {
      try {
        const box = bounds(wall.ringsFeet), rings = normalize(wall.ringsFeet, origin), faces = rings.flatMap(edges);
        const owners = rooms.filter(room => intersects(room.box, box)).flatMap(room => {
          const touching = edges(room.rings[0]).filter(([a, b]) => faces.some(([c, d]) => contact(a, b, c, d)));
          if (!touching.length) return [];
          const claim = pc.intersection(rings, union(touching.map(band)));
          return claim.length ? [{ room, touching, claim }] : [];
        });
        const rect = rectangle(rings);
        const assigned = owners.map(owner => {
          const ownerSide = rect ? side(rect, owner.touching) : null;
          return { ...owner, side: ownerSide, span: rect ? longitudinalSpan(rect, owner.touching, ownerSide) : null };
        });
        const split = rect && assigned.some(o => o.side === -1) && assigned.some(o => o.side === 1);
        for (const owner of assigned) {
          let material = split && owner.side ? pc.intersection(owner.claim, half(rect!, owner.side)) : owner.claim;
          if (rect && owner.span && owner.side) {
            let u0 = rect.u0, u1 = rect.u1;
            // Adjacent rooms on one long wall face meet halfway across their
            // intervening partition. Long uncovered spans remain neutral.
            const maximumGap = 2 * (rect.v1 - rect.v0) + CONTACT;
            for (const other of assigned) {
              if (other === owner || other.side !== owner.side || !other.span) continue;
              const after = other.span[0] - owner.span[1], before = owner.span[0] - other.span[1];
              if (after >= -CONTACT && after <= maximumGap)
                u1 = Math.min(u1, (owner.span[1] + other.span[0]) / 2);
              if (before >= -CONTACT && before <= maximumGap)
                u0 = Math.max(u0, (owner.span[0] + other.span[1]) / 2);
            }
            material = u1 > u0 ? pc.intersection(material, wallSlice(rect, u0, u1, rect.v0, rect.v1)) : [];
          }
          owner.room.claims.push(...material);
        }
      } catch { /* Malformed wall material is never guessed or expanded. */ }
    }
    const claims = rooms.map(room => {
      try { return union(room.claims); } catch { return [] as Parts; }
    });
    for (const [i, room] of rooms.entries()) {
      const conservativeInterior=()=>{
        const holes=room.rings.slice(1).map(ring=>[ring]);
        const localCuts=cutters.filter(cut=>intersects(room.box,cut.box)).map(cut=>cut.rings);
        const parts=holes.length||localCuts.length?pc.difference(room.rings,...holes,...localCuts):[room.rings];
        return canonical(parts,origin);
      };
      try {
        const nearby = rooms.flatMap((other, j) => i !== j && intersects(room.box, other.box) ? [claims[j]] : []).filter(parts => parts.length);
        const exclusive = nearby.length && claims[i].length ? pc.difference(claims[i], ...nearby) : claims[i];
        let parts = union([room.rings, ...exclusive]);
        const holes = room.rings.slice(1).map(ring => [ring]);
        const localCuts = cutters.filter(cut => intersects(room.box, cut.box)).map(cut => cut.rings);
        if (holes.length || localCuts.length) parts = pc.difference(parts, ...holes, ...localCuts);
        result.set(room.roomKey, parts.length?canonical(parts, origin):conservativeInterior());
      } catch {
        // Roof ownership can encounter a numerical shared-wall sliver after
        // another room is recovered. Keep the independently verified interior
        // under all existing masks; never fall back to an expanded source box.
        try {result.set(room.roomKey,conservativeInterior());} catch { /* Invalid masks still cannot authorize a roof. */ }
      }
    }
  }
  return result;
}
