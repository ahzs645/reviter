import type { OriginalNativeStairRiserPartition } from "./native-source-stair-riser-partition.ts";
import { originalNativeStairRunReferencePlane } from "./native-source-stair-reference-plane.ts";
/** A bounded original floor attachment, distinct from whole reference-ring
 * admission. The complete connected walking footprint is proved against EVERY
 * original cap boundary, hole and retained embedding uncertainty. No native
 * loop, nominal terminal, served level or global support gate is changed. */
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import {
  readOriginalForeignEnvelopeScopedFloor,
  readOriginalForeignEnvelopeScopedSemantic,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import { inspectOriginalNativeFloorCapDemand } from "./native-source-floor-cap-demand.ts";
import {
  nativeConservativeTwoFootStation,
  nativeConservativeTwoFootStrip,
  nativeSegmentInExactParts,
  nativeStairStationLateralDirection,
  type NativeStairStationLateral,
} from "./native-source-stair-stepped-stations.ts";
import {
  Rational,
  rational,
  nativeRationalOverlay,
  type NativeRationalPoint,
  type NativeRationalParts,
} from "./native-rational-overlay.ts";
import type { OriginalLogicalFloorAttachmentDemand } from "./native-source-stair-floor-attachment.ts";
import { originalTwoFootStandingSquare } from "./native-source-standing-footprint.ts";
const sourceId = (v: unknown) =>
  (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
const same = (a: Rational, b: Rational) => a.n * b.d === b.n * a.d;
const subtract = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a: Rational, b: Rational) =>
  new Rational(a.n * b.n, a.d * b.d);
const compare = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
function hull(points: NativeRationalPoint[]): NativeRationalPoint[] {
  const key = (p: NativeRationalPoint) =>
    p.map((q) => `${q.n}/${q.d}`).join(":");
  const ordered = [...new Map(points.map((p) => [key(p), p])).values()].sort(
    (a, b) => compare(a[0], b[0]) || compare(a[1], b[1]),
  );
  const turn = (
    a: NativeRationalPoint,
    b: NativeRationalPoint,
    c: NativeRationalPoint,
  ) =>
    subtract(
      multiply(subtract(b[0], a[0]), subtract(c[1], a[1])),
      multiply(subtract(b[1], a[1]), subtract(c[0], a[0])),
    );
  const half = (input: NativeRationalPoint[]) => {
    const out: NativeRationalPoint[] = [];
    for (const p of input) {
      while (out.length > 1 && turn(out.at(-2)!, out.at(-1)!, p).n <= 0n)
        out.pop();
      out.push(p);
    }
    return out;
  };
  return [
    ...half(ordered).slice(0, -1),
    ...half([...ordered].reverse()).slice(0, -1),
  ];
}
/** Exact conservative support demand used by the physical kernel: standing
 * squares at original/turn points, complete two-foot strips, and the terminal
 * transverse line. Only the final strip is enlarged to enclose that line.
 * This neither fills a source floor hole nor claims a full floor winding. */
export function originalStairTerminalWalkingFootprint(
  approachXYFeet: readonly (readonly [number, number])[],
  orientation: NativeStairStationLateral,
): NativeRationalParts {
  if (
    !Array.isArray(approachXYFeet) ||
    approachXYFeet.length < 2 ||
    approachXYFeet.length > 1000 ||
    approachXYFeet.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        ![0, 1].every((i) => Number.isFinite(p[i])),
    )
  )
    throw new Error("Malformed original terminal walking footprint request");
  const points = approachXYFeet.map(
      (p) => p.map(rational) as NativeRationalPoint,
    ),
    parts = points.slice(0, -1).map(originalTwoFootStandingSquare),
    lateral = nativeConservativeTwoFootStation(
      points.at(-1)!,
      nativeStairStationLateralDirection(orientation),
    );
  for (let i = 1; i < points.length; i++) {
    const strip = nativeConservativeTwoFootStrip(points[i - 1]!, points[i]!);
    if (!strip.length)
      throw new Error("Repeated original terminal approach point");
    parts.push(
      i === points.length - 1
        ? [[hull([...strip.flat(2), ...lateral])]]
        : strip,
    );
  }
  const result = nativeRationalOverlay("union", parts[0]!, ...parts.slice(1));
  if (result.length !== 1 || result[0]!.length !== 1)
    throw new Error(
      "Terminal support demand is not one connected hole-free footprint",
    );
  return result;
}
/** Only a genuine current original census and stair handle can enter this
 * constructor. A proposal supplies a demand, never its own cap/body geometry. */
