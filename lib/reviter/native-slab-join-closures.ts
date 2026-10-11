import { Rational, rational, nativeRationalOverlay, nativeRationalScalarToIEEE, type NativeRationalParts } from "./native-rational-overlay.ts";

/** Mirror of openindoormaps app/indoor-project/native-slab-join-closures.ts (keep identical). */
export const NATIVE_SLAB_JOIN_CLOSURES_VERSION = "native-slab-join-closures-v1";
/** Two original walking slabs at one elevation whose facing boundary edges lie
 * within this distance of each other meet at a numerical join, not a physical
 * gap. 1e-9 ft is about 0.3 nm: six orders of magnitude below any slot that
 * could matter to a walker, and well above double-precision export noise. */
export const NATIVE_SLAB_JOIN_TOLERANCE_FEET = 1e-9;
/** A closure must run along the join; a point contact never joins two slabs. */
export const NATIVE_SLAB_JOIN_MIN_LENGTH_FEET = 1e-3;

type P2 = [number, number];
type Rings = P2[][];
export type NativeSlabJoinFloor = { nativeElementId: number; partsFeet: Rings[] };
type Segment = { id: number; a: P2; b: P2; box: [number, number, number, number] };
type RP = [Rational, Rational];
const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n);
const sign = (a: Rational) => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
const cmp = (a: Rational, b: Rational) => sign(sub(a, b));
const zero = new Rational(0n), one = new Rational(1n);
const clamp = (t: Rational) => (cmp(t, zero) < 0 ? zero : cmp(t, one) > 0 ? one : t);
const toNumber = (q: Rational) => nativeRationalScalarToIEEE(q) as number;
const at = (p: RP, d: RP, t: Rational): RP => [add(p[0], mul(d[0], t)), add(p[1], mul(d[1], t))];
const dot = (a: RP, b: RP) => add(mul(a[0], b[0]), mul(a[1], b[1]));
const cross = (a: RP, b: RP) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
const minus = (a: RP, b: RP): RP => [sub(a[0], b[0]), sub(a[1], b[1])];
const exact = (p: P2): RP => [rational(p[0]), rational(p[1])];
const distance = (a: RP, b: RP) => Math.hypot(toNumber(sub(a[0], b[0])), toNumber(sub(a[1], b[1])));

