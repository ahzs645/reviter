#!/usr/bin/env node

/**
 * Find every record that carries one of the stair-type built-in parameters,
 * validate its frame head, and walk its parameter table.
 *
 * Targets both generations: the legacy sketched-stair type flag
 * STAIRS_ATTR_MONOLITHIC_STAIRS (-1007255) and the component-stair type
 * parameters STAIRSTYPE_RUN_TYPE (-1151207), STAIRSTYPE_CONSTRUCTION_METHOD
 * (-1151233), STAIRSTYPE_IS_ASSEMBLED_STAIRS (-1151218),
 * STAIRS_RUNTYPE_STRUCTURE (-1151403) and
 * STAIRS_RUNTYPE_HAS_MONOLITHIC_SUPPORT (-1151401).
 *
 *   node --experimental-strip-types scripts/probe-stair-type-params.ts model.rvt
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

const TARGET_PARAMETERS = new Set([
  -1007255, -1151207, -1151233, -1151218, -1151403, -1151401,
]);
const BUILT_IN_MIN = -2_000_000;
const BUILT_IN_MAX = -1_000_000;

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-stair-type-params.ts model.rvt");

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
let reported = 0;
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
    let lastReport = -1;
    for (let offset = 0; offset + 8 <= data.byteLength; offset += 1) {
      if (view.getUint32(offset + 4, true) !== 0xffff_ffff) continue;
      const id = view.getInt32(offset, true);
      if (!TARGET_PARAMETERS.has(id)) continue;
      if (offset - lastReport < 2000 && lastReport >= 0) continue;
      lastReport = offset;
      console.log(`\n${path} chunk ${chunkIndex} at ${offset}: hit param ${id}`);

      // Validated frame head covering this offset.
      for (let back = offset; back >= 0 && offset - back < 32768; back -= 1) {
        if (back + 24 > data.byteLength) continue;
        if (view.getUint32(back + 4, true) !== 0) continue;
        const elementId = view.getUint32(back, true);
        if (!elementId || elementId > 0x00ff_ffff) continue;
        const objectLength = view.getUint32(back + 12, true);
        if (objectLength < 64 || objectLength > 0x80000) continue;
        if (back + objectLength + 16 < offset) continue;
        const echoOffset = back + objectLength + 16;
        const echo = echoOffset + 4 <= data.byteLength
          ? view.getUint32(echoOffset, true)
          : null;
        if (echo !== objectLength) continue;
        console.log(`  head id=${elementId}` +
          ` marker=${view.getUint16(back + 16, true)} len=${objectLength}` +
          ` paramAt=+${offset - back}`);
        break;
      }

      // Walk the surrounding table.
      const windowStart = Math.max(0, offset - 900);
      const windowEnd = Math.min(data.byteLength - 8, offset + 900);
      for (let at = windowStart; at < windowEnd; at += 1) {
        if (view.getUint32(at + 4, true) !== 0xffff_ffff) continue;
        const paramId = view.getInt32(at, true);
        if (paramId <= BUILT_IN_MIN || paramId >= BUILT_IN_MAX) continue;
        const value = data.subarray(at + 8, Math.min(at + 8 + 24, windowEnd));
        const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
        const flag = TARGET_PARAMETERS.has(paramId) ? "  <<<" : "";
        console.log(`    ${(at - offset).toString().padStart(5)} id=${paramId} ${hex}${flag}`);
        at += 7;
      }
      reported += 1;
      if (reported >= 8) process.exit(0);
    }
  }
}
console.log(`\nreports: ${reported}`);
