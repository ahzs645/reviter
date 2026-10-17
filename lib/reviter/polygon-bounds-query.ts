type BoundsParts = readonly (readonly (readonly (readonly number[])[])[])[];
type Bounds = [number, number, number, number];

/** Broad phase for one synchronous, read-only geometry operation. A new query
 * must be created after source edits: array identity never certifies a bound
 * across operations. Only strictly disjoint finite bounds are rejected. */
export function createPolygonBoundsQuery() {
  const saved = new WeakMap<BoundsParts, Bounds | null>();
  const bounds = (parts: BoundsParts): Bounds | null => {
    if (!Array.isArray(parts) || parts.length === 0) return null;
    if (saved.has(parts)) return saved.get(parts)!;
    const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    let valid = true;
    for (const part of parts) {
      if (!Array.isArray(part) || part.length === 0) {
        valid = false;
        break;
      }
      for (const ring of part) {
        if (!Array.isArray(ring) || ring.length < 3) {
          valid = false;
          break;
        }
        for (const p of ring) {
          if (
            !Array.isArray(p) ||
            p.length < 2 ||
            !Number.isFinite(p[0]) ||
            !Number.isFinite(p[1])
          ) {
            valid = false;
            break;
          }
          box[0] = Math.min(box[0], p[0]);
          box[1] = Math.min(box[1], p[1]);
          box[2] = Math.max(box[2], p[0]);
          box[3] = Math.max(box[3], p[1]);
        }
        if (!valid) break;
      }
      if (!valid) break;
    }
    const result = valid ? box : null;
    saved.set(parts, result);
    return result;
  };
  return (a: BoundsParts, b: BoundsParts): boolean => {
    const x = bounds(a),
      y = bounds(b);
    // Unknown or malformed input still reaches the original geometry kernel
    // and its validation. Touching bounds also keep that original predicate.
    return (
      !x || !y || !(x[2] < y[0] || y[2] < x[0] || x[3] < y[1] || y[3] < x[1])
    );
  };
}
