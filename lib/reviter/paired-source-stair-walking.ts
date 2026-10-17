import * as DMath from "./deterministic-math.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { nativeAuthoredStairTreads, type NativeAuthoredStairTreadRoles } from "./native-authored-stair-treads.ts";
import { nativeRationalPointInParts } from "./native-exact-planar-topology.ts";
import { nativeRationalOverlay, Rational, rational, type NativeRationalParts, type NativeRationalOverlayInput } from "./native-rational-overlay.ts";
import { validatePairedSourceStairBodyV3, type PairedSourceBodyMesh } from "./paired-source-stair-body.ts";
import type { NativeSourceStairReceipt } from "./native-source-stair-width.ts";

type P2 = [number, number];
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const abs = (a: Rational) => new Rational(a.n < 0n ? -a.n : a.n, a.d);
const pair = (a: Rational): [string, string] => [a.n.toString(), a.d.toString()];
function area(parts: NativeRationalParts): Rational {
  return parts.reduce((total, rings) => add(total, rings.reduce((total, ring, index) => {
    const twice = ring.reduce((total, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return add(total, sub(mul(p[0], q[1]), mul(p[1], q[0])));
    }, new Rational(0n));
    const positive = abs(new Rational(twice.n, twice.d * 2n));
    return index ? sub(total, positive) : add(total, positive);
  }, new Rational(0n))), new Rational(0n));
}

export type PairedSourceHorizontalCoverage = {
  covered: boolean;
  requiredAreaSquareFeet: [string, string];
  missingAreaSquareFeet: [string, string];
  exactHeightUpwardTriangleCount: number;
  nearestUpwardHeightDifferenceFeet?: [string, string];
};

/** Mathematical predicate only, NOT source authority. The caller must first
 * independently bind a complete original body. All source binary64 values are
 * interpreted as exact rationals. No plane/height tolerance, snap, buffer,
 * rounding or small-component deletion is used. Holes remain in the operand.
 * Upward faces of individual additive operands do not prove exposed walking
 * surfaces or body/headroom clearance; those remain separate requirements. */
export function pairedSourceHorizontalCoverage(
  mesh: PairedSourceBodyMesh,
  elevationFeet: number,
  requiredParts: NativeRationalOverlayInput,
): PairedSourceHorizontalCoverage | undefined {
  try {
    const p = mesh.positionsFeet, ix = mesh.indices;
    if (!Number.isFinite(elevationFeet) || !Array.isArray(p) || p.length % 3 || p.length > 3_000_000 ||
      !Array.isArray(ix) || ix.length % 3 || ix.length > 3_000_000 || p.some((n) => !Number.isFinite(n)) ||
      ix.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= p.length / 3)) return;
    const required = nativeRationalOverlay("union", requiredParts), requiredArea = area(required);
    if (requiredArea.n <= 0n) return;
    const parts: NativeRationalOverlayInput = [];
    let nearest: Rational | undefined;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix.slice(i, i + 3).map((j) => p.slice(j * 3, j * 3 + 3));
      if (t[0]![2] !== t[1]![2] || t[0]![2] !== t[2]![2]) continue;
      const [a, b, c] = t.map((q) => q.map(rational));
      const orientation = sub(mul(sub(b![0]!, a![0]!), sub(c![1]!, a![1]!)), mul(sub(b![1]!, a![1]!), sub(c![0]!, a![0]!)));
      if (orientation.n <= 0n) continue;
      const delta = sub(a![2]!, rational(elevationFeet));
      if (!nearest || abs(delta).n * nearest.d < abs(nearest).n * delta.d) nearest = delta;
      if (delta.n === 0n) parts.push([t.map((q) => [q[0]!, q[1]!] as P2)]);
    }
    const missing = parts.length ? nativeRationalOverlay("difference", required, nativeRationalOverlay("union", parts)) : required;
    return { covered: missing.length === 0, requiredAreaSquareFeet: pair(requiredArea), missingAreaSquareFeet: pair(area(missing)),
      exactHeightUpwardTriangleCount: parts.length, ...(nearest ? { nearestUpwardHeightDifferenceFeet: pair(nearest) } : {}) };
  } catch { return; }
}

function sameRing(a: P2[], b: P2[]): boolean {
  return a.length === b.length && a.length > 2 && a.some((_, offset) => [1, -1].some((direction) => a.every((p, i) => {
    const q = b[(offset + direction * i + b.length * 2) % b.length]!;
    return p[0] === q[0] && p[1] === q[1];
  })));
}
/** Derived demand, never a replacement for original source geometry. Refuse
 * any corner with a lateral offset less than one foot from the exact path
 * line. This is a patch demand, not a full path/cap continuity certificate. */
