/** Independently verify selected same-page GElements before comparing their IFCs. */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { openRevitContainer } from "../lib/reviter/convert-container.ts";
import { frameHeaderBytes, narrowElementIds } from "../lib/reviter/element-id-width.ts";
import { fileClassTag } from "../lib/reviter/revit-class-tags.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";
import { createRevit2027NativeMeshCollector } from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import { collectRevit2027GInstanceBindings } from "../lib/reviter/revit-2027-nested-instance.ts";
import { iterateInflatedChunks, openRvt } from "./lib/rvt-harness.ts";

const [path, ownersFlag, ownerValues, jsonFlag, outputPath] = process.argv.slice(2);
if (!path || ownersFlag !== "--owners" || !ownerValues || jsonFlag !== "--json" || !outputPath) {
  throw new Error("usage: audit-rvt-owner-frames.ts model.rvt --owners decimalId,... --json report.json");
}
const ids = ownerValues.split(",").map(Number);
if (ids.length > 32 || ids.some(id => !Number.isSafeInteger(id) || id < 1 || id > 0x7fff_ffff)) throw new Error("owners requires up to 32 positive int32 IDs");
const bytes = readFileSync(path), opened = openRevitContainer(bytes, {}), header = frameHeaderBytes();
if (fileClassTag(2246) < 0) throw new Error("Source schema does not declare GElement");
const needles = ids.map(id => { const value = Buffer.alloc(narrowElementIds() ? 4 : 8); value.writeUInt32LE(id); return value; });
const collector = createRevit2027NativeMeshCollector(opened.decoderPlan.revitVersion);
const records: unknown[] = [];
const work = { checksumBytes: 0, checksumLimitBytes: 64 * 1024 * 1024, skippedChecksumBudget: 0 };
for (const chunk of iterateInflatedChunks(openRvt(path))) {
  if (chunk.salvaged) continue;
  const data = chunk.data, buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const [index, needle] of needles.entries()) for (let offset = buffer.indexOf(needle); offset >= 0; offset = buffer.indexOf(needle, offset + 1)) {
    if (offset + header + 18 > data.length || view.getUint16(offset + header, true) !== fileClassTag(2246)) continue;
    const length = view.getUint32(offset + header - 4, true), owner = ids[index]!;
    if (length < 40 || length + header + 4 > 8 * 1024 * 1024 || offset + length + header + 4 > data.length) continue;
    if (view.getUint32(offset + (narrowElementIds() ? 14 : 26), true) !== owner) continue;
    if (work.checksumBytes + length > work.checksumLimitBytes) { work.skippedChecksumBudget++; continue; }
    work.checksumBytes += length;
    const echoMatches = view.getUint32(offset + length + header, true) === length;
    // Independent slow modulo reduction, intentionally separate from the
    // production collector's blockwise Adler implementation.
    let a = 1, b = 0;
    for (let cursor = offset + header; cursor < offset + header + length; cursor++) { a = (a + data[cursor]!) % 65521; b = (b + a) % 65521; }
    const checksumMatches = ((b * 65536 + a) >>> 0) === view.getUint32(offset + header - 8, true);
    const frame = { offset, elementId: owner, marker: 2246, objectLength: length, typeCode: view.getUint32(offset + header + 2, true) };
    const root = echoMatches && checksumMatches ? decodeRevit2027FramedGRepRoot(data, frame, opened.decoderPlan.revitVersion ?? 0) : null;
    const replay = root?.ok ? replayRevit2027GRepFifo(data, root.value, undefined, { maxReplayEntries: 16384, maxDescriptors: 65536 }) : null;
    const bindings = replay?.ok ? collectRevit2027GInstanceBindings(replay.value) : null;
    if (replay?.ok) collector.scanSplitGElementFrame(data.subarray(offset, offset + length + header + 4));
    records.push({ elementId: owner, stream: chunk.path.replace(/^Root Entry\//, ""), chunkIndex: chunk.chunkIndex, pageOffset: offset,
      objectLength: length, aboveGeneralScannerCeiling: length > 0xffff, echoMatches, checksumMatches,
      root: root?.ok ? { ownerElementId: root.value.ownerElementId.toString(), children: root.value.children.map(child => child.sourceClassSlot), worldExtents: root.value.worldExtents } : root,
      instanceBindings: bindings?.ok ? bindings.value.map(binding => ({ kind: binding.kind, path: binding.instance.path,
        symbolElementId: binding.instance.symbolElementId.toString(), gRepId: binding.instance.gRepId, cda: binding.instance.cda,
        hasScale: binding.instance.hasScale, resolveSymbolInView: binding.instance.resolveSymbolInView, forbiddenTarget: binding.instance.forbiddenTarget,
        transform: binding.instance.transform.matrix })) : bindings,
      fifo: replay?.ok ? { complete: true, spans: replay.value.spans.length, descriptors: replay.value.descriptors.length,
        faces: replay.value.spans.filter(span => span.readerId === "Revit2027Face").length,
        instances: replay.value.spans.filter(span => span.readerId === "Revit2027GInstance").length,
        readerCounts: replay.value.spans.reduce<Record<string, number>>((counts, span) => { counts[span.readerId] = (counts[span.readerId] ?? 0) + 1; return counts; }, {}) } : replay });
  }
}
const snapshot = collector.snapshot(ids);
const definitions = [...snapshot.owners].map(([elementId, owner]) => {
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const face of owner.faces) {
    const matrix = face.nestedTransform;
    for (const vertex of face.mesh.indices) {
      const position = face.mesh.positions.subarray(vertex * 3, vertex * 3 + 3);
      for (let axis = 0; axis < 3; axis++) {
        const value = matrix ? matrix[axis]! * position[0]! + matrix[4 + axis]! * position[1]! + matrix[8 + axis]! * position[2]! + matrix[12 + axis]! : position[axis]!;
        minimum[axis] = Math.min(minimum[axis]!, value);
        maximum[axis] = Math.max(maximum[axis]!, value);
      }
    }
  }
  return { elementId, faces: owner.faces.length, triangles: owner.triangles, drawnVertexBounds: { minimum, maximum } };
});
const report = { schemaVersion: 1, generatedBy: "scripts/audit-rvt-owner-frames.ts", source: { fileName: basename(path), sha256: createHash("sha256").update(bytes).digest("hex"), release: opened.decoderPlan.revitVersion },
  scope: "Selected complete same-page GElements only. Independent restated owner, length echo and Adler checks precede FIFO replay. No reference model is read. Stored mesh definitions still require final scene envelope/output-budget admission.",
  work, records, definitions,
  failures: snapshot.incompleteSamples };
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ records: records.length, definitions: report.definitions, failures: report.failures }, null, 2));
