#!/usr/bin/env node

/**
 * Find UTF-16LE stair-type names ("Monolithic Run", "Non-Monolithic Run",
 * seat/terrace type names) in the inflated partition streams and report the
 * element frame each occurrence sits inside, so the StairsRunType records can
 * be located without a schema tag.
 *
 *   node --experimental-strip-types scripts/probe-monolithic-names.ts model.rvt
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

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-monolithic-names.ts model.rvt");

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

const needles = process.argv.length > 3
  ? process.argv.slice(3)
  : ["Monolithic", "Terrace", "Amphith", "Run Type", "Stair Run"];
const encoded = needles.map((needle) => {
  const bytes = new Uint8Array(needle.length * 2);
  for (let index = 0; index < needle.length; index += 1) {
    bytes[index * 2] = needle.charCodeAt(index) & 0xff;
    bytes[index * 2 + 1] = needle.charCodeAt(index) >> 8;
  }
  return { needle, bytes };
});

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
let hits = 0;
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$|ElemTable$|Latest$/i.test(path)) continue;
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
    for (const { needle, bytes } of encoded) {
      outer: for (let offset = 0; offset + bytes.length <= data.byteLength; offset += 1) {
        for (let index = 0; index < bytes.length; index += 1) {
          if (data[offset + index] !== bytes[index]) continue outer;
        }
        // Read the surrounding UTF-16 run for context (ASCII or Cyrillic).
        const isWordUnit = (low: number, high: number) =>
          (high === 0 && low >= 0x20 && low < 0x7f) ||
          (high === 0x04 && low <= 0xff);
        let start = offset;
        while (start >= 2 && isWordUnit(data[start - 2]!, data[start - 1]!)) start -= 2;
        let end = offset + bytes.length;
        while (end + 2 <= data.byteLength && isWordUnit(data[end]!, data[end + 1]!)) end += 2;
        let text = "";
        for (let index = start; index + 1 < end; index += 2) {
          text += String.fromCharCode(data[index]! | (data[index + 1]! << 8));
        }
        // The nearest preceding valid frame head names the owning element.
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let owner = null;
        for (let back = offset; back >= 0 && offset - back < 16384; back -= 1) {
          if (back + 24 > data.byteLength) continue;
          if (view.getUint32(back + 4, true) !== 0) continue;
          const elementId = view.getUint32(back, true);
          if (!elementId || elementId > 0x0fff_ffff) continue;
          const objectLength = view.getUint32(back + 12, true);
          if (objectLength < 24 || back + objectLength < offset) continue;
          owner = {
            elementId,
            marker: view.getUint16(back + 16, true),
            frameOffset: back,
            inFrame: offset - back,
          };
          break;
        }
        console.log(`${path} chunk ${chunkIndex} "${text}"` +
          (owner
            ? ` element=${owner.elementId} marker=${owner.marker} at+${owner.inFrame}`
            : " (no frame head found)"));
        hits += 1;
        if (hits > 60) process.exit(0);
        offset = end;
      }
    }
  }
}
console.log(`total hits: ${hits}`);
