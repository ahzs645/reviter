import type { Box } from "./drawn-bounds.ts";
import type { MeshData, Vec3 } from "./types.ts";

/**
 * Measure the triangles that actually reached the viewer, grouped by their
 * native Revit element id and returned in absolute RVT feet.
 *
 * This is deliberately mesh-based. A decoded record envelope can be much
 * broader than a native or reconstructed body, which would turn an otherwise
 * exact RVT/IFC overlay red even when both render the same triangles.
 */
export function meshBoundsByElement(
  meshes: readonly MeshData[],
  origin: Vec3 = { x: 0, y: 0, z: 0 },
): Map<number, Box> {
  const bounds = new Map<number, Box>();
  for (const mesh of meshes) {
    if (!mesh.elementIds?.length) continue;
    const triangleCount = Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3));
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const elementId = mesh.elementIds[triangle]!;
      let box = bounds.get(elementId);
      if (!box) {
        box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        bounds.set(elementId, box);
      }
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.indices[triangle * 3 + corner]! * 3;
        const localX = mesh.positions[vertex];
        const localY = mesh.positions[vertex + 1];
        const localZ = mesh.positions[vertex + 2];
        if (localX == null || localY == null || localZ == null) continue;
        const x = localX + origin.x;
        const y = localY + origin.y;
        const z = localZ + origin.z;
        box[0] = Math.min(box[0], x); box[3] = Math.max(box[3], x);
        box[1] = Math.min(box[1], y); box[4] = Math.max(box[4], y);
        box[2] = Math.min(box[2], z); box[5] = Math.max(box[5], z);
      }
    }
  }
  return bounds;
}

