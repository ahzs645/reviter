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
import { setActiveClassTagTranslation } from "./revit-class-tags.ts";
import { setActiveElementIdBytes } from "./element-id-width.ts";
import { buildMeshes } from "./scene.ts";
import { buildStairAssemblies } from "./stair-assemblies.ts";
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
import { resolveFamilyTypeNames } from "./family-type-names.ts";
import { familyDocumentFormsBySymbol } from "./family-forms.ts";
import { boundlessSceneElements } from "./model-elements.ts";
import { nativeOriginalSymbolElementIds, resolveNativeIfcTypeIdentityEvidence } from "./native-ifc-type-identity.ts";
import { resolveNativeSectionFamilyRelations } from "./native-structural-profiles.ts";
import { readDocumentMetadataContainer } from "./document-metadata.ts";
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
  // Installed by `openRevitContainer` from this file's schema and removed
  // below, so one file's class numbering and id width never reach the next.
  setActiveClassTagTranslation(null);
  setActiveElementIdBytes(null);
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
      fullElementInventory,
      elementOwnership,
      nativeIdentity,
      transmissionData,
      coverage,
      schema,
      partitionNames,
      contentDocuments,
    } = openRevitContainer(bytes, options);

    // A structurally recognized table can still have no parsed rows. In that
    // case use the independently validated history inventory, not an empty set.
    const declaredElementIds = new Set(elementIndex?.uniqueElementIds.length
      ? elementIndex.uniqueElementIds
      : nativeIdentity?.identities.map(identity => identity.elementId) ?? []);
    const scan = scanPartitions({
      schema,
      declaredElementIds,
      nativeTypeIdentityElementIds: nativeOriginalSymbolElementIds(declaredElementIds, nativeIdentity?.identities ?? []),
      nativeSectionElementIds: new Set(fullElementInventory?.status === "decoded" ? fullElementInventory.declaredElementIds :
        nativeIdentity?.identities.map(identity => identity.elementId) ?? declaredElementIds),
      partitions,
      decoderPlan,
      objectMarkers,
      maxSegments,
      segmentScale,
      maxNativeMeshBytes: options.maxNativeMeshBytes,
      onProgress,
      contentDocuments,
    });
    const {
      candidates,
      categoryTokens,
      elementHeaders,
      levelDefinitions,
      lightSourceStyleIds,
      familyDocuments,
      familyForms,
      nameEntries,
      instanceReferences,
      symbolReferences,
      wallKinds,
      wallTypeIds,
      elementBounds,
      elementObjects,
      instancePlacements,
      localBounds,
      elementParameters,
      ifcExportParameters,
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
      stairsAggregates,
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
      elementHeaders,
    });
    let unplacedRecords = removeDatumPileRecords(elementBounds, elementHeaders);

    onProgress?.({
      ratio: 0.84,
      message: `Resolving native Revit categories · ${elementBounds.length.toLocaleString()} element records`,
    });
    const { nativeCategories, counts } = resolveElementGeometry({
      elementBounds,
      categoryTokens,
      elementHeaders,
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
    const categorisedElements =
      (nativeCategories.headerElements ?? 0) +
      nativeCategories.directElements +
      nativeCategories.inheritedElements;
    for (const record of elementBounds) {
      const header = elementHeaders.get(record.elementId);
      if (header) record.designOptionId = header.designOptionId;
      const wallKind = wallKinds.get(record.elementId);
      if (wallKind) record.wallKind = wallKind;
      const wallTypeId = wallTypeIds.get(record.elementId);
      const wallTypeName = wallTypeId == null ? undefined : typeNames.get(wallTypeId);
      if (wallTypeName) {
        record.typeId = wallTypeId;
        record.typeName = wallTypeName;
      }
    }

    const familyTypeNames = resolveFamilyTypeNames(
      instanceReferences,
      symbolReferences,
      nameEntries,
      (elementId) => elementHeaders.get(elementId)?.categoryId,
    );
    const familyDocumentForms = familyDocumentFormsBySymbol(
      instancePlacements.values(),
      (elementId) => familyTypeNames.get(elementId)?.familyId,
      familyDocuments,
      familyForms,
    );
    const relations = resolveNativeRelations({
      elementBounds,
      nameEntries,
      familyTypeNames,
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
    for (const record of elementBounds) {
      const ownOverrides = ifcExportParameters.get(record.elementId);
      if (ownOverrides?.length) {
        const parameters = [...(record.parameters ?? [])];
        for (const parameter of ownOverrides) {
          if (!parameters.some(existing => existing.parameterId === parameter.parameterId && existing.value === parameter.value)) parameters.push(parameter);
        }
        record.parameters = parameters;
      }
      const typeId = record.typeId ?? record.familySymbolId;
      if (typeId != null) {
        const typeValues = [...(elementParameters.get(typeId)?.values() ?? [])];
        for (const parameter of ifcExportParameters.get(typeId) ?? []) {
          if (!typeValues.some(existing => existing.parameterId === parameter.parameterId && existing.value === parameter.value)) typeValues.push(parameter);
        }
        if (typeValues.length) record.typeParameters = typeValues;
      }
    }

    const drawable = selectDrawableRecords({
      elementBounds,
      markersByElement,
      instancePlacements,
      nativeAssociatedLevelRelations,
      elementHeaders,
    });
    const { boundedSolids, nonSceneNativeMeshIds, nonModelElements } = drawable;
    unplacedRecords += drawable.unplacedRecords;

    // The two branches below publish the same decoded file — the same records,
    // streams, identities and relations — and differ only in how the model was
    // drawn from it. Named once so the two result literals cannot drift.
    const nativePhaseEvidence = scan.nativePhaseCollector.resolve({ elementHeaders, levelIds: new Set(levelDefinitions.keys()) });
    // Metadata-only classification links include declared source types even
    // when they have no shared render-geometry object. The separate resolver
    // keeps all family contradictions visible without changing scene admission.
    const nativeSectionOwnerIds = new Set(fullElementInventory?.status === "decoded" ?
      fullElementInventory.declaredElementIds : nativeIdentity?.identities.map(identity => identity.elementId) ?? declaredElementIds);
    const nativeSectionFamilyRelations = resolveNativeSectionFamilyRelations(familySymbolCandidates, familySymbolReferenceSets, familyElementIds, nativeSectionOwnerIds);
    const decodedFile = {
      documentMetadata: readDocumentMetadataContainer(cfb, partitionNames),
      nativeIfcGuidParameters: scan.nativeIfcGuidParameters,
      nativePhaseEvidence,
      nativeStructuralSections: scan.nativeStructuralSectionCollector.finish(nativeSectionOwnerIds, nativeSectionFamilyRelations),
      nativeIfcTypeIdentityEvidence: resolveNativeIfcTypeIdentityEvidence({
        references: scan.nativeOriginalSymbols, placements: instancePlacements.values(),
        elementBounds, hostRelations: nativeHostRelations, revitVersion: decoderPlan.revitVersion ?? 0,
      }),
      nativeSourceRooms: scan.nativeRoomCollector.resolve({
        elementHeaders,
        elementBounds,
        declaredElementIds: declaredElementIds.size ? declaredElementIds : undefined,
        levelIds: new Set(levelDefinitions.keys()),
        associatedLevelRelations: nativeAssociatedLevelRelations,
        roomFloorFinishes: nativePhaseEvidence.roomFloorFinishes,
      }),
      nativeMepEvidence: scan.nativeMepEvidence,
      nativeDesignOptions: scan.nativeDesignOptions,
      nativeDesignOptionMembership: [...elementHeaders.values()].flatMap(header =>
        header.designOptionId == null ? [] : [{ elementId: header.elementId, designOptionId: header.designOptionId }]),
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
    // A function of one argument rather than a constant, because the only
    // thing either branch can add to the decoded relations is the stair shape,
    // and the evidence for it -- which runs the spiral mesh replay recovered --
    // is not known until the display scene has been built. The branch that
    // builds no scene passes nothing and every stair stays undetermined.
    const decodedRelations = (
      spiralStairRunIds: ReadonlySet<number> = new Set<number>(),
    ) => ({
      // The assembly tree was decoded to place run geometry and then dropped
      // before anything could publish it, so a consumer of the export could
      // not tell a stringer from a mullion or two flights of one stairwell
      // from two stairwells. Both sources are joined here once.
      nativeStairAssemblies: buildStairAssemblies(
        stairsRuns,
        stairsAggregates,
        spiralStairRunIds,
      ),
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
      fullElementInventory,
      nativeInstancePlacements: [...instancePlacements.values()],
      nativeFamilySymbolRelations,
      nativeFamilyDefinitions,
      nativeGeometryMaterialAssignments,
      nativeElementMaterialAssignments,
      nativeCompoundStructureDefinitions,
      nativeCompoundLayerMaterialAssignments,
      nativeHostRelations,
      nativeAssociatedLevelRelations,
    });

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
    const largeFrameWarnings = [
      ...(scan.largeWholeGElementFrames.skippedChecksumBudget
        ? ["Large whole-page GElement checksum work exceeded its partition budget; additional large bodies were withheld."] : []),
      ...(scan.largeWholeGElementFrames.nativeCompilation.skippedBufferBudget
        ? ["Supplemental whole-page GElement buffers reached their 64 MiB limit; additional large bodies were withheld while original geometry retained priority."] : []),
      ...(scan.largeWholeGElementFrames.nativeCompilation.skippedDefinitionBudget
        ? ["Supplemental whole-page GElements reached the native definition budget; original native geometry retained priority and remaining large bodies were withheld."] : []),
    ];
    if (scan.nativeOriginalSymbolDiagnostics.legacyCapped) largeFrameWarnings.push("Native original-symbol identity reads reached their scan limit; source type recipes were withheld.");
    if (scan.nativeOriginalSymbolDiagnostics.historicalEnvelope.capped) largeFrameWarnings.push("Stored original-symbol envelope comparisons reached their scan limit; some type flip conflicts could not be checked.");
    if (scan.nativeOriginalSymbolDiagnostics.largeObjects.capped) largeFrameWarnings.push("Large original-symbol identity reads reached their scan limit; additional type recipes could not be checked.");

    // The bounds branch is the release's own record decoder. Records the
    // release-independent passes synthesised (a wall solid rebuilt from plane
    // triples, a sketch ring) are not that decoder, and on a release it does
    // not cover they once took this branch on their own: four synthesised
    // boxes turned the 2024 Snowdon sample into a four-element "validated
    // bounds" scene and dropped its coordinate scan.
    if (boundedSolids.length && decoderPlan.elementBoundsDecoder) {
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
        nonModelElements,
        levelDefinitions,
        lightSourceStyleIds,
        familyDocumentForms,
        boundlessSceneElements: boundlessSceneElements(
          elementHeaders,
          new Set(elementBounds.map((record) => record.elementId)),
        ),
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
        ...decodedRelations(
          scene.report.meshCollection.spiralStairRunOwnerIds,
        ),
        warnings: [...buildWarnings(basis, scene.report), ...largeFrameWarnings, ...(scan.nativeStructuralSectionCollector.capped ? ["Structural section metadata exceeded its scan budget; section profiles were withheld."] : [])],
        stats: {
          largeWholeGElementFrames: scan.largeWholeGElementFrames,
          nativeOriginalSymbolDiagnostics: scan.nativeOriginalSymbolDiagnostics,
          streamCount: cfb.FileIndex.filter((entry) => entry.type === 2 && entry.size > 0).length,
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
          widenedWalls: counts.widenedWalls,
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
      ...decodedRelations(),
      warnings: [...buildWarnings(basis, coordinateReport), ...largeFrameWarnings, ...(scan.nativeStructuralSectionCollector.capped ? ["Structural section metadata exceeded its scan budget; section profiles were withheld."] : [])],
      stats: {
        largeWholeGElementFrames: scan.largeWholeGElementFrames,
        nativeOriginalSymbolDiagnostics: scan.nativeOriginalSymbolDiagnostics,
        streamCount: cfb.FileIndex.filter((entry) => entry.type === 2 && entry.size > 0).length,
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
  } finally {
    setActiveClassTagTranslation(null);
    setActiveElementIdBytes(null);
  }
}
