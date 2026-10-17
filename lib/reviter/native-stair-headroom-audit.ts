import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as DMath from "./deterministic-math.ts";
import { nativeRationalOverlay, rational, Rational } from "./native-rational-overlay.ts";
import { nativeRationalMeasuredArea } from "./native-exact-planar-topology.ts";
import { nativeSourceInstantiatedElementIds, nativeSourceNonPhysicalElementIds, nativeSourcePlanarComponentEnvelopes, nativeStairMaterialContainerCoverage } from "./native-material-source.ts";
import { reviewedDrawingReferenceElementIds } from "./reviewed-drawing-reference-source.ts";
import { NON_MODEL_CATEGORY_IDS } from "./model-elements.ts";
import type { ConvertResult, Bounds3 } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

type P3 = [number, number, number];
export type StairHeadroomEnvelope = {
  nativeElementId: number;
  boundsFeet: Bounds3;
  /** Every component is an enclosing solid volume, not a clipped face shell. */
  componentBoundsFeet?: Bounds3[];
  categoryUnknown?: boolean;
};

/** Exact closed convex contact, including zero-thickness panels and side
 * contact that a polygon area overlay intentionally does not return. */
function closedConvexContact(a: [number, number][], b: [number, number][]): boolean {
  const first = a.map((p) => p.map(rational)), second = b.map((p) => p.map(rational));
  const sub = (x: Rational, y: Rational) => new Rational(x.n * y.d - y.n * x.d, x.d * y.d);
  const dot = (p: Rational[], axis: Rational[]) => new Rational(
    p[0]!.n * axis[0]!.n * p[1]!.d * axis[1]!.d + p[1]!.n * axis[1]!.n * p[0]!.d * axis[0]!.d,
    p[0]!.d * axis[0]!.d * p[1]!.d * axis[1]!.d);
  const cmp = (x: Rational, y: Rational) => x.n * y.d - y.n * x.d;
  for (const polygon of [first, second]) for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length]!, axis = [sub(p[1]!, q[1]!), sub(q[0]!, p[0]!)];
    if (axis.every((x) => x.n === 0n)) continue;
    const pa = first.map((point) => dot(point, axis)), pb = second.map((point) => dot(point, axis));
    const min = (values: Rational[]) => values.reduce((v, x) => cmp(v, x) < 0n ? v : x), max = (values: Rational[]) => values.reduce((v, x) => cmp(v, x) > 0n ? v : x);
    if (cmp(max(pa), min(pb)) < 0n || cmp(max(pb), min(pa)) < 0n) return false;
  }
  return true;
}

/** A conservative audit of full-height body space above the walking profile.
 * There are NO whole-stair/run/floor ownership exemptions. Bounding positives
 * require exact physical follow-up; a negative is not a complete-source or
 * human-clearance certificate. This intentionally stays outside admission. */
