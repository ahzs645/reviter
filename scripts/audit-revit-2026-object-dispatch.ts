/**
 * Bounded negative audit of raw slot-2237 byte occurrences against the exact
 * Revit 2026 GPolyMesh static reader shape.
 *
 * A raw occurrence is not an ObjectPtrInitReader boundary. This probe only
 * measures how often the release-scoped reader could consume the following
 * bytes and how often its conditional topology descriptor names slot 5255.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2026-object-dispatch.ts model.rvt
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
import {
  decodeRevit2026GPolyMeshStatic,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
} from "../lib/reviter/revit-2026-object-dispatch.ts";
import { locateFacetedTopology8Body } from "../lib/reviter/faceted-topology.ts";

const FACETED_TOPOLOGY8_SLOT = 5255;
const MAX_REPORTED_CANDIDATES = 100;

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2026-object-dispatch.ts model.rvt",
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

const candidates: {
  stream: string;
  chunkIndex: number;
  selectorOffset: number;
  bodyEndOffset: number;
  topologyToken: number;
  topologySourceClassSlot: number;
  interiorStyleElementId: string;
  materialElementId: string;
  polyMeshFlags: number;
}[] = [];
let chunks = 0;
let failedChunks = 0;
let inflatedBytes = 0;
let rawSlotOccurrences = 0;
let completeStaticShapes = 0;
let facetedTopology8Descriptors = 0;
let plausibleFacetedTopology8Descriptors = 0;
let rawFacetedTopology8SlotOccurrences = 0;
let scopedGPolyMeshStaticShapes = 0;
let plausibleScopedGPolyMeshStaticShapes = 0;
let immediateScopedTopology8Bodies = 0;
let candidatesTruncated = false;

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
    const view = new DataView(
      inflated.buffer,
      inflated.byteOffset,
      inflated.byteLength,
    );
    for (
      let selectorOffset = 0;
      selectorOffset + 2 <= inflated.byteLength;
      selectorOffset += 1
    ) {
      if (
        view.getInt16(selectorOffset, true) !==
        REVIT_2026_GPOLYMESH_SOURCE_CLASS
      ) {
        if (view.getInt16(selectorOffset, true) !== FACETED_TOPOLOGY8_SLOT) {
          continue;
        }
        rawFacetedTopology8SlotOccurrences += 1;
        const scopedBodyOffset = selectorOffset - 24;
        if (scopedBodyOffset < 0) continue;
        const scoped = decodeRevit2026GPolyMeshStatic(
          inflated,
          scopedBodyOffset,
        );
        if (
          !scoped.ok ||
          scoped.value.value.topologySourceClassSlot !==
            FACETED_TOPOLOGY8_SLOT
        ) {
          continue;
        }
        scopedGPolyMeshStaticShapes += 1;
        if (
          scoped.value.value.topologyPropertyToken <= 0 ||
          scoped.value.value.topologyPropertyToken > 100_000
        ) {
          continue;
        }
        plausibleScopedGPolyMeshStaticShapes += 1;
        const immediateTopology = locateFacetedTopology8Body(
          inflated,
          scoped.value.endOffset,
        );
        if (immediateTopology.ok) immediateScopedTopology8Bodies += 1;
        continue;
      }
      rawSlotOccurrences += 1;
      const decoded = decodeRevit2026GPolyMeshStatic(
        inflated,
        selectorOffset + 2,
      );
      if (!decoded.ok) continue;
      completeStaticShapes += 1;
      const value = decoded.value.value;
      if (value.topologySourceClassSlot !== FACETED_TOPOLOGY8_SLOT) continue;
      facetedTopology8Descriptors += 1;
      if (
        value.topologyPropertyToken <= 0 ||
        value.topologyPropertyToken > 100_000
      ) {
        continue;
      }
      plausibleFacetedTopology8Descriptors += 1;
      if (candidates.length < MAX_REPORTED_CANDIDATES) {
        candidates.push({
          stream: partition.path.replace(/^Root Entry\//, ""),
          chunkIndex,
          selectorOffset,
          bodyEndOffset: decoded.value.endOffset,
          topologyToken: value.topologyPropertyToken,
          topologySourceClassSlot: value.topologySourceClassSlot,
          interiorStyleElementId: value.interiorStyleElementId.toString(),
          materialElementId: value.materialElementId.toString(),
          polyMeshFlags: value.polyMeshFlags,
        });
      } else {
        candidatesTruncated = true;
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
        topologyTokenMin: 1,
        topologyTokenMax: 100_000,
        maxReportedCandidates: MAX_REPORTED_CANDIDATES,
      },
      rawSlotOccurrences,
      completeStaticShapes,
      facetedTopology8Descriptors,
      plausibleFacetedTopology8Descriptors,
      scopedReplayAudit: {
        rawFacetedTopology8SlotOccurrences,
        scopedGPolyMeshStaticShapes,
        plausibleScopedGPolyMeshStaticShapes,
        immediateScopedTopology8Bodies,
        interpretation:
          "DynamicQueue replay supplies slot 2237 as scoped state, so a GPolyMesh body has no serialized 2237 selector. Slot 5255 anchors the nested descriptor at bodyOffset + 24, but only a certified parent queue can establish the body start.",
      },
      candidatesTruncated,
      candidates,
      interpretation:
        "Raw slot bytes are not ObjectPtrInitReader boundaries. A candidate requires an independently proven outer class-dispatch position before registry or replay certification.",
    },
    null,
    2,
  ),
);
