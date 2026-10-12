import pc from "polygon-clipping";
import * as DMath from "./deterministic-math.ts";
import {
  nativeRationalOverlay,
  type NativeRationalOverlayInput,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import { nativeExactPartsForProposals } from "./native-exact-planar-topology.ts";
type Point = [number, number];
type Parts = Point[][][];
/** Selection-only closures for a census-omission supplement wall (see
 * native-material-section-supplement.ts). The production mesh cut of such a host
 * stops at its window/curtain openings, while the fenestration members fill only
 * part of the wall thickness, so a floor strip stays open inside the wall body and
 * partitions ending at the wall face leak along it. Before the supplement, selection
 * used the host's whole native body. Each closure is a subset of that native body:
 *  - hosted-opening: the body swept across its thickness over the footprint of a
 *    fenestration member (window, curtain panel/mullion or verified curtain assembly)
 *    lying in an opening of the section;
 *  - face: a body piece left between the section and the body face that is thinner
 *    than the mesh-cut precision (the section sits inside the face it should share).
 * Door openings never close: every door footprint meeting the body, swept across the
 * wall along its own traversal normal, is removed from both closures. */
export const NATIVE_SUPPLEMENT_OPENING_CLOSURE_VERSION =
  "native-supplement-hosted-opening-closure-v1";
/** Mean width (2 x area / perimeter) below which a body piece is a face sliver:
 * float32 mesh-cut precision at building coordinates (<= 1000 ft). */
export const NATIVE_SUPPLEMENT_FACE_TOLERANCE_FEET = 1e-4;
/** Windows, curtain panels and curtain mullions. */
export const NATIVE_FENESTRATION_CATEGORY_IDS: ReadonlySet<number> = new Set([
  -2_000_014, -2_000_170, -2_000_171,
]);
export type NativeSupplementClosure = {
  kind: "hosted-opening" | "face";
  parts: NativeRationalParts;
};
const ringArea = (ring: Point[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!,
      q = ring[(i + 1) % ring.length]!;
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(sum) / 2;
};
const area = (parts: Parts) =>
  parts.reduce(
    (s, part) =>
      s + part.reduce((v, r, i) => v + (i ? -1 : 1) * ringArea(r), 0),
    0,
  );
const perimeter = (parts: Parts) =>
  parts.reduce(
    (s, part) =>
      s +
      part.reduce(
        (v, r) =>
          v +
          r.reduce((w, p, i) => {
            const q = r[(i + 1) % r.length]!;
            return w + DMath.hypot(q[0] - p[0], q[1] - p[1]);
          }, 0),
        0,
      ),
    0,
  );
const safe = <T>(f: () => T, fallback: T) => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
const hull = (points: Point[]): Point[] => {
  const pts = [
    ...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values(),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (ps: Point[]) => {
    const h: Point[] = [];
    for (const p of ps) {
      while (h.length > 1 && cross(h.at(-2)!, h.at(-1)!, p) <= 0) h.pop();
      h.push(p);
    }
    return h;
  };
  return [...half(pts).slice(0, -1), ...half([...pts].reverse()).slice(0, -1)];
};
/** Unit normal of the body face edge nearest to a point (local wall frame). */
function faceNormal(body: Parts, at: Point): Point | undefined {
  let best: { d: number; len: number; n: Point } | undefined;
  for (const part of body)
    for (const ring of part)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          len = DMath.hypot(dx, dy);
        if (!(len > 0)) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (len * len),
          ),
        );
        const d = DMath.hypot(at[0] - a[0] - t * dx, at[1] - a[1] - t * dy);
        if (!best || d < best.d || (d === best.d && len > best.len))
          best = { d, len, n: [-dy / len, dx / len] };
      }
  return best?.n;
}
/** Footprint swept along +-normal by reach (Minkowski sum for convex footprints). */
const sweep = (points: Point[], n: Point, reach: number): Point[] =>
  hull(
    points.flatMap((p) => [
      [p[0] + n[0] * reach, p[1] + n[1] * reach] as Point,
      [p[0] - n[0] * reach, p[1] - n[1] * reach] as Point,
    ]),
  );
const bounds = (parts: Parts) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts)
    for (const ring of part)
      for (const p of ring) {
        if (p[0] < b[0]) b[0] = p[0];
        if (p[1] < b[1]) b[1] = p[1];
        if (p[0] > b[2]) b[2] = p[0];
        if (p[1] > b[3]) b[3] = p[1];
      }
  return b;
};
const centroid = (points: Point[]): Point => {
  const s = points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [s[0] / points.length, s[1] / points.length];
};
/** Exact closures for one census-omission supplement host at one cut. Empty when the
 * host has no native body here, or its section already fills that body. */
