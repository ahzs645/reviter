#!/usr/bin/env node

/**
 * Dump recovered tread quads for named stair runs beside the export's box for
 * the same tag, in absolute Revit feet, to see which edge of the flight the
 * recovery misplaces.
 *
 *   node --experimental-strip-types scripts/probe-tread-quads.ts model.rvt model.ifc 2075102 ...
 */
import { convertModel } from "./audit-coverage.ts";
import { readTruthBoxes } from "./overlay-diff.ts";

const [rvtPath, ifcPath, ...idArguments] = process.argv.slice(2);
const focusIds = idArguments.map(Number).filter((id) => Number.isFinite(id));
if (!rvtPath || !ifcPath || !focusIds.length) {
  throw new Error("usage: probe-tread-quads.ts model.rvt model.ifc <id...>");
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
for (const elementId of focusIds) {
  const record = result.elementBounds.find((entry) => entry.elementId === elementId);
  const entry = truth.get(elementId);
  console.log(`\nelement ${elementId}`);
  if (entry) {
    console.log(`  export ${entry.type} box x ${entry.box[0].toFixed(2)}..${entry.box[3].toFixed(2)}` +
      ` y ${entry.box[1].toFixed(2)}..${entry.box[4].toFixed(2)}` +
      ` z ${entry.box[2].toFixed(2)}..${entry.box[5].toFixed(2)}`);
  }
  if (!record) continue;
  const { min, max } = record.boundsFeet;
  console.log(`  record env x ${min.x.toFixed(2)}..${max.x.toFixed(2)}` +
    ` y ${min.y.toFixed(2)}..${max.y.toFixed(2)} z ${min.z.toFixed(2)}..${max.z.toFixed(2)}`);
  console.log(`  begin=${record.stairBeginWithRiser} end=${record.stairEndWithRiser}` +
    ` thickness=${record.stairTreadThicknessFeet?.toFixed(3)}` +
    ` expectedRisers=${record.stairExpectedRiserCount}`);
  for (const tread of record.stairTreads ?? []) {
    const [a, b, c, d] = tread;
    console.log(`    z=${a[2].toFixed(2)}` +
      ` rear(3->0)=(${d[0].toFixed(2)},${d[1].toFixed(2)})->(${a[0].toFixed(2)},${a[1].toFixed(2)})` +
      ` front(1->2)=(${b[0].toFixed(2)},${b[1].toFixed(2)})->(${c[0].toFixed(2)},${c[1].toFixed(2)})`);
  }
}
