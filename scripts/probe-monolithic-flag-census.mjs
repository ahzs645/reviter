#!/usr/bin/env node
// Every occurrence of STAIRS_ATTR_MONOLITHIC_STAIRS (-1007255) with its value
// and validated frame head - no suppression, no cap.
import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import {
  gzipOffsets, inflateRevitChunk, revitWindowTail, salvageRevitChunk, stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const cfb = CFB.read(readFileSync(process.argv[2]), { type: "buffer" });
for (let e = 0; e < cfb.FileIndex.length; e += 1) {
  const path = cfb.FullPaths[e] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(
    cfb.FileIndex[e].content instanceof Uint8Array
      ? cfb.FileIndex[e].content : new Uint8Array(cfb.FileIndex[e].content));
  const offsets = gzipOffsets(stored);
  let window = null;
  for (let c = 0; c < offsets.length; c += 1) {
    const read = inflateRevitChunk(stored, offsets[c], offsets[c + 1], window);
    const data = read ?? salvageRevitChunk(stored, offsets[c], offsets[c + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let o = 0; o + 12 <= data.byteLength; o += 1) {
      if (view.getInt32(o, true) !== -1007255) continue;
      if (view.getUint32(o + 4, true) !== 0xffffffff) continue;
      const value = view.getUint32(o + 8, true);
      let head = "no-head";
      for (let back = o; back >= 0 && o - back < 32768; back -= 1) {
        if (back + 24 > data.byteLength) continue;
        if (view.getUint32(back + 4, true) !== 0) continue;
        const id = view.getUint32(back, true);
        if (!id || id > 0x00ffffff) continue;
        const len = view.getUint32(back + 12, true);
        if (len < 64 || len > 0x80000) continue;
        if (back + len + 16 < o) continue;
        const echoAt = back + len + 16;
        if (echoAt + 4 > data.byteLength || view.getUint32(echoAt, true) !== len) continue;
        head = `id=${id} marker=${view.getUint16(back + 16, true)} len=${len}`;
        break;
      }
      console.log(`${path} chunk ${c} at ${o} value=${value} ${head}`);
    }
  }
}
