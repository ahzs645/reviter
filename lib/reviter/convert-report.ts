/**
 * What a conversion says about itself: the decoder-coverage report and the
 * human-readable warnings.
 *
 * Both conversion branches — the bounds recovery that decodes native element
 * records, and the diagnostic coordinate recovery that runs when no release
 * decoder is available — end in a result carrying these two blocks, and the
 * blocks are mostly the same text about the same decoded facts. They were
 * written out twice, and the copies had already drifted: the material sentence
 * lists the FamilySymbol geometry-tag maps on one branch and not on the other,
 * which is a real difference (the maps are only resolved where the scene is
 * built) rather than an accident, and is preserved here as one.
 *
 * The branch is therefore a discriminated parameter rather than two functions:
 * every shared sentence is written once, and each place the two branches really
 * do differ is visible as a `branch.kind` test instead of being hidden in the
 * distance between two 120-line array literals.
 *
 * **Order is part of the contract.** `activeDecoders` and `warnings` are read
 * positionally by the studio UI and asserted by the conversion tests, so the
 * shared entries keep the relative order both copies had, with the
 * scene-specific entries interleaved at exactly the points they appeared.
 */
import type { NativeCompoundLayerMaterialAssignment, NativeCompoundStructureDefinition } from "./compound-structure-materials.ts";
import type { ElementOwnershipDecode } from "./element-relations.ts";
import type {
  NativeElementMaterialAssignment,
  NativeFamilyDefinition,
  NativeFixedFamilySymbolRelation,
  NativeFamilySymbolRelation,
  NativeGeometryMaterialAssignment,
  NativeUniqueFamilyTargetRelation,
} from "./family-material-relations.ts";
import type {
  NativeFamilySymbolMaterialAssignment,
  NativeFamilySymbolMaterialMap,
} from "./family-symbol-materials.ts";
import { limitCensusWarning } from "./limit-census.ts";

import type { PersistedCadFileName } from "./cad-files.ts";
import type { NativeHostRelation } from "./host-relations.ts";
import type { NativeAssociatedLevelRelation } from "./level-relations.ts";
import type { NativeMaterialPaletteEntry } from "./material-palette.ts";
import type { NativeMeshCleanupResult } from "./native-mesh-cleanup.ts";
import type { NativeIdentityDecode } from "./native-identity.ts";
import type {
  Revit2027NativeMeshCollection,
  Revit2027NativeMeshScene,
} from "./revit-2027-native-mesh-bridge.ts";
import type { DisplaySelection } from "./scene.ts";
import type { RevitTransmissionData } from "./transmission-data.ts";
import type {
  DecoderCoverage,
  LocatedNativeMaterialDefinition,
  NativeCategorySummary,
} from "./types.ts";

/** Everything both branches decode, and therefore both branches report. */
export type ConvertReportBasis = {
  revitVersion: number | null;
  nativeCategories: NativeCategorySummary;
  /** Elements carrying a category, from their own token or by consensus. */
  categorisedElements: number;
  /** Records the branch counts as approximated rather than natively drawn. */
  approximateSolids: number;
  elementOwnership: ElementOwnershipDecode | undefined;
  nativeIdentity: NativeIdentityDecode | undefined;
  transmissionData: RevitTransmissionData | undefined;
  persistedCadFileNames: PersistedCadFileName[];
  sharedGeometryIds: Set<number>;
  nativeMaterialDefinitions: LocatedNativeMaterialDefinition[];
  nativeMaterialPalette: NativeMaterialPaletteEntry[];
  nativeMaterialAssignedElements: number;
  fixedFamilySymbolRelations: NativeFixedFamilySymbolRelation[];
  staticTailFamilyTargetRelations: NativeUniqueFamilyTargetRelation[];
  nativeFamilySymbolRelations: NativeFamilySymbolRelation[];
  nativeFamilyDefinitions: NativeFamilyDefinition[];
  nativeGeometryMaterialAssignments: NativeGeometryMaterialAssignment[];
  nativeElementMaterialAssignments: NativeElementMaterialAssignment[];
  nativeFamilySymbolMaterialMaps: NativeFamilySymbolMaterialMap[];
  nativeFamilySymbolMaterialAssignments: NativeFamilySymbolMaterialAssignment[];
  nativeCompoundStructureDefinitions: NativeCompoundStructureDefinition[];
  nativeCompoundLayerMaterialAssignments: NativeCompoundLayerMaterialAssignment[];
  nativeHostRelations: NativeHostRelation[];
  nativeAssociatedLevelRelations: NativeAssociatedLevelRelation[];
};