export function inspectOriginalNativeStairScopedFloorAttachment(
  foreign: OriginalNativeForeignEnvelopeCensus,
  stair: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  demand: OriginalLogicalFloorAttachmentDemand,
  completeConnectedWalkingFootprintFeet: NativeRationalParts,
  partition?: OriginalNativeStairRiserPartition,
) {
  if (
    !demand.originalLogicalGraphNodeId ||
    !Array.isArray(demand.originalLogicalPointFeet) ||
    demand.originalLogicalPointFeet.length !== 3 ||
    ![0, 1, 2].every((i) => Number.isFinite(demand.originalLogicalPointFeet[i]))
  )
    throw Error("Invalid unchanged original scoped floor attachment demand");
  const physical = readOriginalNativeStairPhysicalSource(stair, nativeRunId);
  if (
    physical.sourceModelSha256 !== foreign.sourceModelSha256 ||
    physical.sourceSchemaSha256 !== foreign.sourceSchemaSha256
  )
    throw Error("Original scoped stair/floor source identity differs");
  const parent = readOriginalForeignEnvelopeScopedSemantic(
      foreign,
      physical.nativeStairId,
      4075,
    ),
    floor = readOriginalForeignEnvelopeScopedFloor(
      foreign,
      demand.nativeFloorElementId,
    ),
    schema = readSchema(parent.originalSourceSchemaBytes);
  if (
    !schema.ok ||
    parent.sourceSchemaSha256 !== physical.sourceSchemaSha256 ||
    floor.sourceSchemaSha256 !== physical.sourceSchemaSha256
  )
    throw Error("Original scoped attachment schema differs");
  const ancestry = inspectOriginalElementLevelPrefix(
      parent.originalFrameBytes,
      schema.schema,
      "StairsElement",
    ),
    floorSemantic = inspectOriginalElementLevelPrefix(
      floor.originalFloorFrameBytes,
      schema.schema,
      "Floor",
    );
  if (
    ancestry.nativeElementId !== physical.nativeStairId ||
    !ancestry.stair ||
    floorSemantic.nativeElementId !== demand.nativeFloorElementId ||
    sourceId(physical.run.root.m_stairsId) !== physical.nativeStairId ||
    sourceId(physical.symbol.root.m_hostId) !== nativeRunId
  )
    throw Error(
      "Original scoped floor/stair/run/definition ownership chain differs",
    );
  const nativeServedLevelId =
      demand.runTerminal === "lower"
        ? ancestry.stair.originalBaseLevelId
        : ancestry.stair.originalTopLevelId,
    offset =
      demand.runTerminal === "lower"
        ? ancestry.stair.originalBaseLevelOffsetFeet
        : ancestry.stair.originalTopLevelOffsetFeet,
    runReference = originalNativeStairRunReferencePlane(
      physical,
      demand.runTerminal,
      partition,
    ),
    nominal = runReference.heightFeet;
  if (
    typeof offset !== "number" ||
    !Number.isFinite(offset) ||
    typeof nominal !== "number" ||
    !Number.isFinite(nominal)
  )
    throw Error(
      "Original scoped served-level offset or nominal run height is unavailable",
    );
  const cap = inspectOriginalNativeFloorCapDemand(
      foreign,
      demand.nativeFloorElementId,
      demand.originalTrimmedFloorFaceToken,
      completeConnectedWalkingFootprintFeet,
    ),
    line = nativeConservativeTwoFootStation(
      [
        rational(demand.originalLogicalPointFeet[0]),
        rational(demand.originalLogicalPointFeet[1]),
      ],
      nativeStairStationLateralDirection(demand),
    ),
    nominalMatches = same(
      rational(nominal),
      rational(demand.originalLogicalPointFeet[2]),
    ),
    floorLevelMatches =
      nativeServedLevelId > 0 &&
      floorSemantic.nativeAssociatedLevelId === nativeServedLevelId,
    stationWithinDemand = nativeSegmentInExactParts(
      line[0],
      line[1],
      completeConnectedWalkingFootprintFeet,
    );
  const delta = new Rational(
    cap.originalPhysicalTopElevationFeet.n * rational(nominal).d -
      rational(nominal).n * cap.originalPhysicalTopElevationFeet.d,
    cap.originalPhysicalTopElevationFeet.d * rational(nominal).d,
  );
  return {
    kind: "original-native-scoped-logical-floor-attachment" as const,
    version: 1 as const,
    sourceModelSha256: physical.sourceModelSha256,
    sourceSchemaSha256: physical.sourceSchemaSha256,
    sourceCensusSha256: foreign.sourceCensusSha256,
    nativeStairId: physical.nativeStairId,
    nativeRunId,
    nativeFloorElementId: demand.nativeFloorElementId,
    originalCapFaceToken: demand.originalTrimmedFloorFaceToken,
    originalGraphNodeId: demand.originalLogicalGraphNodeId,
    originalLogicalPointFeet: demand.originalLogicalPointFeet.map(rational),
    originalPhysicalAttachmentPointFeet: [
      rational(demand.originalLogicalPointFeet[0]),
      rational(demand.originalLogicalPointFeet[1]),
      cap.originalPhysicalTopElevationFeet,
    ],
    logicalToPhysicalHeightDeltaFeet: delta,
    originalRunReferencePlane: runReference,
    originalNativeServedLevelId: nativeServedLevelId,
    originalServedLevelOffsetFeet: rational(offset),
    zeroOriginalServedLevelOffset: offset === 0,
    unchangedLogicalHeightMatchesOriginalRunReferencePlane: nominalMatches,
    unchangedLogicalHeightMatchesOriginalNominalRunHeight: same(
      rational(demand.originalLogicalPointFeet[2]),
      rational(runReference.originalRootNominalHeightFeet),
    ),
    floorAndStairNamedLevelAgree: floorLevelMatches,
    fullTwoFootStationWithinDemand: stationWithinDemand,
    originalStairSemanticFrameSha256: parent.originalFrameSha256,
    originalFloorFrameSha256: floor.originalFloorFrameSha256,
    originalGElementFrameSha256: floor.originalGElementFrameSha256,
    originalFloorSemanticPrefix: floorSemantic,
    completeConnectedWalkingFootprintFeet,
    cap,
    completeScopedAttachmentQualified:
      offset === 0 &&
      nominalMatches &&
      floorLevelMatches &&
      stationWithinDemand &&
      cap.completeConnectedDemandSupported,
    globalReferenceWindingApproved: false as const,
    originalGraphCoordinatesChanged: false as const,
    originalSourceAuthorityGranted: false as const,
    routeApproved: false as const,
  };
}
