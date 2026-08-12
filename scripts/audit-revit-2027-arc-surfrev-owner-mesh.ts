/**
 * Corpus proof for the reusable browser Arc/SurfRev owner-mesh adapter.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-arc-surfrev-owner-mesh.ts model.rvt
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import {
  countsByFrequency,
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
  replayAndMeshRevit2027ArcSurfRevOwner,
} from "../lib/reviter/revit-2027-arc-surfrev-owner-mesh.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/audit-revit-2027-arc-surfrev-owner-mesh.ts model.rvt",
  );
}

const container = CFB.read(readFileSync(modelPath), { type: "buffer" });
const basicFileInfo = container.FileIndex
  .map((entry, index) => ({
    entry,
    path: container.FullPaths[index] ?? "",
  }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/iu.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(
    `audit requires Revit 2027, received ${release ?? "unknown"}`,
  );
}

const partitions = container.FileIndex
  .map((entry, index) => ({
    entry,
    path: container.FullPaths[index] ?? "",
  }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/iu.test(path),
  );

let chunks = 0;
let failedChunks = 0;
const materialDefinitions = new Map<
  number,
  ReturnType<typeof scanMaterialElementRecords>["definitions"][number]
>();
for (const partition of partitions) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) continue;
    if (read) dictionary = revitWindowTail(read);
    for (
      const definition of scanMaterialElementRecords(inflated, release)
        .definitions
    ) {
      if (!materialDefinitions.has(definition.elementId)) {
        materialDefinitions.set(definition.elementId, definition);
      }
    }
  }
}
let directGeometryOwners = 0;
let completedOwners = 0;
let ownersWithCertifiedFaces = 0;
let certifiedFaces = 0;
let positions = 0;
let triangles = 0;
const issues = new Map<string, number>();
const replayFailures = new Map<string, number>();
const materialIds = new Map<string, number>();
const faces: Array<{
  ownerElementId: number;
  faceToken: number;
  loopToken: number;
  profileToken: number;
  revolutionSegments: number;
  profileSegments: number;
  positions: number;
  triangles: number;
}> = [];

for (const partition of partitions) {
  const stored = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated =
      read ??
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
    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const root = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        release,
      );
      if (
        !root.ok ||
        root.value.children.length !== 1 ||
        root.value.children[0]?.sourceClassSlot !==
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
      ) {
        continue;
      }
      directGeometryOwners += 1;
      const meshed = replayAndMeshRevit2027ArcSurfRevOwner(
        inflated,
        root.value,
        { materialDefinitions },
      );
      if (meshed.ok === false) {
        increment(replayFailures, meshed.error);
        continue;
      }
      completedOwners += 1;
      if (meshed.value.faceMeshes.length) ownersWithCertifiedFaces += 1;
      for (const issue of meshed.value.issues) increment(issues, issue.code);
      for (const face of meshed.value.faceMeshes) {
        const facePositions = face.mesh.positions.length / 3;
        const faceTriangles = face.mesh.indices.length / 3;
        certifiedFaces += 1;
        positions += facePositions;
        triangles += faceTriangles;
        increment(
          materialIds,
          String(face.mesh.groups[0]?.materialId ?? "null"),
        );
        faces.push({
          ownerElementId: Number(meshed.value.ownerElementId),
          faceToken: face.faceToken,
          loopToken: face.loopToken,
          profileToken: face.profileToken,
          revolutionSegments: face.revolutionSegments,
          profileSegments: face.profileSegments,
          positions: facePositions,
          triangles: faceTriangles,
        });
      }
    }
  }
}

console.log(JSON.stringify({
  modelPath,
  release,
  partitions: partitions.length,
  chunks,
  failedChunks,
  directGeometryOwners,
  completedOwners,
  ownersWithCertifiedFaces,
  certifiedFaces,
  positions,
  triangles,
  materialDefinitions: materialDefinitions.size,
  materialIds: countsByFrequency(materialIds),
  issues: countsByFrequency(issues),
  replayFailures: countsByFrequency(replayFailures),
  faces,
  boundary:
    "only circular-profile SurfRev faces with one exact rectangular envelope-side trim are emitted",
}, null, 2));