function segments(floors: readonly NativeSlabJoinFloor[]): Segment[] {
  const out: Segment[] = [];
  for (const floor of floors)
    for (const part of floor.partsFeet)
      for (const ring of part) {
        const open = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
        for (let i = 0; i < open.length; i++) {
          const a = open[i]!, b = open[(i + 1) % open.length]!;
          if (a[0] === b[0] && a[1] === b[1]) continue;
          out.push({ id: floor.nativeElementId, a, b, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
        }
      }
  return out;
}

/** The thin piece between two nearly coincident edges of DIFFERENT original
 * slabs, built from exact points on both original edges (no snapped, moved or
 * rounded corner). Edges that meet only at a point, run apart by more than the
 * tolerance at either end of their common span, or belong to one slab, give
 * nothing. A crossing pair is split at its exact crossing so no piece twists. */
function closure(s: Segment, t: Segment): RP[][] {
  const p = exact(s.a), d = minus(exact(s.b), p), q = exact(t.a), e = minus(exact(t.b), q);
  const dd = dot(d, d), ee = dot(e, e);
  if (!sign(dd) || !sign(ee)) return [];
  const ts = [div(dot(minus(q, p), d), dd), div(dot(minus(exact(t.b), p), d), dd)];
  const lo = clamp(cmp(ts[0]!, ts[1]!) < 0 ? ts[0]! : ts[1]!), hi = clamp(cmp(ts[0]!, ts[1]!) < 0 ? ts[1]! : ts[0]!);
  if (cmp(hi, lo) <= 0) return [];
  const a0 = at(p, d, lo), a1 = at(p, d, hi);
  if (distance(a0, a1) < NATIVE_SLAB_JOIN_MIN_LENGTH_FEET) return [];
  const b0 = at(q, e, clamp(div(dot(minus(a0, q), e), ee))), b1 = at(q, e, clamp(div(dot(minus(a1, q), e), ee)));
  if (distance(a0, b0) > NATIVE_SLAB_JOIN_TOLERANCE_FEET || distance(a1, b1) > NATIVE_SLAB_JOIN_TOLERANCE_FEET) return [];
  const s0 = sign(cross(d, minus(b0, p))), s1 = sign(cross(d, minus(b1, p)));
  if (!s0 && !s1) return [];
  if (s0 * s1 >= 0) return [[a0, a1, b1, b0]];
  // The other edge crosses this one inside the common span: two triangles.
  const f = minus(b1, b0), den = cross(d, f);
  if (!sign(den)) return [];
  const u = div(cross(minus(b0, p), f), den), x = at(p, d, u);
  return [[a0, x, b0], [x, a1, b1]];
}

/** Exact walking-support closures for numerical joins between distinct original
 * slabs on one elevation. The result only fills the hairline between two slab
 * profiles that already meet; walls, columns, doors, holes and every other
 * material veto are still subtracted afterwards by the caller. */
export function nativeSlabJoinClosures(floors: readonly NativeSlabJoinFloor[]): NativeRationalParts {
  const all = segments(floors), tol = NATIVE_SLAB_JOIN_TOLERANCE_FEET;
  if (new Set(all.map((s) => s.id)).size < 2) return [];
  const size = 16, grid = new Map<string, Segment[]>();
  for (const s of all)
    for (let x = Math.floor((s.box[0] - tol) / size); x <= Math.floor((s.box[2] + tol) / size); x++)
      for (let y = Math.floor((s.box[1] - tol) / size); y <= Math.floor((s.box[3] + tol) / size); y++) {
        const key = `${x},${y}`;
        const list = grid.get(key);
        if (list) list.push(s);
        else grid.set(key, [s]);
      }
  const pieces: RP[][] = [], seen = new Set<string>();
  const index = new Map(all.map((s, i) => [s, i]));
  for (const list of grid.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const s = list[i]!, t = list[j]!;
        if (s.id === t.id) continue;
        const key = [index.get(s), index.get(t)].sort((x, y) => x! - y!).join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.box[0] > t.box[2] + tol || t.box[0] > s.box[2] + tol || s.box[1] > t.box[3] + tol || t.box[1] > s.box[3] + tol) continue;
        // Floating broad phase: both ends of the shorter edge must be near the
        // other edge's line; the exact construction below decides the rest.
        const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
        const off = (p: P2) => Math.abs((p[0] - s.a[0]) * dy - (p[1] - s.a[1]) * dx) / len;
        if (Math.min(off(t.a), off(t.b)) > 1e-6) continue;
        pieces.push(...closure(s, t));
      }
  if (!pieces.length) return [];
  return nativeRationalOverlay("union", pieces.map((ring) => [ring]));
}

const cache = new WeakMap<object, NativeRationalParts>();
/** Cached per immutable floor-list identity. */
export function nativeSlabJoinClosuresFor(key: object, floors: readonly NativeSlabJoinFloor[]): NativeRationalParts {
  let saved = cache.get(key);
  if (!saved) cache.set(key, (saved = nativeSlabJoinClosures(floors)));
  return saved;
}

/** Exact walking floors on one elevation: original slab profiles inside the
 * certified indoor envelope, plus only those numerical slab-join closures that
 * the envelope also covers. Without a join this is exactly the original
 * floor/envelope intersection. */
export function nativeWalkingFloorsWithSlabJoins(rawFloors: readonly Rings[], envelopes: readonly Rings[]): NativeRationalParts {
  if (!rawFloors.length || !envelopes.length) return [];
  const base = nativeRationalOverlay("intersection", rawFloors as Rings[], envelopes as Rings[]);
  const joins = nativeSlabJoinClosures(rawFloors.map((part, i) => ({ nativeElementId: i, partsFeet: [part] })));
  if (!joins.length) return base;
  const inside = nativeRationalOverlay("intersection", joins, envelopes as Rings[]);
  return inside.length ? nativeRationalOverlay("union", base, inside) : base;
}
