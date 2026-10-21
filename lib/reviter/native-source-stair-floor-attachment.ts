import type { OriginalNativeStairRiserPartition } from "./native-source-stair-riser-partition.ts";
import { originalNativeStairRunReferencePlane } from "./native-source-stair-reference-plane.ts";
/** Unwired v2 attachment proposal. A graph's logical served-level coordinate
 * is preserved. Its distinct physical support point is bound to an actual
 * source-trimmed named floor face at exactly the same XY. This is neither an
 * epsilon equality nor a newly added walking segment through floor material. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readSchema } from "./schema-reader.ts";
import { inspectOriginalElementLevelPrefix } from "./native-source-element-level-prefix.ts";
import {
  readOriginalForeignEnvelopeScopedSemantic,
  type OriginalNativeForeignEnvelopeCensus,
} from "./native-source-foreign-envelope-census.ts";
import {
  readOriginalNativeStairPhysicalSource,
  type OriginalNativeStairPhysicalContext,
} from "./native-source-stair-physical-inventory.ts";
import {
  inspectOriginalNativeFloorLocalSupport,
  inspectLocalFloorTwoFootStation,
} from "./native-source-floor-local-support.ts";
import { rational, type Rational } from "./native-rational-overlay.ts";
import {
  nativeStairStationLateralDirection,
  type NativeStairStationLateral,
} from "./native-source-stair-stepped-stations.ts";

export type OriginalLogicalFloorAttachmentDemand = {
  originalLogicalGraphNodeId: string;
  originalLogicalPointFeet: readonly [number, number, number];
  nativeFloorElementId: number;
  originalTrimmedFloorFaceToken: number;
  runTerminal: "lower" | "upper";
} & NativeStairStationLateral;
const same = (a: Rational, b: Rational) => a.n * b.d === b.n * a.d;
const sourceId = (v: unknown) =>
  (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
export function inspectOriginalNativeStairFloorAttachment(
  foreignSource: OriginalNativeForeignEnvelopeCensus,
  stairSource: OriginalNativeStairPhysicalContext,
  nativeRunId: number,
  demand: OriginalLogicalFloorAttachmentDemand,
  partition?: OriginalNativeStairRiserPartition,
) {
  if (
    !demand.originalLogicalGraphNodeId ||
    demand.originalLogicalPointFeet.length !== 3 ||
    demand.originalLogicalPointFeet.some((v) => !Number.isFinite(v))
  )
    throw Error("Invalid original logical graph attachment demand");
  const physical = readOriginalNativeStairPhysicalSource(
    stairSource,
    nativeRunId,
  );
  if (
    physical.sourceModelSha256 !== foreignSource.sourceModelSha256 ||
    physical.sourceSchemaSha256 !== foreignSource.sourceSchemaSha256
  )
    throw Error("Stair and floor original source authority differ");
  const parent = readOriginalForeignEnvelopeScopedSemantic(
      foreignSource,
      physical.nativeStairId,
      4075,
    ),
    schema = readSchema(parent.originalSourceSchemaBytes);
  if (
    !schema.ok ||
    bytesToHex(sha256(parent.originalSourceSchemaBytes)) !==
      physical.sourceSchemaSha256
  )
    throw Error("Original stair attachment schema mismatch");
  const ancestry = inspectOriginalElementLevelPrefix(
    parent.originalFrameBytes,
    schema.schema,
    "StairsElement",
  );
  if (
    ancestry.nativeElementId !== physical.nativeStairId ||
    !ancestry.stair ||
    sourceId(physical.run.root.m_stairsId) !== physical.nativeStairId ||
    sourceId(physical.symbol.root.m_hostId) !== nativeRunId
  )
    throw Error(
      "Original run/symbol explicit ownership chain differs from parent stair",
    );
  const cap = inspectOriginalNativeFloorLocalSupport(
      foreignSource,
      demand.nativeFloorElementId,
      demand.originalTrimmedFloorFaceToken,
    ),
    expectedNativeLevelId =
      demand.runTerminal === "lower"
        ? ancestry.stair.originalBaseLevelId
        : ancestry.stair.originalTopLevelId;
  const originalServedLevelOffset =
    demand.runTerminal === "lower"
      ? ancestry.stair.originalBaseLevelOffsetFeet
      : ancestry.stair.originalTopLevelOffsetFeet;
  if (
    typeof originalServedLevelOffset !== "number" ||
    !Number.isFinite(originalServedLevelOffset)
  )
    throw Error("Missing original stair served-level offset");
  const support = inspectLocalFloorTwoFootStation(
    cap,
    [demand.originalLogicalPointFeet[0], demand.originalLogicalPointFeet[1]],
    nativeStairStationLateralDirection(demand),
    demand.originalLogicalPointFeet[2],
  );
  const runReference = originalNativeStairRunReferencePlane(
      physical,
      demand.runTerminal,
      partition,
    ),
    originalNominalRunHeight = runReference.heightFeet;
  if (
    typeof originalNominalRunHeight !== "number" ||
    !Number.isFinite(originalNominalRunHeight)
  )
    throw Error("Missing original nominal run terminal height");
  const floorAndStairNamedLevelAgree =
      expectedNativeLevelId > 0 &&
      cap.originalAssociatedNativeLevelId === expectedNativeLevelId,
    unchangedLogicalHeightMatchesOriginalRunReferencePlane = same(
      rational(demand.originalLogicalPointFeet[2]),
      rational(originalNominalRunHeight),
    );
  const originalLogicalPointFeetExact = demand.originalLogicalPointFeet.map(
      rational,
    ) as [Rational, Rational, Rational],
    physicalFootPointFeetExact: [Rational, Rational, Rational] = [
      originalLogicalPointFeetExact[0],
      originalLogicalPointFeetExact[1],
      cap.originalPhysicalTopElevationFeet,
    ];
  return {
    kind: "original-native-logical-floor-attachment" as const,
    version: 2 as const,
    sourceModelSha256: physical.sourceModelSha256,
    sourceSchemaSha256: physical.sourceSchemaSha256,
    sourceCensusSha256: foreignSource.sourceCensusSha256,
    nativeStairId: physical.nativeStairId,
    nativeRunId,
    nativeFloorElementId: demand.nativeFloorElementId,
    runTerminal: demand.runTerminal,
    originalGraphNodeId: demand.originalLogicalGraphNodeId,
    originalLogicalPointFeetExact,
    originalPhysicalFootPointFeetExact: physicalFootPointFeetExact,
    originalNominalRunTerminalHeightFeet: rational(
      runReference.originalRootNominalHeightFeet,
    ),
    originalRunReferenceHeightFeet: rational(originalNominalRunHeight),
    originalRunReferencePlane: runReference,
    originalNativeServedLevelId: expectedNativeLevelId,
    originalServedLevelOffsetFeet: rational(originalServedLevelOffset),
    zeroOriginalServedLevelOffset: originalServedLevelOffset === 0,
    originalRunToStairOwnerField: {
      sourceFieldName: "StairsRun.m_stairsId",
      nativeRunId,
      originalStairOwnerId: physical.nativeStairId,
    },
    originalSymbolToRunHostField: {
      sourceFieldName: "StairsTriserSymbol.m_hostId",
      nativeDefinitionId: physical.nativeDefinitionId,
      originalRunHostId: nativeRunId,
    },
    originalParentRunAndLandingList: ancestry.stair.originalRunsAndLandings,
    originalParentRunAndLandingListIncludesRun:
      ancestry.stair.originalRunsAndLandings.includes(nativeRunId),
    reciprocalParentListMembershipRequired: false as const,
    originalStairSemanticFrameSha256: parent.originalFrameSha256,
    originalStairNamedFieldPrefix: ancestry,
    originalRunAndDefinitionFrameSha256s: physical.sourceFrameSha256s,
    originalFloorFrameSha256: cap.originalFloorFrameSha256,
    originalFloorGElementFrameSha256: cap.originalGElementFrameSha256,
    originalPhysicalFloorFaceToken: cap.originalFaceToken,
    originalFloorSemanticPrefix: cap.originalFloorSemanticPrefix,
    support,
    logicalAndPhysicalPointsHaveExactlySameXY:
      same(originalLogicalPointFeetExact[0], physicalFootPointFeetExact[0]) &&
      same(originalLogicalPointFeetExact[1], physicalFootPointFeetExact[1]),
    unchangedLogicalHeightMatchesOriginalRunReferencePlane,
    unchangedLogicalHeightMatchesOriginalNominalRunHeight: same(
      rational(demand.originalLogicalPointFeet[2]),
      rational(runReference.originalRootNominalHeightFeet),
    ),
    floorAndStairNamedLevelAgree,
    requestedStationHasOriginalNamedLevelAndSupport:
      floorAndStairNamedLevelAgree &&
      originalServedLevelOffset === 0 &&
      unchangedLogicalHeightMatchesOriginalRunReferencePlane &&
      support.fullTwoFootStationWithinGuaranteedOriginalSupport,
    originalLogicalGraphNodeIdentityVerified: false as const,
    originalSourceRunTerminalXYVerified: false as const,
    completeNamedLogicalToPhysicalAttachmentSourceProof: false as const,
    originalGraphCoordinatesChanged: false as const,
    addedWalkingSegmentBetweenLogicalAndPhysicalPoints: false as const,
    exactOriginal3DTerminalContactClaimed: false as const,
    fullHumanClearanceApproved: false as const,
    preparedRuntimeAttachmentApproved: false as const,
    routeApproved: false as const,
  };
}
