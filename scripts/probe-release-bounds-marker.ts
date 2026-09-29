// Probe: does the Revit 2027 duplicated-bounds record exist in other releases under the file's own GElement class index?
// Usage: node --experimental-strip-types scripts/probe-release-bounds-marker.ts <model.rvt> <markerHex> [drawn-element-ids.json] [maxPages]
// Measured 2026-09-11: Technicalschoolcurrentm.rvt (2025) with 0x0876 -> 8,506 records, 5,443/5,479 Autodesk-drawn ids; with 2027's 0x08c6 -> 0.
// Does the 2027 duplicated-bounds record exist in 2024/2025 files under the file's own GElement index?
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk } from "../lib/reviter/revit-container.ts";
const [path, markerHex, drawnIdsPath, maxPagesArg] = process.argv.slice(2);
const marker = Number(markerHex); const maxPages = Number(maxPagesArg ?? 400);
const drawn = drawnIdsPath ? new Set<number>(JSON.parse(readFileSync(drawnIdsPath, "utf8"))) : null;
const cfb = CFB.read(readFileSync(path!), { type: "buffer" });
const parts = cfb.FileIndex.map((e, i) => ({ e, p: cfb.FullPaths[i]! })).filter(({ e, p }) => e.size > 0 && /\/Partitions\/[^/]+$/i.test(p)).sort((a,b)=>b.e.size-a.e.size);
const data = stripRevitPageChecksums(new Uint8Array(parts[0]!.e.content as ArrayLike<number>));
const offs = gzipOffsets(data, 100000);
const stride = Math.max(1, Math.floor(offs.length / maxPages));
const lo = marker & 0xff, hi = marker >> 8;
const stage = { markerHits: 0, idEcho: 0, familyWord: 0, three: 0, count: 0, boundsOk: 0, duplicated: 0 };
const familyWords = new Map<number, number>(); const threeWords = new Map<number, number>();
const ids = new Set<number>(); const samples: string[] = [];
let pagesRead = 0;
for (let pi = 0; pi < offs.length; pi += stride) {
  const page = inflateRevitChunk(data, offs[pi]!, offs[pi + 1]); if (!page) continue; pagesRead++;
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength);
  for (let t = page.indexOf(lo, 16); t >= 0 && t + 122 < page.length; t = page.indexOf(lo, t + 1)) {
    if (page[t + 1] !== hi) continue;
    const r = t - 16; const id = v.getUint32(r, true);
    if (!id || id === 0xffffffff || v.getUint32(r + 4, true) !== 0) continue;
    stage.markerHits++;
    if (v.getUint32(r + 26, true) !== id || v.getUint32(r + 30, true) !== 0) continue;
    stage.idEcho++;
    const fw = v.getUint32(r + 34, true); familyWords.set(fw, (familyWords.get(fw) ?? 0) + 1);
    if (fw !== 0x0008_8004) continue; stage.familyWord++;
    const tw = v.getUint32(r + 42, true); threeWords.set(tw, (threeWords.get(tw) ?? 0) + 1);
    if (tw !== 3) continue; stage.three++;
    const n = v.getUint32(r + 38, true); if (n < 1 || n > 10000) continue; stage.count++;
    const b = r + 42 + n * 6; if (b + 96 > page.length) continue;
    const vals: number[] = []; let ok = true;
    for (let k = 0; k < 6; k++) { const x = v.getFloat64(b + k * 8, true); if (!Number.isFinite(x) || Math.abs(x) > 50000) ok = false; vals.push(x); }
    if (!ok) continue; stage.boundsOk++;
    let dup = true; for (let k = 0; k < 48; k++) if (page[b + k] !== page[b + 48 + k]) { dup = false; break; }
    if (dup) stage.duplicated++;
    ids.add(id);
    if (samples.length < 5) samples.push(`id=${id} code=${v.getUint32(r+18,true).toString(16)} n=${n} dup=${dup} box=[${vals.map(x=>x.toFixed(2)).join(",")}]`);
  }
}
console.log(JSON.stringify({ file: path!.split("/").pop(), marker: "0x" + marker.toString(16), pagesRead, of: offs.length, stage, uniqueIds: ids.size }));
console.log("family words:", [...familyWords].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([w,n])=>`0x${w.toString(16)}:${n}`).join(" "));
console.log("+42 words:", [...threeWords].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([w,n])=>`${w}:${n}`).join(" "));
if (drawn) { let hit = 0; for (const id of ids) if (drawn.has(id)) hit++; console.log(`ids matching Autodesk-drawn elements: ${hit}/${ids.size} (drawn set ${drawn.size}; sampled ${pagesRead}/${offs.length} pages)`); }
for (const s of samples) console.log("  ", s);
