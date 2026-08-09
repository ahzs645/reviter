#!/usr/bin/env node
// Who references type element 192162 ("Monolithic staircase" record)?
import { readFileSync } from "node:fs";
import * as CFB from "cfb";
import { collectTypeLinks } from "../lib/reviter/element-types.ts";
import {
  gzipOffsets, inflateRevitChunk, revitWindowTail, salvageRevitChunk, stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { convertModel } from "./audit-coverage.ts";

const rvtPath = process.argv[2];
const targetType = Number(process.argv[3] ?? 192162);
const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
const referrers = [];
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
    for (const ref of collectTypeLinks(data).references) {
      if (ref.typeId === targetType) referrers.push(ref.elementId);
    }
  }
}
console.log(`referrers of ${targetType}:`, referrers.length, referrers.slice(0, 8));
const result = convertModel(rvtPath);
const byId = new Map(result.elementBounds.map((r) => [r.elementId, r]));
const counts = new Map();
for (const id of referrers) {
  const category = byId.get(id)?.categoryName ?? "no-record";
  counts.set(category, (counts.get(category) ?? 0) + 1);
}
console.log([...counts]);
