type Point = readonly number[];
type Rings = readonly Point[];
type Parts = readonly (readonly Rings[])[];
/** Only numerical point-on-original-edge recognition; never a geometric buffer. */
export function nativePlanarPointInRing(p: Point, ring: Rings) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
      error =
        8 *
        Number.EPSILON *
        Math.max(
          1,
          Math.abs(p[0]),
          Math.abs(p[1]),
          Math.abs(a[0]),
          Math.abs(a[1]),
          Math.abs(b[0]),
          Math.abs(b[1]),
        );
    if (
      t >= 0 &&
      t <= 1 &&
      Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) <= error
    )
      return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < a[0] + ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1])
    )
      inside = !inside;
  }
  return inside;
}
export const nativePlanarPointInParts = (p: Point, parts: Parts) =>
  parts.some(
    (rings) =>
      rings.length > 0 &&
      nativePlanarPointInRing(p, rings[0]) &&
      !rings.slice(1).some((h) => nativePlanarPointInRing(p, h)),
  );
/** Every positive original-boundary interval is checked, including tiny real
 * gaps and holes. Degenerate traces still require actual point support. */
export function nativePlanarPathSupported(
  points: readonly Point[],
  parts: Parts,
) {
  if (
    !points.length ||
    !parts.length ||
    points.some((p) => p.length < 2 || p.some((v) => !Number.isFinite(v)))
  )
    return false;
  for (const p of points) if (!nativePlanarPointInParts(p, parts)) return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      cuts = [0, 1];
    for (const part of parts)
      for (const ring of part)
        for (let k = 0; k < ring.length; k++) {
          const p = ring[k],
            q = ring[(k + 1) % ring.length],
            ex = q[0] - p[0],
            ey = q[1] - p[1],
            den = dx * ey - dy * ex;
          if (den === 0) continue;
          const ox = p[0] - a[0],
            oy = p[1] - a[1],
            t = (ox * ey - oy * ex) / den,
            u = (ox * dy - oy * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
        }
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++)
      if (cuts[j] > cuts[j - 1]) {
        const t = (cuts[j] + cuts[j - 1]) / 2;
        if (!nativePlanarPointInParts([a[0] + t * dx, a[1] + t * dy], parts))
          return false;
      }
  }
  return true;
}
