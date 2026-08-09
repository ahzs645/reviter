import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import {
  gzipOffsets, inflateRevitChunk, revitWindowTail, salvageRevitChunk, stripRevitPageChecksums,
} from "/Users/ahmadjalil/github/reviter/lib/reviter/revit-container.ts";

const needle = "Monolithic staircase";
const bytes = new Uint8Array(needle.length * 2);
for (let i = 0; i < needle.length; i += 1) bytes[i * 2] = needle.charCodeAt(i);
const cfb = CFB.read(readFileSync(process.argv[2]), { type: "buffer" });
for (let e = 0; e < cfb.FileIndex.length; e += 1) {
  const path = cfb.FullPaths[e] ?? "";
  if (!/Partitions\/325$/i.test(path)) continue;
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
    outer: for (let o = 0; o + bytes.length <= data.byteLength; o += 1) {
      for (let i = 0; i < bytes.length; i += 1) if (data[o + i] !== bytes[i]) continue outer;
      console.log(`chunk ${c} stringOffset ${o}`);
      const start = Math.max(0, o - 96);
      for (let row = start; row < o + 16; row += 16) {
        const hex = [...data.subarray(row, row + 16)]
          .map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const ascii = [...data.subarray(row, row + 16)]
          .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
        console.log(`  ${(row - o).toString().padStart(5)}: ${hex}  ${ascii}`);
      }
      process.exit(0);
    }
  }
}
