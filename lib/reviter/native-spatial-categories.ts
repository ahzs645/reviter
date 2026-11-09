/** File-local category proof for selected spatial owners. Uses no global
 * class-tag/id-width state, and never changes geometry admission. */
import CFB from "cfb";
import { sha256 } from "@noble/hashes/sha2.js";
import { asBytes, stripRevitPageChecksums, gzipOffsets, inflateRevitChunk, revitWindowTail } from "./revit-container.ts";
import { readSchema } from "./schema-reader.ts";
import { parseFullElemTableInventory } from "./elem-table.ts";
import type { NativeEvidenceReport } from "./native-evidence-reader.ts";
import type { SpatialCategoryEvidence } from "./native-spatial-organization.ts";
const digest = (b: Uint8Array) => Array.from(sha256(b), n => n.toString(16).padStart(2, "0")).join("");
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Only exact wide ElementHeader frames are admitted; conflicting categories
 * remain unresolved. Header offsets address inflated bytes, never original RVT. */
export function readNativeSpatialCategoryEvidence(bytes: Uint8Array, report: NativeEvidenceReport, options: { maxInflatedBytes?: number; maxFileBytes?: number } = {}): SpatialCategoryEvidence {
  const summary = object(report.source.summary);
  const result: SpatialCategoryEvidence = { sourceSha256: digest(bytes), schemaSha256: String(summary.schema_sha256 ?? ""), status: "unsupported", records: [], inflatedBytes: 0, diagnostics: [] };
  const budget = Math.min(options.maxInflatedBytes ?? 512 * 1024 * 1024, 512 * 1024 * 1024);
  if (!Number.isSafeInteger(budget) || budget <= 0 || bytes.length > (options.maxFileBytes ?? 128 * 1024 * 1024) || result.sourceSha256 !== report.sourceSha256 || ![2024, 2025, 2026, 2027].includes(Number(summary.revit_version))) return result;
  const ids = new Set(report.source.records.filter(v => object(v).class_name === "RoomElem").map(v => String(object(object(v).identity).element_id)));
  if (!ids.size) { result.status = "complete"; return result; }
  if (ids.size > 4096) return result;
  try {
    const cfb = CFB.read(bytes, { type: "buffer" });
    const streams = cfb.FileIndex.map((entry, i) => ({ path: cfb.FullPaths[i].replace(/^Root Entry\//, ""), entry })).filter(v => v.entry.type === 2);
    const inflate = (path: string): Uint8Array | null => {
      const entry = streams.find(v => v.path === path); if (!entry) return null;
      const input = stripRevitPageChecksums(asBytes(entry.entry.content)), offsets = gzipOffsets(input), chunks: Uint8Array[] = [];
      let window: Uint8Array | undefined;
      for (const [i, offset] of offsets.entries()) {
        const page = inflateRevitChunk(input, offset, offsets[i + 1], window, { maxChunkBytes: Math.min(16 * 1024 * 1024, budget - result.inflatedBytes), maxStreamBytes: budget - result.inflatedBytes });
        if (!page || page.length > budget - result.inflatedBytes) return null;
        result.inflatedBytes += page.length; chunks.push(page); window = revitWindowTail(page);
      }
      const joined = new Uint8Array(chunks.reduce((s, b) => s + b.length, 0)); let at = 0;
      for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; } return joined;
    };
    const schemaBytes = inflate("Formats/Latest"), tableBytes = inflate("Global/ElemTable");
    if (!schemaBytes || !tableBytes || digest(schemaBytes) !== result.schemaSha256) return result;
    const schema = readSchema(schemaBytes); if (!schema.ok) return result;
    const header = schema.schema.classes.find(c => c.name === "ElementHeader");
    const names = header?.properties.map(p => p.name);
    if (!header || names?.[0] !== "m_regenHistory" || names[1] !== "m_categroryId" || names[2] !== "m_familyId" || names[3] !== "m_ownerViewId") return result;
    const table = parseFullElemTableInventory(tableBytes, { revitVersion: Number(summary.revit_version), expectedSchemaTag: schema.schema.classes.find(c => c.name === "ElemTable")?.index });
    if (table.status !== "decoded" || table.layout.idBytes !== 8) return result;
    const declared = new Set(Array.from(table.declaredElementIds, String));
    for (const id of ids) if (!declared.has(id)) ids.delete(id);
    let partial = false;
    for (const entry of streams.filter(v => /^Partitions\/\d+$/.test(v.path))) {
      const input = stripRevitPageChecksums(asBytes(entry.entry.content)), offsets = gzipOffsets(input);
      let window: Uint8Array | undefined, pageOffset = 0;
      for (const [i, offset] of offsets.entries()) {
        if (result.inflatedBytes >= budget) { partial = true; break; }
        const page = inflateRevitChunk(input, offset, offsets[i + 1], window, { maxChunkBytes: Math.min(16 * 1024 * 1024, budget - result.inflatedBytes), maxStreamBytes: budget - result.inflatedBytes });
        if (!page || page.length > budget - result.inflatedBytes) { partial = true; break; }
        result.inflatedBytes += page.length; window = revitWindowTail(page);
        result.records.push(...scanNativeSpatialCategoryHeaders(page, header.index, ids, entry.path, pageOffset));
        pageOffset += page.length;
      }
    }
    result.status = partial ? "partial" : "complete";
    if (partial) result.diagnostics.push("Selected category scan reached an inflation budget or an undecodable page; absent owners remain unresolved.");
  } catch { result.diagnostics.push("Source container/category framing is unsupported."); }
  return result;
}

/** Exact file-local header-frame projection; exported for malformed-input checks. */
export function scanNativeSpatialCategoryHeaders(page: Uint8Array, classTag: number, ids: ReadonlySet<string>, stream: string, pageOffset = 0): SpatialCategoryEvidence["records"] {
  const records: SpatialCategoryEvidence["records"] = [];
  if (!Number.isSafeInteger(classTag) || classTag <= 0 || classTag > 32767 || !Number.isSafeInteger(pageOffset) || pageOffset < 0 || !/^Partitions\/\d+$/.test(stream) || ids.size > 4096) return records;
  const low = classTag & 255, high = classTag >> 8;
  const v = new DataView(page.buffer, page.byteOffset, page.byteLength);
  for (let at = page.indexOf(low, 12); at >= 12 && at + 6 < page.length; at = page.indexOf(low, at + 1)) {
    if (page[at + 1] !== high || v.getUint32(at - 8, true) !== 0) continue;
    const elementId = String(v.getUint32(at - 12, true)); if (!ids.has(elementId)) continue;
    const length = v.getUint32(at - 4, true), end = at + length;
    if (length < 54 || end + 4 > page.length || v.getUint32(end, true) !== length) continue;
    const n = v.getUint32(at + 2, true), catAt = at + 6 + n * 22;
    if (n > 4096 || catAt + 48 > end) continue;
    const cat = v.getBigInt64(catAt, true), fam = v.getBigInt64(catAt + 8, true), view = v.getBigInt64(catAt + 16, true);
    if (cat < -3000000n || cat > -1000000n || fam < -1n || view < -1n || fam > BigInt(Number.MAX_SAFE_INTEGER) || view > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    records.push({ elementId, categoryId: Number(cat), familyId: fam === -1n ? null : String(fam), ownerViewId: view === -1n ? null : String(view), stream, inflatedOffset: pageOffset + at - 12 });
  }
  return records;
}