function strip(a: number[], b: number[]): NativeRationalOverlayInput | undefined {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, length = DMath.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return;
  const nx = -dy / length, ny = dx / length;
  const ring: P2[] = [[a[0]! + nx, a[1]! + ny], [b[0]! + nx, b[1]! + ny], [b[0]! - nx, b[1]! - ny], [a[0]! - nx, a[1]! - ny]];
  const direction = [sub(rational(b[0]!), rational(a[0]!)), sub(rational(b[1]!), rational(a[1]!))];
  const lengthSquared = add(mul(direction[0]!, direction[0]!), mul(direction[1]!, direction[1]!));
  if (ring.some((p, i) => {
    const offset = [sub(rational(p[0]), rational(a[0]!)), sub(rational(p[1]), rational(a[1]!))];
    const cross = sub(mul(direction[0]!, offset[1]!), mul(direction[1]!, offset[0]!));
    const square = mul(cross, cross);
    return (i < 2 ? cross.n <= 0n : cross.n >= 0n) || square.n * lengthSquared.d < lengthSquared.n * square.d;
  })) return;
  return [[ring]];
}

type BodyParameters = Parameters<typeof validatePairedSourceStairBodyV3>;
export type PairedSourceStairWalkingInput = {
  originalIfcContext: BodyParameters[0];
  /** Trusted frozen producer hashes, supplied independently of these bytes. */
  originalBodies: { bytes: Uint8Array; expectedOriginalExtractionSha256: string }[];
  originalNativeRoleBytes: Uint8Array;
  expectedOriginalNativeRolesSha256: string;
  originalModel: BodyParameters[3];
  sourceModelSha256: string;
  nativeStairId: number;
  originalDocument: BodyParameters[6];
  receipt: NativeSourceStairReceipt;
};
export type PairedSourceStairWalkingReport = {
  sourceModelSha256: string;
  nativeStairId: number;
  originalNativeRolesSha256: string;
  originalBodyExtractionSha256s: string[];
  preparedTreadInventoryMatchesOriginal: boolean;
  requiredTreadPatchesCovered: boolean;
  treads: { nativeRunId: number; typedIndex: number; elevationFeet: number; result?: PairedSourceHorizontalCoverage; blocker?: string }[];
  blockers: string[];
  /** This seam is a prerequisite, not a full walking-body or route authority. */
  terminalSupportApproved: false;
  riserAndLandingContinuityApproved: false;
  ownBodyClearanceApproved: false;
  originalNativeWalkingCorrespondenceApproved: false;
  routeApproved: false;
};

/** Bind independent original native authored roles and immutable paired source
 * operands before checking the actually demanded interior tread patches. The
 * independently reviewed extraction digests are REQUIRED TRUSTED INPUTS; the
 * supplied bytes must never be used to manufacture their own expected hashes.
 * This does not re-execute either original numerical source producer, certify
 * terminal cut floors, borrow receipt landings/supports, or approve a route.
 * Exact native/IFC discrepancies remain blockers even when one binary64 ULP. */
