/** Evidence gate for native wall meshes that include join/sweep overhangs. */
import type { Bounds3, ElementBoundsRecord, MeshData, Vec3 } from "./types.ts";

const WALL_CATEGORY_ID = -2_000_011;
const PLAN_SPAN_DISAGREEMENT_FEET = 0.5;
const CENTRE_CORROBORATION_FEET = 0.1;
const VERTICAL_SPAN_CORROBORATION_FEET = 0.25;

function emptyBounds(): Bounds3 {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

function include(bounds: Bounds3, x: number, y: number, z: number): void {
  bounds.min.x = Math.min(bounds.min.x, x);
  bounds.min.y = Math.min(bounds.min.y, y);
  bounds.min.z = Math.min(bounds.min.z, z);
  bounds.max.x = Math.max(bounds.max.x, x);
  bounds.max.y = Math.max(bounds.max.y, y);
  bounds.max.z = Math.max(bounds.max.z, z);
}

function solidProxyBounds(record: ElementBoundsRecord): Bounds3 | null {
  const solids = record.solids?.length
    ? record.solids
    : record.solid
      ? [record.solid]
      : [];
  if (!solids.length) return null;
  const bounds = emptyBounds();
  for (const solid of solids) {
    const dx = solid.end.x - solid.start.x;
    const dy = solid.end.y - solid.start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !(solid.topElevation > solid.baseElevation)) return null;
    const nx = (-dy / length) * solid.thickness * 0.5;
    const ny = (dx / length) * solid.thickness * 0.5;
    for (const end of [solid.start, solid.end]) {
      for (const sign of [-1, 1]) {
        include(
          bounds,
          end.x + nx * sign,
          end.y + ny * sign,
          solid.baseElevation,
        );
        include(
          bounds,
          end.x + nx * sign,
          end.y + ny * sign,
          solid.topElevation,
        );
      }
    }
  }
  return bounds;
}

function meshBoundsByElement(
  meshes: readonly MeshData[],
  origin: Vec3,
  targets: ReadonlySet<number>,
): Map<number, Bounds3> {
  const byElement = new Map<number, Bounds3>();
  for (const mesh of meshes) {
    if (!mesh.elementIds?.length) continue;
    const triangles = Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3));
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const elementId = mesh.elementIds[triangle]!;
      if (!targets.has(elementId)) continue;
      const bounds = byElement.get(elementId) ?? emptyBounds();
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.indices[triangle * 3 + corner]! * 3;
        include(
          bounds,
          mesh.positions[vertex]! + origin.x,
          mesh.positions[vertex + 1]! + origin.y,
          mesh.positions[vertex + 2]! + origin.z,
        );
      }
      byElement.set(elementId, bounds);
    }
  }
  return byElement;
}

const span = (bounds: Bounds3, axis: "x" | "y" | "z") =>
  bounds.max[axis] - bounds.min[axis];
const centre = (bounds: Bounds3, axis: "x" | "y" | "z") =>
  (bounds.max[axis] + bounds.min[axis]) / 2;

/**
 * Native wall meshes whose plan span overfills their independently recovered
 * location-line solid while both readings still identify the same wall.
 *
 * The rule uses RVT evidence only. The paired UNBC IFC validates its scope:
 * 660 native meshes meet the broad span/centre gate, and selecting the smaller
 * recovered solid improves size agreement from 5.2% to 98.6%. Restricting the
 * decision to native *overfill* (not any disagreement) isolates the join/sweep
 * residual and avoids incomplete recovered solids that are smaller for the
 * wrong reason.
 */
export function nativeWallProxyReplacementIds(
  meshes: readonly MeshData[],
  origin: Vec3,
  records: readonly ElementBoundsRecord[],
  renderedProxyMeshes?: readonly MeshData[],
): Set<number> {
  const proxyBounds = new Map<number, Bounds3>();
  for (const record of records) {
    if (record.categoryId !== WALL_CATEGORY_ID) continue;
    const bounds = solidProxyBounds(record);
    if (bounds) proxyBounds.set(record.elementId, bounds);
  }
  if (renderedProxyMeshes) {
    const rendered = meshBoundsByElement(
      renderedProxyMeshes,
      origin,
      new Set(proxyBounds.keys()),
    );
    proxyBounds.clear();
    for (const [elementId, bounds] of rendered) proxyBounds.set(elementId, bounds);
  }
  const nativeBounds = meshBoundsByElement(meshes, origin, new Set(proxyBounds.keys()));
  const replacements = new Set<number>();
  for (const [elementId, proxy] of proxyBounds) {
    const native = nativeBounds.get(elementId);
    if (!native) continue;
    const planOverfill = Math.max(
      span(native, "x") - span(proxy, "x"),
      span(native, "y") - span(proxy, "y"),
    );
    const centreDisagreement = Math.max(
      Math.abs(centre(native, "x") - centre(proxy, "x")),
      Math.abs(centre(native, "y") - centre(proxy, "y")),
      Math.abs(centre(native, "z") - centre(proxy, "z")),
    );
    const verticalSpanDisagreement = Math.abs(span(native, "z") - span(proxy, "z"));
    if (
      planOverfill >= PLAN_SPAN_DISAGREEMENT_FEET &&
      centreDisagreement < CENTRE_CORROBORATION_FEET &&
      verticalSpanDisagreement < VERTICAL_SPAN_CORROBORATION_FEET
    ) {
      replacements.add(elementId);
    }
  }
  return replacements;
}
