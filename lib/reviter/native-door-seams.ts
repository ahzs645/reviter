// The source material and its serialized indoor envelope can describe the same
// jamb span at slightly different coordinates. Match both original endpoints.
type Point = [number, number];
type Rings = Point[][];
const joinToleranceFeet = 1e-7;
const close = (a: Point, b: Point) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= joinToleranceFeet ** 2;

export function matchingDoorSeams(
  footprint: Point[],
  envelopes: Rings[],
): Rings[] {
  const strips: Rings[] = [];
  if (footprint.length < 3) return strips;
  for (const [ring] of envelopes) {
    if (!ring) continue;
    for (let j = 0; j < ring.length; j++) {
      const u = ring[j]!,
        v = ring[(j + 1) % ring.length]!;
      for (let i = 0; i < footprint.length; i++) {
        const a = footprint[i]!,
          b = footprint[(i + 1) % footprint.length]!;
        if (close(a, b)) continue;
        let start: Point, end: Point;
        if (close(a, u) && close(b, v)) [start, end] = [u, v];
        else if (close(a, v) && close(b, u)) [start, end] = [v, u];
        else continue;
        const side = (p: Point) =>
          (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const s = side(start),
          t = side(end);
        if ((s === 0 && t === 0) || s * t < 0) continue;
        strips.push([[a, b, end, start]]);
      }
    }
  }
  return strips;
}
