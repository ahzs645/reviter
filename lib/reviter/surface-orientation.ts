import type { MeshData, Vec3 } from "./types.ts";

export type SurfaceOrientationTotals = {
  horizontal: number;
  vertical: number;
  sloped: number;
  triangles: number;
};

const HORIZONTAL_NORMAL_Z = Math.cos(5 * Math.PI / 180);
const VERTICAL_NORMAL_Z = Math.sin(5 * Math.PI / 180);
const MIN_SLOPED_FRACTION = 0.2;
const MAX_AXIS_ALIGNED_SLOPED_FRACTION = 0.02;

export function emptySurfaceOrientationTotals(): SurfaceOrientationTotals {
  return { horizontal: 0, vertical: 0, sloped: 0, triangles: 0 };
}

/** Add one triangle, weighting its orientation by surface area. */
export function addSurfaceTriangle(
  totals: SurfaceOrientationTotals,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): void {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const twiceArea = Math.hypot(nx, ny, nz);
  if (!(twiceArea > 1e-12)) return;
  const normalZ = Math.abs(nz) / twiceArea;
  if (normalZ >= HORIZONTAL_NORMAL_Z) totals.horizontal += twiceArea;
  else if (normalZ <= VERTICAL_NORMAL_Z) totals.vertical += twiceArea;
  else totals.sloped += twiceArea;
  totals.triangles += 1;
}

export function slopedSurfaceFraction(totals: SurfaceOrientationTotals): number {
  const area = totals.horizontal + totals.vertical + totals.sloped;
  return area > 0 ? totals.sloped / area : 0;
}

/**
 * A deliberately strict shape gate for a missing roof/ramp plane.
 *
 * Tessellation and hidden back faces can change surface-area ratios between
 * RVT and IFC, so ordinary ratio drift is not enough to replace geometry. We
 * require one body to be effectively axis-aligned and the other to devote at
 * least 20% of its area to genuine slopes. This catches a flattened sketch
 * prism without turning small triangulation differences into IFC repairs.
 */
export function hasMaterialSlopeDifference(
  recovered: SurfaceOrientationTotals | undefined,
  reference: SurfaceOrientationTotals | undefined,
): boolean {
  if (!recovered || !reference || recovered.triangles < 4 || reference.triangles < 4) return false;
  const recoveredSlope = slopedSurfaceFraction(recovered);
  const referenceSlope = slopedSurfaceFraction(reference);
  return (
    recoveredSlope <= MAX_AXIS_ALIGNED_SLOPED_FRACTION &&
    referenceSlope >= MIN_SLOPED_FRACTION
  ) || (
    referenceSlope <= MAX_AXIS_ALIGNED_SLOPED_FRACTION &&
    recoveredSlope >= MIN_SLOPED_FRACTION
  );
}

/** Pack one compact, transferable signature per tagged viewer element. */
export function packMeshSurfaceOrientationSignatures(
  meshes: readonly MeshData[],
): Float64Array {
  const byElement = new Map<number, SurfaceOrientationTotals>();
  for (const mesh of meshes) {
    if (!mesh.elementIds?.length) continue;
    const triangleCount = Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3));
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const points: Vec3[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.indices[triangle * 3 + corner]! * 3;
        const x = mesh.positions[vertex];
        const y = mesh.positions[vertex + 1];
        const z = mesh.positions[vertex + 2];
        if (x == null || y == null || z == null) break;
        points.push({ x, y, z });
      }
      if (points.length !== 3) continue;
      const elementId = mesh.elementIds[triangle]!;
      const totals = byElement.get(elementId) ?? emptySurfaceOrientationTotals();
      addSurfaceTriangle(totals, points[0]!, points[1]!, points[2]!);
      byElement.set(elementId, totals);
    }
  }
  const packed: number[] = [];
  for (const [elementId, totals] of [...byElement].sort((left, right) => left[0] - right[0])) {
    packed.push(
      elementId,
      totals.horizontal,
      totals.vertical,
      totals.sloped,
      totals.triangles,
    );
  }
  return Float64Array.from(packed);
}

export function unpackSurfaceOrientationSignatures(
  packed?: Float64Array,
): Map<number, SurfaceOrientationTotals> {
  const result = new Map<number, SurfaceOrientationTotals>();
  if (!packed) return result;
  for (let index = 0; index + 4 < packed.length; index += 5) {
    result.set(packed[index]!, {
      horizontal: packed[index + 1]!,
      vertical: packed[index + 2]!,
      sloped: packed[index + 3]!,
      triangles: packed[index + 4]!,
    });
  }
  return result;
}
