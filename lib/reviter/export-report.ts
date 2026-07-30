/** JSON audit report: what was decoded, from what evidence, and what was not. */
import type { ConvertResult, ElementBoundsRecord } from "./types";
import {
  bimSemanticFidelity,
  modelTreeFidelity,
  modelTreeReport,
} from "./ownership-report.ts";

export type ElementManifestGeometrySource =
  | "analytic-plane-solid"
  | "analytic-cylinder-arc"
  | "placed-shared-shape"
  | "door-leaf-from-shape"
  | "door-leaf-from-host-wall"
  | "sketch-prism"
  | "sketch-rail-sweep"
  | "validated-bounds-envelope";

function geometrySource(record: ElementBoundsRecord): ElementManifestGeometrySource {
  if (record.railPath) return "sketch-rail-sweep";
  if (record.loops?.length) return "sketch-prism";
  if (record.doorLeafSource === "shape") return "door-leaf-from-shape";
  if (record.doorLeafSource === "wall") return "door-leaf-from-host-wall";
  if (record.orientedBox) return "placed-shared-shape";
  if (record.solids?.length || record.solid) return "analytic-plane-solid";
  if (record.arcs?.length) return "analytic-cylinder-arc";
  return "validated-bounds-envelope";
}

function evidenceRank(record: ElementBoundsRecord): number {
  const source = geometrySource(record);
  const geometryRank: Record<ElementManifestGeometrySource, number> = {
    "sketch-rail-sweep": 8,
    "sketch-prism": 7,
    "door-leaf-from-shape": 6,
    "door-leaf-from-host-wall": 6,
    "placed-shared-shape": 5,
    "analytic-plane-solid": 4,
    "analytic-cylinder-arc": 4,
    "validated-bounds-envelope": 1,
  };
  return (
    geometryRank[source] * 1_000 +
    (record.categoryId != null ? 100 : 0) +
    (record.typeName ? 10 : 0) +
    (record.familyName ? 10 : 0) +
    (record.parameters?.length ?? 0)
  );
}

/**
 * One client-side semantic record per recovered Revit element.
 *
 * The ODA sample prompted this shape of export, but none of its code or schema
 * is used here. Every field below already exists in Reviter's own decoded
 * evidence. Persisted model ownership is exported separately because
 * `Global/ElemTable` covers many valid non-geometric records too.
 */
export function elementManifest(result: ConvertResult) {
  const identityByElement = new Map(
    result.nativeIdentity?.identities.map((identity) => [
      identity.elementId,
      identity,
    ]) ?? [],
  );
  const bestByElement = new Map<number, ElementBoundsRecord>();
  for (const record of result.elementBounds) {
    const previous = bestByElement.get(record.elementId);
    if (!previous || evidenceRank(record) > evidenceRank(previous)) {
      bestByElement.set(record.elementId, record);
    }
  }
  const drawnIds = new Set<number>();
  for (const mesh of result.meshes) {
    for (const elementId of mesh.elementIds ?? []) drawnIds.add(elementId);
  }
  const materialNameById = new Map(
    (result.nativeMaterialDefinitions ?? []).map((definition) => [
      definition.elementId,
      definition.name,
    ]),
  );
  const materialsByElement = new Map<
    number,
    Map<
      number,
      {
        evidence: Set<string>;
        geometryTags: Set<number>;
        layerIndices: Set<number>;
      }
    >
  >();
  const materialEvidence = (elementId: number, materialId: number) => {
    let byMaterial = materialsByElement.get(elementId);
    if (!byMaterial) {
      byMaterial = new Map();
      materialsByElement.set(elementId, byMaterial);
    }
    let evidence = byMaterial.get(materialId);
    if (!evidence) {
      evidence = {
        evidence: new Set(),
        geometryTags: new Set(),
        layerIndices: new Set(),
      };
      byMaterial.set(materialId, evidence);
    }
    return evidence;
  };
  for (const assignment of result.nativeElementMaterialAssignments ?? []) {
    const evidence = materialEvidence(
      assignment.elementId,
      assignment.materialId,
    );
    evidence.evidence.add(assignment.evidence);
    if ("geometryTags" in assignment) {
      for (const geometryTag of assignment.geometryTags) {
        evidence.geometryTags.add(geometryTag);
      }
    }
  }
  for (
    const assignment of result.nativeCompoundLayerMaterialAssignments ?? []
  ) {
    const evidence = materialEvidence(
      assignment.elementId,
      assignment.materialId,
    );
    evidence.evidence.add(assignment.evidence);
    evidence.layerIndices.add(assignment.layerIndex);
  }

  return [...bestByElement.values()]
    .sort((a, b) => a.elementId - b.elementId)
    .map((record) => {
      const identity = identityByElement.get(record.elementId);
      const materialAssignments = [
        ...(materialsByElement.get(record.elementId) ?? []),
      ]
        .sort((left, right) => left[0] - right[0])
        .map(([materialId, evidence]) => ({
          materialId,
          name: materialNameById.get(materialId) ?? null,
          evidence: [...evidence.evidence].sort(),
          ...(evidence.geometryTags.size
            ? { geometryTags: [...evidence.geometryTags].sort((a, b) => a - b) }
            : {}),
          ...(evidence.layerIndices.size
            ? { layerIndices: [...evidence.layerIndices].sort((a, b) => a - b) }
            : {}),
        }));
      return {
        elementId: record.elementId,
        ...(identity ? { uniqueId: identity.uniqueId } : {}),
        displayed: drawnIds.has(record.elementId),
        category: record.categoryId == null && !record.categoryName
          ? null
          : {
              id: record.categoryId ?? null,
              name: record.categoryName ?? null,
              evidence: record.categorySource ?? null,
            },
        type:
          record.typeId == null &&
            !record.typeName &&
            record.familyId == null &&
            !record.familyName &&
            record.familySymbolId == null
          ? null
          : {
              elementId: record.typeId ?? null,
              name: record.typeName ?? null,
              ...(record.familySymbolId == null
                ? {}
                : { symbolId: record.familySymbolId }),
              ...(record.familyId == null ? {} : { familyId: record.familyId }),
              ...(record.familyName ? { familyName: record.familyName } : {}),
            },
        geometry: {
          source: geometrySource(record),
          boundsFeet: record.boundsFeet,
          bodies: record.solids?.length ?? (record.solid ? 1 : record.arcs?.length ?? 1),
          nativeFaces: record.quads?.length ?? 0,
        },
        ...(materialAssignments.length
          ? { materialAssignments }
          : {}),
        parameters: (record.parameters ?? []).map(({ parameterId, name, value }) => ({
          id: parameterId,
          name,
          value,
        })),
      };
    });
}

