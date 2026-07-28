#!/usr/bin/env node

/**
 * Audit direct Face.renderStyleElementId -> MaterialElem identity joins.
 *
 * IFC is read only after the RVT join is complete and is used solely as an
 * output-name/style association oracle.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-face-materials.ts model.rvt reference.ifc
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  bindRevit2027FaceMaterial,
  type Revit2027FaceMaterialBinding,
} from "../lib/reviter/revit-2027-face-material.ts";
import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-face-static.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

function increment<K>(map: Map<K, number>, key: K, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  let expected = firstToken;
  for (const entry of entries) {
    if (entry.sourceClassSlot == null || entry.token === 0) {
      return "FIFO append list contains a null property";
    }
    if (entry.token === -1) continue;
    if (entry.token !== expected) {
      return `expected token ${expected}, received ${entry.token}`;
    }
    expected += 1;
  }
  return null;
}

function numbered(entries: readonly CondInt16QueueEntry[]): number {
  return entries.reduce(
    (count, entry) => count + (entry.token > 0 ? 1 : 0),
    0,
  );
}

function decodeIfcString(source: string): string {
  return source
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_match, hex: string) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(
          Number.parseInt(hex.slice(index, index + 4), 16),
        );
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll("''", "'");
}

function ifcMaterialNames(text: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^#\d+ *= *IFCMATERIAL\('((?:''|[^'])*)'\);\s*$/gm;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    names.add(decodeIfcString(match[1]!));
  }
  return names;
}

function sortedRecord<K extends string | number | bigint>(
  map: ReadonlyMap<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort(([left], [right]) =>
        String(left).localeCompare(String(right), undefined, { numeric: true }))
      .map(([key, count]) => [String(key), count]),
  );
}

const rvtPath = process.argv[2];
const ifcPath = process.argv[3];
if (!rvtPath || !ifcPath) {
  throw new Error(
    "usage: audit-revit-2027-face-materials.ts model.rvt reference.ifc",
  );
}

const rvtBytes = readFileSync(rvtPath);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(asBytes(basicFileInfo.entry.content));
if (release !== 2027) throw new Error(`expected Revit 2027, received ${release}`);

const materialDefinitions = new Map<
  number,
  ReturnType<typeof scanMaterialElementRecords>["definitions"][number]
>();
const faceIds = new Map<bigint, number>();
const nonExplicitFaceGStyleIds = new Map<bigint, number>();
const nonExplicitGeometryGStyleIds = new Map<bigint, number>();
const failures = new Map<string, number>();
let chunks = 0;
let failedChunks = 0;
let geometryOwners = 0;
let decodedFaces = 0;

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  const entry = cfb.FileIndex[entryIndex]!;
  if (entry.size <= 0 || !/\/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated = read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;

    for (const definition of scanMaterialElementRecords(inflated, release)
      .definitions) {
      materialDefinitions.set(definition.elementId, definition);
    }

    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const rootResult = decodeRevit2027FramedGRepRoot(inflated, frame, release);
      if (!rootResult.ok) continue;
      const root = rootResult.value;
      if (
        root.children.length !== 1 ||
        root.children[0]?.sourceClassSlot !==
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT ||
        requireTokens(root.children, 3)
      ) {
        continue;
      }
      const geometry = decodeRevit2027GeometryStatic(
        inflated,
        root.dynamicPayloadOffset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!geometry.ok) {
        increment(failures, geometry.error);
        continue;
      }
      const geometryTokenError = requireTokens(geometry.value.queuedProperties, 4);
      if (geometryTokenError) {
        increment(failures, geometryTokenError);
        continue;
      }
      if (
        geometry.value.faces.entries.some(
          (descriptor) =>
            descriptor.sourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT,
        )
      ) {
        increment(failures, "unexpected Geometry face source slot");
        continue;
      }

      let cursor = geometry.value.endOffset;
      let nextToken = 4 + numbered(geometry.value.queuedProperties);
      const ownerFaces: Array<{
        renderStyleElementId: bigint;
        faceGStyleElementId: bigint;
      }> = [];
      let ownerFailure: string | null = null;
      for (let index = 0; index < geometry.value.faces.count; index += 1) {
        const face = decodeRevit2027FaceStatic(
          inflated,
          cursor,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (!face.ok) {
          ownerFailure = face.error;
          break;
        }
        const tokenError = requireTokens(face.value.queuedProperties, nextToken);
        if (tokenError) {
          ownerFailure = tokenError;
          break;
        }
        nextToken += numbered(face.value.queuedProperties);
        cursor = face.value.endOffset;
        ownerFaces.push({
          renderStyleElementId: face.value.renderStyleElementId,
          faceGStyleElementId: face.value.gInfo.gStyleElementId,
        });
      }
      if (ownerFailure) {
        increment(failures, ownerFailure);
        continue;
      }
      geometryOwners += 1;
      decodedFaces += ownerFaces.length;
      for (const face of ownerFaces) {
        increment(faceIds, face.renderStyleElementId);
        if (face.renderStyleElementId <= 0n) {
          increment(nonExplicitFaceGStyleIds, face.faceGStyleElementId);
          increment(
            nonExplicitGeometryGStyleIds,
            geometry.value.gInfo.gStyleElementId,
          );
        }
      }
    }
  }
}

const bindingCounts = new Map<Revit2027FaceMaterialBinding["status"], number>();
const exactMaterialFaces = new Map<number, number>();
const unresolvedPositiveIds = new Map<bigint, number>();
const negativeSystemIds = new Map<bigint, number>();
for (const [id, count] of faceIds) {
  const binding = bindRevit2027FaceMaterial(id, materialDefinitions);
  increment(bindingCounts, binding.status, count);
  if (binding.status === "exact-material") {
    increment(exactMaterialFaces, binding.materialElementId, count);
  } else if (binding.status === "unresolved-positive-id") {
    unresolvedPositiveIds.set(id, count);
  } else if (binding.status === "negative-system-id") {
    negativeSystemIds.set(id, count);
  }
}

const ifcText = readFileSync(ifcPath, "latin1");
const ifcNames = ifcMaterialNames(ifcText);
const boundDefinitions = [...exactMaterialFaces.keys()]
  .map((id) => materialDefinitions.get(id)!)
  .sort((left, right) => left.elementId - right.elementId);
const boundNamesInIfc = boundDefinitions.filter((definition) =>
  ifcNames.has(definition.name));

console.log(JSON.stringify({
  rvtPath,
  ifcPath,
  release,
  chunks,
  failedChunks,
  geometryOwners,
  decodedFaces,
  failures: sortedRecord(failures),
  materialDefinitions: materialDefinitions.size,
  faceRenderStyleIds: {
    distinct: faceIds.size,
    counts: sortedRecord(faceIds),
  },
  bindings: {
    counts: sortedRecord(bindingCounts),
    exactDistinctMaterialElements: exactMaterialFaces.size,
    exactMaterialFaces: sortedRecord(exactMaterialFaces),
    unresolvedPositiveIds: sortedRecord(unresolvedPositiveIds),
    negativeSystemIds: sortedRecord(negativeSystemIds),
    nonExplicitFaceGStyleIds: sortedRecord(nonExplicitFaceGStyleIds),
    nonExplicitGeometryGStyleIds: sortedRecord(nonExplicitGeometryGStyleIds),
  },
  ifcOracle: {
    distinctIfcMaterialNames: ifcNames.size,
    styledItems:
      ifcText.match(/^#\d+ *= *IFCSTYLEDITEM\(/gm)?.length ?? 0,
    materialAssociations:
      ifcText.match(/^#\d+ *= *IFCRELASSOCIATESMATERIAL\(/gm)?.length ?? 0,
    boundRvtMaterialNames: boundDefinitions.length,
    boundRvtNamesFoundInIfc: boundNamesInIfc.length,
    exactNameCoverage:
      boundDefinitions.length === 0
        ? null
        : boundNamesInIfc.length / boundDefinitions.length,
    missingBoundRvtNames: boundDefinitions
      .filter((definition) => !ifcNames.has(definition.name))
      .map((definition) => definition.name),
  },
  evidenceBoundary:
    "IFC names/styles are compared only after direct RVT Face ID to framed MaterialElem ID binding",
}, null, 2));
