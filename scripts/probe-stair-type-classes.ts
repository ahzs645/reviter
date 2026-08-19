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
import {
  readSchema,
  schemaAncestorChain,
  schemaClassesByName,
} from "../lib/reviter/schema-reader.ts";

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
const parsed = readSchema(schemaBytes);
if (!parsed.ok) throw new Error(`schema did not tile: ${parsed.error} at ${parsed.offset}`);
const { schema } = parsed;
const byName = schemaClassesByName(schema);

const interesting = /stair|riser|tread|monolith|runtype/i;
console.log(`${schema.classes.length} classes; those matching ${interesting}:`);
for (const entry of schema.classes) {
  const parent = entry.parent.kind === "inline" || entry.parent.kind === "reference"
    ? entry.parent.name
    : "";
  if (!interesting.test(entry.name) && !interesting.test(parent)) continue;
  console.log(`  index=${entry.index} name=${entry.name} parent=${parent}` +
    ` version=${entry.version} fields=${entry.propertyCount}`);
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
  const definition = byName.get(name);
  if (!definition) {
    console.log(`\n${name}: not declared by this file`);
    continue;
  }
  // Base first, which is the order an instance writes them in.
  const chain = schemaAncestorChain(schema, definition.index);
  const fields = chain.flatMap((entry) =>
    entry.properties.map((property) => ({ owner: entry.name, property })));
  console.log(
    `\n${name} index=${definition.index} chain=${chain.map((entry) => entry.name).join(" < ")}` +
      ` fields=${fields.length}:`,
  );
  for (const { owner, property } of fields) {
    console.log(
      `    ${owner}.${property.name} type=0x${property.fieldType.toString(16)}` +
        ` lm=${property.loadingMode} im=${property.itemMode}` +
        (property.size == null ? "" : ` size=${property.size}`),
    );
  }
}
