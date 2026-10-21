/** Original-byte reconstruction hook for current compilation. Receipts or a
 * serialized handle cannot enter this API. Locator IDs and scope are demands;
 * the source constructors independently verify their original relationships. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  captureOriginalDoorStandingIdentityDemand,
  certifyOriginalDoorDerivedStanding,
  type OriginalDoorDerivedStandingRequest,
} from "./native-source-door-derived-standing.ts";
import { createOriginalNativeStairPhysicalContext } from "./native-source-stair-physical-inventory.ts";
import { createOriginalNativeForeignEnvelopeCensus } from "./native-source-foreign-envelope-census.ts";
import type { ReviewedDrawingReferences } from "./reviewed-drawing-references.ts";
import type { Bounds3 } from "./types.ts";

export type OriginalDoorDerivedStandingReplayRecipe = {
  version: 1;
  roomKey: string;
  nativeDoorElementId: number;
  originalPortalNodeId: string;
  /** Untrusted original native frame locators; all are rechecked. */
  nativeDoorDefinitionElementId: number;
  nativeOwnStairElementId: number;
  nativeStairDefinitionElementId: number;
  standing: OriginalDoorDerivedStandingRequest;
  foreignScopeBoundsFeet: Bounds3;
  requestedAdditionalOriginalFrameIds: readonly number[];
};

/** Synchronous source reconstruction, intended for native compilation rather
 * than browser/runtime route calculation. The independent importer selects
 * expected graph/model hashes. Graph identity is not a physical certificate.
 * This hook mutates no dataset and returns only the live narrow source handle;
 * current native-cell/full walking/material/owner/policy and preservation
 * replay plus explicit pointer adoption remain the compiler's responsibility. */
export function reconstructOriginalDoorDerivedStanding(
  originalRvtBytes: Uint8Array,
  expectedSourceModelSha256: string,
  originalGraphBytes: Uint8Array,
  expectedOriginalGraphSha256: string,
  recipe: OriginalDoorDerivedStandingReplayRecipe,
) {
  if (
    !recipe ||
    recipe.version !== 1 ||
    !Array.isArray(recipe.requestedAdditionalOriginalFrameIds) ||
    recipe.requestedAdditionalOriginalFrameIds.length > 10000 ||
    [
      recipe.nativeDoorElementId,
      recipe.nativeDoorDefinitionElementId,
      recipe.nativeOwnStairElementId,
      recipe.nativeStairDefinitionElementId,
      recipe.standing?.nativeRunId,
      recipe.standing?.nativeFloorElementId,
      ...recipe.requestedAdditionalOriginalFrameIds,
    ].some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw Error("Malformed original door standing reconstruction recipe");
  // Pin caller bytes before parsing. The native contexts independently verify
  // the model SHA as well; this early check avoids expensive invalid replays.
  if (bytesToHex(sha256(originalRvtBytes)) !== expectedSourceModelSha256)
    throw Error("Original door standing reconstruction model bytes differ");
  const identity = captureOriginalDoorStandingIdentityDemand(
    originalGraphBytes,
    expectedOriginalGraphSha256,
    expectedSourceModelSha256,
    recipe.roomKey,
    recipe.nativeDoorElementId,
    recipe.originalPortalNodeId,
  );
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(originalGraphBytes),
  ) as {
    reviewedDrawingReferences?: ReviewedDrawingReferences;
  };
  const stair = createOriginalNativeStairPhysicalContext(
    originalRvtBytes,
    expectedSourceModelSha256,
    [
      {
        nativeStairId: recipe.nativeOwnStairElementId,
        nativeRunId: recipe.standing.nativeRunId,
        nativeDefinitionId: recipe.nativeStairDefinitionElementId,
      },
    ],
  );
  const foreign = createOriginalNativeForeignEnvelopeCensus(
    originalRvtBytes,
    expectedSourceModelSha256,
    recipe.foreignScopeBoundsFeet,
    data.reviewedDrawingReferences,
    [
      recipe.nativeDoorElementId,
      recipe.nativeDoorDefinitionElementId,
      recipe.standing.nativeFloorElementId,
      ...recipe.requestedAdditionalOriginalFrameIds,
    ],
  );
  return certifyOriginalDoorDerivedStanding(
    foreign.certificate,
    stair,
    identity,
    recipe.standing,
  );
}
