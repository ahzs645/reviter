#!/usr/bin/env node

/**
 * Anatomy of the record that carries a UTF-16 needle inside a type-parameter
 * table. Prints a wide hex window, the best-validated frame head found by
 * scanning backwards (element id + zero high word + object length that spans
 * the string + marker + echo where reachable), and a first-pass walk of the
 * [i64 built-in-parameter][value] entries around the needle.
 *
 *   node --experimental-strip-types scripts/probe-type-parameter-record.ts \
 *     model.rvt "Monolithic staircase"
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

const [rvtPath, needleText] = process.argv.slice(2);
if (!rvtPath || !needleText) {
  throw new Error('usage: probe-type-parameter-record.ts model.rvt "needle"');
}

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

const needle = new Uint8Array(needleText.length * 2);
for (let index = 0; index < needleText.length; index += 1) {
  needle[index * 2] = needleText.charCodeAt(index) & 0xff;
  needle[index * 2 + 1] = needleText.charCodeAt(index) >> 8;
}

const BUILT_IN_MIN = -2_000_000;
const BUILT_IN_MAX = -1_000_000;

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(stored);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    const data = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    outer: for (let offset = 0; offset + needle.length <= data.byteLength; offset += 1) {
      for (let index = 0; index < needle.length; index += 1) {
        if (data[offset + index] !== needle[index]) continue outer;
      }
      console.log(`${path} chunk ${chunkIndex} stringOffset ${offset}`);

      // Backward scan for a frame head whose object span covers the string.
      const heads: string[] = [];
      for (let back = offset; back >= 0 && offset - back < 32768; back -= 1) {
        if (back + 24 > data.byteLength) continue;
        if (view.getUint32(back + 4, true) !== 0) continue;
        const elementId = view.getUint32(back, true);
        if (!elementId || elementId > 0x00ff_ffff) continue;
        const objectLength = view.getUint32(back + 12, true);
        if (objectLength < 64 || objectLength > 0x80000) continue;
        if (back + objectLength < offset) continue;
        const marker = view.getUint16(back + 16, true);
        const echoOffset = back + objectLength + 16;
        const echo = echoOffset + 4 <= data.byteLength
          ? view.getUint32(echoOffset, true)
          : null;
        heads.push(`head@-${offset - back} id=${elementId} marker=${marker}` +
          ` len=${objectLength} echo=${echo === objectLength ? "ok" : echo}`);
        if (heads.length >= 6) break;
      }
      for (const head of heads) console.log("  " + head);

      // Walk built-in-parameter ids in a +-1200 byte window and print each
      // entry id, its label offset, and the bytes up to the next entry.
      const windowStart = Math.max(0, offset - 1200);
      const windowEnd = Math.min(data.byteLength - 8, offset + 1200);
      const entries: Array<{ at: number; id: number }> = [];
      for (let at = windowStart; at < windowEnd; at += 1) {
        if (view.getUint32(at + 4, true) !== 0xffff_ffff) continue;
        const id = view.getInt32(at, true);
        if (id <= BUILT_IN_MIN || id >= BUILT_IN_MAX) continue;
        entries.push({ at, id });
        at += 7;
      }
      console.log(`  ${entries.length} built-in-parameter ids in window:`);
      for (const [index, entry] of entries.entries()) {
        const next = entries[index + 1]?.at ?? Math.min(entry.at + 72, windowEnd);
        const value = data.subarray(entry.at + 8, Math.min(next, entry.at + 8 + 48));
        const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        console.log(`    at ${entry.at - offset} id=${entry.id} gap=${next - entry.at - 8}` +
          ` value=${hex}`);
      }
      process.exit(0);
    }
  }
}
console.log("needle not found");
