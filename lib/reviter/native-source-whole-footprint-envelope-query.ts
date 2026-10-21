/** Pure conservative-envelope query. Its rows/footprint grant no source
 * authority; production callers must obtain them from a fresh opaque census. */
import {
  Rational,
  rational,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
type Bounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};
type Row = { nativeElementId: number; boundsFeet?: Bounds; blocker?: unknown };
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
export function inspectWholeFootprintEnvelopeCandidates(
  rows: readonly Row[],
  footprint: NativeRationalParts,
  foot: Rational,
  head: Rational,
) {
  const points = footprint.flat(2);
  if (
    !points.length ||
    !(foot instanceof Rational) ||
    !(head instanceof Rational) ||
    compare(head, foot) <= 0n ||
    points.some(
      (p) => p.length !== 2 || p.some((q) => !(q instanceof Rational)),
    )
  )
    throw new Error("Invalid complete foreign footprint demand");
  const low = [0, 1].map((i) =>
      points.map((p) => p[i]!).reduce((a, b) => (compare(a, b) < 0n ? a : b)),
    ),
    high = [0, 1].map((i) =>
      points.map((p) => p[i]!).reduce((a, b) => (compare(a, b) > 0n ? a : b)),
    ),
    bounded: number[] = [],
    unbounded: number[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.nativeElementId) || row.nativeElementId <= 0)
      throw new Error("Invalid original foreign identity");
    const b = row.boundsFeet;
    if (
      !b ||
      row.blocker !== undefined ||
      (["x", "y", "z"] as const).some(
        (a) =>
          !Number.isFinite(b.min[a]) ||
          !Number.isFinite(b.max[a]) ||
          b.min[a] > b.max[a],
      )
    ) {
      unbounded.push(row.nativeElementId);
      continue;
    }
    const min = [b.min.x, b.min.y, b.min.z].map(rational),
      max = [b.max.x, b.max.y, b.max.z].map(rational);
    if (
      compare(max[2]!, foot) <= 0n ||
      compare(min[2]!, head) > 0n ||
      [0, 1].some(
        (i) =>
          compare(max[i]!, low[i]!) < 0n || compare(min[i]!, high[i]!) > 0n,
      )
    )
      continue;
    const a: [Rational, Rational] = [min[0]!, min[1]!],
      c: [Rational, Rational] = [max[0]!, max[1]!],
      positive = compare(a[0], c[0]) < 0n && compare(a[1], c[1]) < 0n;
    const plan: NativeRationalParts = positive
      ? [[[a, [c[0], a[1]], c, [a[0], c[1]]]]]
      : [];
    if (
      exactClosedSourcePlanarContact(footprint, plan, positive ? [] : [[a, c]])
    )
      bounded.push(row.nativeElementId);
  }
  return {
    candidateNativeElementIds: [...new Set(bounded)].sort((a, b) => a - b),
    unboundedNativeElementIds: [...new Set(unbounded)].sort((a, b) => a - b),
    censusRecordsChecked: rows.length,
    completeStatedFootprintChecked: true as const,
    closedSideAndHeadTangenciesRetained: true as const,
    explicitSourceReplacementsRequireSeparateMaterialProof: [] as number[],
    foreignHumanClearanceApproved: false as const,
    routeApproved: false as const,
  };
}
