/** Exact support of one stated connected demand, from complete original cap
 * boundary operands. Global reference-ring approval is a separate predicate.
 * No native loop, hole, coordinate or uncertainty operand is repaired. */
import {
  inspectOriginalNamedFloorCapBoundaryOperands,
  validateOriginalNamedCapReference,
  type OriginalLocalFloorCapEnvelope,
} from "./native-source-floor-local-support.ts";
import { exactClosedSourcePlanarContact } from "./native-source-planar-slab-envelope.ts";
import {
  Rational,
  type NativeRationalParts,
  type NativeRationalPoint,
} from "./native-rational-overlay.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const orient = (
  a: NativeRationalPoint,
  b: NativeRationalPoint,
  p: NativeRationalPoint,
) =>
  sub(
    mul(sub(b[0], a[0]), sub(p[1], a[1])),
    mul(sub(b[1], a[1]), sub(p[0], a[0])),
  ).n;
/** Exact winding is defined away from the complete closed source boundary,
 * including when a reference self-crossing exists somewhere else. The caller
 * first proves the ENTIRE connected demand avoids all boundary uncertainty. */
function winding(p: NativeRationalPoint, ring: NativeRationalPoint[]) {
  let w = 0;
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!;
    if (cmp(a[1], p[1]) <= 0) {
      if (cmp(b[1], p[1]) > 0 && orient(a, b, p) > 0n) w++;
    } else if (cmp(b[1], p[1]) <= 0 && orient(a, b, p) < 0n) w--;
  }
  return w;
}
/** For each original loop, winding is constant over a connected demand that
 * avoids every possible source edge/twin/curve/join. Winding ±1 in the outer
 * loop and0 in EVERY original hole therefore establishes this bounded patch
 * for the entire preserved embedding family. A distant reference crossing
 * cannot be snapped, unioned or discarded to gain support elsewhere. */
export function inspectOriginalNamedFloorCapDemand(
  replay: Revit2027GRepReplay,
  faceToken: number,
  demand: NativeRationalParts,
) {
  return inspectOriginalFloorCapBoundaryDemand(
    inspectOriginalNamedFloorCapBoundaryOperands(replay, faceToken),
    demand,
  );
}

/** Pure scoped winding/uncertainty predicate. Caller operands grant no source
 * authority. The actual-RVT wrapper below always obtains them independently. */
export function inspectOriginalFloorCapBoundaryDemand(
  cap: OriginalLocalFloorCapEnvelope,
  demand: NativeRationalParts,
) {
  if (demand.length !== 1 || demand[0]!.length !== 1)
    throw Error(
      "Scoped original cap demand must be one connected simple hole-free footprint",
    );
  validateOriginalNamedCapReference(demand);
  const boundaryContact = exactClosedSourcePlanarContact(
    demand,
    cap.retainedPositiveBoundaryUncertaintyPartsFeet,
    cap.retainedZeroAreaBoundarySegmentsFeet,
  );
  const representative = demand[0]![0]![0]!,
    sourceLoopWindings = cap.originalReferenceWindingPartsFeet[0]!.map((r) =>
      winding(representative, r),
    );
  const windingQualified =
    Math.abs(sourceLoopWindings[0] ?? 0) === 1 &&
    sourceLoopWindings.slice(1).every((w) => w === 0);
  return {
    nativeFloorElementId: cap.nativeFloorElementId,
    originalCapFaceToken: cap.originalFaceToken,
    originalPhysicalTopElevationFeet: cap.originalPhysicalTopElevationFeet,
    originalCapLoopTokens: cap.originalCapLoopTokens,
    originalCapEdgeTokens: cap.originalCapEdgeTokens,
    originalChainEnvelopeLoops: cap.originalChainEnvelopeLoops,
    retainedOriginalHoleCount: cap.originalCapLoopTokens.length - 1,
    sourceLoopWindings,
    completeBoundaryUncertaintyContact: boundaryContact,
    scopedDemandFeet: demand,
    completeConnectedDemandSupported: !boundaryContact && windingQualified,
    coordinatesChanged: false as const,
    originalLoopsOrHolesChanged: false as const,
    globalReferenceWindingApproved: false as const,
    wholeFloorSolidApproved: false as const,
    originalSourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}

import {
  readOriginalForeignEnvelopeScopedFloor,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
/** Actual original Floor/category/schema and complete saved cap bytes come
 * only from the private RVT census. Saved JSON cannot restore this capability. */
export function inspectOriginalNativeFloorCapDemand(
  census: OriginalNativeForeignEnvelopeCensus,
  nativeFloorElementId: number,
  originalCapFaceToken: number,
  demand: NativeRationalParts,
) {
  const source = readOriginalForeignEnvelopeScopedFloor(
      census,
      nativeFloorElementId,
    ),
    bytes = source.originalGElementFrameBytes,
    schema = readSchema(source.originalSourceSchemaBytes);
  if (!schema.ok) throw Error(schema.error);
  const semantic = inspectOriginalElementLevelPrefix(
    source.originalFloorFrameBytes,
    schema.schema,
    "Floor",
  );
  if (semantic.nativeElementId !== nativeFloorElementId)
    throw Error("Original scoped Floor owner differs");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    root = decodeRevit2027FramedGRepRoot(
      bytes,
      {
        offset: 0,
        elementId: nativeFloorElementId,
        marker: 2246,
        objectLength: v.getUint32(12, true),
        typeCode: v.getUint32(18, true),
      },
      2027,
    );
  if (!root.ok) throw Error(root.error);
  const replay = replayRevit2027GRepFifo(bytes, root.value);
  if (!replay.ok) throw Error(replay.error);
  if (
    replay.value.ownerElementId !== BigInt(nativeFloorElementId) ||
    replay.value.endOffset !== root.value.dynamicPayloadEndOffset
  )
    throw Error("Unconsumed or foreign original Floor geometry");
  return {
    ...inspectOriginalNamedFloorCapDemand(
      replay.value,
      originalCapFaceToken,
      demand,
    ),
    sourceModelSha256: source.sourceModelSha256,
    sourceSchemaSha256: source.sourceSchemaSha256,
    sourceCensusSha256: census.sourceCensusSha256,
    originalFloorFrameSha256: source.originalFloorFrameSha256,
    originalGElementFrameSha256: source.originalGElementFrameSha256,
    sourceBoundOriginalOperands: true as const,
  };
}
