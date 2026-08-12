/**
 * The persisted relationships and materials a Revit file states about its own
 * elements, resolved from the candidates the partition scan collected.
 *
 * Every scan in the page walk can only propose: a family-symbol reference, a
 * material id beside a geometry tag, a host id, an associated level. Resolving
 * them needs the whole file — which symbols were ever placed, which material
 * elements really exist, which ids the element table knows — so it happens here,
 * once, after the walk.
 *
 * Two of these outputs are more than a report. `materials` is the display
 * palette every mesh batch indexes into, and it is built here because the
 * native material definitions are what extend it; `proxyMaterialIndexByElement`
 * is the per-element answer the proxy builder needs, and it deliberately
 * declines multi-material elements rather than picking one of their materials.
 */
import {
  resolveCompoundLayerMaterialAssignments,
} from "./compound-structure-materials.ts";
import {
  resolveElementMaterialAssignments,
  resolveFamilySymbolRelations,
  resolveGeometryMaterialAssignments,
  resolveUniqueFamilySymbolTargets,
} from "./family-material-relations.ts";
import {
  resolveFamilySymbolMaterialAssignments,
  resolveFamilySymbolMaterialMaps,
} from "./family-symbol-materials.ts";
import { resolveHostRelations } from "./host-relations.ts";
import { resolveAssociatedLevelRelations } from "./level-relations.ts";
import { buildNativeMaterialPalette } from "./material-palette.ts";
import { displayMaterials } from "./scene.ts";

import type {
  NativeCompoundLayerMaterialAssignment,
  NativeCompoundStructureDefinition,
} from "./compound-structure-materials.ts";
import type {
  FamilySymbolCandidate,
  FamilySymbolReferenceSet,
  GeometryMaterialCandidate,
  NativeElementMaterialAssignment,
  NativeFamilyDefinition,
  NativeFamilySymbolRelation,
  NativeFixedFamilySymbolRelation,
  NativeGeometryMaterialAssignment,
  NativeUniqueFamilyTargetRelation,
} from "./family-material-relations.ts";
import type {
  FamilySymbolMaterialReferenceSet,
  NativeFamilySymbolMaterialAssignment,
  NativeFamilySymbolMaterialMap,
} from "./family-symbol-materials.ts";
import type { HostRelationCandidate, NativeHostRelation } from "./host-relations.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import type {
  AssociatedLevelRelationCandidate,
  NativeAssociatedLevelRelation,
} from "./level-relations.ts";
import type { NativeMaterialPaletteEntry } from "./material-palette.ts";
import type {
  ElementBoundsRecord,
  LocatedNativeMaterialDefinition,
  MaterialData,
} from "./types.ts";

export type NativeRelationsInput = {
  /** Records the resolved family identity is written onto. */
  elementBounds: ElementBoundsRecord[];
  instancePlacements: Map<number, InstancePlacement>;
  /** Local shape ids proven to be referenced by a placement. */
  sharedGeometryIds: Set<number>;
  familyElementIds: Set<number>;
  familySymbolCandidates: FamilySymbolCandidate[];
  familySymbolReferenceSets: FamilySymbolReferenceSet[];
  nativeFamilyDefinitionMap: Map<number, NativeFamilyDefinition>;
  nativeMaterialDefinitionMap: Map<number, LocatedNativeMaterialDefinition>;
  geometryMaterialCandidates: GeometryMaterialCandidate[];
  familySymbolMaterialReferenceSets: FamilySymbolMaterialReferenceSet[];
  familySymbolMaterialPlacements: InstancePlacement[];
  /** `element id -> type id`, for expanding compound-structure layers. */
  typeReferences: Map<number, number>;
  nativeCompoundStructureDefinitions: NativeCompoundStructureDefinition[];
  hostRelationCandidates: HostRelationCandidate[];
  associatedLevelRelationCandidates: AssociatedLevelRelationCandidate[];
  /** `element id -> object marker`; the class key both resolvers verify against. */
  markerByElement: Map<number, number>;
};

