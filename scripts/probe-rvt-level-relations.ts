#!/usr/bin/env node

/**
 * Read-only probe for the persisted Element.m_assocLevelId field.
 *
 * IFC containment supplies only a storey grouping oracle. It does not supply
 * candidate RVT level ids to the scanner.
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

declareUsage(
  "probe-rvt-level-relations.ts --rvt model.rvt --ifc model.ifc",
);

const paths = { rvt: requirePath("--rvt"), ifc: requirePath("--ifc") };

function readIfcContainment(text: string): {
  storeyByRevitTag: Map<number, number>;
  storeyNames: Map<number, string>;
} {
  const tagByExpressId = new Map<number, number>();
  const storeyNames = new Map<number, string>();
  const containment: Array<{ related: number[]; storey: number }> = [];
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const id = Number(match[1]);
    const type = match[2]!;
    const fields = splitStepArgs(match[3]!);
    const tag = /^'(\d+)'$/.exec(fields[7] ?? "");
    if (tag) tagByExpressId.set(id, Number(tag[1]));
    if (type === "IFCBUILDINGSTOREY") {
      const name = /^'((?:''|[^'])*)'$/.exec(fields[2] ?? "");
      if (name) storeyNames.set(id, name[1]!.replaceAll("''", "'"));
    } else if (type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      containment.push({
        related: stepReferences(fields[4]),
        storey: stepReferences(fields[5])[0] ?? 0,
      });
    }
  }
  const storeyByRevitTag = new Map<number, number>();
  for (const relation of containment) {
    for (const expressId of relation.related) {
      const tag = tagByExpressId.get(expressId);
      if (tag != null && relation.storey) storeyByRevitTag.set(tag, relation.storey);
    }
  }
  return { storeyByRevitTag, storeyNames };
}

type Candidate = {
  elementId: number;
  marker: number;
  fieldOffset: number;
  targetId: number;
  storey: number | undefined;
};

function add<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const oracle = readIfcContainment(readFileSync(paths.ifc, "latin1"));
const cfb = CFB.read(readFileSync(paths.rvt), { type: "buffer" });
const allElementIds = new Set<number>();
const markersByElementId = new Map<number, Set<number>>();
const candidates: Candidate[] = [];
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
    const data = read ??
      salvageRevitChunk(stored, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!data) continue;
    if (read) window = revitWindowTail(read);
    chunks += 1;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
      if (view.getUint32(offset + 4, true) !== 0) continue;
      const elementId = view.getUint32(offset, true);
      const objectLength = view.getUint32(offset + 12, true);
      if (!elementId || objectLength < 40 || objectLength > 0xffff) continue;
      const echo = offset + objectLength + 16;
      if (echo + 4 > data.byteLength || view.getUint32(echo, true) !== objectLength) continue;
      allElementIds.add(elementId);
      const marker = view.getUint16(offset + 16, true);
      const elementMarkers = markersByElementId.get(elementId) ?? new Set<number>();
      elementMarkers.add(marker);
      markersByElementId.set(elementId, elementMarkers);
      const storey = oracle.storeyByRevitTag.get(elementId);
      const limit = Math.min(offset + objectLength, offset + 260);
      for (let at = offset + 34; at + 8 <= limit; at += 1) {
        if (view.getUint32(at + 4, true) !== 0) continue;
        const targetId = view.getUint32(at, true);
        if (targetId && targetId !== elementId) {
          candidates.push({
            elementId,
            marker,
            fieldOffset: at - offset,
            targetId,
            storey,
          });
        }
      }
      offset += objectLength + 19;
    }
  }
}

type Metric = {
  sources: Set<number>;
  targetStoreys: Map<number, Set<number>>;
  storeyTargets: Map<number, Set<number>>;
  targetMarkers: Map<number, number>;
};
const byField = new Map<string, Metric>();
const byOffset = new Map<string, Metric>();

function record(map: Map<string, Metric>, key: string, candidate: Candidate): void {
  if (!allElementIds.has(candidate.targetId) || candidate.storey == null) return;
  const metric = map.get(key) ?? {
    sources: new Set<number>(),
    targetStoreys: new Map<number, Set<number>>(),
    storeyTargets: new Map<number, Set<number>>(),
    targetMarkers: new Map<number, number>(),
  };
  metric.sources.add(candidate.elementId);
  const storeys = metric.targetStoreys.get(candidate.targetId) ?? new Set<number>();
  storeys.add(candidate.storey);
  metric.targetStoreys.set(candidate.targetId, storeys);
  const targets = metric.storeyTargets.get(candidate.storey) ?? new Set<number>();
  targets.add(candidate.targetId);
  metric.storeyTargets.set(candidate.storey, targets);
  for (const marker of markersByElementId.get(candidate.targetId) ?? []) {
    add(metric.targetMarkers, marker);
  }
  map.set(key, metric);
}

for (const candidate of candidates) {
  const marker = `0x${candidate.marker.toString(16).padStart(4, "0")}`;
  record(byField, `${marker} start=${candidate.fieldOffset}`, candidate);
  record(byOffset, `start=${candidate.fieldOffset}`, candidate);
}

function summaries(map: Map<string, Metric>) {
  return [...map].map(([field, metric]) => ({
    field,
    sources: metric.sources.size,
    targets: metric.targetStoreys.size,
    storeys: metric.storeyTargets.size,
    pureTargets: [...metric.targetStoreys.values()].filter((values) => values.size === 1).length,
    oneTargetStoreys: [...metric.storeyTargets.values()].filter((values) => values.size === 1).length,
    maxTargetsPerStorey: Math.max(0, ...[...metric.storeyTargets.values()].map((values) => values.size)),
    targetMarkers: [...metric.targetMarkers].sort((a, b) => b[1] - a[1]).map(
      ([marker, count]) => [
        `0x${marker.toString(16).padStart(4, "0")}`,
        count,
      ],
    ),
  })).filter((metric) => metric.sources >= 10 && metric.storeys >= 2)
    .sort((a, b) =>
      (b.pureTargets / b.targets) - (a.pureTargets / a.targets) ||
      b.oneTargetStoreys - a.oneTargetStoreys ||
      b.sources - a.sources
    );
}

const levelOffsetDetails = candidates.filter(
  (candidate) =>
    candidate.storey != null &&
    [64, 66, 68, 70, 72].includes(candidate.fieldOffset) &&
    allElementIds.has(candidate.targetId),
).reduce((details, candidate) => {
  const storey = candidate.storey;
  if (storey == null) return details;
  const key = `${candidate.fieldOffset}:${candidate.targetId}:${candidate.storey}`;
  if (details.has(key)) return details;
  details.set(key, {
    fieldOffset: candidate.fieldOffset,
    targetId: candidate.targetId,
    targetMarkers: [...(markersByElementId.get(candidate.targetId) ?? [])].map(
      (marker) => `0x${marker.toString(16).padStart(4, "0")}`,
    ),
    storey,
    storeyName: oracle.storeyNames.get(storey),
  });
  return details;
}, new Map<string, {
  fieldOffset: number;
  targetId: number;
  targetMarkers: string[];
  storey: number;
  storeyName: string | undefined;
}>());

const levelMarker = 0x0a19;
const levelIds = new Set(
  [...markersByElementId.entries()].filter(([, markers]) => markers.has(levelMarker)).map(
    ([elementId]) => elementId,
  ),
);
const levelCandidates = candidates.filter(
  (candidate) =>
    [64, 66, 68, 70, 72].includes(candidate.fieldOffset) &&
    levelIds.has(candidate.targetId),
);
const relationsBySource = new Map<number, Set<number>>();
const relationOffsets = new Map<number, number>();
for (const candidate of levelCandidates) {
  const targets = relationsBySource.get(candidate.elementId) ?? new Set<number>();
  targets.add(candidate.targetId);
  relationsBySource.set(candidate.elementId, targets);
  add(relationOffsets, candidate.fieldOffset);
}
const uniqueRelations = new Map<number, number>();
for (const [sourceId, targets] of relationsBySource) {
  if (targets.size === 1) uniqueRelations.set(sourceId, [...targets][0]!);
}
const targetStorey = new Map<number, number>();
for (const candidate of levelCandidates) {
  if (candidate.storey != null) targetStorey.set(candidate.targetId, candidate.storey);
}
let ifcMatches = 0;
let ifcMismatches = 0;
let ifcMissing = 0;
for (const [sourceId, expectedStorey] of oracle.storeyByRevitTag) {
  const targetId = uniqueRelations.get(sourceId);
  if (targetId == null) ifcMissing += 1;
  else if (targetStorey.get(targetId) === expectedStorey) ifcMatches += 1;
  else ifcMismatches += 1;
}

console.log(JSON.stringify({
  chunks,
  ifcContainedRevitTags: oracle.storeyByRevitTag.size,
  ifcStoreys: oracle.storeyNames.size,
  framedElementIds: allElementIds.size,
  levelMarker: `0x${levelMarker.toString(16)}`,
  levelMarkerElements: levelIds.size,
  combinedLevelRelations: {
    sources: relationsBySource.size,
    unique: uniqueRelations.size,
    conflicting: [...relationsBySource.values()].filter((targets) => targets.size > 1).length,
    offsets: [...relationOffsets].sort((a, b) => a[0] - b[0]),
    ifcMatches,
    ifcMismatches,
    ifcMissing,
  },
  byOffset: summaries(byOffset).slice(0, 100),
  byMarkerAndOffset: summaries(byField).slice(0, 200),
  levelOffsetDetails: [...levelOffsetDetails.values()].sort((a, b) =>
    a.fieldOffset - b.fieldOffset || a.storey - b.storey || a.targetId - b.targetId
  ),
}, null, 2));
