export type StaticBounds = { min: readonly number[]; max: readonly number[] };
type Entry<T> = { value: T; ordinal: number; bounds: StaticBounds };
type Node<T> = { bounds: StaticBounds; children?: [Node<T>, Node<T>]; entries?: Entry<T>[] };
const valid = (b: StaticBounds | null | undefined, dimensions: number): b is StaticBounds => {
  if (!b || !Array.isArray(b.min) || !Array.isArray(b.max) || b.min.length !== dimensions || b.max.length !== dimensions) return false;
  for (let i = 0; i < dimensions; i++)
    if (!Number.isFinite(b.min[i]) || !Number.isFinite(b.max[i]) || b.min[i] > b.max[i]) return false;
  return true;
};
const meets = (a: StaticBounds, b: StaticBounds) =>
  !a.min.some((v, i) => v > b.max[i] || a.max[i] < b.min[i]);

/** Fresh read-only broad phase for one synchronous geometry operation.
 * Bounds use only min/max of supplied coordinates. Unknown entries always reach
 * the original predicate; boundary contact and duplicate occurrences are kept.
 * Never retain this index across a source edit or substitute it for validation.
 */
export function createStaticBoundsIndex<T>(
  values: readonly T[],
  boundsOf: (value: T) => StaticBounds | null | undefined,
  dimensions: 2 | 3,
) {
  const unknown: { value: T; ordinal: number }[] = [], finite: Entry<T>[] = [];
  for (const [ordinal, value] of values.entries()) {
    const bounds = boundsOf(value);
    if (!valid(bounds, dimensions)) unknown.push({ value, ordinal });
    else finite.push({ value, ordinal, bounds: { min: [...bounds.min], max: [...bounds.max] } });
  }
  const build = (entries: Entry<T>[]): Node<T> => {
    const min = Array(dimensions).fill(Infinity) as number[],
      max = Array(dimensions).fill(-Infinity) as number[];
    for (const entry of entries) for (let i = 0; i < dimensions; i++) {
      min[i] = Math.min(min[i], entry.bounds.min[i]);
      max[i] = Math.max(max[i], entry.bounds.max[i]);
    }
    const bounds = { min, max };
    if (entries.length <= 16) return { bounds, entries };
    let axis = 0;
    for (let i = 1; i < dimensions; i++)
      if (max[i] - min[i] > max[axis] - min[axis]) axis = i;
    entries.sort((a, b) => a.bounds.min[axis] < b.bounds.min[axis] ? -1 : a.bounds.min[axis] > b.bounds.min[axis] ? 1 : a.ordinal - b.ordinal);
    const mid = Math.floor(entries.length / 2);
    return { bounds, children: [build(entries.slice(0, mid)), build(entries.slice(mid))] };
  };
  const tree = finite.length ? build(finite) : undefined;
  return (query: StaticBounds | null | undefined): T[] => {
    if (!valid(query, dimensions)) return [...values];
    const result = [...unknown];
    const visit = (node: Node<T>) => {
      if (!meets(node.bounds, query)) return;
      if (node.children) for (const child of node.children) visit(child);
      else for (const entry of node.entries!)
        if (meets(entry.bounds, query)) result.push(entry);
    };
    if (tree) visit(tree);
    return result.sort((a, b) => a.ordinal - b.ordinal).map((e) => e.value);
  };
}

/** Finite bounds of all shell/hole vertices; no translation or rounding. */
export function polygonPartsBounds(parts: readonly (readonly (readonly (readonly number[])[])[])[]): StaticBounds | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const part of parts) {
    if (!Array.isArray(part) || part.length === 0) return null;
    for (const ring of part) {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      for (const p of ring) {
        if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
        min[0] = Math.min(min[0], p[0]); min[1] = Math.min(min[1], p[1]);
        max[0] = Math.max(max[0], p[0]); max[1] = Math.max(max[1], p[1]);
      }
    }
  }
  return { min, max };
}