/** The display scene, which only the bounds-recovery branch builds. */
export type ConvertSceneReport = {
  kind: "scene";
  /** Records with a usable volume, ring or tread set: the drawable population. */
  drawableRecords: number;
  displaySelection: DisplaySelection;
  meshScene: Revit2027NativeMeshScene;
  meshCollection: Revit2027NativeMeshCollection;
  meshCleanup: NativeMeshCleanupResult;
  wallProxyReplacements: number;
  inferredCurtainPanels: number;
  omittedHelperProxies: number;
  omittedCurtainAssemblyProxies: number;
};

/** The diagnostic segment scan, which runs when no element record decoded. */
export type ConvertCoordinateReport = {
  kind: "coordinate";
  /** True for a component-scale file, whose geometry is not an element model. */
  familyScale: boolean;
  /** Candidates dropped as an isolated spatial cluster; 0 when none were. */
  omittedIsolatedCandidates: number;
};

export type ConvertBranchReport = ConvertSceneReport | ConvertCoordinateReport;

/** The decoders whose evidence reached the result, in their reported order. */
export function buildDecoderCoverage(
  basis: ConvertReportBasis,
  branch: ConvertBranchReport,
): DecoderCoverage {
  const scene = branch.kind === "scene" ? branch : undefined;
  const meshScene = scene?.meshScene;
  const meshCollection = scene?.meshCollection;
  const meshCleanup = scene?.meshCleanup;
  return {
    revitVersion: basis.revitVersion,
    activeDecoders: [
      // The bounds decoder is what makes this the bounds branch, so it is
      // reported unconditionally there and is absent from the other.
      ...(scene ? ["revit-2027-duplicated-bounds-v1"] : []),
      ...(basis.nativeCategories.tokensFound ? ["revit-builtin-category-token-v1"] : []),
      ...(basis.elementOwnership ? ["revit-2024-2027-elem-table-ownership-v1"] : []),
      ...(basis.nativeIdentity ? ["revit-2027-native-identity-v1"] : []),
      ...(basis.transmissionData ? ["revit-transmission-data-v1"] : []),
      ...(basis.nativeMaterialDefinitions.length
        ? ["revit-2027-material-element-name-v1"]
        : []),
      ...(basis.nativeMaterialPalette.length
        ? ["revit-2027-material-color-packed-v1"]
        : []),
      ...(basis.fixedFamilySymbolRelations.length
        ? ["revit-2027-family-symbol-family-v1"]
        : []),
      ...(basis.staticTailFamilyTargetRelations.length
        ? ["revit-2027-family-symbol-static-tail-v1"]
        : []),
      ...(basis.nativeFamilyDefinitions.length
        ? ["revit-2027-family-name-path-v1"]
        : []),
      ...(basis.nativeGeometryMaterialAssignments.length
        ? ["revit-2027-geometry-material-id-v1"]
        : []),
      ...(basis.nativeElementMaterialAssignments.length
        ? ["revit-2027-instance-geometry-material-v1"]
        : []),
      ...(basis.nativeFamilySymbolMaterialAssignments.length
        ? ["revit-2027-family-symbol-geometry-tag-material-v1"]
        : []),
      ...(basis.nativeCompoundStructureDefinitions.length
        ? ["revit-2027-basic-wall-compound-material-v1"]
        : []),
      ...(basis.nativeHostRelations.length
        ? ["revit-2027-insertable-host-id-v1"]
        : []),
      ...(meshCleanup && (
        meshCleanup.duplicateTrianglesRemoved ||
        meshCleanup.hostTrianglesClipped ||
        meshCleanup.redundantWallShellTrianglesRemoved)
        ? ["revit-2027-native-mesh-visibility-cleanup-v1"]
        : []),
      ...(meshCleanup?.redundantWallShellTrianglesRemoved
        ? ["revit-2027-redundant-wall-envelope-shell-v1"]
        : []),
      ...(scene?.wallProxyReplacements
        ? ["revit-2027-wall-native-overfill-gate-v1"]
        : []),
      ...(basis.nativeAssociatedLevelRelations.length
        ? ["revit-2027-associated-level-id-v1"]
        : []),
      ...(meshScene?.meshes.length
        ? [
            "revit-2027-certified-grep-brep-mesh-v1",
            ...(meshScene.boundedTessellatorElements
              ? ["revit-2027-bounded-tessellator-roots-v1"]
              : []),
            ...(meshScene.conditionedGeometryElements
              ? ["revit-2027-conditioned-geometry-roots-v1"]
              : []),
            ...(meshScene.embeddedGeometryElements
              ? ["revit-2027-embedded-gelement-v1"]
              : []),
          ]
        : []),
      ...(meshCollection?.completeNestedRoots
        ? ["revit-2027-nested-symbol-composition-v1"]
        : []),
      ...(meshCollection?.completeRequestedOwners
        ? ["revit-2027-placement-referenced-grep-composition-v1"]
        : []),
    ],
    nativeCurves: 0,
    nativeProfiles: 0,
    nativeMeshes: meshScene?.meshes.length ?? 0,
    // The native mesh census exists only where a scene was built. Reporting
    // zeroes on the diagnostic branch would claim these decoders ran and found
    // nothing, when in fact they were never given a chance to run.
    ...(scene && meshScene && meshCollection && meshCleanup
      ? {
          nativeMeshFaces: meshScene.faceMeshes,
          nativeMeshElements: meshScene.coveredElementIds.size,
          nativeWallProxyReplacements: scene.wallProxyReplacements,
          nativeMeshOwners: meshCollection.completeOwners,
          nativeMeshBoundedTessellatorCandidates:
            meshCollection.boundedTessellatorCandidateRoots,
          nativeMeshCompleteBoundedTessellatorRoots:
            meshCollection.completeBoundedTessellatorRoots,
          nativeMeshBoundedTessellatorElements:
            meshScene.boundedTessellatorElements,
          nativeMeshConditionedGeometryCandidates:
            meshCollection.conditionedGeometryCandidateRoots,
          nativeMeshCompleteConditionedGeometryRoots:
            meshCollection.completeConditionedGeometryRoots,
          nativeMeshConditionedGeometryElements:
            meshScene.conditionedGeometryElements,
          nativeMeshEmbeddedGeometryCandidates:
            meshCollection.embeddedGeometryCandidateRoots,
          nativeMeshCompleteEmbeddedGeometryRoots:
            meshCollection.completeEmbeddedGeometryRoots,
          nativeMeshEmbeddedGeometryElements:
            meshScene.embeddedGeometryElements,
          nativeMeshTriangles: meshScene.triangles,
          nativeMeshDuplicateTrianglesRemoved:
            meshCleanup.duplicateTrianglesRemoved,
          nativeMeshCrossMaterialDuplicateTrianglesRemoved:
            meshCleanup.crossMaterialDuplicateTrianglesRemoved,
          nativeRedundantWallShellTrianglesRemoved:
            meshCleanup.redundantWallShellTrianglesRemoved,
          nativeRedundantWallShellElements:
            meshCleanup.redundantWallShellElements,
          nativeHostOpeningWallTrianglesClipped:
            meshCleanup.hostTrianglesClipped,
          nativeHostOpeningWallTrianglesGenerated:
            meshCleanup.hostTrianglesGenerated,
          nativeMeshTruncated: meshScene.truncated,
          nativeMeshStoredBytes: meshCollection.storedBytes,
          nativeMeshBoundsMismatches: meshScene.boundsMismatches,
          nativeMeshCarrierComposedItems: meshScene.carrierComposedItems,
          nativeMeshCarrierComposedOutsideEnvelope:
            meshScene.carrierComposedOutsideEnvelope,
          nativeMeshMissingBounds: meshScene.missingBounds,
          nativeMeshUnrepresentedElements: meshScene.unrepresentedElements,
          nativeMeshNestedDefinitions: meshCollection.nestedDefinitions,
          nativeMeshNestedLinks: meshCollection.nestedLinks,
          nativeMeshNestedRoots: meshCollection.nestedRootOwners,
          nativeMeshCompleteNestedRoots: meshCollection.completeNestedRoots,
          nativeMeshPartialNestedRoots: meshCollection.partialNestedRoots,
          nativeMeshNestedTriangles: meshCollection.nestedTriangles,
          nativeMeshNestedFailures: meshCollection.nestedFailures,
          nativeMeshRequestedOwnerDefinitions:
            meshCollection.requestedOwnerDefinitions,
          nativeMeshCompleteRequestedOwners:
            meshCollection.completeRequestedOwners,
          nativeMeshPartialRequestedOwners:
            meshCollection.partialRequestedOwners,
          nativeMeshRequestedOwnerTriangles:
            meshCollection.requestedOwnerTriangles,
          nativeMeshRequestedOwnerFailures:
            meshCollection.requestedOwnerFailures,
        }
      : {}),
    nativeMaterialDefinitions: basis.nativeMaterialDefinitions.length,
    nativeMaterialAssignments: basis.nativeMaterialAssignedElements,
    nativeGeometryMaterialAssignments: basis.nativeGeometryMaterialAssignments.length,
    nativeCompoundStructureDefinitions:
      basis.nativeCompoundStructureDefinitions.length,
    nativeCompoundLayerMaterialAssignments:
      basis.nativeCompoundLayerMaterialAssignments.length,
    nativeFamilySymbols: basis.sharedGeometryIds.size,
    nativeFamilyRelations: basis.nativeFamilySymbolRelations.length,
    nativeHostRelations: basis.nativeHostRelations.length,
    nativeAssociatedLevelRelations: basis.nativeAssociatedLevelRelations.length,
    nativeFamilyDefinitions: basis.nativeFamilyDefinitions.length,
    nativeUniqueIds: basis.nativeIdentity?.decodedIdentityCount ?? 0,
    nativeOwnershipRecords: basis.elementOwnership?.decodedRecordCount ?? 0,
    nativeOwnershipRelations: basis.elementOwnership?.relations.length ?? 0,
    approximateSolids: basis.approximateSolids,
    nativeCategorisedElements: basis.categorisedElements,
    geometryFidelity: scene
      ? (meshScene?.meshes.length
        ? "certified-native-brep-with-proxy-fallback"
        : "native-bounds-envelope")
      : "diagnostic-only",
    materialFidelity: basis.nativeElementMaterialAssignments.length
      ? "native-assigned"
      : basis.nativeMaterialDefinitions.length
      ? "native-definitions-unassigned"
      : "display-fallback",
    semanticFidelity: basis.categorisedElements
      ? (basis.elementOwnership ? "native-categories-and-ownership" : "native-categories")
      : (basis.elementOwnership
        ? "native-ownership"
        : scene ? "record-code-heuristic" : "none"),
  };
}