export type NativeRelations = {
  materialElementIds: Set<number>;
  nativeMaterialDefinitions: LocatedNativeMaterialDefinition[];
  nativeMaterialPalette: NativeMaterialPaletteEntry[];
  /** The display palette, extended with every decoded native material. */
  materials: MaterialData[];
  nativeMaterialIndexById: Map<number, number>;
  /** The one unambiguous material an element-wide proxy may be drawn in. */
  proxyMaterialIndexByElement: Map<number, number>;
  /** Wall layer materials, which the native mesh cleanup prefers by element. */
  preferredWallMaterialIdsByElement: Map<number, Set<number>>;
  nativeMaterialAssignedElements: number;
  fixedFamilySymbolRelations: NativeFixedFamilySymbolRelation[];
  staticTailFamilyTargetRelations: NativeUniqueFamilyTargetRelation[];
  nativeFamilySymbolRelations: NativeFamilySymbolRelation[];
  nativeFamilyDefinitions: NativeFamilyDefinition[];
  nativeGeometryMaterialAssignments: NativeGeometryMaterialAssignment[];
  nativeElementMaterialAssignments: NativeElementMaterialAssignment[];
  nativeFamilySymbolMaterialMaps: NativeFamilySymbolMaterialMap[];
  nativeFamilySymbolMaterialAssignments: NativeFamilySymbolMaterialAssignment[];
  nativeCompoundLayerMaterialAssignments: NativeCompoundLayerMaterialAssignment[];
  nativeHostRelations: NativeHostRelation[];
  nativeAssociatedLevelRelations: NativeAssociatedLevelRelation[];
};

