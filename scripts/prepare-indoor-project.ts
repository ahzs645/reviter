import {applySemanticDoorLinks} from "../lib/reviter/semantic-door-links.ts";
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
import { validateVisitorMetadata } from "../lib/reviter/visitor-metadata.ts";
import { roomBuilding } from "../lib/reviter/room-directory.ts";
import { validateSemanticRoomBoundaries, applySemanticRoomBoundaries } from "../lib/reviter/semantic-room-boundaries.ts";
import { validateIndoorConnectorReview } from "../lib/reviter/indoor-connectors.ts";
import { promoteNativeRoomInteriors } from "../lib/reviter/native-room-promotion.ts";
import { prepareIndoorPresentation } from "../lib/reviter/indoor-presentation.ts";
import {createNativeParallelCompiler} from './indoor/parallel-native-circulation.ts';

const args = process.argv.slice(2),
  option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
const input = option("--input"),
  out = option("--out");
if (!input || !out) {
  console.error(
    "Usage: npm run indoor:prepare -- --input project.reviter.zip [--rooms latest-reviews.json] [--native-interiors] [--semantic-boundaries finish-boundaries.json] [--visitor visitor.json] [--connectors connectors.json] --out prepared.reviter.zip [--revit-version 2027] [--windows native|simplified] [--no-scene] [--native-workers 1|2 --checkpoint-dir directory]",
  );
  process.exit(1);
}
if (resolve(input) === resolve(out)) throw new Error("Use a new output path to retain the source archive.");
const workerArgument=option('--native-workers'),workerCount=workerArgument===undefined?undefined:Number(workerArgument);
for(const flag of ['--native-workers','--checkpoint-dir'])if(args.includes(flag)&&(!option(flag)||option(flag)!.startsWith('--')))throw Error(flag+' requires a value.');
if(workerCount!==undefined&&workerCount!==1&&workerCount!==2)throw Error('--native-workers must be 1 or 2.');
if(option('--checkpoint-dir')&&!workerCount)throw Error('--checkpoint-dir requires --native-workers.');
const nativeCirculationCompiler=workerCount?createNativeParallelCompiler({maxWorkers:workerCount as 1|2,checkpointDir:resolve(option('--checkpoint-dir')??out+'.checkpoints'),onProgress:m=>console.log(m)}):undefined;
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
const visitorPath = option("--visitor");
if (visitorPath) {
  const visitor: unknown = JSON.parse(await readFile(resolve(visitorPath), "utf8"));
  validateVisitorMetadata(visitor, rooms.annotations.filter(r => r.status !== "deleted").map(r => ({key: r.key, building: roomBuilding(r)})));
  rooms = {...rooms, visitorMetadata: visitor};
}
const connectorsPath = option("--connectors");
if (connectorsPath) {
  const connectors: unknown = JSON.parse(await readFile(resolve(connectorsPath), "utf8"));
  validateIndoorConnectorReview(connectors);
  if (connectors.modelSha256 !== original.manifest.model.sha256) throw new Error("Connector metadata belongs to different model bytes.");
  rooms = {...rooms, indoorConnectors: connectors};
}
await mkdir(dirname(resolve(out)), { recursive: true });
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
const semanticPath = option("--semantic-boundaries");
if (args.includes("--native-interiors")) {
  const baseline = reviewPath || !original.indoor
    ? await prepareIndoorDataset(result, rooms, original.manifest.model.sha256, undefined, {physicalDoorSource:original.indoor,nativeCirculationCompiler})
    : original.indoor;
  const current = { ...baseline, presentation: prepareIndoorPresentation(baseline, rooms.annotations) };
  const promoted = promoteNativeRoomInteriors(current, rooms);
  rooms = promoted.data;
  await writeFile(resolve(out) + ".boundary-promotion.json", JSON.stringify(promoted.report, null, 2));
  console.log(`Promoting verified native interiors; detailed coverage in ${resolve(out)}.boundary-promotion.json`);
}
if (semanticPath) {
  const baseline = reviewPath || !original.indoor
    ? await prepareIndoorDataset(result, rooms, original.manifest.model.sha256, undefined, {physicalDoorSource:original.indoor,nativeCirculationCompiler})
    : original.indoor;
  const semanticInput: unknown = JSON.parse(await readFile(resolve(semanticPath), "utf8"));
  const validated = validateSemanticRoomBoundaries(baseline, rooms.annotations, semanticInput);
  if (validated.diagnostics.length) {
    await writeFile(resolve(out) + ".semantic-review.json", JSON.stringify(validated.diagnostics, null, 2));
    console.log(`Semantic boundary review: ${validated.diagnostics.length} rejected/unresolved entries.`);
  }
  rooms = applySemanticRoomBoundaries(rooms, validated.rooms);
  const semanticDoors = applySemanticDoorLinks(result, rooms, original.manifest.model.sha256, semanticInput);
  rooms = semanticDoors.data;
  await writeFile(resolve(out) + ".semantic-doors.json", JSON.stringify({accepted: semanticDoors.accepted, diagnostics: semanticDoors.diagnostics}, null, 2));
  console.log(`Regenerating navigation from ${validated.rooms.length} validated finish-face room boundaries.`);
}
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
  { physicalDoorSource: original.indoor, nativeCirculationCompiler },
);
const windowDetail = option("--windows") ?? "simplified";
if (!["native", "simplified"].includes(windowDetail)) throw new Error("--windows must be native or simplified");
if (dataset.windowDisplay) dataset.windowDisplay.mode = windowDetail as "native" | "simplified";
const scene = args.includes("--no-scene")
  ? undefined
  : original.scene ?? new Uint8Array(makeGlb(result));
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
