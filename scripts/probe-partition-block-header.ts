// Probe: what heads each inflated partition page? tekton reports a 0x0f28 header naming a
// logical sequence (101 element header / 102 element object / 103 drawable representation).
// Usage: node --experimental-strip-types scripts/probe-partition-block-header.ts <model.rvt> [maxPages]
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk } from "../lib/reviter/revit-container.ts";
const path = process.argv[2]!; const maxPages = Number(process.argv[3] ?? 400);
const cfb = CFB.read(readFileSync(path), { type: "buffer" });
const parts = cfb.FileIndex.map((e, i) => ({ e, p: cfb.FullPaths[i]! })).filter(({ e, p }) => e.size > 0 && /\/Partitions\/[^/]+$/i.test(p)).sort((a, b) => b.e.size - a.e.size);
const data = stripRevitPageChecksums(new Uint8Array(parts[0]!.e.content as ArrayLike<number>)); const offs = gzipOffsets(data, 100000);
const stride = Math.max(1, Math.floor(offs.length / maxPages));
const heads = new Map<string, number>(); const words = new Map<string, number>(); let pages = 0; const sizes: number[] = [];
for (let pi = 0; pi < offs.length; pi += stride) {
  const page = inflateRevitChunk(data, offs[pi]!, offs[pi + 1]); if (!page) continue; pages++; sizes.push(page.length);
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength);
  const head = Buffer.from(page.subarray(0, 24)).toString("hex").replace(/(..)/g, "$1 ").trim();
  heads.set(head.slice(0, 35), (heads.get(head.slice(0, 35)) ?? 0) + 1);
  for (let k = 0; k + 2 <= 16; k += 2) { const w = v.getUint16(k, true); const key = `+${k}:${w}`; words.set(key, (words.get(key) ?? 0) + 1); }
}
sizes.sort((a, b) => a - b);
console.log(path.split("/").pop(), "pages", pages, "of", offs.length, "page bytes p10/p50/p90", sizes[Math.floor(sizes.length * .1)], sizes[Math.floor(sizes.length * .5)], sizes[Math.floor(sizes.length * .9)]);
console.log("first 12 bytes, top forms:"); for (const [k, n] of [...heads].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log("u16 words by offset (top):"); for (const [k, n] of [...words].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(n).padStart(6)}  ${k}`);
// Is 0x0f28 present anywhere near page starts? Count occurrences in the first 64 bytes across pages.
let f28 = 0; for (let pi = 0; pi < offs.length; pi += stride) { const page = inflateRevitChunk(data, offs[pi]!, offs[pi + 1]); if (!page) continue; const b = Buffer.from(page.subarray(0, 64)); if (b.indexOf(Buffer.from([0x28, 0x0f])) >= 0) f28++; }
console.log("pages with 28 0f in first 64 bytes:", f28);