export function resolveNativeRelations(
  input: NativeRelationsInput,
): NativeRelations {
  const {
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
  } = input;
  // The same set answers three questions below — which material ids exist —
  // and the definition map is complete before this stage runs.
  const materialElementIds = new Set(nativeMaterialDefinitionMap.keys());
  const nativeMaterialDefinitions = [...nativeMaterialDefinitionMap.values()]
    .sort((left, right) => left.elementId - right.elementId);
  const fixedFamilySymbolRelations = resolveFamilySymbolRelations(
    familySymbolCandidates,
    familyElementIds,
    sharedGeometryIds,
  );
  const staticTailFamilyTargetRelations = resolveUniqueFamilySymbolTargets(
    familySymbolReferenceSets,
    familyElementIds,
    sharedGeometryIds,
  );
  const familyRelationBySymbol = new Map<
    number,
    NativeFamilySymbolRelation
  >();
  // The release-specific fixed field is stronger evidence where both paths
  // identify the same symbol. The native static-tail path fills
  // variable-width layouts and fails closed on more than one certified
  // Family target.
  for (const relation of staticTailFamilyTargetRelations) {
    familyRelationBySymbol.set(relation.symbolId, relation);
  }
  for (const relation of fixedFamilySymbolRelations) {
    familyRelationBySymbol.set(relation.symbolId, relation);
  }
  const nativeFamilySymbolRelations = [...familyRelationBySymbol.values()]
    .sort((left, right) => left.symbolId - right.symbolId);
  const referencedFamilyIds = new Set(
    nativeFamilySymbolRelations.map((relation) => relation.familyId),
  );
  const nativeFamilyDefinitions = [...nativeFamilyDefinitionMap.values()]
    .filter((definition) => referencedFamilyIds.has(definition.familyId))
    .sort((left, right) => left.familyId - right.familyId);
  const familyDefinitionById = new Map(
    nativeFamilyDefinitions.map((definition) => [definition.familyId, definition]),
  );
  for (const record of elementBounds) {
    const placement = instancePlacements.get(record.elementId);
    if (!placement) continue;
    const symbolId = placement.symbolId ?? placement.geometryId;
    record.familySymbolId = symbolId;
    const relation = familyRelationBySymbol.get(symbolId);
    if (!relation) continue;
    record.familyId = relation.familyId;
    record.familyName = familyDefinitionById.get(relation.familyId)?.name;
  }
  const nativeGeometryMaterialAssignments = resolveGeometryMaterialAssignments(
    geometryMaterialCandidates,
    materialElementIds,
    sharedGeometryIds,
  );
  const nativeSharedGeometryMaterialAssignments =
    resolveElementMaterialAssignments(
    instancePlacements.values(),
    nativeGeometryMaterialAssignments,
    sharedGeometryIds,
  );
  const nativeFamilySymbolMaterialMaps = resolveFamilySymbolMaterialMaps(
    familySymbolMaterialReferenceSets,
    materialElementIds,
  );
  const nativeFamilySymbolMaterialAssignments =
    resolveFamilySymbolMaterialAssignments(
      familySymbolMaterialPlacements,
      nativeFamilySymbolMaterialMaps,
    );
  const nativeElementMaterialAssignments = [
    ...nativeSharedGeometryMaterialAssignments,
    ...nativeFamilySymbolMaterialAssignments,
  ];
  const nativeCompoundLayerMaterialAssignments =
    resolveCompoundLayerMaterialAssignments(
      [...typeReferences].map(([elementId, typeId]) => ({
        elementId,
        typeId,
      })),
      nativeCompoundStructureDefinitions,
    );
  const nativeMaterialAssignedElements = new Set(
    [
      ...nativeElementMaterialAssignments,
      ...nativeCompoundLayerMaterialAssignments,
    ].map((assignment) => assignment.elementId),
  ).size;
  const nativeMaterialPalette = buildNativeMaterialPalette(
    nativeMaterialDefinitions,
    [
      ...nativeElementMaterialAssignments,
      ...nativeCompoundLayerMaterialAssignments,
    ],
  );
  const materials = displayMaterials();
  const nativeMaterialIndexById = new Map<number, number>();
  for (const entry of nativeMaterialPalette) {
    nativeMaterialIndexById.set(entry.materialElementId, materials.length);
    materials.push(entry.material);
  }
  const proxyMaterialIdsByElement = new Map<number, Set<number>>();
  for (const assignment of nativeElementMaterialAssignments) {
    if (!nativeMaterialIndexById.has(assignment.materialId)) continue;
    const materialIds = proxyMaterialIdsByElement.get(assignment.elementId)
      ?? new Set<number>();
    materialIds.add(assignment.materialId);
    proxyMaterialIdsByElement.set(assignment.elementId, materialIds);
  }
  // An element-wide proxy can represent only one material faithfully. Use a
  // persisted assignment when it is unambiguous; multi-material family
  // geometry continues to use the category fallback instead of choosing an
  // arbitrary material for the whole proxy.
  const proxyMaterialIndexByElement = new Map<number, number>();
  for (const [elementId, materialIds] of proxyMaterialIdsByElement) {
    if (materialIds.size !== 1) continue;
    const [materialId] = materialIds;
    const materialIndex = nativeMaterialIndexById.get(materialId!);
    if (materialIndex != null) {
      proxyMaterialIndexByElement.set(elementId, materialIndex);
    }
  }
  const nativeHostRelations = resolveHostRelations(
    hostRelationCandidates,
    new Set(markerByElement.keys()),
  );
  const preferredWallMaterialIdsByElement = new Map<number, Set<number>>();
  for (const assignment of nativeCompoundLayerMaterialAssignments) {
    const materialIds = preferredWallMaterialIdsByElement.get(
      assignment.elementId,
    ) ?? new Set<number>();
    materialIds.add(assignment.materialId);
    preferredWallMaterialIdsByElement.set(assignment.elementId, materialIds);
  }
  const nativeAssociatedLevelRelations = resolveAssociatedLevelRelations(
    associatedLevelRelationCandidates,
    markerByElement,
  );
  return {
    materialElementIds,
    nativeMaterialDefinitions,
    nativeMaterialPalette,
    materials,
    nativeMaterialIndexById,
    proxyMaterialIndexByElement,
    preferredWallMaterialIdsByElement,
    nativeMaterialAssignedElements,
    fixedFamilySymbolRelations,
    staticTailFamilyTargetRelations,
    nativeFamilySymbolRelations,
    nativeFamilyDefinitions,
    nativeGeometryMaterialAssignments,
    nativeElementMaterialAssignments,
    nativeFamilySymbolMaterialMaps,
    nativeFamilySymbolMaterialAssignments,
    nativeCompoundLayerMaterialAssignments,
    nativeHostRelations,
    nativeAssociatedLevelRelations,
  };
}
