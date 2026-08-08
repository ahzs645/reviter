#!/usr/bin/env node

/**
 * Where exactly is the reference riser surface that the recovery does not
 * occupy, relative to the recovered tread quads of the run it sits inside?
 * Prints, per named stair-run element, each detector voxel's position and the
 * distance from the voxel to the nearest recovered tread front/rear edge in
 * plan, plus the vertical offset to the nearest tread elevation.
 *
 *   node --experimental-strip-types scripts/probe-riser-offsets.ts \
 *     model.rvt recovered.glb reference.glb 2075102 [ids...]
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

type Point3 = [number, number, number];

const STAIRS_RUN_CATEGORY = -2_000_919;
const FEET_PER_METRE = 3.280839895;

const [rvtPath, recoveredPath, referencePath, ...idArguments] = process.argv.slice(2);
const focusIds = new Set(idArguments.map(Number).filter((id) => Number.isFinite(id)));
if (!rvtPath || !recoveredPath || !referencePath) {
  throw new Error(
    "usage: probe-riser-offsets.ts model.rvt recovered.glb reference.glb [elementId...]",
  );
}

const recovered = convertModel(rvtPath);
const comparison = compareGlbs(
  readFileSync(recoveredPath),
  readFileSync(referencePath),
  0.25,
);
const renderedBounds = meshBoundsByElement(recovered.meshes);
const recordById = new Map(recovered.elementBounds.map((record) => [record.elementId, record]));
const stairElements = recovered.elementBounds.flatMap((record) => {
  if (record.categoryId !== STAIRS_RUN_CATEGORY) return [];
  const box = renderedBounds.get(record.elementId);
  if (!box) return [];
  return [{
    elementId: record.elementId,
    bounds: registeredRvtElementBounds(box, comparison.registration),
  }];
});
const attributed = attributeResidualComponentsToElements(
  comparison.missingVerticalStairRiserIndices,
  comparison.grid,
  stairElements,
);

const { registration } = comparison;
// Registered GLB metres -> RVT feet, inverting registeredRvtElementBounds.
const toFeet = ([x, y, z]: [number, number, number]): Point3 => [
  (x - registration.referenceCenter[0]) / registration.scale + registration.sourceCenter[0],
  (y - registration.referenceCenter[1]) / registration.scale + registration.sourceCenter[1],
  (z - registration.referenceCenter[2]) / registration.scale + registration.sourceCenter[2],
];

for (const assignment of attributed.assignments) {
  if (focusIds.size && !focusIds.has(assignment.elementId)) continue;
  const record = recordById.get(assignment.elementId);
  const treads = record?.stairTreads as [Point3, Point3, Point3, Point3][] | undefined;
  if (!treads?.length) continue;
  console.log(`\nelement ${assignment.elementId}: ${assignment.indices.length} voxels`);
  const elevations = [...new Set(treads.map((tread) => tread[0][2]))]
    .sort((left, right) => left - right);
  console.log(`  tread elevations (ft): ${elevations.map((z) => z.toFixed(2)).join(", ")}`);

  const edgeDistance = (point: Point3, start: Point3, end: Point3) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const parameter = lengthSquared <= 1e-12
      ? 0
      : Math.max(0, Math.min(1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    return Math.hypot(
      point[0] - (start[0] + dx * parameter),
      point[1] - (start[1] + dy * parameter),
    );
  };

  const summaries = new Map<string, number>();
  for (const index of assignment.indices.slice(0, 400)) {
    // Grid coordinates are RVT-feet-space already mapped through the same
    // registration as the element bounds; convert the voxel centre back.
    const centre = toFeet(voxelCenter(comparison.grid, index) as [number, number, number]);
    // glTF y-up registered frame -> RVT z-up feet frame used by stairTreads:
    // gltf(x, y, z) = revit(x, z, -y) so revit = (x, -z, y). The registered
    // frame is origin-relative while stairTreads are absolute Revit feet.
    const revit: Point3 = [
      centre[0] + recovered.origin.x,
      -centre[2] + recovered.origin.y,
      centre[1] + recovered.origin.z,
    ];
    let nearestFront = Infinity;
    let nearestRear = Infinity;
    for (const tread of treads) {
      nearestFront = Math.min(nearestFront, edgeDistance(revit, tread[1], tread[2]));
      nearestRear = Math.min(nearestRear, edgeDistance(revit, tread[3], tread[0]));
    }
    const nearestElevation = elevations.reduce((best, elevation) =>
      Math.abs(elevation - revit[2]) < Math.abs(best - revit[2]) ? elevation : best);
    const verticalOffset = revit[2] - nearestElevation;
    const key = `front=${nearestFront.toFixed(1)} rear=${nearestRear.toFixed(1)}` +
      ` dz=${verticalOffset.toFixed(1)}`;
    summaries.set(key, (summaries.get(key) ?? 0) + 1);
  }
  const top = [...summaries].sort((left, right) => right[1] - left[1]).slice(0, 12);
  for (const [key, count] of top) console.log(`  ${count.toString().padStart(4)}  ${key}`);
}
