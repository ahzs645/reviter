/**
 * Inspect a Formats/Latest tag reference and count raw two-byte
 * coincidences in Partitions/325.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-geometry-tag-references.ts model.rvt [tag]
 *
 * Partition counts are deliberately labelled raw byte-window occurrences.
 * Without a decoded outer object boundary, they are not class selectors.
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { inspectSchemaTagReference } from "../lib/reviter/schema-tag-references.ts";

type Cfb = ReturnType<typeof CFB.read>;

function streamBytes(cfb: Cfb, suffix: string): Uint8Array {
  const index = cfb.FullPaths.findIndex((path) => path.endsWith(suffix));
  if (index < 0) throw new Error(`missing RVT stream ${suffix}`);
  const entry = cfb.FileIndex[index]!;
  if (!entry.content) throw new Error(`RVT stream ${suffix} has no content`);
  return stripRevitPageChecksums(asBytes(entry.content));
}

function inflateFirstChunk(stored: Uint8Array): Uint8Array {
  const offset = gzipOffsets(stored, 1)[0];
  if (offset == null) throw new Error("stream has no usable gzip chunk");
  const inflated = inflateRevitChunk(stored, offset);
  if (!inflated) throw new Error("first gzip chunk could not be inflated");
  return inflated;
}

function scanRawWords(
  stored: Uint8Array,
  words: readonly number[],
): {
  chunks: number;
  failedChunks: number;
  inflatedBytes: number;
  rawByteWindowOccurrences: Record<string, number>;
} {
  const offsets = gzipOffsets(stored);
  const counts = new Map(words.map((word) => [word, 0]));
  let chunks = 0;
  let failedChunks = 0;
  let inflatedBytes = 0;
  let window: Uint8Array | null = null;
  let previousByte: number | null = null;

  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]!;
    const end = offsets[index + 1];
    const inflated =
      inflateRevitChunk(stored, offset, end, window) ??
      salvageRevitChunk(stored, offset, end, window);
    if (!inflated?.length) {
      failedChunks += 1;
      previousByte = null;
      continue;
    }

    chunks += 1;
    inflatedBytes += inflated.byteLength;
    let scan = inflated;
    if (previousByte != null) {
      scan = new Uint8Array(inflated.byteLength + 1);
      scan[0] = previousByte;
      scan.set(inflated, 1);
    }
    for (let byteOffset = 0; byteOffset + 1 < scan.byteLength; byteOffset += 1) {
      const word = scan[byteOffset]! | (scan[byteOffset + 1]! << 8);
      if (counts.has(word)) counts.set(word, counts.get(word)! + 1);
    }
    previousByte = inflated[inflated.byteLength - 1]!;
    window = revitWindowTail(inflated);
  }

  return {
    chunks,
    failedChunks,
    inflatedBytes,
    rawByteWindowOccurrences: Object.fromEntries(
      [...counts].map(([word, count]) => [
        `0x${word.toString(16).padStart(4, "0")}`,
        count,
      ]),
    ),
  };
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/probe-geometry-tag-references.ts model.rvt [tag]",
  );
}
const classId = Number(process.argv[3] ?? 1426);
if (!Number.isSafeInteger(classId) || classId < 0 || classId > 0x7fff) {
  throw new Error("slot must be an unsigned 15-bit integer");
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const schema = inflateFirstChunk(streamBytes(cfb, "/Formats/Latest"));
const partition = streamBytes(cfb, "/Partitions/325");
const inspection = inspectSchemaTagReference(schema, classId);

console.log(
  JSON.stringify(
    {
      modelPath,
      classId,
      classWord: `0x${classId.toString(16).padStart(4, "0")}`,
      definitionWord: `0x${(classId | 0x8000).toString(16).padStart(4, "0")}`,
      schemaBytes: schema.byteLength,
      schemaTagReference: inspection,
      partition: scanRawWords(partition, [classId, classId | 0x8000]),
      interpretation:
        inspection.status === "shared-reference"
          ? "The schema tag reference is shared and cannot identify a partition object class."
          : "A raw partition occurrence is not a selector until an outer object boundary is decoded.",
    },
    null,
    2,
  ),
);
