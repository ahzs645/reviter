/** Exact closed contact, including retained tangent and zero-area boundaries. */
import {
  Rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
type Q = Rational;
const sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d);
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
/** Closed contact preserves tangent material and zero-thickness source
 * boundaries that an area-only polygon operation intentionally omits. */
export function exactClosedSourcePlanarContact(
  subject: NativeRationalParts,
  material: NativeRationalParts,
  sourceSegments: NativeRationalPoint[][] = [],
  subjectSegments: NativeRationalPoint[][] = [],
): boolean {
  if (nativeRationalOverlay("intersection", subject, material).length > 0)
    return true;
  const edges = (parts: NativeRationalParts) =>
    parts.flatMap((p) =>
      p.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]!] as const)),
    );
  const boundary = edges(subject),
    materialBoundary = edges(material);
  const cross = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    p: NativeRationalPoint,
  ) =>
    sub(
      mul(sub(b[0], a[0]), sub(p[1], a[1])),
      mul(sub(b[1], a[1]), sub(p[0], a[0])),
    );
  const on = (
    p: NativeRationalPoint,
    a: NativeRationalPoint,
    b: NativeRationalPoint,
  ) =>
    cross(a, b, p).n === 0n &&
    [0, 1].every(
      (axis) =>
        cmp(p[axis]!, cmp(a[axis]!, b[axis]!) < 0 ? a[axis]! : b[axis]!) >= 0 &&
        cmp(p[axis]!, cmp(a[axis]!, b[axis]!) > 0 ? a[axis]! : b[axis]!) <= 0,
    );
  const intersects = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    c: NativeRationalPoint,
    d: NativeRationalPoint,
  ) => {
    const ab1 = cross(a, b, c).n,
      ab2 = cross(a, b, d).n,
      cd1 = cross(c, d, a).n,
      cd2 = cross(c, d, b).n;
    return (
      (((ab1 < 0n && ab2 > 0n) || (ab1 > 0n && ab2 < 0n)) &&
        ((cd1 < 0n && cd2 > 0n) || (cd1 > 0n && cd2 < 0n))) ||
      on(a, c, d) ||
      on(b, c, d) ||
      on(c, a, b) ||
      on(d, a, b)
    );
  };
  if (
    boundary.some(([a, b]) =>
      materialBoundary.some(([c, d]) => intersects(a, b, c, d)),
    )
  )
    return true;
  if (
    sourceSegments.some(
      (segment) =>
        segment.some((point) => nativeRationalPointInParts(point, subject)) ||
        segment.some((a, i) =>
          boundary.some(([c, d]) =>
            intersects(a, segment[Math.min(i + 1, segment.length - 1)]!, c, d),
          ),
        ),
    )
  )
    return true;
  return subjectSegments.some(
    (segment) =>
      segment.some((point) => nativeRationalPointInParts(point, material)) ||
      segment.some((a, i) => {
        const b = segment[Math.min(i + 1, segment.length - 1)]!;
        return (
          materialBoundary.some(([c, d]) => intersects(a, b, c, d)) ||
          sourceSegments.some((source) =>
            source.some((c, j) =>
              intersects(a, b, c, source[Math.min(j + 1, source.length - 1)]!),
            ),
          )
        );
      }),
  );
}
