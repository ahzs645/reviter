import type { IndoorDataset } from "./indoor-contract.ts";
import { nativeMaterialPlanExactWalls } from "./native-material-plan.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import { createNativeRoutingMaterialQuery } from "./native-routing-material.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint as RP,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";

type Point = [number, number];
type Rings = Point[][];
/** A reviewed analytical contact only. Original physical bodies, coordinates,
 * door portals, navigation and access are never replaced by this descriptor. */
export type NativeSelectionContactRepair = {
  id: string;
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  levelId: number;
  elevationFeet: number;
  status: "proposed" | "applied" | "restored";
  source: {
    nativeElementId: number;
    ringsFeet: Rings;
    capFeet: [Point, Point];
  };
  target: {
    nativeElementId: number;
    ringsFeet: Rings;
    faceFeet: [Point, Point];
  };
  contactMode?: "finite-cap-overlap" | "original-free-cap";
  evidenceSha256: string;
  notes: string;
  assumption: {
    kind: "provisional-extracted-native-contact";
    revisitRequired: true;
  };
};
export type NativeSelectionContactRepairs = {
  version: 1;
  sourceModelSha256: string;
  repairs: NativeSelectionContactRepair[];
};
const fail = (message: string): never => {
  throw new Error(`Invalid native selection contact repair: ${message}`);
};
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const point = (v: unknown): v is Point =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every(
    (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7,
  );
const pair = (v: unknown): v is [Point, Point] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every(point) &&
  JSON.stringify(v[0]) !== JSON.stringify(v[1]);
const rings = (v: unknown): v is Rings =>
  Array.isArray(v) &&
  v.length === 1 &&
  v.every(
    (r) =>
      Array.isArray(r) && r.length >= 3 && r.length <= 128 && r.every(point),
  );
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const openNumericRings = (rs: Rings): Rings =>
  rs.map((r) => (r.length > 1 && same(r[0], r.at(-1)) ? r.slice(0, -1) : r));
const openExactRing = (r: RP[]): RP[] =>
  r.length > 1 && eq(r[0], r.at(-1)!) ? r.slice(0, -1) : r;
export function validateNativeSelectionContactRepairs(
  value: NativeSelectionContactRepairs | undefined,
  modelSha256?: string,
): void {
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    !hash(value.sourceModelSha256) ||
    (modelSha256 && value.sourceModelSha256 !== modelSha256) ||
    !Array.isArray(value.repairs) ||
    value.repairs.length > 10_000
  )
    fail("source identity or collection");
  const ids = new Set<string>();
  for (const r of value.repairs) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id.trim() ||
      r.id.length > 256 ||
      ids.has(r.id) ||
      r.sourceModelSha256 !== value.sourceModelSha256 ||
      !hash(r.sourceMaterialGeometrySha256) ||
      !Number.isSafeInteger(r.levelId) ||
      !Number.isFinite(r.elevationFeet) ||
      !["proposed", "applied", "restored"].includes(r.status) ||
      !r.source ||
      !r.target ||
      !Number.isSafeInteger(r.source.nativeElementId) ||
      r.source.nativeElementId <= 0 ||
      !Number.isSafeInteger(r.target.nativeElementId) ||
      r.target.nativeElementId <= 0 ||
      r.source.nativeElementId === r.target.nativeElementId ||
      !rings(r.source.ringsFeet) ||
      !rings(r.target.ringsFeet) ||
      !pair(r.source.capFeet) ||
      !pair(r.target.faceFeet) ||
      !hash(r.evidenceSha256) ||
      typeof r.notes !== "string" ||
      !r.notes.trim() ||
      r.notes.length > 10_000 ||
      (r.contactMode !== undefined &&
        r.contactMode !== "finite-cap-overlap" &&
        r.contactMode !== "original-free-cap") ||
      !r.assumption ||
      r.assumption.kind !== "provisional-extracted-native-contact" ||
      r.assumption.revisitRequired !== true
    )
      fail("finite original evidence, assumption, state or duplicate ID");
    ids.add(r.id);
  }
}
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Rational, b: Rational) => {
  const n = a.n * b.d - b.n * a.d;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
};
const zero = new Rational(0n),
  one = new Rational(1n);