export function nativeSupplementOpeningClosures(input: {
  /** Native body (prepared data.walls rings) of the host at this level. */
  body: Parts;
  /** Supplement mesh-cut section parts of the host at this cut. */
  section: Parts;
  /** Fenestration member footprints (each member's own parts) at this cut. */
  members: Parts[];
  /** Door footprints on this level with their traversal normal when known. */
  doors: { footprintFeet: Point[]; normalFeet?: Point }[];
}): NativeSupplementClosure[] {
  const body = input.body.filter((p) => p.length > 0 && p[0]!.length >= 3);
  if (body.length === 0 || input.section.length === 0) return [];
  const B = safe(() => pc.union(body as pc.Geom) as Parts, []);
  const S = safe(() => pc.union(input.section as pc.Geom) as Parts, []);
  const G = safe(() => pc.difference(B, S) as Parts, B);
  const bodyArea = area(B);
  if (!(bodyArea > 0) || !(area(G) > 0)) return [];
  // Reach across the wall: generous against the body's mean thickness; the
  // result is always clipped to the body and kept only where it meets the member.
  const reach = 4 * ((2 * bodyArea) / perimeter(B)) + 0.5;
  const doorSweeps = input.doors.flatMap((d) => {
    if (!(d.footprintFeet.length >= 3)) return [];
    if (
      !(
        area(safe(() => pc.intersection(B, [[d.footprintFeet]]) as Parts, [])) >
        1e-9
      )
    )
      return [];
    const len = d.normalFeet
      ? DMath.hypot(d.normalFeet[0], d.normalFeet[1])
      : 0;
    const n: Point | undefined =
      len > 0
        ? [d.normalFeet![0] / len, d.normalFeet![1] / len]
        : faceNormal(B, centroid(d.footprintFeet));
    if (!n) return [];
    const ring = sweep(d.footprintFeet, n, reach);
    return ring.length >= 3 ? [[[ring]] as Parts] : [];
  });
  const box = bounds(B);
  const kept: NativeRationalParts[] = [];
  for (const member of input.members) {
    const mb = bounds(member);
    if (mb[0] > box[2] || mb[2] < box[0] || mb[1] > box[3] || mb[3] < box[1])
      continue;
    const memberArea = area(member);
    if (!(memberArea > 0)) continue;
    // Hosted in this body (mostly inside it) and standing in an opening of the section.
    if (
      area(safe(() => pc.intersection(B, member) as Parts, [])) <
      memberArea / 2
    )
      continue;
    if (!(area(safe(() => pc.intersection(G, member) as Parts, [])) > 1e-6))
      continue;
    const points = member.flatMap((part) => part[0] ?? []);
    const n = faceNormal(B, centroid(points));
    if (!n) continue;
    const ring = sweep(points, n, reach);
    if (ring.length < 3) continue;
    const exact = nativeRationalOverlay("intersection", body, [[ring]]);
    for (const part of exact) {
      const approx = nativeExactPartsForProposals([part]);
      if (area(safe(() => pc.intersection(approx, member) as Parts, [])) > 1e-9)
        kept.push([part]);
    }
  }
  const out: NativeSupplementClosure[] = [];
  let openings: NativeRationalParts = [];
  if (kept.length > 0) {
    const [first, ...rest] = kept as NativeRationalOverlayInput[];
    openings = nativeRationalOverlay("union", first!, ...rest);
    if (doorSweeps.length > 0)
      openings = nativeRationalOverlay("difference", openings, ...doorSweeps);
    if (openings.length > 0)
      out.push({ kind: "hosted-opening", parts: openings });
  }
  const rest = nativeRationalOverlay(
    "difference",
    body,
    input.section,
    ...(openings.length > 0 ? [openings] : []),
    ...doorSweeps,
  );
  const faces = rest.filter((part) => {
    const approx = nativeExactPartsForProposals([part]);
    const a = area(approx),
      p = perimeter(approx);
    return (
      a > 0 && p > 0 && (2 * a) / p <= NATIVE_SUPPLEMENT_FACE_TOLERANCE_FEET
    );
  });
  if (faces.length > 0) out.push({ kind: "face", parts: faces });
  return out;
}
