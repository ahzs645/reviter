/**
 * Helpers for the IFC GlobalId stability tests: read every GlobalId out of an
 * export, and take one element out of a `ConvertResult` the way deleting it in
 * Revit would.
 */
import type { ConvertResult } from "../../lib/reviter/types.ts";

/**
 * Every rooted entity's GlobalId, in file order.
 *
 * Every entity this exporter writes with a GlobalId writes it as its first
 * attribute, so the first quoted 22-character token of the instance is it.
 */
export function ifcGlobalIds(source: string): string[] {
  return [...source.matchAll(/^#\d+=IFC[A-Z0-9]+\('([0-9A-Za-z_$]{22})',#\d+,/gm)].map((match) => match[1]!);
}

/** `result` without element `elementId`: its record, triangles, identity and relations. */
export function withoutElement(result: ConvertResult, elementId: number): ConvertResult {
  const keep = <T extends { elementId: number }>(items: readonly T[] | undefined): T[] | undefined =>
    items?.filter((item) => item.elementId !== elementId);
  return {
    ...result,
    elementBounds: result.elementBounds.filter((record) => record.elementId !== elementId),
    meshes: result.meshes.map((mesh) => {
      if (!mesh.elementIds?.includes(elementId)) return mesh;
      const faces = [...mesh.elementIds.keys()].filter((face) => mesh.elementIds![face] !== elementId);
      return {
        ...mesh,
        indices: Uint32Array.from(faces.flatMap((face) => [...mesh.indices.subarray(face * 3, face * 3 + 3)])),
        elementIds: Uint32Array.from(faces, (face) => mesh.elementIds![face]!),
      };
    }),
    ...(result.nativeIdentity
      ? {
          nativeIdentity: {
            ...result.nativeIdentity,
            identities: result.nativeIdentity.identities.filter((identity) => identity.elementId !== elementId),
          },
        }
      : {}),
    nativeElementMaterialAssignments: keep(result.nativeElementMaterialAssignments),
    nativeCompoundLayerMaterialAssignments: keep(result.nativeCompoundLayerMaterialAssignments),
    nativeAssociatedLevelRelations: keep(result.nativeAssociatedLevelRelations),
    nativeHostRelations: result.nativeHostRelations?.filter(
      (relation) => relation.elementId !== elementId && relation.hostId !== elementId,
    ),
  };
}