export function auditStairHeadroomEnvelopeCensus(pointsFeet: readonly P3[], census: readonly StairHeadroomEnvelope[], clearanceHeightFeet: number) {
  if (pointsFeet.length < 2 || pointsFeet.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
    !Number.isFinite(clearanceHeightFeet) || clearanceHeightFeet <= 0 || clearanceHeightFeet > 30)
    throw Error("Invalid walking path or explicit headroom height");
  const candidates: { segmentIndex: number; nativeElementId: number; componentIndex: number | null; minimumWalkingElevationFeet: number; maximumWalkingElevationFeet: number; obstacleMinimumElevationFeet: number; obstacleMaximumElevationFeet: number; projectedAreaSqFt: number; contactOnly: boolean; categoryUnknown: boolean }[] = [];
  const unboundedSourceElementIds = new Set<number>();
  const validBounds = (box: Bounds3) => box && box.min && box.max && (["x", "y", "z"] as const).every((axis) =>
    Number.isFinite(box.min[axis]) && Number.isFinite(box.max[axis]) && box.min[axis] <= box.max[axis]);
  for (const [segmentIndex, b] of pointsFeet.slice(1).entries()) {
    const a = pointsFeet[segmentIndex]!, dx = b[0] - a[0], dy = b[1] - a[1], length = DMath.hypot(dx, dy);
    if (length < 1e-8) throw Error("Unsupported zero-plan-length walking segment");
    const nx = -dy / length, ny = dx / length;
    const strip: [number, number][][][] = [[[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]]];
    const stripPoints = strip[0]![0]!, minX = Math.min(...stripPoints.map((p) => p[0])), maxX = Math.max(...stripPoints.map((p) => p[0])),
      minY = Math.min(...stripPoints.map((p) => p[1])), maxY = Math.max(...stripPoints.map((p) => p[1]));
    const low = Math.min(a[2], b[2]), high = Math.max(a[2], b[2]) + clearanceHeightFeet;
    for (const body of census) {
      if (!validBounds(body.boundsFeet) || (body.componentBoundsFeet !== undefined && (!body.componentBoundsFeet.length || body.componentBoundsFeet.some((box) => !validBounds(box))))) {
        unboundedSourceElementIds.add(body.nativeElementId); continue;
      }
      const boxes = body.componentBoundsFeet ?? [body.boundsFeet];
      for (const [index, box] of boxes.entries()) {
        // Material wholly below the feet is support. Every positive rise above
        // the lower foot height remains, including a two-inch raised panel.
        // A sloped walking segment can therefore produce under-foot candidates;
        // resolving those requires exact original walking/body correspondence.
        if (box.max.z <= low || box.min.z > high || box.max.x < minX || box.min.x > maxX || box.max.y < minY || box.min.y > maxY) continue;
        const projected: [number, number][][][] = [[[[box.min.x, box.min.y], [box.max.x, box.min.y], [box.max.x, box.max.y], [box.min.x, box.max.y]]]];
        const overlap = box.min.x < box.max.x && box.min.y < box.max.y ? nativeRationalOverlay("intersection", strip, projected) : [];
        if (!overlap.length && !closedConvexContact(strip[0]![0]!, projected[0]![0]!)) continue;
        candidates.push({ segmentIndex, nativeElementId: body.nativeElementId, componentIndex: body.componentBoundsFeet ? index : null,
          minimumWalkingElevationFeet: low, maximumWalkingElevationFeet: Math.max(a[2], b[2]),
          obstacleMinimumElevationFeet: box.min.z, obstacleMaximumElevationFeet: box.max.z,
          projectedAreaSqFt: nativeRationalMeasuredArea(overlap), contactOnly: !overlap.length, categoryUnknown: body.categoryUnknown === true });
      }
    }
  }
  return { clearanceHeightFeet, widthFeet: 2 as const, candidates,
    candidateNativeElementIds: [...new Set(candidates.map((c) => c.nativeElementId))].sort((a, b) => a - b),
    unboundedSourceElementIds: [...unboundedSourceElementIds].sort((a, b) => a - b),
    headroomApproved: false as const, sourceCompletenessApproved: false as const, routeApproved: false as const };
}

/** Reuse only independently checked original nonphysical and drawing roles.
 * Unknown original categories stay physical/unknown; sparse rendered meshes
 * cannot remove material. Complete original component envelopes may refine a
 * standalone source definition, with all carrier/parent records still kept. */
