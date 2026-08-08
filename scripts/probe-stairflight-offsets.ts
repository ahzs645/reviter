#!/usr/bin/env node

/**
 * Signed per-axis centre offsets of drawn stair flights against the paired
 * export, and the tread-quad extent against the export box for the same tag.
 * Answers: are stair runs displaced along a consistent axis/direction, and is
 * the displacement in the tread quads themselves or in the mesh build?
 *
 *   node --experimental-strip-types scripts/probe-stairflight-offsets.ts model.rvt model.ifc
 */
import { meshBoundsByElement } from "../lib/reviter/mesh-element-bounds.ts";
import { convertModel } from "./audit-coverage.ts";
import { readTruthBoxes } from "./overlay-diff.ts";

const STAIRS_RUN_CATEGORY = -2_000_919;

const [rvtPath, ifcPath] = process.argv.slice(2);
if (!rvtPath || !ifcPath) {
  throw new Error("usage: probe-stairflight-offsets.ts model.rvt model.ifc");
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
const rendered = meshBoundsByElement(result.meshes, result.origin);

const rows: Array<{
  elementId: number;
  worst: number;
  dx: number;
  dy: number;
  dz: number;
  treadDx: number | null;
  treadDy: number | null;
}> = [];
for (const record of result.elementBounds) {
  if (record.categoryId !== STAIRS_RUN_CATEGORY) continue;
  const entry = truth.get(record.elementId);
  const drawn = rendered.get(record.elementId);
  if (!entry || !drawn || entry.type !== "IFCSTAIRFLIGHT") continue;
  const centre = (box: readonly number[], axis: number) =>
    (box[axis]! + box[axis + 3]!) / 2;
  const dx = centre(drawn, 0) - centre(entry.box, 0);
  const dy = centre(drawn, 1) - centre(entry.box, 1);
  const dz = centre(drawn, 2) - centre(entry.box, 2);
  let treadDx: number | null = null;
  let treadDy: number | null = null;
  const treads = record.stairTreads;
  if (treads?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const tread of treads) {
      for (const corner of tread) {
        if (corner[0] < minX) minX = corner[0];
        if (corner[0] > maxX) maxX = corner[0];
        if (corner[1] < minY) minY = corner[1];
        if (corner[1] > maxY) maxY = corner[1];
      }
    }
    treadDx = (minX + maxX) / 2 - centre(entry.box, 0);
    treadDy = (minY + maxY) / 2 - centre(entry.box, 1);
  }
  rows.push({
    elementId: record.elementId,
    worst: Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)),
    dx,
    dy,
    dz,
    treadDx,
    treadDy,
  });
}
rows.sort((left, right) => right.worst - left.worst);
console.log(`${rows.length} drawn stair flights matched to export products`);
const over = rows.filter((row) => row.worst > 0.5);
console.log(`${over.length} with centre error > 0.5 ft:`);
for (const row of over.slice(0, 30)) {
  console.log(
    `  ${row.elementId} dx=${row.dx.toFixed(2)} dy=${row.dy.toFixed(2)}` +
    ` dz=${row.dz.toFixed(2)}` +
    (row.treadDx == null
      ? " treads=none"
      : ` treadDx=${row.treadDx.toFixed(2)} treadDy=${row.treadDy!.toFixed(2)}`),
  );
}