export function inspectPairedSourceStairWalking(input: PairedSourceStairWalkingInput): PairedSourceStairWalkingReport {
  const report: PairedSourceStairWalkingReport = {
    sourceModelSha256: input.sourceModelSha256, nativeStairId: input.nativeStairId,
    originalNativeRolesSha256: input.expectedOriginalNativeRolesSha256, originalBodyExtractionSha256s: [],
    preparedTreadInventoryMatchesOriginal: false, requiredTreadPatchesCovered: false, treads: [], blockers: [],
    terminalSupportApproved: false, riserAndLandingContinuityApproved: false, ownBodyClearanceApproved: false,
    originalNativeWalkingCorrespondenceApproved: false, routeApproved: false,
  };
  try {
    const bytes = Uint8Array.from(input.originalNativeRoleBytes);
    if (!hash(input.expectedOriginalNativeRolesSha256) || digest(bytes) !== input.expectedOriginalNativeRolesSha256) throw Error("Native roles do not match their independently frozen original producer digest");
    const roles = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as NativeAuthoredStairTreadRoles;
    const originals = nativeAuthoredStairTreads(roles, input.sourceModelSha256);
    const r = input.receipt;
    if (r.version !== 1 || r.widthFeet !== 2 || r.sourceModelSha256 !== input.sourceModelSha256 || r.nativeStairId !== input.nativeStairId ||
      !r.nativeRunIds.length || new Set(r.nativeRunIds).size !== r.nativeRunIds.length || !Array.isArray(r.pointsFeet) || r.pointsFeet.length < 4 || r.pointsFeet.length > 10000 ||
      r.pointsFeet.some((p) => p.length !== 3 || p.some((n) => !Number.isFinite(n))) ||
      roles.runs.filter((run) => r.nativeRunIds.includes(run.nativeRunId)).some((run) => run.nativeStairId !== input.nativeStairId) ||
      r.nativeRunIds.some((id) => !originals.has(id))) throw Error("Prepared flight lacks the independently bound original owned run inventory");
    const unmatched = r.nativeRunIds.flatMap((id) => originals.get(id)!);
    for (const tread of r.treads) {
      const index = unmatched.findIndex((o) => o.runElementId === tread.runElementId && o.elevationFeet === tread.elevationFeet && sameRing(o.ringFeet, tread.ringFeet));
      if (index < 0) throw Error("Prepared tread drift or duplication differs from the exact original native multiset");
      unmatched.splice(index, 1);
    }
    if (unmatched.length) throw Error("Prepared flight omits an original native walking tread");
    report.preparedTreadInventoryMatchesOriginal = true;
    const bodies = new Map<number, PairedSourceBodyMesh>();
    for (const original of input.originalBodies) {
      const snapshot = Uint8Array.from(original.bytes);
      const result = validatePairedSourceStairBodyV3(input.originalIfcContext, snapshot, original.expectedOriginalExtractionSha256,
        input.originalModel, input.sourceModelSha256, input.nativeStairId, input.originalDocument);
      if (!result.ok) throw Error(result.reason);
      const id = result.certificate.nativeElementId;
      if (bodies.has(id)) throw Error("Duplicate original source body occurrence");
      const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot)) as { mesh: PairedSourceBodyMesh };
      bodies.set(id, data.mesh); report.originalBodyExtractionSha256s.push(original.expectedOriginalExtractionSha256);
    }
    const strips = r.pointsFeet.slice(1).map((b, i) => strip(r.pointsFeet[i]!, b));
    if (strips.some((p) => !p)) throw Error("Demand strip has an unsupported direction or an exactly sub-two-foot binary64 width");
    for (const id of r.nativeRunIds) for (const [typedIndex, tread] of originals.get(id)!.entries()) {
      const row: PairedSourceStairWalkingReport["treads"][number] = { nativeRunId: id, typedIndex, elevationFeet: tread.elevationFeet };
      report.treads.push(row);
      const mesh = bodies.get(id);
      if (!mesh) { row.blocker = "Missing independently verified original physical source body"; continue; }
      const demands = strips.flatMap((parts, i) => {
        const a = r.pointsFeet[i]!, b = r.pointsFeet[i + 1]!;
        return tread.elevationFeet >= Math.min(a[2], b[2]) && tread.elevationFeet <= Math.max(a[2], b[2]) ? [parts!] : [];
      });
      if (!demands.length || !r.pointsFeet.some((p) => p[2] === tread.elevationFeet && nativeRationalPointInParts([p[0], p[1]], nativeRationalOverlay("union", [[tread.ringFeet]])))) { row.blocker = "Original tread has no exact-height path visit on its original face"; continue; }
      const demand = nativeRationalOverlay("intersection", [[tread.ringFeet]], nativeRationalOverlay("union", demands[0]!, ...demands.slice(1)));
      row.result = pairedSourceHorizontalCoverage(mesh, tread.elevationFeet, demand);
      if (!row.result) row.blocker = "No positive exact original tread demand or unsupported source geometry";
      else if (!row.result.covered) row.blocker = row.result.exactHeightUpwardTriangleCount ? "Positive exact demanded area lacks original source support" : "Original source has no upward physical face at the exact native walking elevation";
    }
    report.requiredTreadPatchesCovered = report.treads.length > 0 && report.treads.every((row) => row.result?.covered === true && !row.blocker);
    if (!report.requiredTreadPatchesCovered) report.blockers.push("Independent original physical body does not exactly cover every demanded native tread patch");
    report.blockers.push("Original cut-floor terminal support, riser/landing continuity, own-body clearance, foreign material, access and actual navigation remain independent and unapproved");
  } catch (error) { report.blockers.push(String(error)); }
  return report;
}
