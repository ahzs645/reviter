#!/usr/bin/env node

/**
 * Which wall records draw surface inside the recovered-only voxel clusters the
 * GLB diff reports? Takes cluster boxes in Revit feet and prints every wall
 * whose rendered bounds intersect one, with the geometry route that drew it.
 *
 *   node --experimental-strip-types scripts/probe-wall-clusters.ts model.rvt
 */
import { meshBoundsByElement } from "../lib/reviter/mesh-element-bounds.ts";
import { convertModel } from "./audit-coverage.ts";

const WALLS_CATEGORY = -2_000_011;

// Revit-feet boxes converted from the two dominant recovered-only clusters in
// outputs/unbc-surface-diff-2026-08-08.json (metres, glTF frame).
const CLUSTERS: Array<{ name: string; box: [number, number, number, number, number, number] }> = [
  { name: "A x166-193 y-138..-125 z38-51", box: [166.7, -138.0, 37.7, 193.0, -124.9, 50.9] },
  { name: "B x278-298 y-105..-86 z5-25", box: [278.3, -105.2, 4.9, 298.0, -85.6, 24.6] },
];

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-wall-clusters.ts model.rvt");

const result = convertModel(rvtPath);
const rendered = meshBoundsByElement(result.meshes, result.origin);

const intersects = (
  a: readonly number[],
  b: readonly number[],
) =>
  a[0]! < b[3]! && b[0]! < a[3]! &&
  a[1]! < b[4]! && b[1]! < a[4]! &&
  a[2]! < b[5]! && b[2]! < a[5]!;

for (const cluster of CLUSTERS) {
  console.log(`\ncluster ${cluster.name}`);
  for (const record of result.elementBounds) {
    if (record.categoryId !== WALLS_CATEGORY) continue;
    const box = rendered.get(record.elementId);
    if (!box || !intersects(box, cluster.box)) continue;
    const { min, max } = record.boundsFeet;
    const route = record.renderGeometryProvenance === "native"
      ? "native"
      : record.arcs?.length
        ? "arc"
        : record.solids?.length || record.solid
          ? "analytic-solid"
          : record.orientedBox
            ? "oriented-box"
            : record.loops?.length
              ? "sketch-prism"
              : "bounds";
    console.log(
      `  ${record.elementId} route=${route}` +
      ` provenance=${record.renderGeometryProvenance ?? "?"}` +
      ` env=${(max.x - min.x).toFixed(1)}x${(max.y - min.y).toFixed(1)}x${(max.z - min.z).toFixed(1)}` +
      ` drawn=[${box.map((value) => value.toFixed(1)).join(",")}]` +
      ` solids=${record.solids?.length ?? (record.solid ? 1 : 0)}` +
      ` orientedBox=${record.orientedBox != null}`,
    );
  }
}
