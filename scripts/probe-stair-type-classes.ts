#!/usr/bin/env node

/**
 * Enumerate stair-related classes in the embedded Formats/Latest schema and
 * decode the field lists of the type-flavoured ones, hunting for the
 * monolithic/structure fields Revit's own parameter enumeration names
 * (STAIRS_RUNTYPE_STRUCTURE, STAIRS_RUNTYPE_HAS_MONOLITHIC_SUPPORT).
 *
 *   node --experimental-strip-types scripts/probe-stair-type-classes.ts model.rvt
 */
import { readFileSync } from "node:fs";

import * as CFB from "cfb";

import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { summariseSchema } from "../lib/reviter/schema.ts";
import {
  findSchemaClassDefinition,
  flattenSchemaFields,
} from "../lib/reviter/schema-fields.ts";

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-stair-type-classes.ts model.rvt");

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
const item = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/Formats\/Latest$/i.test(path));
if (!item) throw new Error("no Formats/Latest stream");
const raw = stripRevitPageChecksums(asBytes(item.entry.content));
const offset = gzipOffsets(raw, 1)[0];
if (offset == null) throw new Error("no gzip member");
const schemaBytes = inflateRevitChunk(raw, offset);
if (!schemaBytes) throw new Error("Formats/Latest gzip member did not inflate");
const summary = summariseSchema(schemaBytes);

const interesting = /stair|riser|tread|monolith|runtype/i;
console.log("tagged classes:");
for (const entry of summary.taggedClasses) {
  if (interesting.test(entry.name) || interesting.test(entry.parent ?? "")) {
    console.log(`  tag=${entry.tag} name=${entry.name} parent=${entry.parent}` +
      ` version=${entry.version} fields=${entry.declaredFieldCount}`);
  }
}
console.log("referenced classes:");
for (const entry of summary.referencedClasses ?? []) {
  if (interesting.test(entry.name)) console.log(`  ${JSON.stringify(entry)}`);
}

const candidates = [
  "StairsRunType",
  "StairsType",
  "StairsLandingType",
  "StairsSupportType",
  "StairsSym",
  "StairsTriserSymbol",
  "StairsAttributes",
];
for (const name of candidates) {
  // `findSchemaClassDefinition` already returns the decoded layer; it used to
  // hand back an offset to decode separately, and this loop was still reading
  // `definition.offset` — undefined on the success branch — so every candidate
  // reported "layer decode failed" instead of printing its fields.
  const definition = findSchemaClassDefinition(schemaBytes, name);
  if (!definition.ok) {
    console.log(`\n${name}: field decode failed: ${definition.error}`);
    continue;
  }
  const fields = flattenSchemaFields(definition.layer);
  console.log(`\n${name} classId=${definition.layer.classId} fields=${fields.length}:`);
  for (const field of fields) {
    console.log(`    ${field.name} type=0x${field.typeCode.toString(16)}` +
      ` mode=0x${field.mode.toString(16)}` +
      (field.arrayElement ? ` array=${JSON.stringify(field.arrayElement)}` : ""));
  }
}
