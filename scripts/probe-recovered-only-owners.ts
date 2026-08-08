#!/usr/bin/env node

/**
 * Attribute every recovered-only voxel component in the GLB diff to the
 * rendered element whose bounds contain it, and print the owners grouped by
 * category with their geometry route. Names the elements behind the "review"
 * residual so a fix can target the route that drew them.
 *
 *   node --experimental-strip-types scripts/probe-recovered-only-owners.ts \
 *     model.rvt recovered.glb reference.glb
 */
import { readFileSync } from "node:fs";

import { meshBoundsByElement } from "../lib/reviter/mesh-element-bounds.ts";
import { convertModel } from "./audit-coverage.ts";
import {
  attributeResidualComponentsToElements,
  compareGlbs,
  registeredRvtElementBounds,
} from "./glb-surface-diff.ts";

const [rvtPath, recoveredPath, referencePath] = process.argv.slice(2);
if (!rvtPath || !recoveredPath || !referencePath) {
  throw new Error("usage: probe-recovered-only-owners.ts model.rvt recovered.glb reference.glb");
}

const recovered = convertModel(rvtPath);
const comparison = compareGlbs(
  readFileSync(recoveredPath),
  readFileSync(referencePath),
  0.5,
);
const renderedBounds = meshBoundsByElement(recovered.meshes);
const recordById = new Map(recovered.elementBounds.map((record) => [record.elementId, record]));
const elements = recovered.elementBounds.flatMap((record) => {
  const box = renderedBounds.get(record.elementId);
  if (!box) return [];
  return [{
    elementId: record.elementId,
    bounds: registeredRvtElementBounds(box, comparison.registration),
  }];
});
const attributed = attributeResidualComponentsToElements(
  comparison.diff.recoveredOnly,
  comparison.grid,
  elements,
);

console.log(`recoveredOnly voxels: ${comparison.diff.recoveredOnly.length}`);
console.log(`unassigned: ${attributed.unassignedIndices.length}`);
const rows = attributed.assignments
  .map((assignment) => {
    const record = recordById.get(assignment.elementId)!;
    const route = record.renderGeometryProvenance === "native"
      ? "native"
      : record.stairTreads?.length
        ? "stair-treads"
        : record.railPath?.length
          ? "rail-path"
          : record.arcs?.length
            ? "arc"
            : record.solids?.length || record.solid
              ? "analytic-solid"
              : record.orientedBox
                ? "oriented-box"
                : record.loops?.length
                  ? "sketch-prism"
                  : "bounds";
    return {
      elementId: assignment.elementId,
      voxels: assignment.indices.length,
      category: record.categoryName ?? String(record.categoryId ?? "?"),
      route,
      provenance: record.renderGeometryProvenance ?? "?",
    };
  })
  .sort((left, right) => right.voxels - left.voxels);
for (const row of rows.slice(0, 40)) {
  console.log(
    `  ${String(row.voxels).padStart(5)}  ${row.elementId}` +
    `  ${row.category}  route=${row.route}  provenance=${row.provenance}`,
  );
}
