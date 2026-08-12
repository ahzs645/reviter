/**
 * The conversion pipeline.
 *
 * This module orchestrates; it neither reads bytes nor decides what anything
 * means. It runs the stages in order, hands each one the previous ones' output,
 * and assembles the result:
 *
 *   `convert-container`            → the CFB streams, the release, the summaries
 *   `convert-partition-scan`       → one pass over every page, and everything on it
 *   `convert-native-surfaces`      → patches gathered into solids, arcs and faces
 *   `convert-synthesised-records`  → records for elements the file gave none, and
 *                                    the removal of records that are not elements
 *   `convert-element-geometry`     → each record's category and its geometry
 *   `convert-native-relations`     → persisted family, material and host relations
 *   `convert-display-scene`        → display selection, batching and framing
 *   `convert-report`               → the warnings and the decoder coverage
 *
 * The eight `onProgress` calls below are the stage boundaries, and the ratios
 * and messages are a contract: `tests/convert-rvt-bytes.test.ts` pins the exact
 * sequence for both branches.
 *
 * **Two branches, one prologue.** Everything up to the display scene runs the
 * same way whether or not a release decoder was available. If it produced
 * drawable records the conversion returns a recovered element model; if it did
 * not, the diagnostic segment scan the page walk collected in passing is
 * extruded instead, and the result says so in its method, its fidelity and its
 * warnings.
 */
import { dominantMarker } from "./element-objects.ts";
import { limitCensus, resetLimitCensus } from "./limit-census.ts";
import { buildMeshes } from "./scene.ts";
import {
  FAMILY_SEGMENT_SCALE,
  deduplicate,
  focusPrimaryCluster,
  levelsFor,
  rawBounds,
  sampleEvenly,
  segmentScaleFor,
  trimVerticalOutliers,
} from "./segment-scan.ts";
import { openRevitContainer } from "./convert-container.ts";
import {
  buildDisplayScene,
  selectDrawableRecords,
} from "./convert-display-scene.ts";
import { resolveElementGeometry } from "./convert-element-geometry.ts";
import { resolveNativeRelations } from "./convert-native-relations.ts";
import { reconstructNativeSurfaces } from "./convert-native-surfaces.ts";
import { scanPartitions } from "./convert-partition-scan.ts";
import {
  removeCachedShapeRecords,
  removeDatumPileRecords,
  synthesiseGeometryRecords,
  synthesiseSketchBoundaryRecords,
} from "./convert-synthesised-records.ts";
import {
  buildDecoderCoverage,
  buildWarnings,
  type ConvertCoordinateReport,
  type ConvertReportBasis,
} from "./convert-report.ts";

import type {
  ConvertOptions,
  ConvertOutcome,
  ConvertResult,
  ProgressUpdate,
} from "./types";

// Re-exported from its new home so the rule keeps the import path it was
// measured and tested under.
export { ringRecordRise } from "./convert-synthesised-records.ts";

const DEFAULT_MAX_SEGMENTS = 12_000;

type ProgressCallback = (update: ProgressUpdate) => void;


