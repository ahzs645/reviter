import * as DMath from "./deterministic-math.ts";
import { nativeRationalOverlay } from "./native-rational-overlay.ts";
import { nativeSourceStairRiserPartsForSegment, type NativeStairRiserProjection } from "./native-source-stair-riser-continuity.ts";
import type { NativeSourceStairReceipt } from "./native-source-stair-width.ts";

type P2 = [number, number];
type P3 = [number, number, number];
type Tread = NativeSourceStairReceipt["treads"][number];
type Landing = NativeSourceStairReceipt["landings"][number];
type Support = NonNullable<NativeSourceStairReceipt["supportFaces"]>[number];
const center = (ring: readonly P2[]): P2 =>
  ring.reduce((p, q) => [p[0] + q[0] / ring.length, p[1] + q[1] / ring.length], [0, 0] as P2);

/** A bounded path proposal on original owned surfaces. Turns can need a real
 * landing dogleg instead of a diagonal between successive tread centres.
 * Every proposed segment retains the existing exact two-foot strip test;
 * failure leaves the old proposal for the complete receipt validator to reject.
 * This does not approve original ownership, caps, foreign material or access. */
export function nativeSourceStairTreadPath(
  treads: readonly Tread[],
  landings: readonly Landing[],
  supportFaces: readonly Support[] = [],
  riserProjections: readonly NativeStairRiserProjection[] = [],
): P3[] {
  const points = treads.map((t): P3 => [...center(t.ringFeet), t.elevationFeet]);
  const surfaces = [
    ...treads.map((t) => ({ z: t.elevationFeet, parts: [[t.ringFeet]] })),
    ...landings.map((l) => ({ z: l.elevationFeet, parts: [l.ringsFeet] })),
    ...supportFaces.map((f) => ({ z: f.elevationFeet, parts: [[f.ringFeet]] })),
  ];
  const cache = new Map<string, boolean>();
  const supported = (a: P3, b: P3) => {
    const key = JSON.stringify([a, b]);
    if (cache.has(key)) return cache.get(key)!;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = DMath.hypot(dx, dy);
    if (length < 1e-8 || b[2] < a[2] - 1e-8 || b[2] - a[2] > 1.2) return false;
    const nx = -dy / length, ny = dx / length;
    const strip: P2[][][] = [[[
      [a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny],
    ]]];
    // Same height band and exact support rule as native-source-stair-width.
    const parts = surfaces.filter((s) => s.z >= a[2] - .05 && s.z <= b[2] + .05).flatMap((s) => s.parts);
    const valid = parts.length > 0 && nativeRationalOverlay(
      "difference", strip, nativeRationalOverlay("union", parts, nativeSourceStairRiserPartsForSegment(riserProjections, a, b)),
    ).length === 0;
    cache.set(key, valid);
    return valid;
  };
  const clear = (chain: P3[]) => chain.slice(1).every((p, i) => supported(chain[i]!, p));
  const out: P3[] = points.length ? [points[0]!] : [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    // Only inter-run seams can acquire landing waypoints. Missing treads and
    // unsupported within-run seams cannot borrow another platform as a repair.
    if (treads[i - 1]!.runElementId === treads[i]!.runElementId || supported(a, b)) {
      out.push(b);
      continue;
    }
    let chosen: P3[] | undefined;
    const previous = i > 1 && treads[i - 2]!.runElementId === treads[i - 1]!.runElementId ? points[i - 2] : undefined;
    const next = i + 1 < points.length && treads[i + 1]!.runElementId === treads[i]!.runElementId ? points[i + 1] : undefined;
    const directions: P2[] = [[1, 0],
      ...(previous ? [[a[0] - previous[0], a[1] - previous[1]] as P2] : []),
      ...(next ? [[next[0] - b[0], next[1] - b[1]] as P2] : []),
    ];
    outer: for (const landing of landings) {
      if (landing.elevationFeet < a[2] || landing.elevationFeet > b[2]) continue;
      for (const direction of directions) {
        const length = DMath.hypot(...direction);
        if (length < 1e-8) continue;
        const u: P2 = [direction[0] / length, direction[1] / length], v: P2 = [-u[1], u[0]];
        const project = (p: P2): P2 => [(p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], (p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]];
        const world = (x: number, y: number): P3 => [a[0] + x * u[0] + y * v[0], a[1] + x * u[1] + y * v[1], landing.elevationFeet];
        const source = landing.ringsFeet.flat().map(project), end = project([b[0], b[1]]);
        // Source vertex interval midpoints supply finite search candidates;
        // none of them creates or expands a support polygon. Curved/high-detail
        // platforms may remain unresolved rather than making search unbounded.
        const stops = (axis: 0 | 1) => {
          const values = [...new Set(source.map((p) => p[axis]))].sort((x, y) => x - y);
          if (values.length < 2) return [];
          return [...new Set([(values[0]! + values.at(-1)!) / 2,
            ...(values.length <= 64 ? values.slice(1).map((x, j) => (x + values[j]!) / 2) : []),
          ])];
        };
        const candidates = [
          ...stops(0).map((x) => [a, world(x, 0), world(x, end[1]), b]),
          ...stops(1).map((y) => [a, world(0, y), world(end[0], y), b]),
        ];
        for (const candidate of candidates) {
          const chain = candidate.filter((p, j) => !j || p.some((value, k) => value !== candidate[j - 1]![k]));
          if (clear(chain)) { chosen = chain; break outer; }
        }
      }
    }
    out.push(...(chosen ? chosen.slice(1) : [b]));
  }
  // A source run can contain its own turning platform as a single typed tread.
  // Its centroid need not lie on a useful two-foot path through a concave top.
  // Replace only that tread's station with stations on that SAME original top;
  // this cannot borrow an unrelated landing to bypass a within-run gap.
  for (let i = 1; i + 1 < points.length; i++) {
    if (treads[i - 1]!.runElementId !== treads[i]!.runElementId || treads[i + 1]!.runElementId !== treads[i]!.runElementId) continue;
    const at = out.indexOf(points[i]!);
    if (at < 1 || at + 1 >= out.length || out[at - 1] !== points[i - 1] || out[at + 1] !== points[i + 1]) continue;
    const a = points[i - 1]!, b = points[i + 1]!, middle = points[i]!, top = treads[i]!;
    // Bound this extra search to an actual concave source trim. Ordinary
    // projected straight-tread seams cannot acquire a platform detour.
    const turns = top.ringFeet.map((p, j, ring) => {
      const q = ring[(j + 1) % ring.length]!, r = ring[(j + 2) % ring.length]!;
      return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    });
    if (!turns.some((turn) => turn > 0) || !turns.some((turn) => turn < 0)) continue;
    if (supported(a, middle) && supported(middle, b)) continue;
    const platform = nativeRationalOverlay("union", [[top.ringFeet]]);
    const onOwnTop = (first: P3, last: P3) => {
      const dx = last[0] - first[0], dy = last[1] - first[1], length = DMath.hypot(dx, dy);
      if (length < 1e-8) return false;
      const nx = -dy / length, ny = dx / length;
      const strip: P2[][][] = [[[
        [first[0] + nx, first[1] + ny], [last[0] + nx, last[1] + ny],
        [last[0] - nx, last[1] - ny], [first[0] - nx, first[1] - ny],
      ]]];
      return nativeRationalOverlay("difference", strip, platform).length === 0;
    };
    const directions: P2[] = [[1, 0],
      ...(i > 1 ? [[a[0] - points[i - 2]![0], a[1] - points[i - 2]![1]] as P2] : []),
      ...(i + 2 < points.length ? [[points[i + 2]![0] - b[0], points[i + 2]![1] - b[1]] as P2] : []),
    ];
    let chosen: P3[] | undefined;
    outer: for (const direction of directions) {
      const length = DMath.hypot(...direction);
      if (length < 1e-8) continue;
      const u: P2 = [direction[0] / length, direction[1] / length], v: P2 = [-u[1], u[0]];
      const project = (p: P2): P2 => [(p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], (p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]];
      const world = (x: number, y: number): P3 => [a[0] + x * u[0] + y * v[0], a[1] + x * u[1] + y * v[1], top.elevationFeet];
      const source = top.ringFeet.map(project), end = project([b[0], b[1]]);
      const stops = (axis: 0 | 1) => {
        const values = [...new Set(source.map((p) => p[axis]))].sort((x, y) => x - y);
        return values.length > 1 && values.length <= 64 ? [...new Set([
          (values[0]! + values.at(-1)!) / 2,
          ...values.slice(1).map((x, j) => (x + values[j]!) / 2),
        ])] : [];
      };
      const candidates = [
        ...stops(0).map((x) => [world(x, 0), world(x, end[1])]),
        ...stops(1).map((y) => [world(0, y), world(end[0], y)]),
      ];
      for (const candidate of candidates) {
        const first = candidate[0]!, last = candidate[1]!;
        if (onOwnTop(first, last) && supported(a, first) && supported(last, b)) { chosen = candidate; break outer; }
      }
    }
    if (chosen) out.splice(at, 1, ...chosen);
  }
  return out;
}
