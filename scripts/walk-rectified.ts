/**
 * Walk the recovered model before and after rectification, first person.
 *
 * Usage:
 *   node --experimental-strip-types scripts/walk-rectified.ts model.rvt \
 *     --wings wings.json [--at "20,240"] [--stride 2]
 *
 * The consumer downstream measures rectification on its voxel lattice. This
 * measures it on the model's own triangles with the studio's own walk physics —
 * a 0.6 m step-up, a 1.8 m eye, real collision — so a difference in the number
 * is a difference in the building, not in the voxelizer.
 */
import { readFileSync } from "node:fs";

import { hasFlag, isEntryPoint, optionValue } from "./lib/rvt-harness.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { contactClaims, planCentre, wingAt, type RectifyPlanInput, type Wing }
  from "../lib/reviter/rectify-plan.ts";
import {
  rectifiedTriangles, startNear, triangleBounds, walkFrom, walkIndexes, wingsFor,
} from "../lib/reviter/rectify-walk.ts";

const METRES_PER_FOOT = 0.3048;
const TOUCH_METRES = 0.6;
const REACH_METRES = 6;

export function parseWalkArguments(argv: string[]) {
  const input = argv[0];
  const wings = optionValue("--wings", argv);
  if (!input || input.startsWith("-") || !wings) {
    throw new Error("Usage: walk-rectified.ts model.rvt --wings wings.json " +
      "[--at \"x,y\" in metres] [--stride 2] [--no-claims]");
  }
  const at = (optionValue("--at", argv) ?? "").split(",").map(Number);
  const stride = Number(optionValue("--stride", argv) ?? 2);
  return {
    input, wings, stride, claims: !hasFlag("--no-claims", argv),
    at: at.length === 2 && at.every(Number.isFinite) ? [at[0]!, at[1]!] as [number, number] : null,
  };
}

export async function runWalk(args: ReturnType<typeof parseWalkArguments>): Promise<void> {
  const transforms = JSON.parse(readFileSync(args.wings, "utf8")) as RectifyPlanInput;
  const bytes = readFileSync(args.input);
  process.stderr.write(`reading ${args.input} ...\n`);
  const outcome = convertRvtBytes(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    args.input.split("/").pop() ?? "model.rvt", {},
    ({ ratio }) => process.stderr.write(`\r  ${(ratio * 100).toFixed(0).padStart(3)}%`));
  process.stderr.write("\n");
  if (!outcome.ok) throw new Error(`Could not read ${args.input}.`);
  const result = outcome;

  const origin: [number, number] = [result.origin?.x ?? 0, result.origin?.y ?? 0];
  process.stderr.write(
    `model origin ${origin[0].toFixed(1)}, ${origin[1].toFixed(1)} ft ` +
    `(${(origin[0] * METRES_PER_FOOT).toFixed(2)}, ${(origin[1] * METRES_PER_FOOT).toFixed(2)} m) ` +
    `— the shared placement the IFC export carries, and what the hulls are offset by\n`);
  const wings = wingsFor(transforms, origin);
  let claimed = new Map<number, Wing>();
  if (args.claims) {
    const seeded = new Map<number, Wing>();
    for (const record of result.elementBounds) {
      const centre = planCentre(record);
      if (!centre) continue;
      const wing = wingAt(wings, centre[0], centre[1]);
      if (wing) seeded.set(record.elementId, wing);
    }
    claimed = contactClaims(result.elementBounds, wings, seeded,
      TOUCH_METRES / METRES_PER_FOOT, REACH_METRES / METRES_PER_FOOT);
  }
  process.stderr.write(`${wings.length} wing(s), ${claimed.size} contact claim(s)\n`);

  // Same start in both worlds, in the frame they share: the model's own feet.
  const plain = rectifiedTriangles(result, [], new Map());
  const box = triangleBounds(plain);
  process.stderr.write(
    `model spans x ${box[0].toFixed(0)}..${box[2].toFixed(0)} ft, ` +
    `y ${box[1].toFixed(0)}..${box[3].toFixed(0)} ft ` +
    `(${(box[0] * METRES_PER_FOOT).toFixed(0)}..${(box[2] * METRES_PER_FOOT).toFixed(0)}, ` +
    `${(box[1] * METRES_PER_FOOT).toFixed(0)}..${(box[3] * METRES_PER_FOOT).toFixed(0)} m)\n`);
  // `--at` is given in the CONSUMER's frame, because that is the frame its
  // wings are published in — so the origin comes off it too. Getting this wrong
  // sent the first run 185 ft outside the model looking for a floor.
  const wanted: [number, number] = args.at
    ? [args.at[0] / METRES_PER_FOOT - origin[0], args.at[1] / METRES_PER_FOOT - origin[1]]
    : [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const plainIndexes = walkIndexes(plain);
  const starts: { label: string; at: [number, number] }[] = [];
  const middle = startNear(plainIndexes, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  if (middle) starts.push({ label: "model centre", at: middle });
  if (args.at) {
    const asked = startNear(plainIndexes, wanted);
    if (asked) starts.push({ label: `near ${args.at[0]}, ${args.at[1]} m`, at: asked });
  }
  if (!starts.length) throw new Error("No floor anywhere near any start.");
  for (const s of starts) {
    process.stderr.write(
      `start "${s.label}": ${s.at[0].toFixed(0)}, ${s.at[1].toFixed(0)} ft\n`);
  }

  const runs: { label: string; wings: Wing[]; claims: ReadonlyMap<number, Wing> }[] = [
    { label: "as recovered", wings: [], claims: new Map() },
    { label: "--rectify", wings, claims: claimed },
  ];
  process.stderr.write(
    `\n${"start".padEnd(22)}${"world".padEnd(15)}${"reached".padStart(9)}` +
    `${"rise".padStart(7)}${"wall".padStart(7)}${"  extent (ft)"}\n`);
  for (const run of runs) {
    const triangles = rectifiedTriangles(result, run.wings, run.claims);
    const indexes = walkIndexes(triangles);
    for (const s of starts) {
      const report = walkFrom(indexes, s.at, { stride: args.stride });
      const extent = report.bounds
        ? `${(report.bounds[2] - report.bounds[0]).toFixed(0)} x ` +
          `${(report.bounds[3] - report.bounds[1]).toFixed(0)}`
        : "-";
      process.stderr.write(
        `${s.label.padEnd(22)}${run.label.padEnd(15)}` +
        `${report.reached.toLocaleString().padStart(9)}` +
        `${report.blockedByRise.toLocaleString().padStart(7)}` +
        `${report.blockedByWall.toLocaleString().padStart(7)}  ${extent}` +
        `${report.start ? "" : "   (no floor under the start)"}\n`);
    }
  }
}

if (isEntryPoint(import.meta.url)) {
  runWalk(parseWalkArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