const rp = (p: Point): RP => [rational(p[0]), rational(p[1])];
const delta = (a: RP, b: RP): RP => [sub(a[0], b[0]), sub(a[1], b[1])];
const dot = (a: RP, b: RP) => add(mul(a[0], b[0]), mul(a[1], b[1]));
const cross = (a: RP, b: RP) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
const eq = (a: RP, b: RP) => !cmp(a[0], b[0]) && !cmp(a[1], b[1]);
const at = (p: RP, n: RP, t: Rational): RP => [
  add(p[0], mul(n[0], t)),
  add(p[1], mul(n[1], t)),
];
const edge = (ring: RP[], a: RP, b: RP) =>
  ring.some(
    (p, i) =>
      (eq(p, a) && eq(ring[(i + 1) % ring.length], b)) ||
      (eq(p, b) && eq(ring[(i + 1) % ring.length], a)),
  );
function convex(ring: RP[]): void {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    if (eq(ring[i], ring[(i + 1) % ring.length]))
      fail("repeated original vertex");
    const n = cross(
      delta(ring[(i + 1) % ring.length], ring[i]),
      delta(ring[(i + 2) % ring.length], ring[(i + 1) % ring.length]),
    ).n;
    if (!n) continue;
    const next = n < 0n ? -1 : 1;
    if (sign && sign !== next) fail("nonconvex original contact body");
    sign = next;
  }
  if (!sign) fail("zero-area original body");
}
/** Rectangle eligibility only. Independent source Float64 corner coordinates
 * may encode rigidly transformed perpendicular faces a few ulps apart. This
 * error bound never changes a vertex or relaxes any exact contact predicate. */
function rectangularSource(ring: Point[]): void {
  const edges = ring.map(
    (p, i): Point => [ring[(i + 1) % 4][0] - p[0], ring[(i + 1) % 4][1] - p[1]],
  );
  const coordinateError =
    16 * Number.EPSILON * Math.max(1, ...ring.flat().map(Math.abs));
  for (let i = 0; i < 4; i++) {
    const a = edges[i],
      b = edges[(i + 1) % 4],
      opposite = edges[(i + 2) % 4];
    const length = Math.hypot(...a),
      nextLength = Math.hypot(...b);
    if (
      Math.abs(a[0] * b[0] + a[1] * b[1]) >
        coordinateError * (length + nextLength) ||
      Math.hypot(a[0] + opposite[0], a[1] + opposite[1]) > 2 * coordinateError
    )
      fail("source member is not rectangular at native coordinate precision");
  }
}
/** Strict first finite ray hit. Parallel edges cannot manufacture a contact. */
function ray(
  p: RP,
  n: RP,
  a: RP,
  b: RP,
): { t: Rational; point: RP } | undefined {
  const e = delta(b, a),
    den = cross(n, e);
  if (!den.n) return undefined;
  const q = delta(a, p),
    t = div(cross(q, e), den),
    s = div(cross(q, n), den);
  if (cmp(t, zero) < 0 || cmp(s, zero) < 0 || cmp(s, one) > 0) return undefined;
  return { t, point: at(p, n, t) };
}
function firstHit(
  p: RP,
  n: RP,
  ring: RP[],
  a: RP,
  b: RP,
): { t: Rational; point: RP } {
  const chosen =
    ray(p, n, a, b) ?? fail("partial-width or absent finite target contact");
  const hits = ring.flatMap((q, i) => {
    const v = ray(p, n, q, ring[(i + 1) % ring.length]);
    return v ? [v] : [];
  });
  if (hits.length === 0 || hits.some((v) => cmp(v.t, chosen.t) < 0))
    fail("target face is not first original material");
  return chosen;
}
/** Original full numeric cap remains authoritative. Finite mode derives its
 * maximal exact lateral overlap with the named finite original face. No saved
 * subcap coordinates, snapping, cap extrapolation or polygon wedge is accepted. */
