import {
  createOriginalPlacedPlanarObstacleContext,
  proveOriginalDirectWallTrimObstacleEnvelope,
} from "./native-source-placed-planar-obstacles.ts";
/** Rebuild source standing capability only from actual current original inputs.
 * No saved receipt, portable geometry or validation checkpoint is accepted. */
import { createOriginalNativeStairPhysicalContext } from "./native-source-stair-physical-inventory.ts";
import {
  createOriginalNativeStairAssemblyContext,
  bindOriginalNativeStairAssembly,
} from "./native-source-stair-assembly.ts";
import { createOriginalNativeForeignEnvelopeCensus } from "./native-source-foreign-envelope-census.ts";
import {
  captureOriginalStairBaseIdentityDemand,
  certifyOriginalSourceStairBaseStanding,
} from "./native-source-stair-base-standing.ts";
import { captureOriginalRecordedStairIntentDemand } from "./native-source-stair-recorded-intent.ts";
export function reconstructOriginalSourceStairBaseStanding(options: {
  originalRVTBytes: Uint8Array;
  expectedSourceModelSha256: string;
  originalDatasetBytes: Uint8Array;
  expectedOriginalDatasetSha256: string;
  roomKey: string;
  nativeStairId: number;
  nativeRunId: number;
  nativeDefinitionId: number;
  nativeFloorElementId: number;
  originalCapFaceToken: number;
  /** Bounded source-derived request only; additional setbacks require the exact literal point. */
  outsetTreadDepthMultiple?: number;
  expectedDerivedPointFeet?: [number, number, number];
  originalApproachNodeId?: string;
  approachXYFeet?: [number, number][];
  recordedIntent?: {
    originalSourceRoomsBytes: Uint8Array;
    expectedSourceRoomsSha256: string;
    upperRoomKey: string;
  };
  /** Source locators only: actual SWall/category/complete trim operands are independently reconstructed. */
  directWallRefinementElementIds?: readonly number[];
  reviewedDrawingReferences: Parameters<
    typeof createOriginalNativeForeignEnvelopeCensus
  >[3];
  log?: (value: unknown) => void;
}) {
  const log = options.log ?? (() => {}),
    identity = captureOriginalStairBaseIdentityDemand(
      options.originalDatasetBytes,
      options.expectedOriginalDatasetSha256,
      options.expectedSourceModelSha256,
      options.roomKey,
      options.nativeStairId,
      { approachNodeId: options.originalApproachNodeId },
    ),
    recordedIntent = options.recordedIntent
      ? captureOriginalRecordedStairIntentDemand(
          options.recordedIntent.originalSourceRoomsBytes,
          options.recordedIntent.expectedSourceRoomsSha256,
          options.expectedSourceModelSha256,
          {
            lowerRoomKey: options.roomKey,
            upperRoomKey: options.recordedIntent.upperRoomKey,
            nativeStairId: options.nativeStairId,
            nativeRunId: options.nativeRunId,
          },
        )
      : undefined;
  const assembly = createOriginalNativeStairAssemblyContext(
      options.originalRVTBytes,
      options.expectedSourceModelSha256,
      [options.nativeStairId],
    ),
    membership = bindOriginalNativeStairAssembly(
      assembly,
      options.nativeStairId,
    );
  log({
    stage: "original-base-standing-complete-native-membership",
    pages: assembly.completeSourcePages,
  });
  const stair = createOriginalNativeStairPhysicalContext(
    options.originalRVTBytes,
    options.expectedSourceModelSha256,
    [
      {
        nativeStairId: options.nativeStairId,
        nativeRunId: options.nativeRunId,
        nativeDefinitionId: options.nativeDefinitionId,
      },
    ],
  );
  log({
    stage: "original-base-standing-complete-own-source",
    pages: stair.completeSourcePages,
  });
  const foreign = createOriginalNativeForeignEnvelopeCensus(
    options.originalRVTBytes,
    options.expectedSourceModelSha256,
    {
      min: { x: -10000, y: -10000, z: -10000 },
      max: { x: 10000, y: 10000, z: 10000 },
    },
    options.reviewedDrawingReferences,
    [
      options.nativeStairId,
      options.nativeRunId,
      options.nativeDefinitionId,
      options.nativeFloorElementId,
    ],
  ).certificate;
  log({
    stage: "original-base-standing-complete-foreign-census",
    sourceCensusSha256: foreign.sourceCensusSha256,
  });
  const wallIds = options.directWallRefinementElementIds ?? [];
  if (
    new Set(wallIds).size !== wallIds.length ||
    wallIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error("Invalid original standing wall refinement locators");
  const wallContext = wallIds.length
    ? createOriginalPlacedPlanarObstacleContext(
        options.originalRVTBytes,
        options.expectedSourceModelSha256,
        wallIds.map((nativeElementId) => ({ nativeElementId })),
      )
    : undefined;
  const directWalls = wallIds.map((id) => {
    const proof = proveOriginalDirectWallTrimObstacleEnvelope(wallContext!, id);
    if (!proof.ok)
      throw new Error(
        `Original standing wall refinement${id} refuses: ${proof.blockers.join("; ")}`,
      );
    return proof.certificate;
  });
  try {
    return certifyOriginalSourceStairBaseStanding(
      identity,
      { stair, membership, foreign, directWalls, recordedIntent },
      {
        nativeRunId: options.nativeRunId,
        nativeFloorElementId: options.nativeFloorElementId,
        originalCapFaceToken: options.originalCapFaceToken,
        outsetTreadDepthMultiple: options.outsetTreadDepthMultiple,
        expectedDerivedPointFeet: options.expectedDerivedPointFeet,
        approachXYFeet: options.approachXYFeet,
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "originalStandingSourceRefusal" in error
    )
      log({
        stage: "original-base-standing-all-bounded-source-refusals",
        diagnostic: error.originalStandingSourceRefusal,
      });
    throw error;
  }
}
