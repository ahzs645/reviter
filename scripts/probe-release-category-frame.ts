// Probe: where BuiltInCategory ids sit in a non-2027 partition and what frames them.
// Usage: node --experimental-strip-types scripts/probe-release-category-frame.ts <model.rvt> [maxPages]
// Measured 2026-09-11: the 2027 `04 00` token is absent from 2025 files (1 hit); the dominant frame in both releases is [u32][ElementHeader index][00 00][i64 categoryId].
// Probe: where do BuiltInCategory ids live in a non-2027 partition, and what frames them?
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk } from "../lib/reviter/revit-container.ts";
const path = process.argv[2]!;
const maxPages = Number(process.argv[3] ?? 400);
const buf = readFileSync(path);
const cfb = CFB.read(buf, { type: "buffer" });
const parts = cfb.FileIndex.map((e, i) => ({ e, p: cfb.FullPaths[i]! })).filter(({ e, p }) => e.size > 0 && /\/Partitions\/[^/]+$/i.test(p)).sort((a,b)=>b.e.size-a.e.size);
const part = parts[0]!;
const data = stripRevitPageChecksums(new Uint8Array(part.e.content as ArrayLike<number>));
const offs = gzipOffsets(data, 100000);
console.log("partition", part.p, "pages", offs.length);
const before = new Map<string, number>(); const after = new Map<string, number>();
let hits = 0; const catCounts = new Map<number, number>();
const CAT_MIN = -2_100_000, CAT_MAX = -1_999_000;
const stride = Math.max(1, Math.floor(offs.length / maxPages));
for (let pi = 0; pi < offs.length; pi += stride) {
  const page = inflateRevitChunk(data, offs[pi]!, offs[pi + 1]);
  if (!page) continue;
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength);
  for (let o = 0; o + 8 <= page.length; o++) {
    if (page[o + 4] !== 0xff || page[o + 5] !== 0xff || page[o + 6] !== 0xff || page[o + 7] !== 0xff) continue;
    const id = Number(v.getBigInt64(o, true));
    if (id < CAT_MIN || id > CAT_MAX) continue;
    hits++;
    catCounts.set(id, (catCounts.get(id) ?? 0) + 1);
    const b = Buffer.from(page.subarray(Math.max(0, o - 10), o)).toString("hex").replace(/(..)/g, "$1 ").trim();
    const a = Buffer.from(page.subarray(o + 8, o + 16)).toString("hex").replace(/(..)/g, "$1 ").trim();
    before.set(b, (before.get(b) ?? 0) + 1); after.set(a, (after.get(a) ?? 0) + 1);
  }
}
console.log("category-id hits in sampled pages:", hits);
console.log("top categories:", [...catCounts].sort((a,b)=>b[1]-a[1]).slice(0,12));
console.log("bytes before (10):"); for (const [k,n] of [...before].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${n.toString().padStart(6)}  ${k}`);
console.log("bytes after (8):"); for (const [k,n] of [...after].sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`  ${n.toString().padStart(6)}  ${k}`);
// also the exact 2027 token: 04 00 <u32> <i64 cat> ff ff ff ff
let exact = 0;
for (let pi = 0; pi < offs.length; pi += stride) {
  const page = inflateRevitChunk(data, offs[pi]!, offs[pi + 1]); if (!page) continue;
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength);
  for (let o = 0; o + 18 <= page.length; o++) {
    if (page[o] !== 4 || page[o+1] !== 0) continue;
    if (page[o+14]!==0xff||page[o+15]!==0xff||page[o+16]!==0xff||page[o+17]!==0xff) continue;
    const id = Number(v.getBigInt64(o+6, true)); if (id < CAT_MIN || id > CAT_MAX) continue; exact++;
  }
}
console.log("exact 2027-layout tokens in sampled pages:", exact);
