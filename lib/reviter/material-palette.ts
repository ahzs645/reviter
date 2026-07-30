import type {
  LocatedNativeMaterialDefinition,
  MaterialData,
  MeshData,
} from "./types.ts";

export type MaterialAssignmentLike = {
  elementId: number;
  materialId: number;
};

export type NativeMaterialPaletteEntry = {
  materialElementId: number;
  material: MaterialData;
};

/**
 * Convert independently decoded RVT packed colours into renderer materials.
 *
 * The channel values stay as byte/255 factors because that is exactly how the
 * supplied Autodesk derivative encodes the same palette in glTF. Transparency
 * remains opaque until the separate persisted transparency field is decoded.
 */
export function buildNativeMaterialPalette(
  definitions: readonly LocatedNativeMaterialDefinition[],
  assignments: Iterable<MaterialAssignmentLike> = [],
): NativeMaterialPaletteEntry[] {
  const assignedElements = new Map<number, Set<number>>();
  for (const assignment of assignments) {
    const elements = assignedElements.get(assignment.materialId) ?? new Set<number>();
    elements.add(assignment.elementId);
    assignedElements.set(assignment.materialId, elements);
  }

  return definitions.flatMap((definition) => {
    const appearance = definition.appearance;
    if (!appearance) return [];
    const [red, green, blue] = appearance.baseColorSrgb;
    return [{
      materialElementId: definition.elementId,
      material: {
        name: definition.name,
        baseColorLinear: [red / 255, green / 255, blue / 255, 1],
        // The Autodesk derivative palette is entirely non-metallic and uses
        // roughness 0.2 for its appearance-backed entries.
        metallic: 0,
        roughness: 0.2,
        doubleSided: true,
        source: "rvt-material",
        assignedElements: assignedElements.get(definition.elementId)?.size ?? 0,
      },
    }];
  });
}

/** Assign renderer material slots only to meshes with an exact persisted id. */
export function applyNativeMaterialIndices(
  meshes: readonly MeshData[],
  materialIndexById: ReadonlyMap<number, number>,
): number {
  let assigned = 0;
  for (const mesh of meshes) {
    if (mesh.nativeMaterialElementId == null) continue;
    const materialIndex = materialIndexById.get(mesh.nativeMaterialElementId);
    if (materialIndex == null) continue;
    mesh.materialIndex = materialIndex;
    assigned += 1;
  }
  return assigned;
}
