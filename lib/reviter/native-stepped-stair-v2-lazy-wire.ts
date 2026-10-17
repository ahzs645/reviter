/** Lossless wire stays unchanged. Every original closed coordinate is scanned
 * to recompute exact bounds. Only cells strictly outside the WHOLE declared
 * motion/standing/headroom scope are replaced by a conservative box during
 * mathematical replay; matching/tangent/unknown cells remain exact. This is
 * not source admission and never trusts serialized bounds or source flags. */
import { Rational, rational } from "./native-rational-overlay.ts";
import { projectStatedTwoFootWalkingVolume } from "./native-stepped-stair-v2-walking-volume.ts";
import {
  decodeSteppedStairV2WireValue,
  replayPortableSteppedStairV2,
  type SteppedStairV2WireValue,
  type PortableSteppedSourceIndex,
  type PortableSteppedReceipt,
  type PortableSteppedGraphBinding,
  type SteppedMaterialCell,
  type Point3,
} from "./native-stepped-stair-v2-kernel.ts";
type Q = { n: bigint; d: bigint };
type Bounds = { minimum: [Q, Q, Q]; maximum: [Q, Q, Q] };
const cmp = (a: Q, b: Q) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const toRational = (a: Q) => new Rational(a.n, a.d);
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
function sourceRational(value: unknown): Q {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("$rational" in value)
  )
    throw new Error("Missing exact rational wire coordinate");
  const pair = (value as { $rational: unknown }).$rational;
  if (
    !Array.isArray(pair) ||
    pair.length !== 2 ||
    !pair.every(
      (n) =>
        typeof n === "string" &&
        n.length <= 4096 &&
        /^-?(0|[1-9][0-9]*)$/.test(n),
    ) ||
    pair[0] === "-0" ||
    !/^[1-9][0-9]*$/.test(pair[1])
  )
    throw new Error("Invalid exact cell rational");
  const n = BigInt(pair[0]),
    d = BigInt(pair[1]);
  let a = n < 0n ? -n : n,
    b = d;
  while (b !== 0n) {
    const r = a % b;
    a = b;
    b = r;
  }
  if (a !== 1n) throw new Error("Unnormalized exact cell rational");
  return { n, d };
}
function scopeFor(receipt: PortableSteppedReceipt): Bounds {
  const points = [
    ...receipt.terminals.flatMap((t) => t.approachFeet),
    ...receipt.stations.map((s) => s.pointFeet),
  ];
  if (
    points.length < 4 ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 3 ||
        p.some((v) => !(v instanceof Rational)),
    )
  )
    throw new Error("Invalid complete motion scope");
  const all: Point3[] = [];
  // Full squares are a conservative superset for every transverse station and
  // include actual flat-node/turn standing caps. No gait claim is made.
  for (const p of points)
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        all.push([add(p[0], rational(x)), add(p[1], rational(y)), p[2]]);
  const paths = [
    ...receipt.terminals.map((t) => t.approachFeet),
    [
      receipt.terminals[0].approachFeet.at(-1)!,
      ...receipt.stations.map((s) => s.pointFeet),
      receipt.terminals[1].approachFeet.at(-1)!,
    ],
  ];
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!,
        b = path[i]!;
      if (cmp(a[0], b[0]) === 0 && cmp(a[1], b[1]) === 0) continue;
      const strip = projectStatedTwoFootWalkingVolume(
        a,
        b,
        rational(0),
        rational(1),
        6,
      ).unclippedStatedStripFeet;
      for (const p of strip) all.push([p[0], p[1], a[2]], [p[0], p[1], b[2]]);
    }
  const first = all[0]!,
    bounds: Bounds = { minimum: [...first], maximum: [...first] };
  for (const p of all)
    for (const axis of [0, 1, 2]) {
      if (cmp(p[axis]!, bounds.minimum[axis]!) < 0)
        bounds.minimum[axis] = p[axis]!;
      if (cmp(p[axis]!, bounds.maximum[axis]!) > 0)
        bounds.maximum[axis] = p[axis]!;
    }
  bounds.maximum[2] = add(bounds.maximum[2], rational(6));
  return bounds;
}
function scanCell(value: SteppedStairV2WireValue): {
  raw: { [key: string]: SteppedStairV2WireValue };
  bounds: Bounds;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid original wire material cell");
  const raw = value;
  if (
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    !positive(raw.nativeOwnerId) ||
    !Array.isArray(raw.originalFaceTokens) ||
    raw.originalFaceTokens.some((t) => !positive(t)) ||
    new Set(raw.originalFaceTokens).size !== raw.originalFaceTokens.length ||
    (raw.geometryKind !== undefined &&
      ![
        "native-face-cells",
        "complete-source-envelope",
        "bounded-source-primitive",
      ].includes(String(raw.geometryKind))) ||
    (raw.originalFaceTokens.length === 0 &&
      !["complete-source-envelope", "bounded-source-primitive"].includes(
        String(raw.geometryKind),
      ))
  )
    throw new Error("Invalid original cell owner/role");
  const lo = sourceRational(raw.minimumElevationFeet),
    hi = sourceRational(raw.maximumElevationFeet);
  if (cmp(lo, hi) > 0) throw new Error("Inverted material height");
  let minimum: [Q, Q] | undefined,
    maximum: [Q, Q] | undefined,
    count = 0;
  const visit = (p: SteppedStairV2WireValue) => {
    if (!Array.isArray(p) || p.length !== 2 || ++count > 200_000)
      throw new Error("Invalid original material vertex");
    const q = [sourceRational(p[0]), sourceRational(p[1])] as [Q, Q];
    if (minimum) {
      for (const axis of [0, 1]) {
        if (cmp(q[axis]!, minimum[axis]!) < 0) minimum[axis] = q[axis]!;
        if (cmp(q[axis]!, maximum![axis]!) > 0) maximum![axis] = q[axis]!;
      }
    } else {
      minimum = q;
      maximum = [...minimum];
    }
  };
  if (
    !Array.isArray(raw.partsFeet) ||
    raw.partsFeet.length > 10_000 ||
    !Array.isArray(raw.closedSegmentsFeet) ||
    raw.closedSegmentsFeet.length > 200_000
  )
    throw new Error("Invalid original closed cell shape");
  for (const part of raw.partsFeet) {
    if (!Array.isArray(part) || part.length === 0)
      throw new Error("Invalid original part");
    for (const ring of part) {
      if (!Array.isArray(ring) || ring.length < 3)
        throw new Error("Invalid original ring");
      for (const p of ring) visit(p);
    }
  }
  for (const segment of raw.closedSegmentsFeet) {
    if (!Array.isArray(segment) || segment.length === 0)
      throw new Error("Invalid original closed primitive");
    for (const p of segment) visit(p);
  }
  if (!minimum || !maximum) throw new Error("Empty original physical cell");
  return {
    raw,
    bounds: {
      minimum: [minimum[0], minimum[1], lo],
      maximum: [maximum[0], maximum[1], hi],
    },
  };
}
const disjoint = (a: Bounds, b: Bounds) =>
  [0, 1, 2].some(
    (i) =>
      cmp(a.maximum[i]!, b.minimum[i]!) < 0 ||
      cmp(b.maximum[i]!, a.minimum[i]!) < 0,
  );