export function convertRvtBytes(
  input: ArrayBuffer | Uint8Array,
  fileName = "model.rvt",
  options: ConvertOptions = {},
  onProgress?: ProgressCallback,
): ConvertOutcome {
  const started = performance.now();
  // Fitted-limit counters are module-level, so a previous conversion's tally
  // must not carry into this one.
  resetLimitCensus();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const segmentScale = segmentScaleFor(fileName, options.geometryScale);
  const familyScale = segmentScale === FAMILY_SEGMENT_SCALE;

  try {
    onProgress?.({ ratio: 0.03, message: "Opening Revit container" });
    const {
      cfb,
      decoderPlan,
      partitions,
      objectMarkers,
      partAtom,
      elementIndex,
      elementOwnership,
      nativeIdentity,
      transmissionData,
      coverage,
      schema,
      partitionNames,
    } = openRevitContainer(bytes, options);

    const scan = scanPartitions({
      partitions,
      decoderPlan,
      objectMarkers,
      maxSegments,
      segmentScale,
      maxNativeMeshBytes: options.maxNativeMeshBytes,
      onProgress,
    });
    const {
      candidates,
      categoryTokens,
      elementBounds,
      elementObjects,
      instancePlacements,
      localBounds,
      elementParameters,
      surfaceCounts,
      planesByElement,
      cylindersByElement,
      curvesByOwner,
      sketchCurves,
      typeReferences,
      typeNames,
      nativeProfiles,
      nativeMaterialDefinitionMap,
      familyElementIds,
      nativeFamilyDefinitionMap,
      familySymbolCandidates,
      familySymbolReferenceSets,
      geometryMaterialCandidates,
      familySymbolMaterialReferenceSets,
      familySymbolMaterialPlacements,
      hostRelationCandidates,
      associatedLevelRelationCandidates,
      partitionRecords,
      partitionRecordIds,
      markerByElement,
      markersByElement,
      gzipChunks,
      inflatedBytes,
      stairsRuns,
      persistedCadFileNames,
      nativeCompoundStructureDefinitions,
      wallThicknessByType,
      nativeMeshCollector,
    } = scan;

    onProgress?.({
      ratio: 0.825,
      message: `Reconstructing native surfaces · ${planesByElement.size.toLocaleString()} surface owners`,
    });
    const solidStream = partitions[0]!.path.replace(/^Root Entry\//, "");
    const surfaces = reconstructNativeSurfaces({
      planesByElement,
      cylindersByElement,
      instancePlacements,
      localBounds,
    });
    const {
      solidGroups,
      solidsByElement,
      arcsByElement,
      orientedBoxes,
      faceReadBoxes,
      quadsByElement,
      allSurfaceQuadsByElement,
    } = surfaces;

    onProgress?.({
      ratio: 0.83,
      message: `Resolving placed geometry · ${instancePlacements.size.toLocaleString()} instances`,
    });
    const { boundedIds, solidOnlyElements, instanceOnlyElements } =
      synthesiseGeometryRecords({
        elementBounds,
        quadsByElement,
        solidGroups,
        orientedBoxes,
        solidStream,
      });

    onProgress?.({
      ratio: 0.835,
      message: `Recovering sketch boundaries · ${curvesByOwner.size.toLocaleString()} curve owners`,
    });
    synthesiseSketchBoundaryRecords({
      elementBounds,
      boundedIds,
      curvesByOwner,
      categoryTokens,
      partitionRecordIds,
      markerByElement,
      elementIndex,
      elementOwnership,
      solidStream,
    });
    const { sharedGeometryIds, cachedShapeRecords } = removeCachedShapeRecords({
      elementBounds,
      categoryTokens,
      elementIndex,
      instancePlacements,
    });
    let unplacedRecords = removeDatumPileRecords(elementBounds);

    onProgress?.({
      ratio: 0.84,
      message: `Resolving native Revit categories · ${elementBounds.length.toLocaleString()} element records`,
    });
    const { nativeCategories, counts } = resolveElementGeometry({
      elementBounds,
      categoryTokens,
      elementIndex,
      elementOwnership,
      elementParameters,
      solidsByElement,
      solidGroups,
      quadsByElement,
      allSurfaceQuadsByElement,
      arcsByElement,
      orientedBoxes,
      faceReadBoxes,
      typeReferences,
      typeNames,
      wallThicknessByType,
      curvesByOwner,
      markerByElement,
      markersByElement,
      stairsRuns,
      instancePlacements,
      localBounds,
    });

    onProgress?.({
      ratio: 0.90,
      message: `Finalising element geometry · ${elementBounds.length.toLocaleString()} element records`,
    });
    const unique = deduplicate(candidates);
    const focused = trimVerticalOutliers(focusPrimaryCluster(unique));
    const used = sampleEvenly(focused, maxSegments);
    const categorisedElements = nativeCategories.directElements + nativeCategories.inheritedElements;
    const relations = resolveNativeRelations({
      elementBounds,
      instancePlacements,
      sharedGeometryIds,
      familyElementIds,
      familySymbolCandidates,
      familySymbolReferenceSets,
      nativeFamilyDefinitionMap,
      nativeMaterialDefinitionMap,
      geometryMaterialCandidates,
      familySymbolMaterialReferenceSets,
      familySymbolMaterialPlacements,
      typeReferences,
      nativeCompoundStructureDefinitions,
      hostRelationCandidates,
      associatedLevelRelationCandidates,
      markerByElement,
    });
    const {
      materials,
      materialElementIds,
      nativeMaterialDefinitions,
      nativeMaterialIndexById,
      proxyMaterialIndexByElement,
      preferredWallMaterialIdsByElement,
      nativeFamilySymbolRelations,
      nativeFamilyDefinitions,
      nativeGeometryMaterialAssignments,
      nativeElementMaterialAssignments,
      nativeCompoundLayerMaterialAssignments,
      nativeHostRelations,
      nativeAssociatedLevelRelations,
    } = relations;
    const drawable = selectDrawableRecords({
      elementBounds,
      markersByElement,
      instancePlacements,
      nativeAssociatedLevelRelations,
    });
    const { boundedSolids, nonSceneNativeMeshIds } = drawable;
    unplacedRecords += drawable.unplacedRecords;

    // The two branches below publish the same decoded file — the same records,
    // streams, identities and relations — and differ only in how the model was
    // drawn from it. Named once so the two result literals cannot drift.
    const decodedFile = {
      elementBounds,
      nativeProfiles,
      nativeCategories,
      schema,
      partitionNames,
      partAtom,
      transmissionData,
      persistedCadFileNames,
      coverage,
    };
    const decodedRelations = {
      elementIndex: elementIndex
        ? {
            ...elementIndex,
            partitionRecordIds: Uint32Array.from(
              [...partitionRecordIds].sort((a, b) => a - b),
            ),
            partitionRecords,
          }
        : undefined,
      elementOwnership,
      nativeIdentity,
      nativeMaterialDefinitions,
      nativeFamilySymbolRelations,
      nativeFamilyDefinitions,
      nativeGeometryMaterialAssignments,
      nativeElementMaterialAssignments,
      nativeCompoundStructureDefinitions,
      nativeCompoundLayerMaterialAssignments,
      nativeHostRelations,
      nativeAssociatedLevelRelations,
    };

    // Everything both result branches say about the file, minus the one figure
    // each branch counts for itself.
    const reportBasis: Omit<ConvertReportBasis, "approximateSolids"> = {
      revitVersion: decoderPlan.revitVersion,
      nativeCategories,
      categorisedElements,
      elementOwnership,
      nativeIdentity,
      transmissionData,
      persistedCadFileNames,
      sharedGeometryIds,
      nativeCompoundStructureDefinitions,
      ...relations,
    };

    if (boundedSolids.length) {
      onProgress?.({
        ratio: 0.96,
        message: `Building the display scene · ${boundedSolids.length.toLocaleString()} drawable records`,
      });
      const scene = buildDisplayScene({
        boundedSolids,
        elementBounds,
        stairsRuns,
        sharedGeometryIds,
        instancePlacements,
        elementOwnership,
        nativeHostRelations,
        nativeAssociatedLevelRelations,
        markerByElement,
        nonSceneNativeMeshIds,
        materialElementIds,
        nativeMaterialIndexById,
        proxyMaterialIndexByElement,
        preferredWallMaterialIdsByElement,
        nativeMeshCollector,
      });
      const basis: ConvertReportBasis = {
        ...reportBasis,
        approximateSolids: scene.proxyRecordCount,
      };
      const result: ConvertResult = {
        ok: true,
        fileName,
        byteLength: bytes.byteLength,
        meshes: scene.meshes,
        materials,
        segments: scene.segments,
        ...decodedFile,
        decoderCoverage: buildDecoderCoverage(basis, scene.report),
        origin: scene.origin,
        bbox: scene.bbox,
        levels: scene.levels,
        method: "partition-bounds-recovery",
        ...decodedRelations,
        warnings: buildWarnings(basis, scene.report),
        stats: {
          streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
          partitionStreams: partitions.length,
          gzipChunks,
          inflatedBytes,
          candidatesFound: elementBounds.length,
          candidatesFocused: scene.displayRecordCount,
          candidatesUsed: scene.proxyRecordCount + scene.nativeCoveredRecordCount,
          // Counted from the batches themselves: a drawn item is no longer
          // always an eight-vertex box.
          vertexCount: scene.meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0),
          triangleCount: scene.meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0),
          meshCount: scene.meshes.length,
          boundsRecordsFound: elementBounds.length,
          solidBoundsRecords: boundedSolids.length,
          elementObjects: elementObjects.length,
          parameterElements: elementParameters.size,
          surfaces: surfaceCounts,
          nativeSolids: solidsByElement.size,
          faceOnlyElements: quadsByElement.size,
          placedInstances: orientedBoxes.size,
          rejectedOrientedBoxes: counts.rejectedOrientedBoxes,
          cachedShapeRecords,
          unplacedRecords,
          sketchBoundaryElements: counts.sketchBoundaryElements,
          sketchBoundedFacetHulls: counts.sketchBoundedFacetHulls,
          completedFlatSketches: counts.completedFlatSketches,
          sweptRailings: counts.sweptRailings,
          curvedWalls: counts.curvedWalls,
          inferredCurtainPanels: scene.report.inferredCurtainPanels,
          doorLeaves: counts.doorLeaves,
          doorLeavesFromShape: counts.doorLeavesFromShape,
          adoptedStairBoxes: counts.adoptedStairBoxes,
          clippedSolids: counts.clippedSolids,
          extendedSolids: counts.extendedSolids,
          recoveredWallJoinEnds: counts.recoveredWallJoinEnds,
          shrunkSolids: counts.shrunkSolids,
          narrowedSolidBands: counts.narrowedSolidBands,
          disownedSolids: counts.disownedSolids,
          narrowedFacetBands: counts.narrowedFacetBands,
          unnamedSketchElements: counts.unnamedSketchElements,
          sketchCurves,
          solidOnlyElements,
          instanceOnlyElements,
          unclassifiedElements: scene.report.displaySelection.unclassifiedCount,
          typedElements: typeReferences.size,
          namedTypeElements: counts.namedTypeElements,
          elementObjectMarker: dominantMarker(elementObjects) ?? undefined,
          fittedLimitsReached: limitCensus(),
          durationMs: performance.now() - started,
        },
      };
      onProgress?.({ ratio: 1, message: "Ready" });
      return result;
    }
    if (!used.length) throw new Error("The file opened, but no plausible geometry was recovered.");

    const bounds = rawBounds(used);
    const origin = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: bounds.min.z,
    };
    // The diagnostic scan recovers curves, not solids, so each candidate is
    // extruded only to make it visible. At family scale a 10 ft extrusion would
    // bury the component, so the defaults follow the recovered extent instead.
    const diagonal = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    const extrusionHeight = options.wallHeight ?? (familyScale ? Math.max(0.05, diagonal * 0.04) : 10);
    const extrusionThickness = options.wallThickness ?? (familyScale ? Math.max(0.01, diagonal * 0.004) : 0.5);
    const meshes = buildMeshes(used, origin, extrusionThickness, extrusionHeight);
    const relativeBounds = {
      min: { x: bounds.min.x - origin.x, y: bounds.min.y - origin.y, z: 0 },
      max: {
        x: bounds.max.x - origin.x,
        y: bounds.max.y - origin.y,
        z: bounds.max.z - origin.z + extrusionHeight,
      },
    };

    const basis: ConvertReportBasis = {
      ...reportBasis,
      approximateSolids: used.length,
    };
    const coordinateReport: ConvertCoordinateReport = {
      kind: "coordinate",
      familyScale,
      omittedIsolatedCandidates: unique.length - focused.length,
    };
    const result: ConvertResult = {
      ok: true,
      fileName,
      byteLength: bytes.byteLength,
      meshes,
      materials,
      segments: used,
      ...decodedFile,
      decoderCoverage: buildDecoderCoverage(basis, coordinateReport),
      origin,
      bbox: relativeBounds,
      levels: levelsFor(used),
      method: "partition-coordinate-recovery",
      ...decodedRelations,
      warnings: buildWarnings(basis, coordinateReport),
      stats: {
        streamCount: cfb.FileIndex.filter((entry) => entry.size > 0).length,
        partitionStreams: partitions.length,
        gzipChunks,
        inflatedBytes,
        candidatesFound: unique.length,
        candidatesFocused: focused.length,
        candidatesUsed: used.length,
        vertexCount: used.length * 8,
        triangleCount: used.length * 12,
        meshCount: meshes.length,
        boundsRecordsFound: elementBounds.length,
        solidBoundsRecords: boundedSolids.length,
        elementObjects: elementObjects.length,
        fittedLimitsReached: limitCensus(),
        durationMs: performance.now() - started,
      },
    };
    onProgress?.({ ratio: 1, message: "Ready" });
    return result;
  } catch (error) {
    return {
      ok: false,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
