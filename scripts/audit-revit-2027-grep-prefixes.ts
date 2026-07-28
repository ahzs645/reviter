/**
 * Audit the release-gated Revit 2027 GArray and GGroup-prefix readers.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2027-grep-prefixes.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GArray,
  decodeRevit2027GGroupPrefix,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2027-grep-prefixes.ts model.rvt",
  );
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(`audit requires a Revit 2027 file, received ${release ?? "unknown"}`);
}
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

let chunks = 0;
let failedChunks = 0;
let oneEntryGArrays = 0;
let decodedOneEntryGArrays = 0;
let firstEntryGroups = 0;
let decodedFirstEntryGroups = 0;
let sequentialNestedTokens = 0;
const gArrayFailures = new Map<string, number>();
const gGroupFailures = new Map<string, number>();
const nestedSourceSlots = new Map<number, number>();

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

    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const decodedRoot = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        release,
      );
      if (!decodedRoot.ok) continue;
      const root = decodedRoot.value;
      const first = root.children[0];

      if (
        root.children.length === 1 &&
        first?.sourceClassSlot === REVIT_2027_GARRAY_SOURCE_CLASS_SLOT
      ) {
        oneEntryGArrays += 1;
        const decoded = decodeRevit2027GArray(
          inflated,
          root.dynamicPayloadOffset,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (decoded.ok) decodedOneEntryGArrays += 1;
        else {
          gArrayFailures.set(
            decoded.error,
            (gArrayFailures.get(decoded.error) ?? 0) + 1,
          );
        }
      }

      if (first?.sourceClassSlot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT) {
        firstEntryGroups += 1;
        const decoded = decodeRevit2027GGroupPrefix(
          inflated,
          root.dynamicPayloadOffset,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (!decoded.ok) {
          gGroupFailures.set(
            decoded.error,
            (gGroupFailures.get(decoded.error) ?? 0) + 1,
          );
          continue;
        }
        decodedFirstEntryGroups += 1;
        const expectedFirstToken = 3 + root.children.length;
        if (
          decoded.value.children.every(
            (child, index) => child.token === expectedFirstToken + index,
          )
        ) {
          sequentialNestedTokens += 1;
        }
        for (const child of decoded.value.children) {
          if (child.sourceClassSlot == null) continue;
          nestedSourceSlots.set(
            child.sourceClassSlot,
            (nestedSourceSlots.get(child.sourceClassSlot) ?? 0) + 1,
          );
        }
      }
    }
  }
}

console.log(JSON.stringify({
  modelPath,
  release,
  partitions: partitions.length,
  chunks,
  failedChunks,
  gArray: {
    sourceClassSlot: REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
    oneEntryCandidates: oneEntryGArrays,
    decodedExact140ByteBodies: decodedOneEntryGArrays,
    failures: Object.fromEntries(
      [...gArrayFailures].sort((left, right) => right[1] - left[1]),
    ),
  },
  gGroup: {
    sourceClassSlot: REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    firstEntryCandidates: firstEntryGroups,
    decodedStaticPrefixes: decodedFirstEntryGroups,
    sequentialNestedTokens,
    nestedSourceSlots: Object.fromEntries(
      [...nestedSourceSlots].sort((left, right) => right[1] - left[1]),
    ),
    failures: Object.fromEntries(
      [...gGroupFailures].sort((left, right) => right[1] - left[1]),
    ),
  },
}, null, 2));
