import { Rational, rational, nativeRationalOverlay, type NativeRationalParts, type NativeRationalPoint } from "./native-rational-overlay";

/** A selection/air threshold measured from original source glass planes and
 * independently closed finite jamb/header sections. This never creates a portal
 * or changes the physical leaf, source material, floor or access. Callers must
 * supply original source primitives, not viewer bounds or room outlines. */
export type OriginalCurtainThresholdInput = {
  sourceModelSha256: string;
  expectedSourceModelSha256: string;
  nativeDoorElementId: number;
  originalDoorPlacement: readonly number[];
  originalGlassLocalNormalPlanes: readonly [number, number];
  cutElevationFeet: number;
  originalDoorwayHeightFeet: readonly [number, number];
  originalSingleDoorAssembly: boolean;
  originalJambs: readonly { nativeElementId: number; parts: NativeRationalParts }[];
  originalHeaderSection: NativeRationalParts;
  originalFloor: NativeRationalParts;
  foreignPhysicalMaterial: NativeRationalParts;
};

const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => new Rational(a.n * b.d, a.d * b.n);
const cmp = (a: Rational, b: Rational) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const key = (q: Rational) => `${q.n}/${q.d}`;
const cross = (a: NativeRationalPoint, b: NativeRationalPoint) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
type Edge = { id: number; lo: Rational; hi: Rational; m: Rational; c: Rational };

export function recoverOriginalCurtainDoorSelectionThreshold(input: OriginalCurtainThresholdInput): {
  state: "qualified" | "rejected";
  reason?: string;
  threshold: NativeRationalParts;
  exactResidual?: NativeRationalParts;
  originalJambNativeElementIds: number[];
  selectionOnly: true;
  grantsWalkingOrPortal: false;
} {
  const reject = (reason: string, exactResidual?: NativeRationalParts) => ({ state: "rejected" as const, reason, threshold: [] as NativeRationalParts, exactResidual, originalJambNativeElementIds: [], selectionOnly: true as const, grantsWalkingOrPortal: false as const });
  if (!/^[a-f0-9]{64}$/.test(input.sourceModelSha256) || input.sourceModelSha256 !== input.expectedSourceModelSha256) return reject("source-model-mismatch");
  if (!Number.isSafeInteger(input.nativeDoorElementId) || input.nativeDoorElementId <= 0 || !input.originalSingleDoorAssembly) return reject("unqualified-single-door-source-role");
  const matrix = input.originalDoorPlacement;
  if (matrix.length !== 16 || !matrix.every(Number.isFinite) || matrix[2] !== 0 || matrix[6] !== 0 || matrix[8] !== 0 || matrix[9] !== 0 || matrix[10] !== 1 || matrix[15] !== 1) return reject("unsupported-original-door-placement");
  if (!Number.isFinite(input.cutElevationFeet) || !input.originalDoorwayHeightFeet.every(Number.isFinite) || !(input.originalDoorwayHeightFeet[0] <= input.cutElevationFeet && input.cutElevationFeet < input.originalDoorwayHeightFeet[1])) return reject("outside-original-doorway-height");
  const planes = input.originalGlassLocalNormalPlanes;
  if (!planes.every(Number.isFinite) || !(planes[0] < planes[1])) return reject("invalid-original-glass-planes");
  if (input.originalJambs.length < 2 || input.originalJambs.some(j => !Number.isSafeInteger(j.nativeElementId) || j.nativeElementId <= 0 || !j.parts.length)) return reject("missing-original-finite-jambs");
  const u = [rational(matrix[0]), rational(matrix[1])] as NativeRationalPoint;
  const v = [rational(matrix[4]), rational(matrix[5])] as NativeRationalPoint;
  const origin = [rational(matrix[12]), rational(matrix[13])] as NativeRationalPoint;
  const determinant = cross(u, v);
  if (determinant.n === 0n) return reject("singular-original-door-placement");
  const local = (p: NativeRationalPoint): NativeRationalPoint => {
    const delta = [sub(p[0], origin[0]), sub(p[1], origin[1])] as NativeRationalPoint;
    return [div(cross(delta, v), determinant), div(cross(u, delta), determinant)];
  };
  const world = (t: Rational, w: Rational): NativeRationalPoint => [add(origin[0], add(mul(u[0], t), mul(v[0], w))), add(origin[1], add(mul(u[1], t), mul(v[1], w)))];
  const lo = rational(planes[0]), hi = rational(planes[1]);
  const events = new Map([[key(lo), lo], [key(hi), hi]]), edges: Edge[] = [];
  for (const jamb of input.originalJambs) for (const part of jamb.parts) for (const ring of part) {
    const points = ring.map(local);
    if (points.length > 1 && cmp(points[0][0], points.at(-1)![0]) === 0 && cmp(points[0][1], points.at(-1)![1]) === 0) points.pop();
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (cmp(a[1], b[1]) === 0) continue;
      const min = cmp(a[1], b[1]) < 0 ? a[1] : b[1], max = cmp(a[1], b[1]) < 0 ? b[1] : a[1];
      const m = div(sub(b[0], a[0]), sub(b[1], a[1]));
      edges.push({ id: jamb.nativeElementId, lo: min, hi: max, m, c: sub(a[0], mul(m, a[1])) });
      for (const w of [min, max]) if (cmp(lo, w) < 0 && cmp(w, hi) < 0) events.set(key(w), w);
    }
  }
  // Include every first-contact order change, not merely endpoint samples.
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j], delta = sub(a.m, b.m);
    if (delta.n === 0n) continue;
    const w = div(sub(b.c, a.c), delta);
    if ([lo, a.lo, b.lo].every(q => cmp(q, w) < 0) && [hi, a.hi, b.hi].every(q => cmp(w, q) < 0)) events.set(key(w), w);
  }
  const ordered = [...events.values()].sort(cmp), ids = new Set<number>();
  let threshold: NativeRationalParts = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i], b = ordered[i + 1], mid = div(add(a, b), rational(2));
    const contacts = edges.filter(e => cmp(e.lo, mid) < 0 && cmp(mid, e.hi) < 0).map(e => ({ e, t: add(mul(e.m, mid), e.c) }));
    const left = contacts.filter(c => c.t.n < 0n).sort((a, b) => -cmp(a.t, b.t))[0];
    const right = contacts.filter(c => c.t.n > 0n).sort((a, b) => cmp(a.t, b.t))[0];
    if (!left || !right || left.e.id === right.e.id) return reject("missing-both-first-finite-jamb-contacts");
    const at = (e: Edge, w: Rational) => add(mul(e.m, w), e.c);
    threshold = nativeRationalOverlay("union", threshold, [[[world(at(left.e, a), a), world(at(right.e, a), a), world(at(right.e, b), b), world(at(left.e, b), b)]]]);
    ids.add(left.e.id); ids.add(right.e.id);
  }
  if (!threshold.length) return reject("empty-original-threshold");
  for (const [name, authority] of [["original-floor-or-hole", input.originalFloor], ["original-finite-header", input.originalHeaderSection]] as const) {
    const residual = nativeRationalOverlay("difference", threshold, authority);
    if (residual.length) return reject(`positive-${name}-residual`, residual);
  }
  const foreign = nativeRationalOverlay("intersection", threshold, input.foreignPhysicalMaterial);
  if (foreign.length) return reject("foreign-physical-material-intersection", foreign);
  return { state: "qualified", threshold, originalJambNativeElementIds: [...ids].sort((a, b) => a - b), selectionOnly: true, grantsWalkingOrPortal: false };
}
