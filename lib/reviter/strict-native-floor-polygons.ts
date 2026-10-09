type Point = [number, number];
type ExactPoint = { point: Point; x: bigint; y: bigint };

/** Original IEEE coordinates supply topology. This classifier introduces no
 * distance/area tolerance, grid, replacement vertex or approximate profile.
 * The source compiler and runtime share the same predicate implementation. */
export function strictNativeFloorPolygons(record: {
  loops?: readonly (readonly (readonly number[])[])[];
}): Point[][][] {
  const rings = (record.loops ?? []).map((ring) => {
    if (
      ring.length < 3 ||
      ring.some((p) => p.length < 2 || !p.slice(0, 2).every(Number.isFinite))
    )
      throw new Error(
        "An original native floor loop is incomplete or non-finite.",
      );
    return ring.map((p): Point => [p[0]!, p[1]!]);
  });
  if (!rings.length) return [];
  const bits = new DataView(new ArrayBuffer(8));
  const dyadics = new Map<number, { n: bigint; e: number }>();
  let exponent = 0;
  const dyadic = (value: number) => {
    let cached = dyadics.get(value);
    if (cached) return cached;
    bits.setFloat64(0, value, false);
    const word = bits.getBigUint64(0, false),
      fraction = word & ((1n << 52n) - 1n),
      encodedExponent = Number((word >> 52n) & 2047n);
    const n =
      (encodedExponent ? (1n << 52n) | fraction : fraction) *
      (word >> 63n ? -1n : 1n);
    cached = { n, e: encodedExponent ? encodedExponent - 1075 : -1074 };
    if (n) exponent = Math.min(exponent, cached.e);
    dyadics.set(value, cached);
    return cached;
  };
  for (const ring of rings)
    for (const p of ring) {
      dyadic(p[0]);
      dyadic(p[1]);
    }
  const integer = (value: number) => {
    const { n, e } = dyadic(value);
    return n ? n << BigInt(e - exponent) : 0n;
  };
  const exact = rings.map((ring) =>
    ring.map(
      (point): ExactPoint => ({
        point,
        x: integer(point[0]),
        y: integer(point[1]),
      }),
    ),
  );
  const orientation = (a: ExactPoint, b: ExactPoint, p: ExactPoint) => {
    const det = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return det < 0n ? -1 : det > 0n ? 1 : 0;
  };
  const between = (p: bigint, a: bigint, b: bigint) =>
    a <= b ? a <= p && p <= b : b <= p && p <= a;
  const covered = (p: ExactPoint, ring: ExactPoint[]) => {
    let inside = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        side = orientation(a, b, p);
      if (!side && between(p.x, a.x, b.x) && between(p.y, a.y, b.y))
        return true;
      if (a.y > p.y !== b.y > p.y && (b.y > a.y ? side > 0 : side < 0))
        inside = !inside;
    }
    return inside;
  };
  const areas = exact.map((ring) => {
    const origin = ring[0]!;
    const area = ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return (
        sum +
        (p.x - origin.x) * (q.y - origin.y) -
        (p.y - origin.y) * (q.x - origin.x)
      );
    }, 0n);
    if (!area)
      throw new Error("An original native floor loop has zero exact area.");
    return area < 0n ? -area : area;
  });
  const boxes = exact.map((ring) => [
    Math.min(...ring.map((p) => p.point[0])),
    Math.min(...ring.map((p) => p.point[1])),
    Math.max(...ring.map((p) => p.point[0])),
    Math.max(...ring.map((p) => p.point[1])),
  ]);
  const crosses = (inner: ExactPoint[], outer: ExactPoint[]) => {
    const doubled = outer.map((p) => ({ ...p, x: p.x * 2n, y: p.y * 2n }));
    return inner.some((a, i) => {
      const b = inner[(i + 1) % inner.length]!;
      if (
        outer.some((c, j) => {
          const d = outer[(j + 1) % outer.length]!;
          return (
            orientation(a, b, c) * orientation(a, b, d) < 0 &&
            orientation(c, d, a) * orientation(c, d, b) < 0
          );
        })
      )
        return true;
      // A segment can leave a concave shell through original vertices without
      // a proper edge crossing. Split at every exact collinear source vertex
      // and test each interval's exact dyadic midpoint, including shared edges.
      const contacts = [
        a,
        b,
        ...outer.filter(
          (p) =>
            !orientation(a, b, p) &&
            between(p.x, a.x, b.x) &&
            between(p.y, a.y, b.y),
        ),
      ];
      const axis = a.x !== b.x ? "x" : "y";
      contacts.sort((p, q) =>
        p[axis] < q[axis] ? -1 : p[axis] > q[axis] ? 1 : 0,
      );
      return contacts.slice(1).some((q, j) => {
        const p = contacts[j]!;
        return !covered({ point: [0, 0], x: p.x + q.x, y: p.y + q.y }, doubled);
      });
    });
  };
  const parents = exact.map((ring, index) => {
    const box = boxes[index]!;
    const candidates = exact
      .map((other, i) => ({ other, i }))
      .filter(({ other, i }) => {
        const enclosing = boxes[i]!;
        return (
          i !== index &&
          areas[i]! > areas[index]! &&
          enclosing[0]! <= box[0]! &&
          enclosing[1]! <= box[1]! &&
          enclosing[2]! >= box[2]! &&
          enclosing[3]! >= box[3]! &&
          ring.every((p) => covered(p, other)) &&
          !crosses(ring, other)
        );
      });
    candidates.sort((a, b) =>
      areas[a.i]! < areas[b.i]!
        ? -1
        : areas[a.i]! > areas[b.i]!
          ? 1
          : a.i - b.i,
    );
    return candidates[0]?.i;
  });
  const depths = new Map<number, number>();
  const depth = (index: number): number => {
    const cached = depths.get(index);
    if (cached !== undefined) return cached;
    const value = parents[index] === undefined ? 0 : 1 + depth(parents[index]!);
    depths.set(index, value);
    return value;
  };
  return rings.flatMap((ring, i) =>
    depth(i) % 2
      ? []
      : [
          [
            ring,
            ...rings.filter((_, j) => parents[j] === i && depth(j) % 2 === 1),
          ],
        ],
  );
}
