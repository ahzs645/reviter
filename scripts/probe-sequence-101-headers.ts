// Probe: walk the element-header sequence of a partition stream and read each element's category
// from its own record, then compare with the converter's token-derived categories.
//
// Measured layout (2026-09-11, Snowdon 2024 / Technical School 2025 / UNBC 2027; tekton's write-up
// read as a specification, no code reused): a 26-byte block header precedes every gzip member —
//   u16 tag, u32 flags (4 = whole records; bit1 = record continues into the next block of this
//   sequence), u32 recordsStarting, u32 sizeHint, u32 bodyBytes, u32 sequence (101/102/103), u32 0
// — and a 6-byte footer (u16 tag', u32 sizeHint) follows the member. Sequence 101 concatenates to a
// stream of { i64 elementId, u32 bodySize, u32 classIndex } records whose class is ElementHeader.
// Usage: node --experimental-strip-types scripts/probe-sequence-101-headers.ts <model.rvt> [audit.json]
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk } from "../lib/reviter/revit-container.ts";
import { parseElemTable } from "../lib/reviter/elem-table.ts";
const path = process.argv[2]!; const auditPath = process.argv[3];
const cfb = CFB.read(readFileSync(path), { type: "buffer" });
const stream = (re: RegExp) => { const i = cfb.FullPaths.findIndex((s) => re.test(s)); let d = new Uint8Array(cfb.FileIndex[i]!.content as ArrayLike<number>); if (d[0] === 0x1f && d[1] === 0x8b) { const s = stripRevitPageChecksums(d); const o = gzipOffsets(s); const parts: Uint8Array[] = []; for (let k = 0; k < o.length; k++) { const c = inflateRevitChunk(s, o[k]!, o[k + 1]); if (c) parts.push(c); } const n = parts.reduce((a, b) => a + b.length, 0); d = new Uint8Array(n); let off = 0; for (const c of parts) { d.set(c, off); off += c.length; } } return d; };
const schema = readSchema(stream(/\/Formats\/Latest$/i)); if (!schema.ok) throw new Error(schema.error);
const byIndex = new Map(schema.schema.classes.map((c) => [c.index, c.name]));
const headerClass = schema.schema.classes.find((c) => c.name === "ElementHeader")!.index;
const known = new Set<number>(parseElemTable(stream(/\/Global\/ElemTable$/i))?.uniqueElementIds ?? []);
const parts = cfb.FileIndex.map((e, i) => ({ e, p: cfb.FullPaths[i]! })).filter(({ e, p }) => e.size > 0 && /\/Partitions\/[^/]+$/i.test(p)).sort((a, b) => b.e.size - a.e.size);
const data = stripRevitPageChecksums(new Uint8Array(parts[0]!.e.content as ArrayLike<number>)); const offs = gzipOffsets(data, 100000);
const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
const HEADER = 26;
const tags = new Map<number, number>(); const seqs = new Map<number, number>(); const flagsBySeq = new Map<string, number>();
const chunks101: Uint8Array[] = []; let bad = 0; let blocksExact = 0, blocksOff = 0; const offSamples: string[] = [];
for (let k = 0; k < offs.length; k++) {
  const o = offs[k]!; if (o < HEADER) { bad++; continue; }
  const h = o - HEADER; const tag = v.getUint16(h, true), flags = v.getUint32(h + 2, true), seq = v.getUint32(h + 18, true);
  tags.set(tag, (tags.get(tag) ?? 0) + 1); seqs.set(seq, (seqs.get(seq) ?? 0) + 1); flagsBySeq.set(`${seq}:${flags}`, (flagsBySeq.get(`${seq}:${flags}`) ?? 0) + 1);
  if (seq !== 101) continue;
  const page = inflateRevitChunk(data, o, offs[k + 1]); if (!page) { bad++; continue; }
  const a = v.getUint32(h + 6, true), c = v.getUint32(h + 14, true);
  if (page.length === 16 * a + c) blocksExact++; else { blocksOff++; if (offSamples.length < 4) offSamples.push(`block ${k}: page ${page.length} vs 16*${a}+${c}=${16 * a + c} flags ${flags}`); }
  chunks101.push(page);
}
const total = chunks101.reduce((a, b) => a + b.length, 0); const s101 = new Uint8Array(total); { let off = 0; for (const c of chunks101) { s101.set(c, off); off += c.length; } }
console.log(path.split("/").pop(), { members: offs.length, tags: [...tags], sequences: [...seqs], flagsBySeq: [...flagsBySeq].sort(), seq101Bytes: total, undecodable: bad, blocksExact, blocksOff, offSamples });
// Walk records.
const sv = new DataView(s101.buffer, s101.byteOffset, s101.byteLength);
const CAT_MIN = -2_100_000, CAT_MAX = -1_999_000;
let pos = 0, records = 0, headerClassRecords = 0, knownIds = 0, withCategory = 0, misaligned = 0; const classWords = new Map<number, number>(); const clsFlagWords = new Map<number, number>();
const categoryOf = new Map<number, number>(); const dupIds = new Set<number>(); let firstMisalign = -1;
while (pos + 16 <= s101.length) {
  const id = sv.getUint32(pos, true), idHigh = sv.getUint32(pos + 4, true), body = sv.getUint32(pos + 8, true), cls = sv.getUint16(pos + 12, true), clsFlags = sv.getUint16(pos + 14, true);
  // A null record — id -1 as all ones, empty body — sits between ordinary ones; it is 16 bytes like any other.
  const nullRecord = id === 0xffff_ffff && idHigh === 0xffff_ffff;
  if ((idHigh !== 0 && !nullRecord) || body > 10_000_000 || pos + 16 + body > s101.length) { misaligned++; if (firstMisalign < 0) firstMisalign = pos; break; }
  if (nullRecord) { pos += 16 + body; continue; }
  records++; classWords.set(cls, (classWords.get(cls) ?? 0) + 1); clsFlagWords.set(clsFlags, (clsFlagWords.get(clsFlags) ?? 0) + 1);
  if (cls === headerClass) { headerClassRecords++; if (known.has(id)) knownIds++;
    if (body >= 10) { const cat = sv.getUint32(pos + 16 + 2, true) - 0x1_0000_0000; if (cat > CAT_MIN && cat < CAT_MAX && sv.getUint32(pos + 16 + 6, true) === 0xffff_ffff) { withCategory++; if (categoryOf.has(id)) dupIds.add(id); categoryOf.set(id, cat); } } }
  pos += 16 + body;
}
console.log({ records, headerClassRecords, knownIds, withCategory, distinctElements: categoryOf.size, duplicateIds: dupIds.size, misaligned, firstMisalign, consumed: pos, of: s101.length, classWords: [...classWords].map(([c, n]) => [byIndex.get(c) ?? c, n]).slice(0, 6), highWords: [...clsFlagWords].sort((a, b) => b[1] - a[1]).slice(0, 8) });
if (misaligned) console.log("bytes at misalignment:", Buffer.from(s101.subarray(Math.max(0, firstMisalign - 32), firstMisalign + 48)).toString("hex").replace(/(..)/g, "$1 "));
if (auditPath) {
  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { elementManifest: { elements: { elementId: number; category: { id: number; evidence: string } | null }[] } };
  let same = 0, differ = 0, onlyAudit = 0, onlyHeader = 0; const disagreements = new Map<string, number>();
  const auditCats = new Map<number, { id: number; evidence: string }>();
  for (const e of audit.elementManifest.elements) if (e.category?.id != null) auditCats.set(e.elementId, e.category);
  for (const [id, cat] of auditCats) { const h = categoryOf.get(id); if (h == null) onlyAudit++; else if (h === cat.id) same++; else { differ++; const key = `${cat.evidence}: audit ${cat.id} vs header ${h}`; disagreements.set(key, (disagreements.get(key) ?? 0) + 1); } }
  for (const id of categoryOf.keys()) if (!auditCats.has(id)) onlyHeader++;
  console.log({ auditCategorised: auditCats.size, same, differ, onlyAudit, onlyHeader });
  console.log("top disagreements:", [...disagreements].sort((a, b) => b[1] - a[1]).slice(0, 10));
}
