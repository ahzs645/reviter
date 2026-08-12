#!/usr/bin/env node

/**
 * Audit the persisted Face/Geometry GStyleElem -> GStyle -> MaterialElem path.
 *
 * IFC is opened only after every RVT record and join has been decoded. It is
 * used solely as an output material-name oracle.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-gstyle-material-fallback.ts model.rvt reference.ifc
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
  isRevit2027DirectGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
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
  replayRevit2027GRepFifo,
  type Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  bindRevit2027FaceGStyleMaterialFallback,
  scanRevit2027GStyleElementRecords,
  type Revit2027GStyleElementRecord,
  type Revit2027GStyleMaterialBinding,
} from "../lib/reviter/revit-2027-gstyle-material.ts";

type FallbackFace = {
  renderStyleElementId: bigint;
  faceGStyleElementId: bigint;
  geometryGStyleElementId: bigint;
};

function mergeCounts(
  target: Map<string, number>,
  source: ReadonlyMap<string, number>,
): void {
  for (const [key, count] of source) increment(target, key, count);
}

function ifcMaterialNames(text: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^#\d+ *= *IFCMATERIAL\('((?:''|[^'])*)'\);\s*$/gm;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    names.add(decodeIfcString(match[1]!));
  }
  return names;
}

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

const rvtPath = process.argv[2];
const ifcPath = process.argv[3];
if (!rvtPath || !ifcPath) {
  throw new Error(
    "usage: audit-revit-2027-gstyle-material-fallback.ts model.rvt reference.ifc",
  );
}

const cfb = CFB.read(readFileSync(rvtPath), { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) =>
    entry.size > 0 && /\/BasicFileInfo$/i.test(path)
  );
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(`expected Revit 2027, received ${release}`);
}

const materialDefinitions = new Map<
  number,
  ReturnType<typeof scanMaterialElementRecords>["definitions"][number]
>();
const styles = new Map<number, Revit2027GStyleElementRecord>();
const styleMaterialIds = new Map<bigint, number>();
const styleFailures = new Map<string, number>();
const replayFailures = new Map<string, number>();
const fallbackFaces: FallbackFace[] = [];
let chunks = 0;
let failedChunks = 0;
let geometryOwners = 0;
let decodedFaces = 0;
let framedStyleElements = 0;
let decodedStyleElements = 0;
let facesWithoutGeometryParent = 0;

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

    for (
      const definition of scanMaterialElementRecords(inflated, release)
        .definitions
    ) {
      materialDefinitions.set(definition.elementId, definition);
    }

    const styleScan = scanRevit2027GStyleElementRecords(inflated, release);
    framedStyleElements += styleScan.framedStyleElements;
    decodedStyleElements += styleScan.decodedStyleElements;
    mergeCounts(styleFailures, styleScan.failures);
    for (const style of styleScan.records) {
      styles.set(style.elementId, style);
      increment(styleMaterialIds, style.materialElementId);
    }

    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const rootResult = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        release,
      );
      if (!rootResult.ok) continue;
      if (!isRevit2027DirectGeometryRoot(rootResult.value)) continue;
      const replayed = replayRevit2027GRepFifo(inflated, rootResult.value);
      if (!replayed.ok) {
        increment(replayFailures, replayed.error);
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
        if (face.renderStyleElementId > 0n) continue;
        const geometry = owningGeometry(span, spansByReplayIndex);
        if (!geometry) facesWithoutGeometryParent += 1;
        fallbackFaces.push({
          renderStyleElementId: face.renderStyleElementId,
          faceGStyleElementId: face.gInfo.gStyleElementId,
          geometryGStyleElementId:
            geometry?.gInfo.gStyleElementId ?? -1n,
        });
      }
    }
  }
}

const statusCounts = new Map<
  Revit2027GStyleMaterialBinding["status"],
  number
>();
const reasonCounts = new Map<string, number>();
const selectedSources = new Map<string, number>();
const selectedStyleIds = new Map<bigint, number>();
const exactMaterialFaces = new Map<number, number>();
const exactDefinitions = new Map<number, string>();
const renderStyleIds = new Map<bigint, number>();
const exactPersistedStyleMaterials = new Map<number, number>();
const unresolvedPersistedStyleMaterials = new Map<bigint, number>();

for (const style of styles.values()) {
  if (style.materialElementId <= 0n) continue;
  if (style.materialElementId > BigInt(Number.MAX_SAFE_INTEGER)) {
    increment(unresolvedPersistedStyleMaterials, style.materialElementId);
    continue;
  }
  const materialElementId = Number(style.materialElementId);
  if (materialDefinitions.has(materialElementId)) {
    increment(exactPersistedStyleMaterials, materialElementId);
  } else {
    increment(unresolvedPersistedStyleMaterials, style.materialElementId);
  }
}

for (const face of fallbackFaces) {
  increment(renderStyleIds, face.renderStyleElementId);
  const binding = bindRevit2027FaceGStyleMaterialFallback(
    face,
    styles,
    materialDefinitions,
  );
  increment(statusCounts, binding.status);
  if ("reason" in binding) increment(reasonCounts, binding.reason);
  if ("source" in binding) {
    increment(selectedSources, binding.source);
    increment(selectedStyleIds, binding.gStyleElementId);
  }
  if (binding.status === "exact-material") {
    increment(exactMaterialFaces, binding.materialElementId);
    exactDefinitions.set(
      binding.materialElementId,
      binding.definition.name,
    );
  }
}

// Post-decode oracle: IFC is not read until the RVT graph and all joins above
// have been finalized.
const ifcText = readFileSync(ifcPath, "latin1");
const ifcNames = ifcMaterialNames(ifcText);
const exactNames = [...exactDefinitions.values()].sort();

console.log(JSON.stringify({
  rvtPath,
  ifcPath,
  release,
  chunks,
  failedChunks,
  geometryOwners,
  decodedFaces,
  facesWithoutGeometryParent,
  replayFailures: countsByKey(replayFailures),
  persistedDefinitions: {
    namedMaterialElements: materialDefinitions.size,
    framedStyleElements,
    decodedStyleElements,
    rejectedStyleElements: framedStyleElements - decodedStyleElements,
    styleDecodeFailures: countsByKey(styleFailures),
    decodedStyleMaterialIds: countsByKey(styleMaterialIds),
    exactNamedStyleMaterialIds:
      countsByKey(exactPersistedStyleMaterials),
    unresolvedPositiveStyleMaterialIds:
      countsByKey(unresolvedPersistedStyleMaterials),
  },
  fallbackFaces: {
    total: fallbackFaces.length,
    renderStyleIds: countsByKey(renderStyleIds),
    statusCounts: countsByKey(statusCounts),
    reasonCounts: countsByKey(reasonCounts),
    selectedSources: countsByKey(selectedSources),
    selectedStyleIds: countsByKey(selectedStyleIds),
    newlyExactFaces: [...exactMaterialFaces.values()]
      .reduce((sum, count) => sum + count, 0),
    exactMaterialFaces: countsByKey(exactMaterialFaces),
  },
  ifcOracle: {
    distinctIfcMaterialNames: ifcNames.size,
    styledItems:
      ifcText.match(/^#\d+ *= *IFCSTYLEDITEM\(/gm)?.length ?? 0,
    exactRvtFallbackMaterialNames: exactNames,
    exactRvtFallbackNamesFoundInIfc: exactNames.filter((name) =>
      ifcNames.has(name)
    ),
  },
  evidenceBoundary:
    "Face renderStyle=-1 or exact Revit-2027 non-category system id -4000010 -> positive Face GInfo style -> otherwise positive owning-Geometry GInfo style -> framed GStyleElem queued GStyle material ID -> independently named framed MaterialElem; IFC is post-decode only",
}, null, 2));
