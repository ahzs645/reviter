/** Exact conservative projection of a stated walking demand. This supplies
 * no source support, terminal or route authority. */
import * as DMath from "./deterministic-math.ts";
import {
  Rational,
  rational,
  nativeRationalScalarToIEEE,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
type Q = Rational;
export type SourceWalkingPoint3 = readonly [number | Q, number | Q, number | Q];
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const clip = (
  ring: NativeRationalPoint[],
  signed: (point: NativeRationalPoint) => Q,
) => {
  const out: NativeRationalPoint[] = [];
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!,
      sa = signed(a),
      sb = signed(b),
      insideA = sa.n <= 0n,
      insideB = sb.n <= 0n;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const t = div(sa, sub(sa, sb));
      out.push([
        add(a[0], mul(t, sub(b[0], a[0]))),
        add(a[1], mul(t, sub(b[1], a[1]))),
      ]);
    }
  }
  return out.filter(
    (point, i) =>
      !i || cmp(point[0], out[i - 1]![0]) || cmp(point[1], out[i - 1]![1]),
  );
};

/** Uses exact source-number differences, then an explicitly lower rational
 * bound on their Euclidean length. The normal has exact squared length >=1,
 * so the two-foot strip encloses the specified width despite IEEE rounding.
 * Exact vertical halfplanes retain tangencies and arbitrarily small overlap. */
export function projectStatedTwoFootWalkingVolume(
  start: SourceWalkingPoint3,
  end: SourceWalkingPoint3,
  materialLowFeet: Q,
  materialHighFeet: Q,
  headroomFeet: number,
) {
  if (
    !start.every(
      (value) => value instanceof Rational || Number.isFinite(value),
    ) ||
    !end.every(
      (value) => value instanceof Rational || Number.isFinite(value),
    ) ||
    !Number.isFinite(headroomFeet) ||
    headroomFeet <= 0 ||
    headroomFeet > 30 ||
    cmp(materialLowFeet, materialHighFeet) > 0
  )
    throw Error("Invalid stated walking volume");
  const a = start.map(rational),
    b = end.map(rational),
    dx = sub(b[0]!, a[0]!),
    dy = sub(b[1]!, a[1]!),
    dz = sub(b[2]!, a[2]!),
    norm2 = add(mul(dx, dx), mul(dy, dy));
  const approximation = DMath.hypot(
    nativeRationalScalarToIEEE(dx),
    nativeRationalScalarToIEEE(dy),
  );
  if (norm2.n === 0n || !Number.isFinite(approximation) || approximation <= 0)
    throw Error("Unsupported vertical/zero-plan walking segment");
  let denominator = rational(approximation),
    refinements = 0;
  while (cmp(mul(denominator, denominator), norm2) > 0) {
    if (++refinements > 64)
      throw Error("Unable to bound stated walking normal");
    denominator = mul(denominator, rational(1 - 2 ** -52));
  }
  const nx = div(new Rational(-dy.n, dy.d), denominator),
    ny = div(dx, denominator),
    normalSquared = add(mul(nx, nx), mul(ny, ny));
  if (cmp(normalSquared, rational(1)) < 0)
    throw Error("Stated walking width enclosure failed");
  const strip: NativeRationalPoint[] = [
    [add(a[0]!, nx), add(a[1]!, ny)],
    [add(b[0]!, nx), add(b[1]!, ny)],
    [sub(b[0]!, nx), sub(b[1]!, ny)],
    [sub(a[0]!, nx), sub(a[1]!, ny)],
  ];
  const projection = (p: NativeRationalPoint) =>
    add(mul(sub(p[0], a[0]!), dx), mul(sub(p[1], a[1]!), dy));
  let possible = clip(strip, (p) =>
    sub(mul(projection(p), dz), mul(sub(materialHighFeet, a[2]!), norm2)),
  );
  if (possible.length)
    possible = clip(possible, (p) =>
      sub(
        mul(sub(materialLowFeet, add(a[2]!, rational(headroomFeet))), norm2),
        mul(projection(p), dz),
      ),
    );
  const area = possible.reduce((sum, p, i) => {
    const q = possible[(i + 1) % possible.length]!;
    return add(sum, sub(mul(p[0], q[1]), mul(q[0], p[1])));
  }, new Rational(0n));
  return {
    unclippedStatedStripFeet: strip,
    possibleClosedProjectionFeet: possible,
    positiveProjectionArea: possible.length >= 3 && area.n !== 0n,
    normalSquaredExact: normalSquared,
    normalLowerBoundRefinements: refinements,
    statedWidthFeet: 2 as const,
    sourceWalkingAuthorityGranted: false as const,
  };
}
