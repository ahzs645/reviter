/** Index complete sequence-102/103 records and inspect missing or suspect IDs. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRvt, requireModelPath, optionValue } from "./lib/rvt-harness.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { applyReleaseMarkers } from "../lib/reviter/release-markers.ts";
import { PartitionRecordReader } from "../lib/reviter/partition-records.ts";
import { stripRevitPageChecksums, gzipOffsets, inflateRevitChunk, revitWindowTail, readPartitionBlockHeader } from "../lib/reviter/revit-container.ts";
import { decodeRevit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "../lib/reviter/revit-2027-grep-replay.ts";

const model = openRvt(requireModelPath("probe-owned-records.ts model.rvt [--ids 1,2] [--comparison report.json] [--out-dir directory] [--json report.json]", "--ids", "--comparison", "--out-dir", "--json"));
const schema = readSchema(model.requireSchema());
if (!schema.ok) throw new Error(schema.error);
const release = model.release();
applyReleaseMarkers(schema.schema, release);
const names = new Map(schema.schema.classes.map(c => [c.index, c.name]));
const ids = new Set((optionValue("--ids") ?? "").split(",").filter(Boolean).map(Number));
if ([...ids].some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("--ids requires positive integer IDs");
const comparison = optionValue("--comparison");
if (comparison) {
  const report = JSON.parse(readFileSync(comparison, "utf8")) as { missing: { elementId: number }[] };
  for (const item of report.missing) ids.add(item.elementId);
}
const directory = optionValue("--out-dir");
if (directory) mkdirSync(directory, { recursive: true });
const records: Record<string, unknown>[] = [];
const summaries: Record<string, unknown>[] = [];
for (const partition of model.streamsMatching(/\/Partitions\/[^/]+$/u)) {
  const data = stripRevitPageChecksums(partition.bytes);
  const offsets = gzipOffsets(data);
  const readers = new Map([[102, new PartitionRecordReader(102)], [103, new PartitionRecordReader(103)]]);
  let window: Uint8Array | undefined;
  for (let chunk = 0; chunk < offsets.length; chunk += 1) {
    const page = inflateRevitChunk(data, offsets[chunk]!, offsets[chunk + 1], window);
    const header = readPartitionBlockHeader(data, offsets[chunk]!);
    if (!page || !header) { for (const r of readers.values()) r.reset(); continue; }
    window = revitWindowTail(page);
    for (const record of readers.get(header.sequence)?.push(header, page, chunk) ?? []) {
      if (!ids.has(record.elementId)) continue;
      const entry: Record<string, unknown> = {
        elementId: record.elementId, sequence: header.sequence, class: record.classIndex == null ? null : names.get(record.classIndex),
        bytes: record.data.length, stream: partition.path, firstChunk: record.firstChunk, lastChunk: record.lastChunk,
      };
      if (header.sequence === 103 && record.classIndex != null && record.objectLength >= 18 && release != null) {
        const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
        const root = decodeRevit2027FramedGRepRoot(record.data, { offset: 0, elementId: record.elementId, objectLength: record.objectLength, marker: record.classIndex, typeCode: view.getUint32(18, true) }, release);
        if (root.ok) {
          entry.children = root.value.children.map(c => names.get(c.sourceClassSlot ?? -1));
          const replay = replayRevit2027GRepFifo(record.data, root.value);
          entry.replay = replay.ok ? "complete" : replay.error;
        }
      }
      if (directory) writeFileSync(join(directory, `${record.elementId}-${header.sequence}.bin`), record.data);
      records.push(entry);
    }
  }
  for (const r of readers.values()) { r.reset(); summaries.push({ stream: partition.path, sequence: r.sequence, ...r.stats }); }
}
const output = JSON.stringify({ summaries, records, notFound: [...ids].filter(id => !records.some(r => r.elementId === id)) }, null, 2);
const json = optionValue("--json");
if (json) writeFileSync(json, output + "\n");
else console.log(output);