/** Reusable only for this exact receipt. Never cache across mutable authoring
 * data: every invocation scans all original coordinates again. */
export function prepareConservativeSteppedStairV2Wire(
  indexWire: SteppedStairV2WireValue,
  receiptWire: SteppedStairV2WireValue,
) {
  if (
    !indexWire ||
    typeof indexWire !== "object" ||
    Array.isArray(indexWire) ||
    !Array.isArray(indexWire.cells) ||
    indexWire.cells.length > 200_000
  )
    throw new Error("Missing complete shared wire index");
  const receipt = decodeSteppedStairV2WireValue(
      receiptWire,
    ) as PortableSteppedReceipt,
    scope = scopeFor(receipt),
    index = decodeSteppedStairV2WireValue({
      ...indexWire,
      cells: [],
    }) as PortableSteppedSourceIndex;
  const cells: SteppedMaterialCell[] = [];
  let fullCells = 0,
    conservativeDisjointCells = 0;
  for (const original of indexWire.cells) {
    const { raw, bounds } = scanCell(original);
    if (
      raw.geometryKind === "bounded-source-primitive" ||
      !disjoint(bounds, scope)
    ) {
      cells.push(
        decodeSteppedStairV2WireValue(original) as SteppedMaterialCell,
      );
      fullCells++;
      continue;
    }
    const metadata = { ...raw, partsFeet: [], closedSegmentsFeet: [] },
      cell = decodeSteppedStairV2WireValue(metadata) as SteppedMaterialCell,
      x0 = toRational(bounds.minimum[0]),
      x1 = toRational(bounds.maximum[0]),
      y0 = toRational(bounds.minimum[1]),
      y1 = toRational(bounds.maximum[1]);
    // Convex outer box contains every original polygon, hole-boundary and
    // finite zero-area primitive; strict disjointness is required in XYZ.
    if (cmp(x0, x1) === 0 || cmp(y0, y1) === 0)
      cell.closedSegmentsFeet = [
        [
          [x0, y0],
          [x1, y1],
        ],
      ];
    else
      cell.partsFeet = [
        [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ],
        ],
      ];
    cells.push(cell);
    conservativeDisjointCells++;
  }
  index.cells = cells;
  return {
    index,
    receipt,
    scope,
    fullCells,
    conservativeDisjointCells,
    originalWireCellCount: indexWire.cells.length,
    originalSourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}
export function replayPortableSteppedStairV2Wire(
  indexWire: SteppedStairV2WireValue,
  receiptWire: SteppedStairV2WireValue,
  expectedGraphBinding: PortableSteppedGraphBinding,
  currentGraphBinding: PortableSteppedGraphBinding,
  options: Parameters<typeof replayPortableSteppedStairV2>[4] = {},
) {
  const prepared = prepareConservativeSteppedStairV2Wire(
    indexWire,
    receiptWire,
  );
  return {
    ...replayPortableSteppedStairV2(
      prepared.index,
      prepared.receipt,
      expectedGraphBinding,
      currentGraphBinding,
      options,
    ),
    wireHydration: {
      fullCells: prepared.fullCells,
      conservativeDisjointCells: prepared.conservativeDisjointCells,
      originalWireCellCount: prepared.originalWireCellCount,
    },
  };
}