export function nativeSelectionContactInterval(repair: {
  contactMode?: "finite-cap-overlap" | "original-free-cap";
  source: { capFeet: [number, number][] };
  target: { faceFeet?: [number, number][] };
}) {
  const [a, b] = repair.source.capFeet.map(rp),
    cap = delta(b, a),
    width2 = dot(cap, cap);
  if (!width2.n) fail("degenerate original cap");
  let start = zero,
    end = one;
  if (repair.contactMode !== undefined) {
    if (
      repair.contactMode !== "finite-cap-overlap" ||
      !repair.target.faceFeet ||
      !pair(repair.target.faceFeet)
    )
      fail("finite overlap needs original target face");
    const lateral = repair.target
      .faceFeet!.map((p) => div(dot(delta(rp(p), a), cap), width2))
      .sort(cmp);
    start = cmp(lateral[0], zero) > 0 ? lateral[0] : zero;
    end = cmp(lateral[1], one) < 0 ? lateral[1] : one;
    const limit2 = mul(rational(1e-7), rational(1e-7));
    if (
      cmp(start, end) >= 0 ||
      (!start.n && cmp(end, one) === 0) ||
      cmp(mul(mul(start, start), width2), limit2) > 0 ||
      cmp(mul(mul(sub(one, end), sub(one, end)), width2), limit2) > 0
    )
      fail("absent, full-width or excessive finite cap trim");
  }
  return {
    start,
    end,
    sourceContact: [at(a, cap, start), at(a, cap, end)] as [RP, RP],
    projectedSpan: mul(sub(end, start), width2),
  };
}
/** Exact free intervals of an original convex short cap. Existing intersections
 * with the target are retained. Every added interval reaches the first original
 * target edge within the numerical depth limit; no source point is moved. */
function originalFreeCapMask(
  source: RP[],
  target: RP[],
  a: RP,
  b: RP,
  c: RP,
  d: RP,
  n: RP,
): NativeRationalParts {
  const cap = delta(b, a),
    width2 = dot(cap, cap),
    n2 = dot(n, n);
  const breaks = new Map<string, Rational>();
  const put = (s: Rational) => {
    if (cmp(s, zero) >= 0 && cmp(s, one) <= 0) breaks.set(`${s.n}/${s.d}`, s);
  };
  put(zero);
  put(one);
  for (let i = 0; i < target.length; i++) {
    const p = target[i],
      q = target[(i + 1) % target.length];
    put(div(dot(delta(p, a), cap), width2));
    // Crossing the original cap switches between retained material and free
    // space. Preserve the exact crossing rather than trimming numeric corners.
    const v = delta(q, p),
      den = cross(cap, v);
    if (den.n) {
      const offset = delta(p, a),
        t = div(cross(offset, cap), den);
      if (cmp(t, zero) >= 0 && cmp(t, one) <= 0)
        put(div(cross(offset, v), den));
    }
  }
  const sorted = [...breaks.values()].sort(cmp),
    masks: NativeRationalParts[] = [];
  const limit2 = mul(rational(1e-7), rational(1e-7));
  let namedFirstFace = false;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1],
      hi = sorted[i];
    if (!cmp(lo, hi)) continue;
    const middle = at(a, cap, div(add(lo, hi), rational(2)));
    if (nativeRationalPointInParts(middle, [[target]])) continue;
    const hits = target
      .flatMap((p, j) => {
        const q = target[(j + 1) % target.length],
          hit = ray(middle, n, p, q);
        return hit ? [{ ...hit, p, q }] : [];
      })
      .sort((x, y) => cmp(x.t, y.t));
    if (hits.length === 0) continue;
    const first = hits[0],
      p0 = at(a, cap, lo),
      p1 = at(a, cap, hi);
    const h0 = firstHit(p0, n, target, first.p, first.q),
      h1 = firstHit(p1, n, target, first.p, first.q);
    if (!h0.t.n && !h1.t.n) continue;
    if ([h0, h1].some((h) => cmp(mul(mul(h.t, h.t), n2), limit2) > 0))
      fail("non-numerical original free cap interval");
    const mask = nativeRationalOverlay("union", [
      [[p0, p1, h1.point, h0.point]],
    ]);
    if (mask.length === 0) continue;
    if (
      nativeRationalOverlay("intersection", mask, [[source], [target]]).length >
      0
    )
      fail("original free cap overlaps retained native material");
    if (
      (eq(first.p, c) && eq(first.q, d)) ||
      (eq(first.p, d) && eq(first.q, c))
    )
      namedFirstFace = true;
    masks.push(mask);
  }
  if (masks.length === 0 || !namedFirstFace)
    fail("absent positive original free cap or non-first named target face");
  return nativeRationalOverlay("union", masks[0], ...masks.slice(1));
}

