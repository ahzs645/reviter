import { nativeDoorClearOpening } from "./native-door-clear-opening";
import pc from "polygon-clipping";
import { exactNativeDoorFloorDifference } from "./native-door-exact-overlay";
import type { IndoorDataset } from "./indoor-contract";
type Point = [number, number];
type Rings = Point[][];
const bounds = (r: Rings) => {
  const p = r.flat();
  return [
    Math.min(...p.map((p) => p[0])),
    Math.min(...p.map((p) => p[1])),
    Math.max(...p.map((p) => p[0])),
    Math.max(...p.map((p) => p[1])),
  ];
};
const overlaps = (a: number[], b: number[]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const segments = (ring: Point[]) =>
  ring.map((p, i) => [p, ring[(i + 1) % ring.length]] as [Point, Point]);
const distance = (p: Point, [a, b]: [Point, Point]) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  if (!length) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** Overlay residue is exempt only at one identical finite subject/native OUTER
 * edge contact. Four IEEE relative ulps bound numerical cancellation; this is
 * neither an area threshold nor a physical gap closure. Any nearby original
 * floor hole, distinct edge or finite unsupported corner retains its veto. */
function analyticalOuterContact(
  outside: Rings[],
  subject: Point[],
  floors: { rings: Rings }[],
) {
  const area = (r: Point[]) =>
    r.reduce(
      (s, p, i) =>
        s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1],
      0,
    );
  const outer = floors.flatMap((f, owner) => {
      const sign = Math.sign(area(f.rings[0]));
      return segments(f.rings[0]).map((edge) => {
        const [a, b] = edge,
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          l = Math.hypot(dx, dy);
        return {
          edge,
          owner,
          inward: l ? [(-dy / l) * sign, (dx / l) * sign] : [0, 0],
        };
      });
    }),
    holes = floors.flatMap((f) => f.rings.slice(1).flatMap(segments));
  return outside.every(
    (part) =>
      part.length === 1 &&
      outer.some((a, i) => {
        const points = part[0],
          bound =
            4 *
            Number.EPSILON *
            Math.max(
              1,
              ...points.flat().map(Math.abs),
              ...a.edge.flat().map(Math.abs),
            );
        if (
          points.some(
            (p) =>
              distance(p, a.edge) > bound ||
              holes.some((h) => distance(p, h) <= bound),
          )
        )
          return false;
        if (
          segments(subject).some((edge) =>
            points.every((p) => distance(p, edge) <= bound),
          )
        )
          return true;
        // A source slab joint inside the doorway requires a second actual finite
        // outer face with opposite supported interior, never two duplicate proxies.
        return outer.some(
          (b, j) =>
            j !== i &&
            b.owner !== a.owner &&
            a.inward[0] * b.inward[0] + a.inward[1] * b.inward[1] <
              -0.999999999999 &&
            points.every((p) => distance(p, b.edge) <= bound),
        );
      }),
  );
}
/** A preserved physical doorway is metadata, not support over a native slab
 * void. Require its complete measured footprint on the union of exact original
 * same-plane slabs. No label contour, doorway aperture or buffer creates floor. */
export function nativeDoorFloorBlockers(data: IndoorDataset): Set<string> {
  const blocked = new Set<string>();
  if (!data.nativeIndoorEnvelopes) return blocked;
  const doors = new Map((data.doors ?? []).map((d) => [d.id, d]));
  const support = data.walkingSupport;
  const floors = (
    support?.version === 1 &&
    support.sourceModelSha256 === data.source.modelSha256
      ? support.floors
      : []
  ).flatMap((f) =>
    (f.partsFeet ?? [f.ringsFeet]).map((rings) => ({
      z: f.elevationFeet,
      rings,
      box: bounds(rings),
    })),
  );
  for (const edge of data.edges) {
    if (edge.kind !== "door" || !edge.enabled) continue;
    const door = doors.get(edge.id),
      first = edge.pointsFeet[0],
      last = edge.pointsFeet.at(-1),
      ring = door
        ? (nativeDoorClearOpening(data, door, first?.[2] ?? NaN) ??
          door.footprintFeet)
        : undefined;
    if (
      !door ||
      door.nativeElementId !== edge.nativeElementId ||
      !first ||
      !last ||
      Math.abs(first[2] - last[2]) > 0.05 ||
      !ring ||
      ring.length < 3
    ) {
      blocked.add(edge.id);
      continue;
    }
    const box = bounds([ring]);
    const relevant = floors.filter(
      (f) => Math.abs(f.z - first[2]) < 0.05 && overlaps(box, f.box),
    );
    if (!relevant.length) {
      blocked.add(edge.id);
      continue;
    }
    try {
      // Translate every operand by the same exact origin to reduce world-scale
      // cancellation. This is an analytical overlay, never a geometry snap.
      const origin = ring[0],
        relative = (rings: Rings) =>
          rings.map((r) =>
            r.map((p) => [p[0] - origin[0], p[1] - origin[1]] as Point),
          );
      let outside: Rings[];
      try {
        outside = pc.difference(
          relative([ring]),
          relevant.map((f) => relative(f.rings)),
        ) as Rings[];
      } catch {
        outside = exactNativeDoorFloorDifference(
          relative([ring]),
          relevant.map((f) => relative(f.rings)),
        );
      }
      const worldOutside = outside.map((part) =>
        part.map((r) =>
          r.map((p) => [p[0] + origin[0], p[1] + origin[1]] as Point),
        ),
      );
      if (
        outside.length &&
        !analyticalOuterContact(worldOutside, ring, relevant)
      )
        blocked.add(edge.id);
    } catch {
      blocked.add(edge.id);
    }
  }
  return blocked;
}
