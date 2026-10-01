/** Attach a decoded survey reference to room annotations for local directory review.
 * Usage: node --experimental-strip-types scripts/register-room-boundaries.ts rooms.json entities.json catalog.json output.json
 * The catalog must include sha256 and named sheet bounds from the DWG decoder. */
import fs from "node:fs/promises";
import { parseRoomDirectory } from "../lib/reviter/room-directory.ts";
import { registerBoundaryReference } from "../lib/reviter/room-boundaries.ts";
import type { DwgBounds, DwgEntity } from "../lib/reviter/dwg-plan.ts";
const [roomPath, entityPath, catalogPath, outputPath] = process.argv.slice(2);
if (!roomPath || !entityPath || !catalogPath || !outputPath) throw new Error("Provide rooms.json, decoded entities.json, catalog.json, and an output path.");
const [roomText, entityText, catalogText] = await Promise.all([fs.readFile(roomPath, "utf8"), fs.readFile(entityPath, "utf8"), fs.readFile(catalogPath, "utf8")]);
const data = parseRoomDirectory(roomText);
const entities = JSON.parse(entityText) as DwgEntity[];
const catalog = JSON.parse(catalogText) as { sha256: string; sheets: { name: string; bounds: DwgBounds }[] };
if (!Array.isArray(entities) || !Array.isArray(catalog.sheets) || typeof catalog.sha256 !== "string") throw new Error("Provide a decoded DWG entity array and its source catalog.");
const reference = registerBoundaryReference(data.annotations, entities, catalog.sheets, catalog.sha256);
if (!reference.sections.length) throw new Error("No survey sections match the annotations' source hash and saved registration anchors.");
const enriched = { ...data, boundaryReference: reference };
parseRoomDirectory(JSON.stringify(enriched));
await fs.writeFile(outputPath, JSON.stringify(enriched));
console.log(`Saved ${reference.sections.length} registered survey sections to ${outputPath}. Import this file in Building directory and choose Rebuild floor boundaries.`);
