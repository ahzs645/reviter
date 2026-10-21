/** Pure obstruction mathematics for a complete, explicitly ordered original
 * cylinder UV domain. This never supplies source, floor or route authority. */
import type { Revit2027CylinderSurface } from "./revit-2027-surfaces.ts";
import { originalCylinderTrigEnclosure } from "./native-source-floor-local-support.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";

type Q = Rational;
type P = NativeRationalPoint;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const abs = (a: Q) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const maximum = (a: Q, b: Q) => (cmp(a, b) > 0 ? a : b);
const minimum = (a: Q, b: Q) => (cmp(a, b) < 0 ? a : b);
const copy = (p: P): P => [
  new Rational(p[0].n, p[0].d),
  new Rational(p[1].n, p[1].d),
];
const key = (p: P) => p.map((q) => `${q.n}/${q.d}`).join(":");
function hull(points: P[]) {
  const a = [...new Map(points.map((p) => [key(p), p])).values()].sort(
    (p, q) => cmp(p[0], q[0]) || cmp(p[1], q[1]),
  );
  const cross = (a: P, b: P, c: P) =>
    sub(
      mul(sub(b[0], a[0]), sub(c[1], a[1])),
      mul(sub(b[1], a[1]), sub(c[0], a[0])),
    );
  const half = (v: P[]) => {
    const h: P[] = [];
    for (const p of v) {
      while (h.length > 1 && cross(h.at(-2)!, h.at(-1)!, p).n <= 0n) h.pop();
      h.push(p);
    }
    return h;
  };
  return a.length < 3
    ? a
    : [...half(a).slice(0, -1), ...half([...a].reverse()).slice(0, -1)];
}
function retainedPoint(p: P) {
  if (
    !Array.isArray(p) ||
    p.length !== 2 ||
    p.some((q) => !(q instanceof Rational) || q.d <= 0n)
  )
    throw Error("Invalid retained exact cylinder residual");
  return copy(p);
}

/** Every real parameter in every subinterval is enclosed, rather than only
 * vertices of a sampled arc. |sin'(u)| and |cos'(u)| are <=1. An arbitrary
 * finite binary64 reference parameter is permitted ONLY because its exact
 * rational distance to BOTH original interval ends enlarges the trig bound.
 * Its rounding is therefore retained, never attributed to source geometry.
 * No IEEE sin/cos, periodic reduction, source snapping or tolerance is used.
 *
 * Retained coedge/twin/interior/join operands are independent of the analytic
 * domain. Callers must retain them here or separately; the domain cannot erase
 * a source embedding that lies outside the analytic cylinder enclosure. */
