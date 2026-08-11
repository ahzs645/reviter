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
 * Convert an 8-bit sRGB triple — the space RVT persists its packed render
 * colour in — to the linear-sRGB factors `MaterialData.baseColorLinear` holds.
 *
 * This is the single definition of the transfer function for that field. It
 * belongs here rather than beside either producer's unpacking code because both
 * of them, the record-scanner palette below and `decodeRvtMaterialDefinitions`
 * in `native-decoder.ts`, feed the same `ConvertResult.materials` array and so
 * must agree to the bit. The curve is the IEC 61966-2-1 sRGB EOTF.
 */
export function srgbBytesToLinear(
  rgb: readonly [number, number, number],
): [number, number, number] {
  return rgb.map((byte) => {
    const channel = Math.min(1, Math.max(0, byte / 255));
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

/**
 * Convert independently decoded RVT packed colours into renderer materials.
 *
 * The persisted channels are sRGB bytes, so they go through `srgbBytesToLinear`
 * before they land in `baseColorLinear`: every consumer of that field reads it
 * as linear — `THREE.Color.setRGB` defaults to the linear-sRGB working space,
 * and glTF defines `baseColorFactor` as linear. The supplied Autodesk
 * derivative does write the raw byte/255 factor into its glTF, which is how
 * `scripts/audit-rvt-glb-material-palette.ts` byte-matched the two palettes;
 * that is a property of Autodesk's translator, not a colour space this field
 * may adopt, and copying it rendered every native material far too bright.
 *
 * Where the persisted `MaterialId.m_transparency` was decoded its complement
 * becomes the alpha channel, and the raw value is carried so a consumer can
 * tell decoded opacity apart from the opaque default a record without the
 * field keeps. Alpha carries no transfer function.
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
    const [red, green, blue] = srgbBytesToLinear(appearance.baseColorSrgb);
    const transparency = appearance.transparency;
    return [{
      materialElementId: definition.elementId,
      material: {
        name: definition.name,
        baseColorLinear: [
          red,
          green,
          blue,
          transparency != null ? Math.min(1, Math.max(0, 1 - transparency)) : 1,
        ],
        // The Autodesk derivative palette is entirely non-metallic and uses
        // roughness 0.2 for its appearance-backed entries.
        metallic: 0,
        roughness: 0.2,
        doubleSided: true,
        source: "rvt-material",
        assignedElements: assignedElements.get(definition.elementId)?.size ?? 0,
        ...(transparency != null ? { transparency } : {}),
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