export function prepareNativeStairHeadroomAudit(model: ConvertResult, data: IndoorDataset,
  receipt: { nativeStairId: number; nativeRunIds: number[]; nativeFloorElementIds: [number, number]; pointsFeet: P3[] }, clearanceHeightFeet: number) {
  const excluded = nativeSourceNonPhysicalElementIds(model, data.source.modelSha256);
  for (const id of reviewedDrawingReferenceElementIds(model, data.reviewedDrawingReferences, data.source.modelSha256)) excluded.add(id);
  const instantiated = nativeSourceInstantiatedElementIds(model, data.source.modelSha256), components = nativeSourcePlanarComponentEnvelopes(model, data.source.modelSha256);
  const retained = model.elementBounds.filter((r) => r.elementId > 0 && !excluded.has(r.elementId) &&
    (!NON_MODEL_CATEGORY_IDS.has(r.categoryId ?? 0) || instantiated.has(r.elementId)));
  const pathBox = { min: { x: Math.min(...receipt.pointsFeet.map((p) => p[0])) - 1, y: Math.min(...receipt.pointsFeet.map((p) => p[1])) - 1, z: Math.min(...receipt.pointsFeet.map((p) => p[2])) },
    max: { x: Math.max(...receipt.pointsFeet.map((p) => p[0])) + 1, y: Math.max(...receipt.pointsFeet.map((p) => p[1])) + 1, z: Math.max(...receipt.pointsFeet.map((p) => p[2])) + clearanceHeightFeet } };
  const decomposed = new Map<number, number[]>(), requiredCarriers = new Set<number>(), retainedIds = new Set(retained.map((r) => r.elementId));
  for (const record of retained) {
    if (record.categoryId !== -2000120 || record.boundsFeet.max.x < pathBox.min.x || record.boundsFeet.min.x > pathBox.max.x ||
      record.boundsFeet.max.y < pathBox.min.y || record.boundsFeet.min.y > pathBox.max.y ||
      record.boundsFeet.max.z <= pathBox.min.z || record.boundsFeet.min.z > pathBox.max.z) continue;
    const coverage = nativeStairMaterialContainerCoverage(model, record.elementId, data.source.modelSha256);
    if (!coverage || coverage.childElementIds.some((id) => !excluded.has(id) && !retainedIds.has(id)) ||
      coverage.requiredCarrierBounds.some((p) => !retained.some((r) => r.elementId === p.carrierElementId && JSON.stringify(r.boundsFeet) === JSON.stringify(p.boundsFeet)))) continue;
    decomposed.set(record.elementId, coverage.childElementIds);
    for (const carrier of coverage.requiredCarrierBounds) requiredCarriers.add(carrier.carrierElementId);
  }
  for (const id of requiredCarriers) decomposed.delete(id);
  const census = retained.filter((r) => !decomposed.has(r.elementId)).map((r) => ({nativeElementId: r.elementId,
    boundsFeet: r.boundsFeet, componentBoundsFeet: requiredCarriers.has(r.elementId) ? undefined : components.get(r.elementId), categoryUnknown: r.categoryId === undefined}));
  const report = auditStairHeadroomEnvelopeCensus(receipt.pointsFeet, census, clearanceHeightFeet);
  const owned = new Set([receipt.nativeStairId, ...receipt.nativeRunIds, ...receipt.nativeFloorElementIds]);
  // Ownership is explanatory grouping only: every grouped record stays in
  // the same obstacle census, including original descendants and definitions.
  for (let depth = 0; depth < 64; depth++) {
    const previousSize = owned.size;
    for (const r of model.elementOwnership?.records ?? []) if (r.owningElementId !== null && owned.has(r.owningElementId)) owned.add(r.elementId);
    for (const r of model.elementBounds) if (owned.has(r.elementId) && r.familySymbolId) owned.add(r.familySymbolId);
    if (owned.size === previousSize) break;
  }
  return { version: 1 as const, diagnosticOnly: true as const, sourceModelSha256: data.source.modelSha256,
    nativeStairId: receipt.nativeStairId, ...report, sourceRecordCount: census.length,
    ownStairRunAndTerminalFloorCandidates: report.candidates.filter((c) => owned.has(c.nativeElementId)),
    originalContainersDelegatedToAllRetainedChildren: [...decomposed].sort(([a], [b]) => a - b),
    noWholeStairOrRunOrTerminalSlabExemption: true as const,
    evidenceSha256: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([data.source.modelSha256,
      model.nativeMaterialSource?.geometrySha256 ?? null, data.reviewedDrawingReferences ?? null, receipt.pointsFeet, clearanceHeightFeet, census])))) };
}
