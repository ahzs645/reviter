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

import {
  countsByKey,
  decodeIfcString,
  increment,
} from "./lib/rvt-harness.ts";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
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
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  decodeRevit2027FramedGRepRoot,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027FaceStatic,
  Revit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
import {
  isRevit2027DirectGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function ifcMaterialNames(text: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^#\d+ *= *IFCMATERIAL\('((?:''|[^'])*)'\);\s*$/gm;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    names.add(decodeIfcString(match[1]!));
  }
  return names;
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
let facesWithoutGeometryParent = 0;

function owningGeometry(
  span: Revit2027GRepReplaySpan,
  spansByReplayIndex: ReadonlyMap<number, Revit2027GRepReplaySpan>,
): Revit2027GeometryStatic | null {
  let parentReplayIndex = span.parentReplayIndex;
  while (parentReplayIndex != null) {
    const parent = spansByReplayIndex.get(parentReplayIndex);
    if (!parent) return null;
    if (
      parent.propertySourceClassSlot ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      return parent.value as Revit2027GeometryStatic;
    }
    parentReplayIndex = parent.parentReplayIndex;
  }
  return null;
}

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
      if (!isRevit2027DirectGeometryRoot(root)) continue;
      const replayed = replayRevit2027GRepFifo(inflated, root);
      if (!replayed.ok) {
        increment(failures, replayed.error);
        continue;
      }
      geometryOwners += 1;
      const spansByReplayIndex = new Map(
        replayed.value.spans.map((span) => [span.replayIndex, span]),
      );
      for (const span of replayed.value.spans) {
        if (
          span.propertySourceClassSlot !==
          REVIT_2027_FACE_SOURCE_CLASS_SLOT
        ) {
          continue;
        }
        const face = span.value as Revit2027FaceStatic;
        decodedFaces += 1;
        increment(faceIds, face.renderStyleElementId);
        if (face.renderStyleElementId > 0n) continue;
        increment(nonExplicitFaceGStyleIds, face.gInfo.gStyleElementId);
        const geometry = owningGeometry(span, spansByReplayIndex);
        if (geometry) {
          increment(
            nonExplicitGeometryGStyleIds,
            geometry.gInfo.gStyleElementId,
          );
        } else {
          facesWithoutGeometryParent += 1;
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
  facesWithoutGeometryParent,
  failures: countsByKey(failures),
  materialDefinitions: materialDefinitions.size,
  faceRenderStyleIds: {
    distinct: faceIds.size,
    counts: countsByKey(faceIds),
  },
  bindings: {
    counts: countsByKey(bindingCounts),
    exactDistinctMaterialElements: exactMaterialFaces.size,
    exactMaterialFaces: countsByKey(exactMaterialFaces),
    unresolvedPositiveIds: countsByKey(unresolvedPositiveIds),
    negativeSystemIds: countsByKey(negativeSystemIds),
    nonExplicitFaceGStyleIds: countsByKey(nonExplicitFaceGStyleIds),
    nonExplicitGeometryGStyleIds: countsByKey(nonExplicitGeometryGStyleIds),
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
