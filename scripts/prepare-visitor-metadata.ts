import {readFile, writeFile, mkdir} from "node:fs/promises";
import {resolve, dirname} from "node:path";
import {readProjectPackage, createProjectPackage} from "../lib/reviter/project-package.ts";
import {validateVisitorMetadata} from "../lib/reviter/visitor-metadata.ts";
const args = process.argv.slice(2);
const option = (name: string) => {const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined;};
const input = option("--input"), output = option("--out"), metadataPath = option("--visitor");
if (!input || !output || !metadataPath || resolve(input) === resolve(output))
  throw new Error("Usage: node --experimental-strip-types scripts/prepare-visitor-metadata.ts --input prepared.zip --visitor visitor.json --out new-project.zip");
const project = await readProjectPackage(new Uint8Array(await readFile(resolve(input))));
if (!project.indoor) throw new Error("Prepare the project graph before updating visitor information.");
const visitor: unknown = JSON.parse(await readFile(resolve(metadataPath), "utf8"));
validateVisitorMetadata(visitor, project.indoor.records);
const originalGeometry = JSON.stringify([project.indoor.records, project.indoor.nodes, project.indoor.edges, project.indoor.walls, project.indoor.doors]);
project.rooms.visitorMetadata = structuredClone(visitor);
project.indoor.visitor = structuredClone(visitor);
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(project.rooms))));
project.indoor.source.roomsSha256 = Array.from(digest, b => b.toString(16).padStart(2,"0")).join("");
if (JSON.stringify([project.indoor.records, project.indoor.nodes, project.indoor.edges, project.indoor.walls, project.indoor.doors]) !== originalGeometry)
  throw new Error("Visitor metadata unexpectedly changed source geometry or routes.");
const bytes = await createProjectPackage(project.model, project.rooms, {indoor: project.indoor, scene: project.scene});
await mkdir(dirname(resolve(output)), {recursive: true});
await writeFile(resolve(output), bytes);
console.log(JSON.stringify({output: resolve(output), buildings: Object.keys(visitor.buildings).length, places: Object.keys(visitor.places).length, sourceGeometryAndGraphUnchanged: true}, null, 2));