/** Recheck the independently retained original bodies during physical vetoes.
 * This helper derives authority, never accepts a serialized mask as proof. */
export function nativeSelectionOriginalFreeCapMask(
  sourceParts: NativeRationalParts,
  targetParts: NativeRationalParts,
  capFeet: [number, number][],
  faceFeet: [number, number][],
): NativeRationalParts {
  if (capFeet.length !== 2 || faceFeet.length !== 2)
    fail("free cap requires complete original edge evidence");
  const [a, b] = capFeet.map(rp),
    [c, d] = faceFeet.map(rp),
    sources = sourceParts.filter(
      (part) => part.length === 1 && edge(openExactRing(part[0]), a, b),
    ),
    targets = targetParts.filter(
      (part) => part.length === 1 && edge(openExactRing(part[0]), c, d),
    );
  // Several retained original components may share one owner. Select one whole
  // uniquely edge-bound component, never crop it or discard sibling material.
  // Independent physical vetoes still check every original owner component.
  if (sources.length !== 1 || targets.length !== 1)
    fail("free cap requires unique complete original material components");
  const source = openExactRing(sources[0][0]),
    target = openExactRing(targets[0][0]);
  if (source.length !== 4 || !edge(source, a, b) || !edge(target, c, d))
    fail("free cap is not a full actual original edge");
  convex(source);
  convex(target);
  const cap = delta(b, a),
    width2 = dot(cap, cap),
    lengths = source.map((p, i) =>
      dot(delta(source[(i + 1) % 4], p), delta(source[(i + 1) % 4], p)),
    ),
    ix = source.findIndex(
      (p, i) =>
        (eq(p, a) && eq(source[(i + 1) % 4], b)) ||
        (eq(p, b) && eq(source[(i + 1) % 4], a)),
    );
  if (
    cmp(width2, rational(4)) > 0 ||
    [lengths[(ix + 3) % 4], lengths[(ix + 1) % 4]].some(
      (v) => cmp(v, width2) <= 0,
    )
  )
    fail("free source edge is not a short original member cap");
  let n: RP = [new Rational(-cap[1].n, cap[1].d), cap[0]];
  const other = source.find((p) => !eq(p, a) && !eq(p, b))!;
  if (cmp(dot(n, delta(other, a)), zero) > 0)
    n = [new Rational(-n[0].n, n[0].d), new Rational(-n[1].n, n[1].d)];
  if (source.some((p) => cmp(dot(n, delta(p, a)), zero) > 0))
    fail("free source cap does not face free space");
  return originalFreeCapMask(source, target, a, b, c, d, n);
}

/** Derive a rational-only gap polygon from actual current original edges.
 * Coordinates stored in the proposal are evidence, never rounded authority.
 * Whole physical floor/opening/door/foreign-material guards run separately. */