export function makeReport(
  result: ConvertResult,
  metadata: Record<string, unknown> | null,
): string {
  const sensitiveMetadataKeys = new Set([
    "path",
    "content",
    "username",
    "centralmodelpath",
    "lastsavepath",
    "centralmodelidentity",
    "modelidentity",
    "author",
  ]);
  const safeMetadataValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(safeMetadataValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) =>
      sensitiveMetadataKeys.has(key.replace(/[^a-z]/gi, "").toLowerCase())
        ? []
        : [[key, safeMetadataValue(child)]]));
  };
  const safeMetadata = metadata
    ? safeMetadataValue(metadata) as Record<string, unknown>
    : null;
  return JSON.stringify(
    {
      schemaVersion: 2,
      generatedBy: "Reviter",
      fidelity: {
        metadata: "verified",
        container: "verified",
        geometry: result.method === "partition-bounds-recovery"
          ? "validated-rvt-element-bounds"
          : "experimental-coordinate-recovery",
        bimSemantics: bimSemanticFidelity(result),
        nativeProfiles: result.decoderCoverage.nativeProfiles,
        nativeMeshes: result.decoderCoverage.nativeMeshes,
        materialDefinitions: result.decoderCoverage.nativeMaterialDefinitions,
        materialAssignments: result.decoderCoverage.nativeMaterialAssignments,
        nativeUniqueIds: result.decoderCoverage.nativeUniqueIds ?? 0,
        ...modelTreeFidelity(result),
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
      partAtom: result.partAtom ?? null,
      transmissionData: result.transmissionData ?? null,
      modelTree: modelTreeReport(result),
      nativeMaterialDefinitions: result.nativeMaterialDefinitions ?? [],
      nativeFamilyDefinitions: result.nativeFamilyDefinitions ?? [],
      streamCoverage: result.coverage ?? null,
      nativeProfiles: result.nativeProfiles,
      elementManifest: {
        count: new Set(result.elementBounds.map((record) => record.elementId)).size,
        parameterValueEncoding: "f64 in Revit internal units; decoded lengths are feet",
        unavailableFields: [
          ...(!result.nativeIdentity ? ["Revit UniqueId"] : []),
          ...((result.nativeFamilyDefinitions?.length ?? 0) === 0
            ? ["loadable-family name"]
            : []),
          "full family regeneration",
          ...(!result.elementOwnership ? ["model-tree hierarchy"] : []),
          ...(result.decoderCoverage.nativeMaterialAssignments === 0
            ? ["element-to-material assignment"]
            : []),
          "per-face material assignment",
        ],
        elements: elementManifest(result),
      },
      materials: result.materials,
      standardsAwareReader: result.readerDiagnostics ?? null,
      warnings: result.warnings,
    },
    null,
    2,
  );
}
