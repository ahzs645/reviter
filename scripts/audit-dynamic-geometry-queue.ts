/**
 * Bounded byte audit for counted OdBmCondInt16 collections containing the
 * Revit 2026 GPolyMesh or common FacetedTopology8 source-class slots.
 *
 * This is deliberately a negative/triage probe. A collection-shaped match is
 * not an object boundary and its end is not a dynamic-property replay offset.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-dynamic-geometry-queue.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import {
  decodeCondInt16QueueCollection,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
  REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
  type CondInt16QueueCollection,
} from "../lib/reviter/dynamic-geometry-queue.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const MAX_ENTRIES = 10_000;
const MAX_SOURCE_CLASS_SLOT = 6_000;
const MAX_REPORTED_MATCHES = 1_000;
const TARGETS = new Set([
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
  REVIT_COMMON_FACETED_TOPOLOGY8_SOURCE_CLASS,
]);

type Match = {
  stream: string;
  chunkIndex: number;
  countOffset: number;
  endOffset: number;
  count: number;
  targetEntries: {
    index: number;
    token: number;
    sourceClassSlot: number;
  }[];
};

function hasBoundedSlots(collection: CondInt16QueueCollection): boolean {
  return collection.entries.every(
    (entry) =>
      entry.sourceClassSlot == null ||
      entry.sourceClassSlot <= MAX_SOURCE_CLASS_SLOT,
  );
}

function hasPlausibleSequentialTokens(
  collection: CondInt16QueueCollection,
): boolean {
  return (
    collection.count > 1 &&
    collection.entries.every(
      (entry, index, entries) =>
        entry.token > 0 &&
        entry.token <= 100_000 &&
        (index === 0 || entry.token === entries[index - 1]!.token + 1),
    )
  );
}

function countRawWords(
  data: Uint8Array,
  counts: Map<number, number>,
): void {
  for (let offset = 0; offset + 1 < data.byteLength; offset += 1) {
    const word = data[offset]! | (data[offset + 1]! << 8);
    if (counts.has(word)) counts.set(word, counts.get(word)! + 1);
  }
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-dynamic-geometry-queue.ts model.rvt",
  );
}

const input = readFileSync(modelPath);
const cfb = CFB.read(input, { type: "buffer" });
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

const rawWordOccurrences = new Map([...TARGETS].map((slot) => [slot, 0]));
const completeMatches = new Map([...TARGETS].map((slot) => [slot, 0]));
const matches: Match[] = [];
let chunks = 0;
let failedChunks = 0;
let inflatedBytes = 0;
let candidateCountOffsets = 0;
let plausibleSequentialCollectionShapes = 0;
let plausibleSequentialShapesContainingTarget = 0;
let matchesTruncated = false;

for (const partition of partitions) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;

  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;
    inflatedBytes += inflated.byteLength;
    countRawWords(inflated, rawWordOccurrences);

    const view = new DataView(
      inflated.buffer,
      inflated.byteOffset,
      inflated.byteLength,
    );
    for (
      let countOffset = 0;
      countOffset + 4 <= inflated.byteLength;
      countOffset += 1
    ) {
      const count = view.getInt32(countOffset, true);
      if (count <= 0 || count > MAX_ENTRIES) continue;
      candidateCountOffsets += 1;
      const decoded = decodeCondInt16QueueCollection(inflated, countOffset, {
        maxEntries: MAX_ENTRIES,
      });
      if (!decoded.ok || !hasBoundedSlots(decoded.collection)) continue;

      const sequential = hasPlausibleSequentialTokens(decoded.collection);
      if (sequential) plausibleSequentialCollectionShapes += 1;
      const targetEntries = decoded.collection.entries.flatMap(
        (entry, index) =>
          entry.sourceClassSlot != null && TARGETS.has(entry.sourceClassSlot)
            ? [
                {
                  index,
                  token: entry.token,
                  sourceClassSlot: entry.sourceClassSlot,
                },
              ]
            : [],
      );
      if (targetEntries.length === 0) continue;
      if (sequential) plausibleSequentialShapesContainingTarget += 1;
      for (const target of new Set(
        targetEntries.map((entry) => entry.sourceClassSlot),
      )) {
        completeMatches.set(target, completeMatches.get(target)! + 1);
      }
      if (matches.length < MAX_REPORTED_MATCHES) {
        matches.push({
          stream: partition.path.replace(/^Root Entry\//, ""),
          chunkIndex,
          countOffset,
          endOffset: decoded.collection.endOffset,
          count: decoded.collection.count,
          targetEntries,
        });
      } else {
        matchesTruncated = true;
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      modelPath,
      inputBytes: input.byteLength,
      partitions: partitions.length,
      chunks,
      failedChunks,
      inflatedBytes,
      bounds: {
        maxEntries: MAX_ENTRIES,
        maxSourceClassSlot: MAX_SOURCE_CLASS_SLOT,
        maxReportedMatches: MAX_REPORTED_MATCHES,
      },
      candidateCountOffsets,
      rawWordOccurrences: Object.fromEntries(rawWordOccurrences),
      completeCollectionShapesContainingTarget:
        Object.fromEntries(completeMatches),
      plausibleSequentialCollectionShapes,
      plausibleSequentialShapesContainingTarget,
      matchesTruncated,
      matches,
      interpretation:
        "Collection-shaped matches are byte-audit candidates only. Reproduce ObjectPtrInitReader and DynamicQueue DataKey state before treating any collection end as a replay boundary.",
    },
    null,
    2,
  ),
);
