/**
 * Explicit paired-IFC repair of viewer geometry.
 *
 * This stays separate from RVT decoding. The paired export does not redefine
 * any RVT bytes; it replaces only tagged elements the comparison has already
 * proved geometrically different, and records that external provenance.
 */
import type {
  Bounds3,
  ConvertResult,
  MeshData,
  ReferenceMeshData,
} from "./types.ts";

const FEET_PER_METRE = 3.280839895;
const RAMP_CATEGORY_ID = -2_000_180;

function hasIncompleteAggregateReference(
  record: ConvertResult["elementBounds"][number] | undefined,
): boolean {
  // Autodesk can tag only a ramp landing while emitting its flights as
  // separate untagged products. The paired GLB independently carries the full
  // ramp, so replacing that RVT body with the tagged IFC fragment would delete
  // valid geometry merely to improve an element-box score.
  return record?.categoryId === RAMP_CATEGORY_ID || record?.categoryName === "Ramps";
}

function dominantMaterials(meshes: readonly MeshData[]): Map<number, number> {
  const counts = new Map<number, Map<number, number>>();
  for (const mesh of meshes) {
    if (!mesh.elementIds) continue;
    for (const elementId of mesh.elementIds) {
      const byMaterial = counts.get(elementId) ?? new Map<number, number>();
      byMaterial.set(mesh.materialIndex, (byMaterial.get(mesh.materialIndex) ?? 0) + 1);
      counts.set(elementId, byMaterial);
    }
  }
  return new Map([...counts].map(([elementId, byMaterial]) => [
    elementId,
    [...byMaterial].sort((left, right) =>
      right[1] - left[1] || left[0] - right[0])[0]![0],
  ]));
}

function withoutElements(
  mesh: MeshData,
  excluded: ReadonlySet<number>,
): MeshData | null {
  if (!mesh.elementIds?.length) return mesh;
  const indices: number[] = [];
  const elementIds: number[] = [];
  for (let triangle = 0; triangle < mesh.elementIds.length; triangle += 1) {
    const elementId = mesh.elementIds[triangle]!;
    if (excluded.has(elementId)) continue;
    const offset = triangle * 3;
    indices.push(mesh.indices[offset]!, mesh.indices[offset + 1]!, mesh.indices[offset + 2]!);
    elementIds.push(elementId);
  }
  if (!indices.length) return null;
  if (indices.length === mesh.indices.length) return mesh;
  return {
    ...mesh,
    indices: Uint32Array.from(indices),
    elementIds: Uint32Array.from(elementIds),
  };
}

type RepairBatch = {
  positions: number[];
  indices: number[];
  colors: number[];
  elementIds: number[];
};

function emptyBounds(): Bounds3 {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

/**
 * Replace geometrically different tagged elements with their paired IFC body.
 * Untagged IFC context and already aligned elements are never copied in.
 */
export function applyIfcReferenceRepairs(
  result: ConvertResult,
  references: readonly ReferenceMeshData[],
): ConvertResult {
  const recordIds = new Set(result.elementBounds.map((record) => record.elementId));
  const recordById = new Map(result.elementBounds.map((record) => [record.elementId, record]));
  const replacementIds = new Set<number>();
  for (const reference of references) {
    if (reference.diffStatus !== "different") continue;
    for (const elementId of reference.elementIds ?? []) {
      if (
        elementId > 0 &&
        recordIds.has(elementId) &&
        !hasIncompleteAggregateReference(recordById.get(elementId))
      ) {
        replacementIds.add(elementId);
      }
    }
  }
  if (!replacementIds.size) return result;

  const materialByElement = dominantMaterials(result.meshes);
  const batches = new Map<number, RepairBatch>();
  const boundsByElement = new Map<number, Bounds3>();
  for (const reference of references) {
    if (reference.diffStatus !== "different" || !reference.elementIds) continue;
    const triangleCount = Math.min(
      reference.elementIds.length,
      Math.floor(reference.indices.length / 3),
    );
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const elementId = reference.elementIds[triangle]!;
      if (!replacementIds.has(elementId)) continue;
      const materialIndex = materialByElement.get(elementId) ?? 0;
      const batch = batches.get(materialIndex) ?? {
        positions: [], indices: [], colors: [], elementIds: [],
      };
      const vertexOffset = batch.positions.length / 3;
      const bounds = boundsByElement.get(elementId) ?? emptyBounds();
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceVertex = reference.indices[triangle * 3 + corner]! * 3;
        const absoluteX = reference.positions[sourceVertex]! * FEET_PER_METRE;
        const absoluteY = reference.positions[sourceVertex + 1]! * FEET_PER_METRE;
        const absoluteZ = reference.positions[sourceVertex + 2]! * FEET_PER_METRE;
        batch.positions.push(
          absoluteX - result.origin.x,
          absoluteY - result.origin.y,
          absoluteZ - result.origin.z,
        );
        batch.colors.push(1, 1, 1);
        bounds.min.x = Math.min(bounds.min.x, absoluteX);
        bounds.min.y = Math.min(bounds.min.y, absoluteY);
        bounds.min.z = Math.min(bounds.min.z, absoluteZ);
        bounds.max.x = Math.max(bounds.max.x, absoluteX);
        bounds.max.y = Math.max(bounds.max.y, absoluteY);
        bounds.max.z = Math.max(bounds.max.z, absoluteZ);
      }
      batch.indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
      batch.elementIds.push(elementId);
      batches.set(materialIndex, batch);
      boundsByElement.set(elementId, bounds);
    }
  }

  const retained = result.meshes.flatMap((mesh) => {
    const filtered = withoutElements(mesh, replacementIds);
    return filtered ? [filtered] : [];
  });
  const repaired = [...batches].map(([materialIndex, batch], index): MeshData => ({
    name: `Paired IFC repair ${index + 1}`,
    positions: Float32Array.from(batch.positions),
    indices: Uint32Array.from(batch.indices),
    colors: Float32Array.from(batch.colors),
    materialIndex,
    elementIds: Uint32Array.from(batch.elementIds),
    source: "reference-ifc",
  }));
  const meshes = [...retained, ...repaired];
  const triangleCount = meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0);

  return {
    ...result,
    meshes,
    elementBounds: result.elementBounds.map((record) => {
      const boundsFeet = boundsByElement.get(record.elementId);
      return boundsFeet
        ? { ...record, boundsFeet, renderGeometryProvenance: "reference-assisted" as const }
        : record;
    }),
    referenceAssistedElementIds: Uint32Array.from(
      [...replacementIds].sort((left, right) => left - right),
    ),
    stats: { ...result.stats, triangleCount },
    warnings: [
      ...result.warnings,
      `${replacementIds.size.toLocaleString()} geometrically different elements use tagged geometry from the paired IFC; Revit identity, semantics and native material assignments are retained.`,
    ],
  };
}
