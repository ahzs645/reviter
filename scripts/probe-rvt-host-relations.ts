#!/usr/bin/env node

/**
 * Read-only clean-room probe for persisted FamilyInstance host ids.
 *
 * The paired IFC is only an acceptance oracle: door/window -> opening -> wall
 * relations identify the expected Revit host tag. No IFC value is used by the
 * runtime decoder.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-rvt-host-relations.ts \
 *     --rvt model.rvt --ifc reference.ifc
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import {
  declareUsage,
  requirePath,
  splitStepArgs,
  stepReferences,
} from "./lib/rvt-harness.ts";

import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { decodeElementOwnership } from "../lib/reviter/element-relations.ts";

declareUsage(
  "probe-rvt-host-relations.ts --rvt model.rvt --ifc model.ifc",
);

const paths = { rvt: requirePath("--rvt"), ifc: requirePath("--ifc") };

function numericTag(fields: readonly string[]): number | null {
  // IfcElement.Tag is the eighth inherited argument. Door/window subtypes add
  // dimensions and predefined types after it, so it is not generally last.
  const match = /^'(\d+)'$/.exec(fields[7] ?? "");
  return match ? Number(match[1]) : null;
}

function readIfcHostOracle(text: string): {
  expectedHostByElement: Map<number, number>;
  sourceClasses: Map<number, string>;
  modelTreeTags: Set<number>;
} {
  const tags = new Map<number, number>();
  const classes = new Map<number, string>();
  const voidHostByOpening = new Map<number, number>();
  const fills: Array<{ opening: number; element: number }> = [];
  const treeMembers: number[] = [];
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const id = Number(match[1]);
    const type = match[2]!;
    const fields = splitStepArgs(match[3]!);
    const tag = numericTag(fields);
    if (tag != null) {
      tags.set(id, tag);
      classes.set(tag, type);
    }
    if (type === "IFCRELVOIDSELEMENT") {
      const host = stepReferences(fields[4])[0];
      const opening = stepReferences(fields[5])[0];
      if (host && opening) voidHostByOpening.set(opening, host);
    } else if (type === "IFCRELFILLSELEMENT") {
      const opening = stepReferences(fields[4])[0];
      const element = stepReferences(fields[5])[0];
      if (opening && element) fills.push({ opening, element });
    } else if (type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      treeMembers.push(...stepReferences(fields[4]));
    } else if (type === "IFCRELAGGREGATES") {
      treeMembers.push(...stepReferences(fields[5]));
    }
  }
  const expectedHostByElement = new Map<number, number>();
  const sourceClasses = new Map<number, string>();
  for (const fill of fills) {
    const sourceTag = tags.get(fill.element);
    const hostTag = tags.get(voidHostByOpening.get(fill.opening) ?? 0);
    if (sourceTag == null || hostTag == null) continue;
    expectedHostByElement.set(sourceTag, hostTag);
    const type = classes.get(sourceTag);
    if (type) sourceClasses.set(sourceTag, type);
  }
  return {
    expectedHostByElement,
    sourceClasses,
    modelTreeTags: new Set(
      treeMembers.map((expressId) => tags.get(expressId)).filter((tag) => tag != null),
    ),
  };
}

type FramedObject = {
  elementId: number;
  marker: number;
  offset: number;
  objectLength: number;
};

function framedObjects(data: Uint8Array): FramedObject[] {
  const result: FramedObject[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    const objectLength = view.getUint32(offset + 12, true);
    if (!elementId || objectLength < 40 || objectLength > 0xffff) continue;
    const echo = offset + objectLength + 16;
    if (echo + 4 > data.byteLength || view.getUint32(echo, true) !== objectLength) continue;
    result.push({
      elementId,
      marker: view.getUint16(offset + 16, true),
      offset,
      objectLength,
    });
    offset += objectLength + 19;
  }
  return result;
}

function add(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const oracle = readIfcHostOracle(readFileSync(paths.ifc, "latin1"));
const cfb = CFB.read(readFileSync(paths.rvt), { type: "buffer" });
const elemTableEntry = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/Global\/ElemTable$/i.test(path));
const ownershipMemberIds = new Set<number>();
if (elemTableEntry) {
  const stored = stripRevitPageChecksums(asBytes(elemTableEntry.entry.content));
  const offset = gzipOffsets(stored, 1)[0];
  const inflated = offset == null ? null : inflateRevitChunk(stored, offset);
  if (inflated) {
    const decoded = decodeElementOwnership(inflated);
    if (decoded.format !== "unsupported") {
      for (const relation of decoded.relations) ownershipMemberIds.add(relation.elementId);
    }
  }
}
const exactMatches = new Map<string, number>();
const matchedElements = new Set<number>();
const matchedByClass = new Map<string, number>();
const objectMarkersByElement = new Map<number, Set<number>>();
const allElementIds = new Set<number>();
const rawHostCandidates: Array<{
  elementId: number;
  targetId: number;
  fieldOffset: number;
}> = [];
const fieldSamples: Array<{
  elementId: number;
  hostId: number;
  fieldOffset: number;
  objectLength: number;
  bytes136To176: string;
}> = [];
let framedObjectsForOracle = 0;
let chunks = 0;

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
    const inflated = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    chunks += 1;
    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (const object of framedObjects(inflated)) {
      allElementIds.add(object.elementId);
      if (object.marker === 0x07ef) {
        for (let fieldOffset = 147; fieldOffset <= 157; fieldOffset += 1) {
          const at = object.offset + fieldOffset;
          if (
            at + 8 <= object.offset + object.objectLength &&
            view.getUint32(at + 4, true) === 0
          ) {
            const targetId = view.getUint32(at, true);
            if (targetId && targetId !== object.elementId) {
              rawHostCandidates.push({ elementId: object.elementId, targetId, fieldOffset });
            }
          }
        }
      }
      const expectedHostId = oracle.expectedHostByElement.get(object.elementId);
      if (expectedHostId == null) continue;
      framedObjectsForOracle += 1;
      const markers = objectMarkersByElement.get(object.elementId) ?? new Set<number>();
      markers.add(object.marker);
      objectMarkersByElement.set(object.elementId, markers);
      const end = Math.min(inflated.byteLength, object.offset + object.objectLength + 20);
      for (let at = object.offset + 18; at + 8 <= end; at += 1) {
        if (
          view.getUint32(at, true) !== expectedHostId ||
          view.getUint32(at + 4, true) !== 0
        ) {
          continue;
        }
        const marker = `0x${object.marker.toString(16).padStart(4, "0")}`;
        add(exactMatches, `${marker} start=${at - object.offset}`);
        add(exactMatches, `${marker} end=${at - (object.offset + object.objectLength)}`);
        matchedElements.add(object.elementId);
        const type = oracle.sourceClasses.get(object.elementId) ?? "UNKNOWN";
        matchedByClass.set(type, (matchedByClass.get(type) ?? 0) + 1);
        const fieldOffset = at - object.offset;
        const samplesAtOffset = fieldSamples.filter(
          (sample) => sample.fieldOffset === fieldOffset,
        ).length;
        if (
          object.marker === 0x07ef &&
          (fieldOffset === 151 || fieldOffset === 153) &&
          samplesAtOffset < 5
        ) {
          fieldSamples.push({
            elementId: object.elementId,
            hostId: expectedHostId,
            fieldOffset,
            objectLength: object.objectLength,
            bytes136To176: Buffer.from(
              inflated.subarray(object.offset + 136, object.offset + 176),
            ).toString("hex"),
          });
        }
      }
    }
  }
}

const candidateMetrics = new Map<number, {
  raw: number;
  resolved: number;
  sources: Set<number>;
  oracleSources: Set<number>;
  oracleMatches: Set<number>;
  oracleMismatches: Set<number>;
}>();
for (const candidate of rawHostCandidates) {
  const metrics = candidateMetrics.get(candidate.fieldOffset) ?? {
    raw: 0,
    resolved: 0,
    sources: new Set<number>(),
    oracleSources: new Set<number>(),
    oracleMatches: new Set<number>(),
    oracleMismatches: new Set<number>(),
  };
  metrics.raw += 1;
  if (allElementIds.has(candidate.targetId)) {
    metrics.resolved += 1;
    metrics.sources.add(candidate.elementId);
    const expected = oracle.expectedHostByElement.get(candidate.elementId);
    if (expected != null) {
      metrics.oracleSources.add(candidate.elementId);
      if (candidate.targetId === expected) metrics.oracleMatches.add(candidate.elementId);
      else metrics.oracleMismatches.add(candidate.elementId);
    }
  }
  candidateMetrics.set(candidate.fieldOffset, metrics);
}
const resolvedBySource = new Map<number, Map<number, number>>();
for (const candidate of rawHostCandidates) {
  if (!allElementIds.has(candidate.targetId)) continue;
  const fields = resolvedBySource.get(candidate.elementId) ?? new Map<number, number>();
  if (!fields.has(candidate.fieldOffset)) fields.set(candidate.fieldOffset, candidate.targetId);
  resolvedBySource.set(candidate.elementId, fields);
}
const decodedHostByElement = new Map<number, { hostId: number; fieldOffset: 151 | 153 }>();
for (const [elementId, fields] of resolvedBySource) {
  const at151 = fields.get(151);
  const at153 = fields.get(153);
  if (at151 != null) decodedHostByElement.set(elementId, { hostId: at151, fieldOffset: 151 });
  else if (at153 != null) decodedHostByElement.set(elementId, { hostId: at153, fieldOffset: 153 });
}
let decodedOracleMatches = 0;
let decodedOracleMismatches = 0;
let decodedOracleMissing = 0;
for (const [elementId, expectedHostId] of oracle.expectedHostByElement) {
  const decoded = decodedHostByElement.get(elementId);
  if (!decoded) decodedOracleMissing += 1;
  else if (decoded.hostId === expectedHostId) decodedOracleMatches += 1;
  else decodedOracleMismatches += 1;
}
const currentComparableTreeMembers = new Set(
  [...oracle.modelTreeTags].filter((elementId) => ownershipMemberIds.has(elementId)),
);
const hostComparableTreeMembers = new Set(
  [...oracle.modelTreeTags].filter((elementId) => decodedHostByElement.has(elementId)),
);
const addedComparableTreeMembers = new Set(
  [...hostComparableTreeMembers].filter((elementId) => !ownershipMemberIds.has(elementId)),
);
const combinedComparableTreeMembers = new Set([
  ...currentComparableTreeMembers,
  ...hostComparableTreeMembers,
]);

console.log(JSON.stringify({
  chunks,
  ifcHostOracleRelations: oracle.expectedHostByElement.size,
  ifcSourceClasses: Object.fromEntries(
    [...oracle.sourceClasses.values()]
      .reduce((counts, type) => counts.set(type, (counts.get(type) ?? 0) + 1), new Map<string, number>()),
  ),
  framedObjectsForOracle,
  oracleElementsWithFramedObject: objectMarkersByElement.size,
  matchedElements: matchedElements.size,
  matchedElementRatio: objectMarkersByElement.size
    ? matchedElements.size / objectMarkersByElement.size
    : null,
  matchedByClass: Object.fromEntries([...matchedByClass].sort((a, b) => b[1] - a[1])),
  exactMatchFields: [...exactMatches].sort((a, b) => b[1] - a[1]).slice(0, 100),
  candidateMetrics: [...candidateMetrics]
    .sort((a, b) => a[0] - b[0])
    .map(([fieldOffset, metrics]) => ({
      fieldOffset,
      raw: metrics.raw,
      resolved: metrics.resolved,
      sources: metrics.sources.size,
      oracleSources: metrics.oracleSources.size,
      oracleMatches: metrics.oracleMatches.size,
      oracleMismatches: metrics.oracleMismatches.size,
    })),
  decodedFallbackRule: {
    relations: decodedHostByElement.size,
    at151: [...decodedHostByElement.values()].filter((entry) => entry.fieldOffset === 151).length,
    at153: [...decodedHostByElement.values()].filter((entry) => entry.fieldOffset === 153).length,
    ifcOracleMatches: decodedOracleMatches,
    ifcOracleMismatches: decodedOracleMismatches,
    ifcOracleMissing: decodedOracleMissing,
  },
  modelTreeParity: {
    ifcComparableMembers: oracle.modelTreeTags.size,
    currentOwnershipMembers: currentComparableTreeMembers.size,
    persistedHostMembers: hostComparableTreeMembers.size,
    addedByHost: addedComparableTreeMembers.size,
    combinedMembers: combinedComparableTreeMembers.size,
    currentRatio: oracle.modelTreeTags.size
      ? currentComparableTreeMembers.size / oracle.modelTreeTags.size
      : null,
    combinedRatio: oracle.modelTreeTags.size
      ? combinedComparableTreeMembers.size / oracle.modelTreeTags.size
      : null,
  },
  fieldSamples,
}, null, 2));
