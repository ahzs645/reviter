import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { readProjectPackage, createProjectPackage } from "../lib/reviter/project-package.ts";
import { prepareIndoorStairDisplay } from "../lib/reviter/indoor-stair-display.ts";

// Augment an already compiled project without reinterpreting its reviewed graph.
const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output))
  throw new Error("Usage: node --experimental-strip-types scripts/prepare-stair-display.ts input.reviter.zip new-output.reviter.zip");
const source = await readProjectPackage(new Uint8Array(await readFile(input)));
if (!source.indoor) throw new Error("Prepare navigation before adding stair display geometry.");
let last = -1;
const model = convertRvtBytes(new Uint8Array(await source.model.arrayBuffer()), source.model.name,
  {revitVersion: 2027}, (p) => {
    if (p.ratio > last + 0.15) {console.log(p.message); last = p.ratio;}
  });
if (!model.ok) throw new Error(model.error);
source.indoor.stairDisplay = prepareIndoorStairDisplay(model, source.indoor);
await writeFile(output, await createProjectPackage(source.model, source.rooms,
  {indoor: source.indoor, scene: source.scene}));
console.log(`Saved ${source.indoor.stairDisplay.flights.length} native stair display bindings to ${output}. Navigation and source records preserved.`);
