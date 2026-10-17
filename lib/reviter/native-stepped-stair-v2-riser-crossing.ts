/** Browser-safe exact finite crossing math; never a source/route certificate. */
import {
  Rational,
  rational,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import { nativeConservativeTwoFootStrip } from "./native-stepped-stair-v2-stations.ts";
export type OriginalFiniteNativeRiserLine = {
  m_origin: readonly [number, number, number];
  m_dirVec: readonly [number, number, number];
  m_endParams: readonly [number, number];
};
const add = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
  sub = (a: Rational, b: Rational) =>
    new Rational(a.n * b.d - b.n * a.d, a.d * b.d),
  mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
  div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n),
  cmp = (a: Rational, b: Rational) =>
    a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const delta = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
  ): NativeRationalPoint => [sub(a[0], b[0]), sub(a[1], b[1])],
  cross = (a: NativeRationalPoint, b: NativeRationalPoint) =>
    sub(mul(a[0], b[1]), mul(a[1], b[0]));

/** For parallel endpoint tracks, both intersection parameters are affine in
 * the lateral strip coordinate. Exact endpoint bounds therefore contain every
 * intervening track. Proper go crossings are strictly between its endpoints;
 * original source-line endpoints remain closed and are checked by clearance. */
export function inspectOriginalFiniteTwoFootRiserCrossing(
  line: OriginalFiniteNativeRiserLine,
  fromFeet: NativeRationalPoint,
  toFeet: NativeRationalPoint,
) {
  if (
    line.m_origin.length !== 3 ||
    line.m_dirVec.length !== 3 ||
    line.m_endParams.length !== 2 ||
    [...line.m_origin, ...line.m_dirVec, ...line.m_endParams].some(
      (v) => !Number.isFinite(v),
    ) ||
    line.m_dirVec[2] !== 0 ||
    line.m_endParams[0] === line.m_endParams[1]
  )
    throw new Error("Unsupported original finite horizontal riser line");
  const direction: NativeRationalPoint = [
      rational(line.m_dirVec[0]),
      rational(line.m_dirVec[1]),
    ],
    origin: NativeRationalPoint = [
      rational(line.m_origin[0]),
      rational(line.m_origin[1]),
    ];
  if (!direction.some((d) => d.n !== 0n))
    throw new Error("Degenerate original source riser direction");
  const strip = nativeConservativeTwoFootStrip(fromFeet, toFeet),
    ring = strip[0]?.[0],
    lower = rational(Math.min(...line.m_endParams)),
    upper = rational(Math.max(...line.m_endParams));
  const tracks = ring
      ? [
          [ring[0]!, ring[1]!],
          [ring[3]!, ring[2]!],
        ]
      : [],
    intersections: {
      goParameter: Rational;
      originalRiserParameter: Rational;
      exactCrossingPointFeet: NativeRationalPoint;
      properGoCrossing: boolean;
      withinOriginalFiniteRiser: boolean;
    }[] = [],
    blockers: string[] = [];
  if (!ring)
    blockers.push("Zero-plan horizontal transfer cannot cross a riser");
  for (const [start, end] of tracks) {
    const v = delta(end!, start!),
      offset = delta(origin, start!),
      den = cross(v, direction);
    if (!den.n) {
      blockers.push(
        "Transfer is parallel or collinear with the original riser",
      );
      continue;
    }
    const s = div(cross(offset, direction), den),
      t = div(cross(offset, v), den);
    intersections.push({
      goParameter: s,
      originalRiserParameter: t,
      exactCrossingPointFeet: [
        add(start![0], mul(v[0], s)),
        add(start![1], mul(v[1], s)),
      ],
      properGoCrossing: s.n > 0n && cmp(s, rational(1)) < 0,
      withinOriginalFiniteRiser: cmp(t, lower) >= 0 && cmp(t, upper) <= 0,
    });
  }
  const half = ring
      ? delta(ring[0]!, fromFeet)
      : ([rational(0), rational(0)] as NativeRationalPoint),
    halfWidthSquaredFeet = add(mul(half[0], half[0]), mul(half[1], half[1]));
  return {
    originalSourceLine: structuredClone(line),
    sourcePlanHeightRetainedAsMetadataFeet: rational(line.m_origin[2]),
    fromFeet,
    toFeet,
    conservativeTwoFootStripPartsFeet: strip,
    exactHalfWidthSquaredFeet: halfWidthSquaredFeet,
    originalFiniteRiserParameterBounds: [lower, upper],
    endpointTrackIntersections: intersections,
    blockers,
    properCrossingForFullTwoFootStrip:
      intersections.length === 2 &&
      intersections.every(
        (i) => i.properGoCrossing && i.withinOriginalFiniteRiser,
      ) &&
      cmp(halfWidthSquaredFeet, rational(1)) >= 0,
    originalSourceAuthorityGranted: false as const,
    physicalRiserCorrespondenceApproved: false as const,
    fullHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}
