/**
 * What survives "Isolate 3D floor", by category.
 *
 * Isolating a storey keeps only elements the model files against that storey's
 * levels. Anything Revit never associated with a level — or associated with a
 * level outside the composed storey — disappears, and a floor slab going
 * missing is the visible symptom. This prints the split so the cause is a
 * number rather than a guess.
 *
 *   node --experimental-strip-types scripts/probe-storey-isolation.ts model.rvt [cache.json]
 */
import { existsSync, readFileSync } from "node:fs";

import { connectedFloorPlanGroups } from "../lib/reviter/connected-floor-plans.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

const input = process.argv[2];
if (!input) {
  console.error("usage: node --experimental-strip-types scripts/probe-storey-isolation.ts <model.rvt> [cache.json]");
  process.exit(2);
}
const cachePath = process.argv[3];
let result: ConvertResult;
if (cachePath && existsSync(cachePath)) {
  result = JSON.parse(readFileSync(cachePath, "utf8")) as ConvertResult;
} else {
  const outcome = await convertRvtBytes(new Uint8Array(readFileSync(input)));
  if (!("elementBounds" in outcome)) { console.error("conversion failed"); process.exit(1); }
  result = outcome;
}

const relations = result.nativeAssociatedLevelRelations ?? [];
const levelsByElement = new Map<number, number[]>();
for (const relation of relations) {
  const ids = levelsByElement.get(relation.elementId) ?? [];
  ids.push(relation.levelId);
  levelsByElement.set(relation.elementId, ids);
}

const unassociated = result.elementBounds.filter((record) => !levelsByElement.has(record.elementId));
console.log(`elements: ${result.elementBounds.length.toLocaleString()}`);
console.log(`with a level relation: ${(result.elementBounds.length - unassociated.length).toLocaleString()}`);
console.log(`with none — hidden by any isolate: ${unassociated.length.toLocaleString()}\n`);

const byCategory = new Map<string, number>();
for (const record of unassociated) {
  const name = record.categoryName ?? "Uncategorised";
  byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
}
console.log("unassociated by category (these vanish whenever a floor is isolated):");
for (const [name, count] of [...byCategory].sort((left, right) => right[1] - left[1]).slice(0, 12)) {
  console.log(`  ${name.padEnd(28)} ${count.toLocaleString().padStart(7)}`);
}

const groups = connectedFloorPlanGroups(result)
  .sort((left, right) => left.minElevation - right.minElevation);
console.log("\nper storey, what isolate keeps:\n");
console.log("STOREY            KEPT     FLOORS  WALLS   DOORS   WINDOWS  STAIRS");
for (const group of groups) {
  const storey = new Set(group.levelIds);
  const kept = result.elementBounds.filter((record) =>
    (levelsByElement.get(record.elementId) ?? []).some((id) => storey.has(id)));
  const count = (match: (name: string) => boolean) =>
    kept.filter((record) => match(record.categoryName ?? "")).length;
  console.log(
    `${`${group.minElevation.toFixed(1)}'`.padEnd(17)} ` +
    `${kept.length.toLocaleString().padStart(7)}  ` +
    `${String(count((name) => name === "Floors")).padStart(6)}  ` +
    `${String(count((name) => name.startsWith("Walls") || name.includes("Curtain Wall"))).padStart(6)}  ` +
    `${String(count((name) => name === "Doors")).padStart(6)}  ` +
    `${String(count((name) => name === "Windows")).padStart(7)}  ` +
    `${String(count((name) => name.startsWith("Stairs"))).padStart(6)}`,
  );
}

// The ground storey in detail: are its own floor slabs actually kept?
const ground = groups.find((group) => group.minElevation <= 0 && group.maxElevation >= 0) ?? groups[0];
if (ground) {
  const storey = new Set(ground.levelIds);
  const floors = result.elementBounds.filter((record) => record.categoryName === "Floors");
  const keptFloors = floors.filter((record) =>
    (levelsByElement.get(record.elementId) ?? []).some((id) => storey.has(id)));
  const groundish = floors.filter((record) =>
    record.boundsFeet.min.z >= ground.minElevation - 4 && record.boundsFeet.min.z <= ground.maxElevation + 4);
  const missed = groundish.filter((record) => !keptFloors.includes(record));
  console.log(`\nground storey [${ground.levelIds.join(", ")}]:`);
  console.log(`  floor slabs kept by isolate:            ${keptFloors.length}`);
  console.log(`  floor slabs sitting at that elevation:  ${groundish.length}`);
  console.log(`  sitting there but dropped by isolate:   ${missed.length}`);
  for (const record of missed.slice(0, 8)) {
    console.log(
      `    element ${record.elementId} at z ${record.boundsFeet.min.z.toFixed(1)}' ` +
      `levels [${(levelsByElement.get(record.elementId) ?? []).join(", ") || "none"}]`,
    );
  }
}
