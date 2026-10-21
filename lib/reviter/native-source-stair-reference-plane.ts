/** An actual retained ordered boundary may supply a distinct source reference
 * plane in the explicitly qualified local-index mode. Literal root nominal
 * scalars remain unchanged and are reported alongside it. */
import {
  readOriginalNativeStairRiserPartitionRun,
  type OriginalNativeStairRiserPartition,
} from "./native-source-stair-riser-partition.ts";
import type { readOriginalNativeStairPhysicalSource } from "./native-source-stair-physical-inventory.ts";
export function originalNativeStairRunReferencePlane(
  physical: ReturnType<typeof readOriginalNativeStairPhysicalSource>,
  terminal: "lower" | "upper",
  partition?: OriginalNativeStairRiserPartition,
) {
  const originalRootNominalHeightFeet =
    physical.run.root[
      terminal === "lower" ? "m_bottomElevation" : "m_topElevation"
    ];
  if (
    typeof originalRootNominalHeightFeet !== "number" ||
    !Number.isFinite(originalRootNominalHeightFeet)
  )
    throw new Error("Unavailable literal original nominal run plane");
  if (!partition)
    return {
      heightFeet: originalRootNominalHeightFeet,
      reference: "original-root-nominal" as const,
      originalRootNominalHeightFeet,
    };
  const source = readOriginalNativeStairRiserPartitionRun(
      partition,
      physical.sourceModelSha256,
      physical.nativeRunId,
      physical.sourceFrameSha256s[`${physical.nativeRunId}:4102`]!,
    ),
    boundary =
      source.orderedRisers[
        terminal === "lower" ? 0 : source.orderedRisers.length - 1
      ]!;
  // The first ordered riser is the TOP of the initial rise, not the base.
  // Preserve the original lower reference; full floor/first-rise guards apply.
  const heightFeet = terminal === "lower" ? originalRootNominalHeightFeet
    : (boundary.originalFiniteCurve.m_origin as number[])[2]!;
  if (!Number.isFinite(heightFeet))
    throw new Error("Unavailable original ordered boundary plane");
  return {
    heightFeet,
    reference: "original-qualified-local-ordered-boundary" as const,
    originalRootNominalHeightFeet,
    originalPartitionSha256: partition.originalPartitionSha256,
    originalBoundary: boundary,
    servedPlaneApproved: false as const,
    routeApproved: false as const,
  };
}