function deriveCheckedContact(
  data: IndoorDataset,
  repair: NativeSelectionContactRepair,
  current: ReturnType<typeof nativeMaterialPlanExactWalls>,
): NativeRationalParts {
  validateNativeSelectionContactRepairs(
    {
      version: 1,
      sourceModelSha256: repair.sourceModelSha256,
      repairs: [repair],
    },
    data.source.modelSha256,
  );
  if (
    data.nativeMaterialSections?.geometrySha256 !==
      repair.sourceMaterialGeometrySha256 ||
    data.nativeMaterialSections.sourceModelSha256 !== repair.sourceModelSha256
  )
    fail("stale current source material binding");
  const level = data.nativeLevels.find((l) => l.id === repair.levelId);
  if (!level || level.elevationFeet !== repair.elevationFeet)
    fail("stale native elevation");
  const find = (
    e:
      | NativeSelectionContactRepair["source"]
      | NativeSelectionContactRepair["target"],
  ) => {
    const rows = current.filter(
      (w) =>
        w.nativeElementId === e.nativeElementId &&
        !w.reviewPatchId &&
        !w.approximate &&
        w.kind === "wall" &&
        (w as typeof w & { geometrySource?: string }).geometrySource ===
          "original-native-material-section" &&
        same(openNumericRings(w.ringsFeet), openNumericRings(e.ringsFeet)),
    );
    if (
      rows.length !== 1 ||
      rows[0].exactParts.length !== 1 ||
      rows[0].exactParts[0].length !== 1
    )
      fail("changed, missing or non-original finite material");
    return openExactRing(rows[0].exactParts[0][0]);
  };
  const source = find(repair.source),
    target = find(repair.target),
    [a, b] = repair.source.capFeet.map(rp),
    [c, d] = repair.target.faceFeet.map(rp);
  if (source.length !== 4 || !edge(source, a, b) || !edge(target, c, d))
    fail("contact is not a full actual original edge");
  convex(source);
  convex(target);
  if (repair.contactMode !== "original-free-cap")
    rectangularSource(openNumericRings(repair.source.ringsFeet)[0]);
  const cap = delta(b, a),
    width2 = dot(cap, cap);
  // A short end cap of a four-corner basic member, not a long side or a
  // diagonal crop. Exact shape/contact checks retain actual source vertices.
  const lengths = source.map((p, i) =>
    dot(delta(source[(i + 1) % 4], p), delta(source[(i + 1) % 4], p)),
  );
  const capIndex = source.findIndex(
    (p, i) =>
      (eq(p, a) && eq(source[(i + 1) % 4], b)) ||
      (eq(p, b) && eq(source[(i + 1) % 4], a)),
  );
  if (
    cmp(width2, rational(4)) > 0 ||
    [lengths[(capIndex + 3) % 4], lengths[(capIndex + 1) % 4]].some(
      (v) => cmp(v, width2) <= 0,
    )
  )
    fail("source edge is not a short original member cap");
  const other = source.find((p) => !eq(p, a) && !eq(p, b))!;
  let n: RP = [new Rational(-cap[1].n, cap[1].d), cap[0]];
  if (cmp(dot(n, delta(other, a)), zero) > 0)
    n = [new Rational(-n[0].n, n[0].d), new Rational(-n[1].n, n[1].d)];
  if (source.some((p) => cmp(dot(n, delta(p, a)), zero) > 0))
    fail("source cap does not face free space");
  if (repair.contactMode === "original-free-cap")
    return nativeSelectionOriginalFreeCapMask(
      [[source]],
      [[target]],
      repair.source.capFeet,
      repair.target.faceFeet,
    );
  const interval = nativeSelectionContactInterval(repair),
    [p0, p1] = interval.sourceContact;
  const h0 = firstHit(p0, n, target, c, d),
    h1 = firstHit(p1, n, target, c, d);
  const limit2 = mul(rational(1e-7), rational(1e-7)),
    n2 = dot(n, n);
  if (
    (!h0.t.n && !h1.t.n) ||
    [h0, h1].some((h) => cmp(mul(mul(h.t, h.t), n2), limit2) > 0)
  )
    fail("zero or non-numerical contact interval");
  // Every original target vertex's lateral breakpoint plus every interval
  // midpoint must keep the named finite face as the first actual contact.
  const samples = [
    interval.start,
    interval.end,
    ...target
      .map((p) => div(dot(delta(p, a), cap), width2))
      .filter((t) => cmp(t, interval.start) > 0 && cmp(t, interval.end) < 0),
  ].sort(cmp);
  for (let i = 0; i < samples.length; i++) {
    firstHit(at(a, cap, samples[i]), n, target, c, d);
    if (i + 1 < samples.length)
      firstHit(
        at(a, cap, div(add(samples[i], samples[i + 1]), rational(2))),
        n,
        target,
        c,
        d,
      );
  }
  const mask = nativeRationalOverlay("union", [[[p0, p1, h1.point, h0.point]]]);
  if (
    mask.length === 0 ||
    nativeRationalOverlay("intersection", mask, [[source]]).length > 0 ||
    nativeRationalOverlay("intersection", mask, [[target]]).length > 0
  )
    fail("non-positive interval or original material overlap");
  return mask;
}
/** One fresh unchanged source snapshot per synchronous batch. No persistent
 * object-identity cache can authorize edited source material. */
