#!/usr/bin/env node

/**
 * Hunt the StairsRun frame for the run -> run-type ObjectId slot.
 *
 * A run frame's bytes +26..+126 and its post-header region are unread by the
 * aggregate decoder. If a fixed slot holds the run type reference, then
 * across the model's ~107 runs that slot yields a SMALL set of distinct
 * target ids (the few StairsRunType elements) shared by many runs. Sweep
 * every 8-byte-aligned-candidate offset, report offsets by
 * (sources, distinct targets), and dump the winners' target ids.
 *
 *   node --experimental-strip-types scripts/probe-stairs-run-type-slot.ts model.rvt
 */
import { readFileSync } from "node:fs";

import * as CFB from "cfb";

import {
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const STAIRS_RUN_MARKER = 4102;

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-stairs-run-type-slot.ts model.rvt");

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
type Candidate = { elementId: number; fieldOffset: number; targetId: number };
const candidates: Candidate[] = [];
const runIds = new Set<number>();

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(stored);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const data = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = 0; offset + 420 <= data.byteLength; offset += 1) {
      if (view.getUint16(offset + 16, true) !== STAIRS_RUN_MARKER) continue;
      if (view.getUint32(offset + 4, true) !== 0) continue;
      const elementId = view.getUint32(offset, true);
      if (!elementId) continue;
      // StairsRun frames carry type code zero (collector contract).
      if (view.getUint32(offset + 18, true) !== 0) continue;
      if (view.getUint32(offset + 22, true) !== 0) continue;
      const objectLength = view.getUint32(offset + 12, true);
      if (objectLength < 200 || objectLength > 0x100000) continue;
      runIds.add(elementId);
      const limit = Math.min(offset + 420, data.byteLength - 8);
      for (let at = offset + 26; at + 8 <= limit; at += 1) {
        if (view.getUint32(at + 4, true) !== 0) continue;
        const targetId = view.getUint32(at, true);
        if (targetId && targetId !== elementId && targetId < 0x0fff_ffff) {
          candidates.push({ elementId, fieldOffset: at - offset, targetId });
        }
      }
    }
  }
}

console.log(`stair run frames found: ${runIds.size}`);
const byOffset = new Map<number, Map<number, Set<number>>>();
for (const candidate of candidates) {
  const targets = byOffset.get(candidate.fieldOffset) ?? new Map<number, Set<number>>();
  const sources = targets.get(candidate.targetId) ?? new Set<number>();
  sources.add(candidate.elementId);
  targets.set(candidate.targetId, sources);
  byOffset.set(candidate.fieldOffset, targets);
}
const rows = [...byOffset]
  .map(([fieldOffset, targets]) => {
    const sources = new Set<number>();
    for (const sourceSet of targets.values()) {
      for (const source of sourceSet) sources.add(source);
    }
    return { fieldOffset, distinctTargets: targets.size, sources: sources.size, targets };
  })
  .filter((row) => row.sources >= runIds.size * 0.8 && row.distinctTargets <= 12)
  .sort((left, right) => left.distinctTargets - right.distinctTargets);
for (const row of rows.slice(0, 20)) {
  const targetList = [...row.targets.keys()].slice(0, 12);
  console.log(`offset +${row.fieldOffset}: ${row.sources} runs ->` +
    ` ${row.distinctTargets} targets: ${targetList.join(", ")}`);
}
