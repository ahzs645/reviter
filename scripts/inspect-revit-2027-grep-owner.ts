#!/usr/bin/env node

/**
 * Print one framed Revit 2027 GElement/GRep owner's exact root, FIFO replay,
 * and certified browser-mesh result. This is a diagnostic tool: it never
 * modifies the RVT and does not use IFC data.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/inspect-revit-2027-grep-owner.ts model.rvt element-id \
 *       [referenced-owner-id ...]
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
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
  replayRevit2027GRepFifo,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
} from "../lib/reviter/revit-2027-certified-owner-mesh.ts";
import {
  certifyRevit2027DrawableFaceCoverage,
  createRevit2027NativeMeshCollector,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";

const modelPath = process.argv[2];
const elementIdText = process.argv[3];
const referencedOwnerTexts = process.argv.slice(4);
if (!modelPath || !elementIdText || !/^[1-9]\d*$/u.test(elementIdText)) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/inspect-revit-2027-grep-owner.ts model.rvt element-id",
  );
}
const targetElementId = Number(elementIdText);
if (!Number.isSafeInteger(targetElementId)) {
  throw new Error("element-id must be a positive safe integer");
}
const inspectionOwnerIds = new Set([targetElementId]);
for (const text of referencedOwnerTexts) {
  if (!/^[1-9]\d*$/u.test(text)) {
    throw new Error(`referenced-owner-id must be a positive integer: ${text}`);
  }
  const id = Number(text);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`referenced-owner-id must be a safe integer: ${text}`);
  }
  inspectionOwnerIds.add(id);
}

const container = CFB.read(readFileSync(modelPath), { type: "buffer" });
const entries = container.FileIndex.map((entry, index) => ({
  entry,
  path: container.FullPaths[index] ?? "",
}));
const basicFileInfo = entries.find(
  ({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/iu.test(path),
);
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(
    `inspection requires Revit 2027, received ${release ?? "unknown"}`,
  );
}

const records: unknown[] = [];
const collector = createRevit2027NativeMeshCollector(release);
let chunks = 0;
let failedChunks = 0;
for (const partition of entries.filter(
  ({ entry, path }) =>
    entry.size > 0 && /\/Partitions\/[^/]+$/iu.test(path),
)) {
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
    const frames = scanFramedElementObjects(inflated);
    // The inspector is intentionally bounded to pages containing the requested
    // owner. Revit normally co-locates that root and its nested definitions;
    // unresolved cross-page targets are reported instead of turning a one-owner
    // diagnostic into a whole-model native replay.
    if (frames.some((frame) => inspectionOwnerIds.has(frame.elementId))) {
      collector.scanPage(inflated);
    }
    for (const frame of frames) {
      if (
        frame.elementId !== targetElementId ||
        frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER
      ) {
        continue;
      }
      const root = decodeRevit2027FramedGRepRoot(inflated, frame, release);
      if (!root.ok) {
        records.push({
          stream: partition.path,
          chunkIndex,
          frame,
          rootError: root.error,
        });
        continue;
      }
      const replay = replayRevit2027GRepFifo(inflated, root.value);
      if (!replay.ok) {
        records.push({
          stream: partition.path,
          chunkIndex,
          frame,
          root: root.value,
          replayError: replay.error,
        });
        continue;
      }
      const mesh = meshRevit2027CertifiedOwnerReplay(replay.value);
      if (!mesh.ok) {
        records.push({
          stream: partition.path,
          chunkIndex,
          frame,
          root: root.value,
          replay: replay.value,
          meshError: mesh.error,
        });
        continue;
      }
      records.push({
        stream: partition.path,
        chunkIndex,
        frame,
        root: root.value,
        replay: replay.value,
        mesh: {
          faceMeshes: mesh.value.faceMeshes.map((face) => ({
            faceToken: face.faceToken,
            kind: face.kind,
            positions: face.mesh.positions.length / 3,
            triangles: face.mesh.indices.length / 3,
          })),
          issues: mesh.value.issues,
          coverage: certifyRevit2027DrawableFaceCoverage(
            mesh.value.replay.spans,
            mesh.value.faceMeshes,
            mesh.value.issues,
          ),
        },
      });
    }
  }
}

const collection = collector.snapshot([targetElementId]);
const composed = collection.owners.get(targetElementId);

console.log(JSON.stringify({
  modelPath,
  release,
  targetElementId,
  chunks,
  failedChunks,
  records,
  composed: composed
    ? {
        faces: composed.faces.length,
        triangles: composed.triangles,
      }
    : null,
  requestedOwnerFailureSamples: collection.requestedOwnerFailureSamples.filter(
    (failure) => failure.ownerElementId === targetElementId,
  ),
}, (_key, value) =>
  typeof value === "bigint" ? value.toString() : value, 2));

if (records.length === 0 || failedChunks > 0) process.exitCode = 1;
