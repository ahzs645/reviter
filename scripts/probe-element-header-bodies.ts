// Probe: where the category sits inside element-header records, checked against a conversion audit.
// Usage: [WANT=<elementId>] node --experimental-strip-types scripts/probe-element-header-bodies.ts <model.rvt> <audit.json> [drawn-element-ids.json]
// Measured 2026-09-11: UNBC 38,788 of 39,165 audit-categorised elements carry the category in their own header (377 null); agreement 38,718, 70 donated-token disagreements.
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk } from "../lib/reviter/revit-container.ts";
const path = process.argv[2]!; const auditPath = process.argv[3]!;
const cfb = CFB.read(readFileSync(path), { type: "buffer" });
const stream = (re: RegExp) => { const i = cfb.FullPaths.findIndex((s) => re.test(s)); let d = new Uint8Array(cfb.FileIndex[i]!.content as ArrayLike<number>); if (d[0] === 0x1f && d[1] === 0x8b) { const s = stripRevitPageChecksums(d); const o = gzipOffsets(s); const parts: Uint8Array[] = []; for (let k = 0; k < o.length; k++) { const c = inflateRevitChunk(s, o[k]!, o[k + 1]); if (c) parts.push(c); } const n = parts.reduce((a, b) => a + b.length, 0); d = new Uint8Array(n); let off = 0; for (const c of parts) { d.set(c, off); off += c.length; } } return d; };
const schema = readSchema(stream(/\/Formats\/Latest$/i)); if (!schema.ok) throw new Error(schema.error);
const parts = cfb.FileIndex.map((e, i) => ({ e, p: cfb.FullPaths[i]! })).filter(({ e, p }) => e.size > 0 && /\/Partitions\/[^/]+$/i.test(p)).sort((a, b) => b.e.size - a.e.size);
const data = stripRevitPageChecksums(new Uint8Array(parts[0]!.e.content as ArrayLike<number>)); const offs = gzipOffsets(data, 100000);
const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
const chunks: Uint8Array[] = [];
for (let k = 0; k < offs.length; k++) { const o = offs[k]!; if (v.getUint32(o - 26 + 18, true) !== 101) continue; const page = inflateRevitChunk(data, o, offs[k + 1]); if (page) chunks.push(page); }
const total = chunks.reduce((a, b) => a + b.length, 0); const s = new Uint8Array(total); { let off = 0; for (const c of chunks) { s.set(c, off); off += c.length; } }
const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
const audit = JSON.parse(readFileSync(auditPath, "utf8")) as { elementManifest: { elements: { elementId: number; category: { id: number; name: string; evidence: string } | null; displayed: boolean }[] } };
const drawnPath = process.argv[4]; const drawn = new Set<number>(drawnPath ? JSON.parse(readFileSync(drawnPath, "utf8")) as number[] : []);
const auditCats = new Map<number, { id: number; name: string; evidence: string }>(); for (const e of audit.elementManifest.elements) if (e.category?.id != null) auditCats.set(e.elementId, e.category);
const CAT_MIN = -2_100_000, CAT_MAX = -1_999_000;
let agree = 0, disagree = 0; const disSamples: string[] = []; let pos = 0; const forms = new Map<string, number>(); const missSamples: string[] = []; let missing = 0, found = 0; const bodySizeMissing = new Map<number, number>(); const catOffsetHist = new Map<number, number>();
while (pos + 16 <= s.length) {
  const id = sv.getUint32(pos, true), idHigh = sv.getUint32(pos + 4, true), body = sv.getUint32(pos + 8, true), high = sv.getUint16(pos + 14, true);
  if (id === 0xffff_ffff && idHigh === 0xffff_ffff) { pos += 16 + body; continue; }
  if (idHigh !== 0) break;
  const b = pos + 16;
  // where in the body does a category id sit, if anywhere?
  // The rule under test: with a zero high word the category is the i64 at body+2 terminated by ff x4;
  // otherwise it follows the first `04 00 [u32]` field tag in the body, terminated the same way.
  let catAt = -1;
  if (high === 0) { if (body >= 14 && sv.getUint32(b + 2 + 4, true) === 0xffff_ffff && sv.getUint32(b + 10, true) === 0xffff_ffff) { const c = sv.getUint32(b + 2, true) - 0x1_0000_0000; if (c > CAT_MIN && c < CAT_MAX) catAt = 2; } }
  else { for (let k = 0; k + 18 <= body; k++) { if (s[b + k] !== 0x04 || s[b + k + 1] !== 0x00) continue; const c = sv.getUint32(b + k + 6, true) - 0x1_0000_0000; if (sv.getUint32(b + k + 10, true) === 0xffff_ffff && sv.getUint32(b + k + 14, true) === 0xffff_ffff && c > CAT_MIN && c < CAT_MAX) { catAt = k + 6; break; } } }
  if (catAt >= 0) catOffsetHist.set(catAt, (catOffsetHist.get(catAt) ?? 0) + 1);
  const a = auditCats.get(id);
  if (a && catAt >= 0) { const c = sv.getUint32(b + catAt, true) - 0x1_0000_0000; if (c === a.id) agree++; else { disagree++; if (disSamples.length < 8) disSamples.push(`${id} audit ${a.id} ${a.name} (${a.evidence}) header ${c} high ${high}`); } }
  if (a) {
    if (catAt >= 0) found++; else { missing++; bodySizeMissing.set(body, (bodySizeMissing.get(body) ?? 0) + 1); const form = `high=${high} body=${body} drawn=${drawn.has(id)} first=${Buffer.from(s.subarray(b, b + 12)).toString("hex")}`; forms.set(form, (forms.get(form) ?? 0) + 1); if (missSamples.length < 6 && (!drawn.size || drawn.has(id))) missSamples.push(`id ${id} ${a.name}(${a.evidence}) body ${body} high ${high} catAt ${catAt}: ${Buffer.from(s.subarray(b, Math.min(b + 200, b + body))).toString("hex").replace(/(..)/g, "$1 ")}`); }
  }
  pos += 16 + body;
}
console.log({ found, missing, catOffsetHist: [...catOffsetHist].sort((a, b) => b[1] - a[1]).slice(0, 8), bodySizesOfMissing: [...bodySizeMissing].sort((a, b) => b[1] - a[1]).slice(0, 8) });
console.log({ agree, disagree }); for (const d of disSamples) console.log("  disagree:", d);
console.log("missing forms:", [...forms].sort((a, b) => b[1] - a[1]).slice(0, 6));
for (const m of missSamples) console.log(" ", m);
// Detail for one element: every category-window i64 in its header body, with context.
{
  const want = Number(process.env.WANT ?? "0"); let pos2 = 0;
  while (want && pos2 + 16 <= s.length) {
    const id = sv.getUint32(pos2, true), idHigh = sv.getUint32(pos2 + 4, true), body = sv.getUint32(pos2 + 8, true);
    if (id === 0xffff_ffff && idHigh === 0xffff_ffff) { pos2 += 16 + body; continue; }
    if (idHigh !== 0) break;
    if (id === want) { const b = pos2 + 16; console.log(`element ${id} body ${body} high ${sv.getUint16(pos2 + 14, true)}`);
      for (let k = 0; k + 8 <= body; k++) { const c = sv.getUint32(b + k, true) - 0x1_0000_0000; if (c > CAT_MIN && c < CAT_MAX) console.log(`  cat ${c} at body+${k}: before ${Buffer.from(s.subarray(b + k - 10, b + k)).toString("hex")} after ${Buffer.from(s.subarray(b + k + 8, b + k + 20)).toString("hex")}`); }
      console.log("  tail:", Buffer.from(s.subarray(b + body - 60, b + body)).toString("hex").replace(/(..)/g, "$1 ")); break; }
    pos2 += 16 + body;
  }
}