export function inspectOriginalCylinderDomainEnclosure(
  source: Revit2027CylinderSurface,
  retained: {
    planPointsFeet?: P[];
    partsFeet?: NativeRationalParts;
    closedSegmentsFeet?: P[][];
  } = {},
  options: { representation?: "axis-box" | "convex-hull" } = {},
) {
  try {
    const representation = options.representation ?? "axis-box";
    if (!["axis-box", "convex-hull"].includes(representation))
      throw Error("Unsupported original cylinder enclosure representation");
    const envelope = source?.surface?.envelope,
      lo = envelope?.firstCorner,
      hi = envelope?.secondCorner;
    if (
      source?.kind !== "cylinder" ||
      source.sourceClassSlot !== 1144 ||
      !Array.isArray(lo) ||
      !Array.isArray(hi) ||
      lo.length !== 2 ||
      hi.length !== 2 ||
      !Array.isArray(source.center) ||
      !Array.isArray(source.xVector) ||
      !Array.isArray(source.yVector) ||
      !Array.isArray(source.zVector) ||
      [source.center, source.xVector, source.yVector, source.zVector].some(
        (a) => a.length !== 3,
      ) ||
      [
        ...lo,
        ...hi,
        ...source.center,
        ...source.xVector,
        ...source.yVector,
        ...source.zVector,
        source.radius,
      ].some((n) => !Number.isFinite(n)) ||
      source.radius <= 0 ||
      !Array.isArray(source.queuedProperties) ||
      source.queuedProperties.length ||
      typeof source.surface.orientFlag !== "boolean"
    )
      throw Error("Incomplete original finite cylinder domain or branch");
    if (lo[0]! > hi[0]! || lo[1]! > hi[1]!)
      throw Error(
        "Unordered original cylinder domain; no periodic branch is inferred",
      );
    if (Math.abs(lo[0]!) > 16 || Math.abs(hi[0]!) > 16)
      throw Error("Unsupported original angular range; no periodic reduction");
    if (
      source.xVector[2] !== 0 ||
      source.yVector[2] !== 0 ||
      source.zVector[0] !== 0 ||
      source.zVector[1] !== 0 ||
      source.zVector[2] === 0
    )
      throw Error("Unsupported original cylinder normal");
    const x = source.xVector.map(rational),
      y = source.yVector.map(rational);
    if (sub(mul(x[0]!, y[1]!), mul(x[1]!, y[0]!)).n === 0n)
      throw Error("Singular original cylinder plane basis");
    const lower = rational(lo[0]!),
      upper = rational(hi[0]!),
      width = sub(upper, lower);
    // A bounded continuous original interval may cross a coordinate-period
    // boundary. Wrapped/unordered or wider/multiple-turn branches are refused.
    if (cmp(width, rational(7)) > 0)
      throw Error("Unsupported multiple-period original cylinder domain");
    const count = width.n === 0n ? 1 : 64,
      r = rational(source.radius),
      center = source.center.map(rational),
      corners: P[] = [],
      intervalProjectionBoundsFeet: { minimumFeet: P; maximumFeet: P }[] = [];
    for (let i = 0; i < count; i++) {
      const a = add(lower, mul(width, new Rational(BigInt(i), BigInt(count)))),
        b = add(lower, mul(width, new Rational(BigInt(i + 1), BigInt(count)))),
        // This is an untrusted mathematical reference, not a source operand.
        reference = lo[0]! + (hi[0]! - lo[0]!) * ((i + 0.5) / count),
        referenceQ = rational(reference),
        distance = maximum(abs(sub(a, referenceQ)), abs(sub(b, referenceQ))),
        trig = originalCylinderTrigEnclosure(reference),
        sin: [Q, Q] = [
          sub(trig.sine[0], distance),
          add(trig.sine[1], distance),
        ],
        cos: [Q, Q] = [
          sub(trig.cosine[0], distance),
          add(trig.cosine[1], distance),
        ];
      const bounds = [0, 1].map((axis) => {
        const u = [mul(x[axis]!, cos[0]), mul(x[axis]!, cos[1])],
          v = [mul(y[axis]!, sin[0]), mul(y[axis]!, sin[1])];
        return [
          add(
            center[axis]!,
            mul(r, add(minimum(u[0]!, u[1]!), minimum(v[0]!, v[1]!))),
          ),
          add(
            center[axis]!,
            mul(r, add(maximum(u[0]!, u[1]!), maximum(v[0]!, v[1]!))),
          ),
        ];
      });
      corners.push(
        [bounds[0]![0]!, bounds[1]![0]!],
        [bounds[0]![1]!, bounds[1]![0]!],
        [bounds[0]![1]!, bounds[1]![1]!],
        [bounds[0]![0]!, bounds[1]![1]!],
      );
      intervalProjectionBoundsFeet.push({
        minimumFeet: [bounds[0]![0]!, bounds[1]![0]!],
        maximumFeet: [bounds[0]![1]!, bounds[1]![1]!],
      });
    }
    // The default box contains the entire analytic interval enclosure AND all
    // retained operands, hence also every possible connection between them.
    // Four vertices avoid expensive exact intersections of many high-order
    // rational hull edges. The opt-in hull remains available for comparison.
    // Source residual parts and closed segments are independently retained.
    const retainedPoints = (retained.planPointsFeet ?? []).map(retainedPoint),
      extraParts = (retained.partsFeet ?? []).map((part) => {
        if (!part.length) throw Error("Empty retained cylinder residual part");
        return part.map((ring) => {
          if (!ring.length)
            throw Error("Empty retained cylinder residual ring");
          return ring.map(retainedPoint);
        });
      }),
      closedSegments = (retained.closedSegmentsFeet ?? []).map((segment) => {
        if (!segment.length)
          throw Error("Empty retained cylinder residual segment");
        return segment.map(retainedPoint);
      });
    let outer: P[];
    if (representation === "convex-hull")
      outer = hull([...corners, ...retainedPoints]);
    else {
      const all = [
          ...corners,
          ...retainedPoints,
          ...extraParts.flat(2),
          ...closedSegments.flat(),
        ],
        minimumFeet = [0, 1].map((axis) =>
          all.map((p) => p[axis]!).reduce(minimum),
        ) as P,
        maximumFeet = [0, 1].map((axis) =>
          all.map((p) => p[axis]!).reduce(maximum),
        ) as P;
      outer =
        cmp(minimumFeet[0], maximumFeet[0]) === 0 ||
        cmp(minimumFeet[1], maximumFeet[1]) === 0
          ? key(minimumFeet) === key(maximumFeet)
            ? [minimumFeet]
            : [minimumFeet, maximumFeet]
          : [
              minimumFeet,
              [maximumFeet[0], minimumFeet[1]],
              maximumFeet,
              [minimumFeet[0], maximumFeet[1]],
            ];
    }
    const analyticParts: NativeRationalParts =
      outer.length >= 3 ? [[outer]] : [];
    if (outer.length < 3) closedSegments.push(outer.map(copy));
    const parts =
      representation === "convex-hull" && extraParts.length
        ? nativeRationalOverlay("union", analyticParts, extraParts)
        : analyticParts;
    return {
      ok: true as const,
      partsFeet: parts,
      closedSegmentsFeet: closedSegments,
      originalAngularDomain: [lower, upper] as [Q, Q],
      originalAxialDomain: [rational(lo[1]!), rational(hi[1]!)] as [Q, Q],
      subintervalCount: count,
      enclosureRepresentation: representation,
      intervalProjectionBoundsFeet,
      entireContinuousSourceDomainEnclosed: true as const,
      retainedResidualParts: extraParts.length,
      retainedResidualPoints: retainedPoints.length,
      retainedResidualSegments: (retained.closedSegmentsFeet ?? []).length,
      sourceCoordinatesChanged: false as const,
      originalSourceAuthorityGranted: false as const,
      routeApproved: false as const,
    };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      originalSourceAuthorityGranted: false as const,
      routeApproved: false as const,
    };
  }
}
