import { Rational, rational } from "./native-rational-overlay.ts";

type Point = readonly [Rational, Rational];
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const compare = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const cross = (a: Point, b: Point, c: Point) =>
  sub(
    mul(sub(b[0], a[0]), sub(c[1], a[1])),
    mul(sub(b[1], a[1]), sub(c[0], a[0])),
  );
const sign = (q: Rational) => (q.n < 0n ? -1 : q.n > 0n ? 1 : 0);
const between = (a: Rational, p: Rational, b: Rational) =>
  (compare(p, a) >= 0 && compare(p, b) <= 0) ||
  (compare(p, b) >= 0 && compare(p, a) <= 0);
const on = (a: Point, p: Point, b: Point) =>
  cross(a, b, p).n === 0n &&
  between(a[0], p[0], b[0]) &&
  between(a[1], p[1], b[1]);

/** Shape check only: preserves every original concave/curved-profile vertex.
 * Current native identity, exact whole-profile equality and physical threshold
 * checks are separately required by closedBoundaryDoors. Holes are unsupported. */
export function simpleOriginalNativeColumnJambRing(value: unknown): boolean {
  try {
    if (
      !Array.isArray(value) ||
      value.length < 3 ||
      value.length > 4096 ||
      value.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some(
            (n) =>
              typeof n !== "number" ||
              !Number.isFinite(n) ||
              Math.abs(n) >= 1e7,
          ),
      )
    )
      return false;
    const points = value.map((p) => p.map(rational) as [Rational, Rational]);
    const key = (p: Point) => `${p[0].n}/${p[0].d},${p[1].n}/${p[1].d}`;
    if (new Set(points.map(key)).size !== points.length) return false;
    let twiceArea = new Rational(0n);
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!,
        b = points[(i + 1) % points.length]!,
        c = points[(i + 2) % points.length]!;
      twiceArea = add(twiceArea, sub(mul(a[0], b[1]), mul(b[0], a[1])));
      if (cross(a, b, c).n === 0n) {
        const dot = add(
          mul(sub(a[0], b[0]), sub(c[0], b[0])),
          mul(sub(a[1], b[1]), sub(c[1], b[1])),
        );
        if (dot.n >= 0n) return false;
      }
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        const c = points[j]!,
          d = points[(j + 1) % points.length]!;
        const abC = sign(cross(a, b, c)),
          abD = sign(cross(a, b, d));
        const cdA = sign(cross(c, d, a)),
          cdB = sign(cross(c, d, b));
        if (
          (abC * abD < 0 && cdA * cdB < 0) ||
          (abC === 0 && on(a, c, b)) ||
          (abD === 0 && on(a, d, b)) ||
          (cdA === 0 && on(c, a, d)) ||
          (cdB === 0 && on(c, b, d))
        )
          return false;
      }
    }
    const magnitude = twiceArea.n < 0n ? -twiceArea.n : twiceArea.n;
    // Preserve the legacy minimum jamb area, compared without floating rounding.
    return (
      compare(new Rational(magnitude, twiceArea.d * 2n), rational(1e-8)) > 0
    );
  } catch {
    return false;
  }
}
