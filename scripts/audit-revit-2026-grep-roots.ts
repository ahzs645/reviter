/**
 * Audit the exact persisted `GElement -> GRep` static roots in an RVT.
 *
 * This identifies genuine outer ownership and the exact dynamic-replay start;
 * it does not infer which queued child consumes any later payload bytes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2026-grep-roots.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2026GRepRoot,
  REVIT_2026_GELEMENT_WIRE_SELECTOR,
} from "../lib/reviter/revit-2026-grep-root.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2026-grep-roots.ts model.rvt",
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

const childSourceClassCounts = new Map<number, number>();
const failures = new Map<string, number>();
let chunks = 0;
let failedChunks = 0;
let inflatedBytes = 0;
let gElementFrames = 0;
let decodedRoots = 0;
let rootsWithBothValidExtents = 0;
let totalChildren = 0;
let dynamicPayloadBytes = 0;
const framedOwnerIds = new Set<number>();
const decodedOwnerIds = new Set<bigint>();
let overlappingFrames = 0;

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

    let priorFrameEnd = -1;
    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2026_GELEMENT_WIRE_SELECTOR) continue;
      gElementFrames += 1;
      framedOwnerIds.add(frame.elementId);
      if (frame.offset < priorFrameEnd) overlappingFrames += 1;
      priorFrameEnd = Math.max(priorFrameEnd, frame.offset + frame.objectLength + 20);
      const root = decodeRevit2026GRepRoot(inflated, frame);
      if (!root.ok) {
        failures.set(root.error, (failures.get(root.error) ?? 0) + 1);
        continue;
      }
      decodedRoots += 1;
      decodedOwnerIds.add(root.value.ownerElementId);
      if (root.value.localExtents.valid && root.value.worldExtents.valid) {
        rootsWithBothValidExtents += 1;
      }
      totalChildren += root.value.children.length;
      dynamicPayloadBytes +=
        root.value.dynamicPayloadEndOffset -
        root.value.dynamicPayloadOffset;
      for (const child of root.value.children) {
        if (child.sourceClassSlot == null) continue;
        childSourceClassCounts.set(
          child.sourceClassSlot,
          (childSourceClassCounts.get(child.sourceClassSlot) ?? 0) + 1,
        );
      }
    }
  }
}

console.log(JSON.stringify({
  modelPath,
  inputBytes: input.byteLength,
  partitions: partitions.length,
  chunks,
  failedChunks,
  inflatedBytes,
  gElementWireSelector:
    `0x${REVIT_2026_GELEMENT_WIRE_SELECTOR.toString(16).padStart(4, "0")}`,
  gElementFrames,
  distinctFramedOwnerIds: framedOwnerIds.size,
  overlappingFrames,
  decodedRoots,
  distinctDecodedOwnerIds: decodedOwnerIds.size,
  decodeRate:
    gElementFrames === 0 ? 0 : decodedRoots / gElementFrames,
  rootsWithBothValidExtents,
  validExtentsRate:
    decodedRoots === 0 ? 0 : rootsWithBothValidExtents / decodedRoots,
  totalChildren,
  dynamicPayloadBytes,
  childSourceClassCounts: Object.fromEntries(
    [...childSourceClassCounts].sort((a, b) => b[1] - a[1]),
  ),
  failures: Object.fromEntries(
    [...failures].sort((a, b) => b[1] - a[1]),
  ),
}, null, 2));