export function deriveNativeSelectionContactRepairs(
  data: IndoorDataset,
  repairs: NativeSelectionContactRepair[],
): NativeRationalParts[] {
  validateNativeSelectionContactRepairs(
    { version: 1, sourceModelSha256: data.source.modelSha256, repairs },
    data.source.modelSha256,
  );
  if (repairs.length === 0) return [];
  const query = createNativeRoutingMaterialQuery(data),
    levels = new Map<number, ReturnType<typeof nativeMaterialPlanExactWalls>>();
  for (const r of repairs)
    if (!levels.has(r.levelId))
      levels.set(
        r.levelId,
        nativeMaterialPlanExactWalls(data, r.levelId, query),
      );
  return repairs.map((r) =>
    deriveCheckedContact(data, r, levels.get(r.levelId)!),
  );
}
/** Independent diagnostics against one fresh synchronous original-material
 * snapshot. Failed rows stay rejected; this API never weakens their proof or
 * makes an incomplete collection authoritative. Applications use only the
 * successful subset and independently run physical guards and publication. */
export function deriveNativeSelectionContactRepairAttempts(
  data: IndoorDataset,
  repairs: NativeSelectionContactRepair[],
): (
  | {
      repair: NativeSelectionContactRepair;
      mask: NativeRationalParts;
      error?: undefined;
    }
  | { repair: NativeSelectionContactRepair; error: string; mask?: undefined }
)[] {
  validateNativeSelectionContactRepairs(
    { version: 1, sourceModelSha256: data.source.modelSha256, repairs },
    data.source.modelSha256,
  );
  if (repairs.length === 0) return [];
  const query = createNativeRoutingMaterialQuery(data),
    levels = new Map<number, ReturnType<typeof nativeMaterialPlanExactWalls>>();
  for (const r of repairs)
    if (!levels.has(r.levelId))
      levels.set(
        r.levelId,
        nativeMaterialPlanExactWalls(data, r.levelId, query),
      );
  return repairs.map((repair) => {
    try {
      return {
        repair,
        mask: deriveCheckedContact(data, repair, levels.get(repair.levelId)!),
      };
    } catch (error) {
      return {
        repair,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
export function deriveNativeSelectionContactRepair(
  data: IndoorDataset,
  repair: NativeSelectionContactRepair,
): NativeRationalParts {
  return deriveNativeSelectionContactRepairs(data, [repair])[0];
}
export function nativeSelectionContactRepairMasks(
  data: IndoorDataset & {
    nativeSelectionContactRepairs?: NativeSelectionContactRepairs;
  },
  levelId: number,
): NativeRationalParts {
  validateNativeSelectionContactRepairs(
    data.nativeSelectionContactRepairs,
    data.source.modelSha256,
  );
  return deriveNativeSelectionContactRepairs(
    data,
    (data.nativeSelectionContactRepairs?.repairs ?? []).filter(
      (r) => r.status === "applied" && r.levelId === levelId,
    ),
  ).flat();
}
