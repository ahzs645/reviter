import polygonClipping from "polygon-clipping";
import { nativeWallSolidPolygon } from "./architectural-plan.ts";
import { triangulate, type Point2 } from "./polygon.ts";
import type { ConvertResult } from "./types.ts";

type Point3 = [number, number, number];

/** Display-only subtraction: retain the measured ramp slope and trim its
 * surface at actual wall faces. This never extends a ramp or authorizes a route. */
export function rampFacesOutsideWalls(
  model: Pick<ConvertResult, "elementBounds">,
  triangles: Point3[][],
): Point3[][] {
  const all = triangles.flat();
  if (!all.length) return triangles;
  const box = [0, 1, 2].map((i) => [
    Math.min(...all.map((p) => p[i]!)),
    Math.max(...all.map((p) => p[i]!)),
  ]);
  const walls = model.elementBounds
    .filter(
      (e) =>
        e.categoryId === -2000011 &&
        e.boundsFeet &&
        e.boundsFeet.min.x <= box[0]![1]! &&
        e.boundsFeet.max.x >= box[0]![0]! &&
        e.boundsFeet.min.y <= box[1]![1]! &&
        e.boundsFeet.max.y >= box[1]![0]!,
    )
    .flatMap((e) => e.solids ?? (e.solid ? [e.solid] : []))
    .filter(
      (s) => s.baseElevation <= box[2]![1]! && s.topElevation >= box[2]![0]!,
    )
    .map((s) => ({ s, ring: nativeWallSolidPolygon(s) }));
  if (!walls.length) return triangles;
  const out: Point3[][] = [];
  for (const t of triangles) {
    const [a, b, c] = t;
    if (!a || !b || !c) continue;
    const den = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(den) < 1e-10) continue;
    const height = (p: Point2) => {
      const u =
        ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / den;
      const v =
        ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / den;
      return a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]);
    };
    // Clip the wall footprint to the part of this triangle's height plane that
    // actually passes through the wall. Walls on other storeys cannot erase it.
    const clipHeight = (ring: Point2[], limit: number, above: boolean) => {
      const result: Point2[] = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!,
          q = ring[(i + 1) % ring.length]!;
        const hp = height(p) - limit,
          hq = height(q) - limit;
        const pin = above ? hp >= 0 : hp <= 0,
          qin = above ? hq >= 0 : hq <= 0;
        if (pin) result.push(p);
        if (pin !== qin) {
          const f = hp / (hp - hq);
          result.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
        }
      }
      return result;
    };
    const obstacles = walls.flatMap(({ s, ring }) => {
      const clipped = clipHeight(
        clipHeight(ring, s.baseElevation, true),
        s.topElevation,
        false,
      );
      return clipped.length >= 3 ? [[clipped]] : [];
    });
    if (!obstacles.length) {
      out.push(t);
      continue;
    }
    const xy = t.map((p): Point2 => [p[0], p[1]]);
    const overlaps = obstacles.filter(
      (p) => polygonClipping.intersection([xy], p).length,
    );
    if (!overlaps.length) {
      out.push(t);
      continue;
    }
    for (const part of polygonClipping.difference([xy], ...overlaps)) {
      const rings = part.map((r) => r.slice(0, -1) as Point2[]);
      const points = rings.flat();
      const indices = triangulate(rings[0]!, rings.slice(1));
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices
          .slice(i, i + 3)
          .map(
            (j): Point3 => [points[j]![0], points[j]![1], height(points[j]!)],
          );
        out.push(triangle);
      }
    }
  }
  return out;
}
