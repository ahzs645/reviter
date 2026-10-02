import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { readProjectPackage, createProjectPackage } from "../lib/reviter/project-package.ts";
import { prepareIndoorPresentation } from "../lib/reviter/indoor-presentation.ts";
import { auditRoomBoundaries } from "../lib/reviter/room-boundary-audit.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const input = option("--input"), output = option("--out");
if (!input || !output || resolve(input) === resolve(output)) throw new Error("Usage: npm run indoor:presentation -- --input prepared.reviter.zip --out new-presentation.reviter.zip [--semantic-boundaries finish-boundaries.json] (use a new output path)");
const project = await readProjectPackage(new Uint8Array(await readFile(resolve(input))));
if (!project.indoor) throw new Error("Prepare the source model and routing before adding presentation boundaries.");
const before = JSON.stringify([project.indoor.records,project.indoor.nodes,project.indoor.edges,project.indoor.walls,project.indoor.doors,project.rooms]);
const semanticPath = option("--semantic-boundaries");
const semantic = semanticPath ? JSON.parse(await readFile(resolve(semanticPath), "utf8")) : undefined;
const presentation = prepareIndoorPresentation(project.indoor, project.rooms.annotations, semantic);
project.indoor.presentation = presentation;
if (JSON.stringify([project.indoor.records,project.indoor.nodes,project.indoor.edges,project.indoor.walls,project.indoor.doors,project.rooms]) !== before) throw new Error("Presentation changed source or routing geometry.");
const bytes = await createProjectPackage(project.model, project.rooms, {indoor:project.indoor,scene:project.scene});
await mkdir(dirname(resolve(output)),{recursive:true});
await writeFile(resolve(output),bytes);
const boundaryAudit = auditRoomBoundaries(project.indoor, project.rooms.annotations);
const report = {input:resolve(input),output:resolve(output),source:project.indoor.source,semanticBoundaryInput:semanticPath ? resolve(semanticPath) : null,verifiedPresentationRooms:presentation.rooms.length,eligibleRooms:project.indoor.records.filter(r=>r.walkable&&!r.circulation).length,sourceAndGraphUnchanged:true,diagnostics:presentation.diagnostics,boundaryAudit};
await writeFile(resolve(output)+'.presentation-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({input:report.input,output:report.output,source:report.source,semanticBoundaryInput:report.semanticBoundaryInput,
  verifiedPresentationRooms:report.verifiedPresentationRooms,eligibleRooms:report.eligibleRooms,sourceAndGraphUnchanged:true,
  diagnostics:presentation.diagnostics.length,diagnosticCounts:boundaryAudit.diagnosticCounts,
  reportPath:resolve(output)+'.presentation-report.json'},null,2));
