import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import {
  readProjectPackage,
  createProjectPackage,
} from "../lib/reviter/project-package.ts";
import { parseRoomDirectory } from "../lib/reviter/room-directory.ts";
import { prepareIndoorDataset } from "../lib/reviter/indoor-pipeline.ts";
import { makeGlb } from "../lib/reviter/export-glb.ts";

const args = process.argv.slice(2),
  option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
const input = option("--input"),
  out = option("--out");
if (!input || !out) {
  console.error(
    "Usage: npm run indoor:prepare -- --input project.reviter.zip [--rooms latest-reviews.json] --out prepared.reviter.zip [--revit-version 2027] [--no-scene]",
  );
  process.exit(1);
}
const original = await readProjectPackage(
  new Uint8Array(await readFile(resolve(input))),
);
let rooms = original.rooms;
const reviewPath = option("--rooms");
if (reviewPath) {
  rooms = parseRoomDirectory(await readFile(resolve(reviewPath), "utf8"));
  if (rooms.model.fileName !== original.rooms.model.fileName)
    throw new Error("Replacement reviews belong to a different source model.");
  rooms = {
    ...rooms,
    georeference: rooms.georeference ?? original.rooms.georeference,
  };
}
console.log(
  `Preparing ${rooms.annotations.length} source records; ${rooms.georeference?.points.length ?? 0} GIS references.`,
);
const versionArg = option("--revit-version");
const version = versionArg == null ? undefined : Number(versionArg);
if (
  version != null &&
  (!Number.isInteger(version) || version < 2000 || version > 2100)
)
  throw new Error("Supply a valid Revit version year.");
let conversionProgress = -0.1;
const result = convertRvtBytes(
  new Uint8Array(await original.model.arrayBuffer()),
  original.model.name,
  { revitVersion: version },
  (message) => {
    if (message.ratio >= conversionProgress + 0.1 || message.ratio >= 0.99) {
      console.log(message.message);
      conversionProgress = message.ratio;
    }
  },
);
if (!result.ok) throw new Error(result.error);
let last = "";
const dataset = await prepareIndoorDataset(
  result,
  rooms,
  original.manifest.model.sha256,
  (m) => {
    if (
      m !== last &&
      (!m.includes("region ") || /region (?:[0-9]*50|[0-9]*00)\//.test(m))
    ) {
      console.log(m);
      last = m;
    }
  },
);
const scene = args.includes("--no-scene")
  ? undefined
  : new Uint8Array(makeGlb(result));
const bytes = await createProjectPackage(original.model, rooms, {
  indoor: dataset,
  scene,
});
await mkdir(dirname(resolve(out)), { recursive: true });
await writeFile(resolve(out), bytes);
await writeFile(
  resolve(out) + ".report.json",
  JSON.stringify(
    {
      source: dataset.source,
      alignment: dataset.alignment,
      report: dataset.report,
      issues: dataset.issues,
      floors: dataset.floors,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { output: resolve(out), bytes: bytes.length, ...dataset.report },
    null,
    2,
  ),
);
