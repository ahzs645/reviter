/** JSON audit report: what was decoded, from what evidence, and what was not. */
import type { ConvertResult } from "./types";

export function makeReport(
  result: ConvertResult,
  metadata: Record<string, unknown> | null,
): string {
  const safeMetadata = metadata
    ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "path" && key !== "content"))
    : null;
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedBy: "Reviter",
      fidelity: {
        metadata: "verified",
        container: "verified",
        geometry: result.method === "partition-bounds-recovery"
          ? "validated-rvt-element-bounds"
          : "experimental-coordinate-recovery",
        bimSemantics: result.decoderCoverage.nativeCategorisedElements
          ? "native-revit-categories"
          : "unavailable",
        nativeProfiles: result.decoderCoverage.nativeProfiles,
        nativeMeshes: result.decoderCoverage.nativeMeshes,
        materialDefinitions: result.decoderCoverage.nativeMaterialDefinitions,
        materialAssignments: result.decoderCoverage.nativeMaterialAssignments,
      },
      file: { name: result.fileName, byteLength: result.byteLength, metadata: safeMetadata },
      originFeet: result.origin,
      boundsLocalFeet: result.bbox,
      levels: result.levels,
      stats: result.stats,
      decoderCoverage: result.decoderCoverage,
      nativeCategories: result.nativeCategories ?? null,
      schema: result.schema ?? null,
      partitionNames: result.partitionNames ?? null,
      streamCoverage: result.coverage ?? null,
      nativeProfiles: result.nativeProfiles,
      materials: result.materials,
      standardsAwareReader: result.readerDiagnostics ?? null,
      warnings: result.warnings,
    },
    null,
    2,
  );
}
