#!/usr/bin/env node

/**
 * For named elements, print where their recovered-only voxels sit in Revit
 * feet relative to the element's own record: envelope, solids, and the paired
 * export's box for the same id. Shows which face of what we draw is surface
 * the Autodesk reference does not have.
 *
 *   node --experimental-strip-types scripts/probe-element-overdraw.ts \
 *     model.rvt model.ifc recovered.glb reference.glb 331585 530175 ...
 */
import { readFileSync } from "node:fs";

import { meshBoundsByElement } from "../lib/reviter/mesh-element-bounds.ts";
import { convertModel } from "./audit-coverage.ts";
import {
  attributeResidualComponentsToElements,
  compareGlbs,
  registeredRvtElementBounds,
  voxelCenter,
} from "./glb-surface-diff.ts";
import { readTruthBoxes } from "./overlay-diff.ts";

const [rvtPath, ifcPath, recoveredPath, referencePath, ...idArguments] = process.argv.slice(2);
const focusIds = new Set(idArguments.map(Number).filter((id) => Number.isFinite(id)));
if (!rvtPath || !ifcPath || !recoveredPath || !referencePath || !focusIds.size) {
  throw new Error(
    "usage: probe-element-overdraw.ts model.rvt model.ifc recovered.glb reference.glb <id...>",
  );
}

const recovered = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
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

const { registration } = comparison;
const toFeet = ([x, y, z]: [number, number, number]) => [
  (x - registration.referenceCenter[0]) / registration.scale + registration.sourceCenter[0],
  (y - registration.referenceCenter[1]) / registration.scale + registration.sourceCenter[1],
  (z - registration.referenceCenter[2]) / registration.scale + registration.sourceCenter[2],
];

const formatBox = (box: readonly number[]) =>
  `[${box.map((value) => value.toFixed(1)).join(", ")}]`;

for (const assignment of attributed.assignments) {
  if (!focusIds.has(assignment.elementId)) continue;
  const record = recordById.get(assignment.elementId)!;
  const { min, max } = record.boundsFeet;
  console.log(`\nelement ${assignment.elementId} (${record.categoryName}):` +
    ` ${assignment.indices.length} voxels, ${assignment.components} components`);
  console.log(`  envelope ft x ${min.x.toFixed(1)}..${max.x.toFixed(1)}` +
    ` y ${min.y.toFixed(1)}..${max.y.toFixed(1)} z ${min.z.toFixed(1)}..${max.z.toFixed(1)}`);
  const drawn = renderedBounds.get(assignment.elementId);
  if (drawn) console.log(`  drawn (origin-relative) ${formatBox(drawn)}`);
  const truthEntry = truth.get(assignment.elementId);
  if (truthEntry) {
    console.log(`  export ${truthEntry.type} box ${formatBox(truthEntry.box)}` +
      ` (${truthEntry.parts.length} parts)`);
  } else {
    console.log("  export: no product with this tag");
  }
  const solids = record.solids ?? (record.solid ? [record.solid] : []);
  for (const solid of solids.slice(0, 6)) {
    const anySolid = solid as Record<string, unknown>;
    console.log(`  solid keys=${Object.keys(anySolid).join(",")}`);
  }
  // Histogram of voxel positions, origin-relative Revit feet.
  const counts = new Map<string, number>();
  for (const index of assignment.indices) {
    const [x, y, z] = toFeet(voxelCenter(comparison.grid, index) as [number, number, number]);
    const revit = [
      x! + recovered.origin.x,
      -z! + recovered.origin.y,
      y! + recovered.origin.z,
    ];
    const key = `x=${(Math.round(revit[0]! / 2) * 2).toFixed(0)}` +
      ` y=${(Math.round(revit[1]! / 2) * 2).toFixed(0)}` +
      ` z=${(Math.round(revit[2]! / 2) * 2).toFixed(0)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts].sort((left, right) => right[1] - left[1]).slice(0, 15);
  for (const [key, count] of top) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }
}
