#!/usr/bin/env node

/**
 * Resolve every hardcoded Revit class index in `lib/reviter` against the class
 * table a model declares in its own `Formats/Latest`.
 *
 * These constants were each measured from element records — a marker that heads
 * objects of the shape a decoder wanted — without knowing what class the number
 * named. The schema names them. Running this against the supplied 2027 project
 * resolves every one of its `REVIT_2027_*` constants to a class whose name is
 * the one the constant is called after, which is what makes replacing the
 * literals with lookups a safe change rather than a hopeful one.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-schema-constants.ts <model.rvt>
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import zlib from "node:zlib";
import * as cfb from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import { readSchema, schemaClassesByName } from "../lib/reviter/schema-reader.ts";
import {
  asBytes,
  isRevitChecksumPagedStream,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

/** Constants that name a class index, by the shape of their name. */
const CONSTANT = /^(?:export )?const ([A-Z][A-Z0-9_]*(?:MARKER|SOURCE_CLASS|SOURCE_CLASS_SLOT|CLASS_SLOT))\s*=\s*(0x[0-9a-f]+|\d+);/gm;

/** Names that count a thing rather than name a class. */
const NOT_A_CLASS = /SAMPLE_PAGES|MIN_SUPPORT|MAX_OBJECT|NULL_FIELD|OFFSET$/;

const modelPath = process.argv[2];
if (!modelPath) {
  console.error("usage: audit-schema-constants.ts <model.rvt>");
  process.exit(1);
}

function schemaStream(path: string): Uint8Array {
  const container = cfb.read(new Uint8Array(readFileSync(path)), { type: "buffer" });
  const index = container.FullPaths.findIndex((entry) => /\/Formats\/Latest$/i.test(entry));
  if (index < 0) throw new Error("no Formats/Latest stream");
  let raw = asBytes(container.FileIndex[index].content as Uint8Array);
  if (isRevitChecksumPagedStream(container.FullPaths[index].replace(/^Root Entry\//, ""))) {
    raw = stripRevitPageChecksums(raw);
  }
  for (let offset = 0; offset + 3 < raw.length; offset += 1) {
    if (raw[offset] === 0x1f && raw[offset + 1] === 0x8b && raw[offset + 2] === 0x08) {
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(raw.subarray(offset + 10)), {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      }));
    }
  }
  throw new Error("no gzip member in Formats/Latest");
}

/** The release this file was written by, so a constant is only read against it. */
function fileRelease(path: string): number | null {
  const container = cfb.read(new Uint8Array(readFileSync(path)), { type: "buffer" });
  const index = container.FullPaths.findIndex((entry) => /BasicFileInfo$/i.test(entry));
  if (index < 0) return null;
  return revitVersionFromBasicFileInfo(asBytes(container.FileIndex[index].content as Uint8Array));
}

const release = fileRelease(resolve(modelPath));
const result = readSchema(schemaStream(resolve(modelPath)));
if (!result.ok) {
  console.error(`schema did not tile: ${result.error} at ${result.offset}`);
  process.exit(1);
}
const { schema } = result;
const byName = schemaClassesByName(schema);
console.log(`Revit ${release ?? "?"}: ${schema.classes.length} classes, ${schema.propertyCount} properties`);
console.log("A class index is release-specific, so only constants for this release are read.\n");

const library = resolve("lib/reviter");
const rows: { file: string; constant: string; value: number; resolved: string | null }[] = [];
for (const file of readdirSync(library).filter((entry) => entry.endsWith(".ts")).sort()) {
  const source = readFileSync(resolve(library, file), "utf8");
  for (const [, constant, literal] of source.matchAll(CONSTANT)) {
    if (NOT_A_CLASS.test(constant)) continue;
    const value = Number(literal);
    rows.push({
      file,
      constant,
      value,
      resolved: schema.classesByIndex.get(value)?.name ?? null,
    });
  }
}

/** The name a constant is called after, for comparison with what it resolves to. */
function expectedName(constant: string): string {
  return constant
    .replace(/^REVIT_20\d\d_/, "")
    .replace(/_(?:OBJECT_)?(?:MARKER|SOURCE_CLASS_SLOT|SOURCE_CLASS|CLASS_SLOT)$/, "")
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join("");
}

const constantRelease = (constant: string) => {
  const era = /^REVIT_(20\d\d)_/.exec(constant)?.[1];
  return era ? Number(era) : null;
};

const readable = rows.filter((row) => {
  const era = constantRelease(row.constant);
  return era == null || release == null || era === release;
});
const otherRelease = rows.length - readable.length;

let named = 0;
let unnamed = 0;
const misnamed: typeof rows = [];
for (const row of readable) {
  const expected = expectedName(row.constant);
  const agrees = row.resolved != null && row.resolved.toLowerCase() === expected.toLowerCase();
  if (row.resolved) named += 1; else unnamed += 1;
  if (row.resolved && !agrees) misnamed.push(row);
  const note = row.resolved == null
    ? "  <- names no class in this file"
    : agrees ? "" : `  <- reads ${row.resolved}, named for ${expected}`;
  console.log(
    `${String(row.value).padStart(5)} 0x${row.value.toString(16).padStart(4, "0")}  ${
      (row.resolved ?? "-").padEnd(34)} ${row.constant}${note}`,
  );
  void byName;
}

console.log(`\n${readable.length} constants for this release: ${named} name a class, ${unnamed} do not`);
console.log(`${otherRelease} constants belong to another release and were not read`);
if (misnamed.length > 0) {
  console.log(`\n${misnamed.length} resolve to a class spelled differently from the constant.`);
  console.log("Most are a naming convention; check any where the class is unrelated.");
}
