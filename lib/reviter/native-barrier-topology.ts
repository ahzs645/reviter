type Point = [number, number];
export const NATIVE_BARRIER_TOPOLOGY_VERSION = "native-wall-contact-noding-v2";
type Rings = Point[][];

/** Preserve native face contacts when reducing numerical precision.
 * A vertex already on another barrier edge is inserted into that edge before
 * rounding so both polygons retain the same grid vertex. No real gap is closed,
 * no polygon is buffered, and original source coordinates remain unchanged.
 * 1e-7 ft is below the compiler grid and only covers floating-point contacts. */
export function nativeBarrierTopology(
  barriers: Rings[],
  grid = 1e6,
  origin: Point = [0, 0],
  contact = 1e-7,
): Rings[] {
  const cell = 16;
  type Edge = {
    id: number;
    barrier: number;
    ring: number;
    index: number;
    a: Point;
    b: Point;
    nodes: { t: number; point: Point }[];
  };
  const edges: Edge[] = [],
    buckets = new Map<string, Edge[]>();
  const key = (x: number, y: number) => `${x}:${y}`;
  for (const [barrier, rings] of barriers.entries())
    for (const [ri, ring] of rings.entries())
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index],
          b = ring[(index + 1) % ring.length];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const edge: Edge = {
          id: edges.length,
          barrier,
          ring: ri,
          index,
          a,
          b,
          nodes: [],
        };
        edges.push(edge);
        for (
          let x = Math.floor((Math.min(a[0], b[0]) - contact) / cell);
          x <= Math.floor((Math.max(a[0], b[0]) + contact) / cell);
          x++
        )
          for (
            let y = Math.floor((Math.min(a[1], b[1]) - contact) / cell);
            y <= Math.floor((Math.max(a[1], b[1]) + contact) / cell);
            y++
          ) {
            const k = key(x, y),
              list = buckets.get(k);
            if (list) list.push(edge);
            else buckets.set(k, [edge]);
          }
      }
  for (const [barrier, rings] of barriers.entries())
    for (const ring of rings)
      for (const point of ring) {
        for (const edge of buckets.get(
          key(Math.floor(point[0] / cell), Math.floor(point[1] / cell)),
        ) ?? []) {
          if (edge.barrier === barrier) continue;
          const dx = edge.b[0] - edge.a[0],
            dy = edge.b[1] - edge.a[1],
            l2 = dx * dx + dy * dy;
          const t =
            ((point[0] - edge.a[0]) * dx + (point[1] - edge.a[1]) * dy) / l2;
          if (t <= 0 || t >= 1) continue;
          if (
            Math.hypot(
              point[0] - edge.a[0] - t * dx,
              point[1] - edge.a[1] - t * dy,
            ) > contact
          )
            continue;
          edge.nodes.push({ t, point });
        }
      }
  // Intersections of original edges need one shared grid node as well. Rounding
  // each unsplit crossing independently can otherwise turn overlap contacts into
  // microscopic bypasses. Only true finite segment crossings are inserted.
  for (const edge of edges) {
    const candidates = new Set<Edge>();
    for (
      let x = Math.floor(Math.min(edge.a[0], edge.b[0]) / cell);
      x <= Math.floor(Math.max(edge.a[0], edge.b[0]) / cell);
      x++
    )
      for (
        let y = Math.floor(Math.min(edge.a[1], edge.b[1]) / cell);
        y <= Math.floor(Math.max(edge.a[1], edge.b[1]) / cell);
        y++
      )
        for (const other of buckets.get(key(x, y)) ?? [])
          if (other.id > edge.id && other.barrier !== edge.barrier)
            candidates.add(other);
    const dx = edge.b[0] - edge.a[0],
      dy = edge.b[1] - edge.a[1];
    for (const other of candidates) {
      const ex = other.b[0] - other.a[0],
        ey = other.b[1] - other.a[1],
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14 * Math.hypot(dx, dy) * Math.hypot(ex, ey))
        continue;
      const ax = other.a[0] - edge.a[0],
        ay = other.a[1] - edge.a[1],
        t = (ax * ey - ay * ex) / den,
        u = (ax * dy - ay * dx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const point: Point = [edge.a[0] + t * dx, edge.a[1] + t * dy];
      if (t > 0 && t < 1) edge.nodes.push({ t, point });
      if (u > 0 && u < 1) other.nodes.push({ t: u, point });
    }
  }
  const byEdge = new Map(
    edges.map((e) => [`${e.barrier}:${e.ring}:${e.index}`, e]),
  );
  return barriers.map((rings, bi) =>
    rings.map((ring, ri) => {
      const output: Point[] = [];
      for (let i = 0; i < ring.length; i++) {
        const edge = byEdge.get(`${bi}:${ri}:${i}`);
        const points = [
          ring[i],
          ...(edge?.nodes.sort((a, b) => a.t - b.t).map((n) => n.point) ?? []),
        ];
        for (const p of points) {
          const q: Point = [
            Math.round((p[0] - origin[0]) * grid) / grid + origin[0],
            Math.round((p[1] - origin[1]) * grid) / grid + origin[1],
          ];
          const last = output.at(-1);
          if (!last || last[0] !== q[0] || last[1] !== q[1]) output.push(q);
        }
      }
      return output;
    }),
  );
}
