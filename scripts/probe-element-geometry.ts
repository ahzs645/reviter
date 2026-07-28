#!/usr/bin/env node

/**
 * Inspect the persisted geometry evidence for selected Revit element ids.
 *
 * This is intentionally a read-only, fail-closed probe. It reports framed
 * objects, duplicated bounds, analytic surfaces, sketch curves and persisted
 * relationship candidates without turning any byte adjacency into ownership.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-element-geometry.ts \
 *     model.rvt 1272040 1280585
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import CFB from "cfb";

import { detectDuplicatedBoundsRecords } from "../lib/reviter/bounds-records.ts";
import type { ElementObject } from "../lib/reviter/element-objects.ts";
import {
  scanPersistedRelationshipCandidates,
} from "../lib/reviter/family-material-relations.ts";
import {
  readInstancePlacement,
  readLocalBounds,
  readLocalShape,
} from "../lib/reviter/instanced-geometry.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { collectSketchCurves } from "../lib/reviter/sketch-curves.ts";
import { collectOwnedSurfaces } from "../lib/reviter/surfaces.ts";

const [inputArgument, ...idArguments] = process.argv.slice(2);
if (!inputArgument || idArguments.length === 0) {
  throw new Error("Usage: probe-element-geometry.ts model.rvt elementId [elementId ...]");
}

const inputPath = resolve(inputArgument);
const targets = new Set(
  idArguments.map((argument) => {
    const id = Number(argument);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffff_ffff) {
      throw new Error(`Invalid element id: ${argument}`);
    }
    return id;
  }),
);

type LocatedObject = ElementObject & {
  stream: string;
  chunkIndex: number;
  storedOffset: number;
  localBounds: ReturnType<typeof readLocalBounds>;
  localShape: ReturnType<typeof readLocalShape>;
  placement: ReturnType<typeof readInstancePlacement>;
};

const report = {
  input: inputPath,
  targetElementIds: [...targets].sort((a, b) => a - b),
  objects: [] as LocatedObject[],
  duplicatedBounds: [] as Array<ReturnType<typeof detectDuplicatedBoundsRecords>[number] & {
    stream: string;
    chunkIndex: number;
    storedOffset: number;
  }>,
  surfaces: [] as Array<ReturnType<typeof collectOwnedSurfaces>[number] & {
    stream: string;
    chunkIndex: number;
  }>,
  sketchCurves: [] as Array<ReturnType<typeof collectSketchCurves>[number] & {
    stream: string;
    chunkIndex: number;
  }>,
  familySymbolRelations: [] as Array<{
    stream: string;
    chunkIndex: number;
    symbolId: number;
    familyId: number;
  }>,
  materialRelations: [] as Array<{
    stream: string;
    chunkIndex: number;
    geometryId: number;
    materialId: number;
    fieldOffset: number;
  }>,
  placementReferences: [] as Array<{
    stream: string;
    chunkIndex: number;
    elementId: number;
    geometryId: number;
    symbolId?: number;
  }>,
  referencedGeometryMarkers: [] as Array<{
    marker: number;
    referencedIds: number;
    targetIds: number[];
  }>,
  chunksRead: 0,
  chunksSalvaged: 0,
};
const referencedGeometryIds = new Set<number>();
const markersByElement = new Map<number, Set<number>>();

function framedObjects(data: Uint8Array): ElementObject[] {
  const objects: ElementObject[] = [];
  if (data.byteLength < 64) return objects;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 40 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < 40 || objectLength > 0xffff) continue;
    if (offset + objectLength + 20 > data.byteLength) continue;
    if (view.getUint32(offset + objectLength + 16, true) !== objectLength) continue;
    objects.push({
      offset,
      elementId,
      objectLength,
      marker: view.getUint16(offset + 16, true),
      typeCode: view.getUint32(offset + 18, true),
    });
    offset += objectLength + 19;
  }
  return objects;
}

const container = CFB.read(readFileSync(inputPath), { type: "buffer" });
for (let entryIndex = 0; entryIndex < container.FileIndex.length; entryIndex += 1) {
  const path = container.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stream = path.replace(/^Root Entry\//, "");
  const stored = stripRevitPageChecksums(asBytes(container.FileIndex[entryIndex]!.content));
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
    report.chunksRead += 1;
    if (read) window = revitWindowTail(read);
    else report.chunksSalvaged += 1;

    for (const object of framedObjects(data)) {
      const markers = markersByElement.get(object.elementId) ?? new Set<number>();
      markers.add(object.marker);
      markersByElement.set(object.elementId, markers);
      const placement = readInstancePlacement(data, object);
      if (placement) referencedGeometryIds.add(placement.geometryId);
      if (placement && targets.has(placement.geometryId)) {
        report.placementReferences.push({
          stream,
          chunkIndex,
          elementId: placement.elementId,
          geometryId: placement.geometryId,
          symbolId: placement.symbolId,
        });
      }
      if (targets.has(object.elementId)) {
        report.objects.push({
          ...object,
          stream,
          chunkIndex,
          storedOffset: revitStoredPageOffset(offsets[chunkIndex]!),
          localBounds: readLocalBounds(data, object),
          localShape: readLocalShape(data, object),
          placement,
        });
      }
    }

    for (const bounds of detectDuplicatedBoundsRecords(data)) {
      if (!targets.has(bounds.elementId)) continue;
      report.duplicatedBounds.push({
        ...bounds,
        stream,
        chunkIndex,
        storedOffset: revitStoredPageOffset(offsets[chunkIndex]!),
      });
    }
    for (const owned of collectOwnedSurfaces(data)) {
      if (targets.has(owned.owner)) report.surfaces.push({ ...owned, stream, chunkIndex });
    }
    for (const curve of collectSketchCurves(data)) {
      if (targets.has(curve.owner)) report.sketchCurves.push({ ...curve, stream, chunkIndex });
    }

    const relationships = scanPersistedRelationshipCandidates(data, 2027);
    for (const relation of relationships.familySymbolCandidates) {
      if (!targets.has(relation.symbolId) && !targets.has(relation.familyId)) continue;
      report.familySymbolRelations.push({
        stream,
        chunkIndex,
        symbolId: relation.symbolId,
        familyId: relation.familyId,
      });
    }
    for (const relation of relationships.geometryMaterialCandidates) {
      if (!targets.has(relation.geometryId)) continue;
      report.materialRelations.push({
        stream,
        chunkIndex,
        geometryId: relation.geometryId,
        materialId: relation.materialId,
        fieldOffset: relation.fieldOffset,
      });
    }
  }
}

const referencedIdsByMarker = new Map<number, Set<number>>();
for (const elementId of referencedGeometryIds) {
  for (const marker of markersByElement.get(elementId) ?? []) {
    const ids = referencedIdsByMarker.get(marker) ?? new Set<number>();
    ids.add(elementId);
    referencedIdsByMarker.set(marker, ids);
  }
}
for (const [marker, elementIds] of referencedIdsByMarker) {
  report.referencedGeometryMarkers.push({
    marker,
    referencedIds: elementIds.size,
    targetIds: [...elementIds].filter((elementId) => targets.has(elementId)),
  });
}
report.referencedGeometryMarkers.sort((a, b) =>
  b.referencedIds - a.referencedIds || a.marker - b.marker);
report.objects.sort((a, b) =>
  a.elementId - b.elementId ||
  a.stream.localeCompare(b.stream) ||
  a.chunkIndex - b.chunkIndex ||
  a.offset - b.offset);

console.log(JSON.stringify(report, null, 2));