/**
 * The prose the result carries, in reported order.
 *
 * Each entry states something the file was actually found to contain, so a
 * count of zero means the sentence is omitted rather than printed as "0".
 */
export function buildWarnings(
  basis: ConvertReportBasis,
  branch: ConvertBranchReport,
): string[] {
  const scene = branch.kind === "scene" ? branch : undefined;
  const { nativeCategories } = basis;
  // Which persistent assignments the branch resolved. The FamilySymbol
  // geometry-tag maps are only resolved on the scene branch, so only that
  // branch's sentence can name them.
  const materialAssigners = scene
    ? `shared geometry, ${basis.nativeFamilySymbolMaterialMaps.length.toLocaleString()} FamilySymbol geometry-tag maps, and ${basis.nativeCompoundStructureDefinitions.length.toLocaleString()} compound wall structures`
    : `shared geometry and ${basis.nativeCompoundStructureDefinitions.length.toLocaleString()} compound wall structures`;
  return [
    ...(scene
      ? [
          `${scene.drawableRecords.toLocaleString()} native element records supplied duplicated, validated 3D bounds.`,
          basis.categorisedElements
            ? `${basis.categorisedElements.toLocaleString()} elements carry a Revit category decoded from the file itself (${nativeCategories.directElements.toLocaleString()} from their own category token, ${nativeCategories.inheritedElements.toLocaleString()} inherited from a record-code consensus).`
            : "No native Revit category tokens were decoded, so element display falls back to record-code clusters.",
        ]
      : [
          ...(basis.revitVersion == null
            ? ["No Revit release was supplied, so release-specific native record decoders were safely disabled."]
            : []),
          branch.kind === "coordinate" && branch.familyScale
            ? "Family file: geometry is inferred from component-scale coordinate-like partition records and is not a native Revit element model."
            : "Geometry is inferred from coordinate-like partition records and is not a native Revit element model.",
        ]),
    ...(basis.elementOwnership
      ? [`${basis.elementOwnership.relations.length.toLocaleString()} persisted element ownership relationships were decoded from Global/ElemTable for the client model tree.`]
      : []),
    ...(scene && nativeCategories.donatedTokensOverridden
      ? [`${nativeCategories.donatedTokensOverridden.toLocaleString()} of ${(nativeCategories.donatedTokenElements ?? 0).toLocaleString()} category labels resting only on tokens that fell through from undrawn elements were overridden by their own record-code cluster's consensus.`]
      : []),
    ...(basis.nativeIdentity
      ? [`${basis.nativeIdentity.decodedIdentityCount.toLocaleString()} native Revit UniqueIds were decoded from Global/History and Global/ElemTable.`]
      : []),
    ...(basis.transmissionData?.missingReferenceCount
      ? [`${basis.transmissionData.missingReferenceCount.toLocaleString()} desired external Revit resources were not found when this model was saved; only redacted filenames and load states are exposed.`]
      : []),
    ...(basis.nativeMaterialDefinitions.length
      ? [`${basis.nativeMaterialDefinitions.length.toLocaleString()} native Revit material definitions were decoded; ${basis.nativeMaterialPalette.length.toLocaleString()} expose a packed render colour, ${basis.nativeMaterialPalette.filter((entry) => entry.material.transparency != null).length.toLocaleString()} a persisted transparency, and ${materialAssigners} persistently assign ${basis.nativeMaterialAssignedElements.toLocaleString()} placed elements. Texture channels and nested-layout transparency remain unresolved.`]
      : []),
    ...(basis.nativeFamilySymbolRelations.length
      ? [`${basis.nativeFamilySymbolRelations.length.toLocaleString()} loadable-family symbols resolve to persisted Family elements.`]
      : []),
    ...(basis.nativeHostRelations.length
      ? [`${basis.nativeHostRelations.length.toLocaleString()} persisted hosted-element relationships were decoded from InsertableInst.m_hostId.`]
      : []),
    ...(scene
      ? [
          ...(scene.meshCleanup.duplicateTrianglesRemoved
            ? [`${scene.meshCleanup.duplicateTrianglesRemoved.toLocaleString()} coincident native triangles were removed before rendering (${scene.meshCleanup.crossMaterialDuplicateTrianglesRemoved.toLocaleString()} crossed material batches).`]
            : []),
          ...(scene.meshCleanup.hostTrianglesClipped
            ? [`${scene.meshCleanup.hostTrianglesClipped.toLocaleString()} native host-wall triangles were clipped around persisted door and window openings.`]
            : []),
          ...(scene.meshCleanup.redundantWallShellTrianglesRemoved
            ? [`${scene.meshCleanup.redundantWallShellTrianglesRemoved.toLocaleString()} generic envelope-shell triangles were removed from ${scene.meshCleanup.redundantWallShellElements.toLocaleString()} walls whose complete sloped compound-layer body was independently present.`]
            : []),
          ...(scene.wallProxyReplacements
            ? [`${scene.wallProxyReplacements.toLocaleString()} native wall meshes whose plan spans overfilled a centre-corroborating location-line solid were replaced by that tighter RVT reconstruction.`]
            : []),
        ]
      : []),
    ...(basis.nativeAssociatedLevelRelations.length
      ? [`${basis.nativeAssociatedLevelRelations.length.toLocaleString()} persisted associated-level relationships were decoded from Element.m_assocLevelId.`]
      : []),
    ...(basis.persistedCadFileNames.length
      ? [`${basis.persistedCadFileNames.length.toLocaleString()} distinct DWG file names are retained in partition records; these names do not include an extractable original DWG payload.`]
      : []),
    ...(scene ? sceneWarnings(scene) : []),
    ...(branch.kind === "coordinate"
      ? [
          branch.omittedIsolatedCandidates > 0
            ? `Focused on the primary spatial cluster and omitted ${branch.omittedIsolatedCandidates.toLocaleString()} isolated candidates.`
            : "No isolated spatial cluster was removed.",
        ]
      : []),
    // Last, and only when it applies: a limit measured on one building
    // turned geometry away in this one. The census is module state that the
    // conversion resets on entry, so it is read here rather than passed in.
    ...(limitCensusWarning() ? [limitCensusWarning()!] : []),
  ];
}

