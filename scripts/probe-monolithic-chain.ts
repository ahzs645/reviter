#!/usr/bin/env node

/**
 * Can a stair run be proven monolithic from decoded evidence alone?
 * Chain under test: run --ElemTable ownership--> stairs element
 * --0x116f type reference--> StairsType record --0x1104 name--> a name like
 * "Monolithic staircase". Prints every stair-flavoured type name, then walks
 * the chain for every Stairs Runs record.
 *
 *   node --experimental-strip-types scripts/probe-monolithic-chain.ts model.rvt
 */
import { readFileSync } from "node:fs";

import * as CFB from "cfb";

import { collectTypeLinks } from "../lib/reviter/element-types.ts";
import {
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { convertModel } from "./audit-coverage.ts";

const STAIRS_RUN_CATEGORY = -2_000_919;

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-monolithic-chain.ts model.rvt");

const asBytes = (content: unknown): Uint8Array =>
  content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer);

const references = new Map<number, number>();
const names = new Map<number, string>();
const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(stored);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const data = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    const links = collectTypeLinks(data);
    for (const reference of links.references) {
      references.set(reference.elementId, reference.typeId);
    }
    for (const record of links.names) names.set(record.typeId, record.name);
  }
}
console.log(`type references: ${references.size}, names: ${names.size}`);
for (const [typeId, name] of names) {
  if (/stair|monolithic|terrace|landing|run/i.test(name)) {
    console.log(`  type ${typeId}: "${name}"`);
  }
}

const result = convertModel(rvtPath);
const ownerById = new Map(
  (result.elementOwnership?.relations ?? []).map((relation) => [
    relation.elementId,
    relation.ownerId,
  ]),
);
const recordById = new Map(result.elementBounds.map((record) => [record.elementId, record]));
const chains = new Map<string, number[]>();
for (const record of result.elementBounds) {
  if (record.categoryId !== STAIRS_RUN_CATEGORY) continue;
  let cursor: number | undefined = record.elementId;
  const hops: string[] = [];
  let resolved = "no-owner";
  for (let hop = 0; hop < 4 && cursor != null; hop += 1) {
    const owner: number | undefined = ownerById.get(cursor);
    if (owner == null) break;
    const ownerRecord = recordById.get(owner);
    hops.push(`${owner}(${ownerRecord?.categoryName ?? "?"})`);
    const typeId = references.get(owner);
    if (typeId != null) {
      resolved = `type ${typeId} "${names.get(typeId) ?? "?"}"`;
      break;
    }
    cursor = owner;
  }
  const key = `${hops.join(" -> ")} => ${resolved}`;
  const group = chains.get(key) ?? [];
  group.push(record.elementId);
  chains.set(key, group);
}
for (const [key, runs] of [...chains].sort((a, b) => b[1].length - a[1].length)) {
  const sample = runs.slice(0, 4).join(",");
  console.log(`${runs.length} runs [${sample}${runs.length > 4 ? ",..." : ""}]: ${key}`);
}