/** The scene-only tail: what the display gate held back and why. */
function sceneWarnings(scene: ConvertSceneReport): string[] {
  const { displaySelection, meshScene, meshCollection } = scene;
  return [
    ...(meshScene.meshes.length
      ? [
          `${meshScene.coveredElementIds.size.toLocaleString()} elements use complete certified Revit 2027 GRep/BRep face meshes (${meshScene.triangles.toLocaleString()} triangles); their display proxies were removed only after native admission.`,
        ]
      : []),
    ...(meshCollection.incompleteOwners
      ? [
          `${meshCollection.incompleteOwners.toLocaleString()} GRep owners did not have a complete drawable Face mesh and remain on the proxy path.`,
        ]
      : []),
    ...(meshCollection.nestedRootOwners
      ? [
          `${meshCollection.completeNestedRoots.toLocaleString()} of ${meshCollection.nestedRootOwners.toLocaleString()} nested-symbol GRep roots resolved atomically through ${meshCollection.nestedLinks.toLocaleString()} exact GInstance links (${meshCollection.nestedTriangles.toLocaleString()} triangles); incomplete recursive roots remain on the proxy path.`,
        ]
      : []),
    ...(meshCollection.requestedOwnerDefinitions
      ? [
          `${meshCollection.completeRequestedOwners.toLocaleString()} of ${meshCollection.requestedOwnerDefinitions.toLocaleString()} exact placement-referenced GRep owners resolved to complete reusable local meshes (${meshCollection.requestedOwnerTriangles.toLocaleString()} triangles); incomplete or absent definitions remain on the proxy path.`,
        ]
      : []),
    ...(meshScene.boundsMismatches
      ? [
          `${meshScene.boundsMismatches.toLocaleString()} complete native items were declined because their transformed AABB escaped the element's independent RVT envelope; their proxies remain.`,
        ]
      : []),
    ...(meshScene.carrierComposedOutsideEnvelope
      ? [
          `${meshScene.carrierComposedOutsideEnvelope.toLocaleString()} of ${meshScene.carrierComposedItems.toLocaleString()} carrier-composed stringer meshes are drawn outside the element's own RVT envelope; that route composes a sibling's geometry by a state displacement and skips the envelope cross-check.`,
        ]
      : []),
    ...(meshScene.missingBounds
      ? [
          `${meshScene.missingBounds.toLocaleString()} complete native items are drawn without an independent RVT envelope to cross-check them against, because those elements have no usable bounds record of their own.`,
        ]
      : []),
    ...(meshScene.unrepresentedElements
      ? [
          `${meshScene.unrepresentedElements.toLocaleString()} complete native definition items were not drawn because no placed RVT element record names them.`,
        ]
      : []),
    ...(scene.inferredCurtainPanels
      ? [
          `${scene.inferredCurtainPanels.toLocaleString()} rectangular curtain-panel proxies were clipped by unambiguous diagonal mullion boundaries; ambiguous and ordinary bays retain their placed boxes.`,
        ]
      : []),
    ...(meshScene.truncated
      ? [
          "The certified native mesh safety cap was reached; declined elements retain their display proxies.",
        ]
      : []),
    ...(displaySelection.omittedContainerCount
      ? ["One dominant container-like envelope remains in audit and IFC output but is omitted from the default scene so it cannot hide the building."]
      : []),
    ...(displaySelection.omittedWrapperCount
      ? [`${displaySelection.omittedWrapperCount.toLocaleString()} curtain-wall/opening wrapper envelopes are hidden by default so their detailed child elements remain visible.`]
      : []),
    ...(displaySelection.unclassifiedCount
      ? [`${displaySelection.unclassifiedCount.toLocaleString()} element envelopes are drawn without a decoded Revit category, grouped as uncategorised elements.`]
      : []),
    ...(displaySelection.omittedSheetCount
      ? [`${displaySelection.omittedSheetCount.toLocaleString()} sheets are held back from the scene: a floor's own boundary sketch, which Revit stores as its own element and which would otherwise be extruded into a second slab, storey-sized plates that no category claims, and uncategorised records written under the "no class" record code, which the paired export gives geometry to in none of 304 cases.`]
      : []),
    ...(scene.omittedHelperProxies
      ? [`${scene.omittedHelperProxies.toLocaleString()} unresolved stair/railing drawing-aid records are not rendered as envelope proxies; exact native or reconstructed geometry for the same element ids remains eligible.`]
      : []),
    ...(scene.omittedCurtainAssemblyProxies
      ? [`${scene.omittedCurtainAssemblyProxies.toLocaleString()} unresolved curtain-grid/assembly envelope records are not rendered over their independently resolved panels and mullions.`]
      : []),
    meshScene.meshes.length
      ? "Geometry prefers complete certified RVT BRep faces and falls back to recovered element envelopes or analytic proxies for unsupported elements."
      : "Geometry uses exact RVT axis-aligned element envelopes; curved profiles, openings, materials, and parameters are not decoded yet.",
  ];
}
