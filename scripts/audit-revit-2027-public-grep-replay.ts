#!/usr/bin/env node

/**
 * Exercise the reusable browser-safe GRep FIFO registry and certified owner
 * mesh paths against every direct single-Geometry owner in a Revit 2027 RVT.
 * Exact persisted instance transforms are reported separately from owner-local
 * meshes so the output can feed the post-decode IFC parity oracle.
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  instanceCorners,
  readInstancePlacement,
  type InstancePlacement,
} from "../lib/reviter/instanced-geometry.ts";
import {
  replayRevit2027GRepFifo,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  meshRevit2027PlanarSampledReplay,
} from "../lib/reviter/revit-2027-planar-owner-mesh.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
} from "../lib/reviter/revit-2027-certified-owner-mesh.ts";
import {
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

function increment<K>(map: Map<K, number>, key: K, count = 1): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function entries<K extends string | number>(
  map: Map<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map].sort(
      (left, right) =>
        right[1] - left[1] ||
        String(left[0]).localeCompare(String(right[0]), "en", {
          numeric: true,
        }),
    ),
  );
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types " +
      "scripts/audit-revit-2027-public-grep-replay.ts model.rvt",
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
let eligibleOwners = 0;
let completedOwners = 0;
let descriptors = 0;
let spans = 0;
const descriptorStates = new Map<string, number>();
const spansBySlot = new Map<number, number>();
const bodyBytesBySlot = new Map<string, number>();
const failures = new Map<string, number>();
let planarFaceMeshes = 0;
let planarPositions = 0;
let planarTriangles = 0;
const planarIssues = new Map<string, number>();
const planarMultiLoopIssueSamples: Array<{
  ownerElementId: number;
  faceToken: number;
  loopToken: number | null;
  detail: string | null;
}> = [];
const planarUvLinkIssueSamples: Array<{
  ownerElementId: number;
  faceToken: number;
  loopToken: number | null;
  edgeToken: number | null;
  detail: string | null;
}> = [];
const certifiedFacesByKind = new Map<string, number>();
let certifiedPositions = 0;
let certifiedTriangles = 0;
let certifiedPlanarMultiLoopFaces = 0;
let certifiedPlanarFilledRegions = 0;
let certifiedPlanarAdditionalFilledRegions = 0;
let certifiedPlanarHoleLoops = 0;
let certifiedPlanarMultiLoopTriangles = 0;
const certifiedIssues = new Map<string, number>();
const certifiedOwnerElements = new Map<number, {
  faces: number;
  planarMultiLoopFaces: number;
  facesByKind: Map<string, number>;
  positions: number;
  triangles: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
}>();
const instancePlacements = new Map<number, InstancePlacement>();

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
      const placement = readInstancePlacement(inflated, frame);
      if (placement && !instancePlacements.has(placement.elementId)) {
        instancePlacements.set(placement.elementId, placement);
      }
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const root = decodeRevit2027FramedGRepRoot(inflated, frame, release);
      if (
        !root.ok ||
        root.value.children.length !== 1 ||
        root.value.children[0]?.sourceClassSlot !==
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
      ) {
        continue;
      }
      eligibleOwners += 1;
      const replayed = replayRevit2027GRepFifo(inflated, root.value);
      if (!replayed.ok) {
        increment(failures, replayed.error);
        continue;
      }
      completedOwners += 1;
      const meshed = meshRevit2027PlanarSampledReplay(replayed.value);
      if (!meshed.ok) {
        increment(failures, `planar owner mesh: ${meshed.error}`);
        continue;
      }
      planarFaceMeshes += meshed.value.faceMeshes.length;
      for (const face of meshed.value.faceMeshes) {
        planarPositions += face.mesh.positions.length / 3;
        planarTriangles += face.mesh.indices.length / 3;
      }
      for (const issue of meshed.value.issues) {
        increment(planarIssues, issue.code);
        if (
          issue.code === "multi-loop" &&
          planarMultiLoopIssueSamples.length < 100
        ) {
          planarMultiLoopIssueSamples.push({
            ownerElementId: Number(replayed.value.ownerElementId),
            faceToken: issue.faceToken ?? -1,
            loopToken: issue.loopToken ?? null,
            detail: issue.detail ?? null,
          });
        }
        if (
          issue.code === "uv-link-unresolved" &&
          planarUvLinkIssueSamples.length < 100
        ) {
          planarUvLinkIssueSamples.push({
            ownerElementId: Number(replayed.value.ownerElementId),
            faceToken: issue.faceToken ?? -1,
            loopToken: issue.loopToken ?? null,
            edgeToken: issue.edgeToken ?? null,
            detail: issue.detail ?? null,
          });
        }
      }
      const certified = meshRevit2027CertifiedOwnerReplay(replayed.value);
      if (certified.ok === false) {
        increment(failures, `certified owner mesh: ${certified.error}`);
        continue;
      }
      for (const face of certified.value.faceMeshes) {
        increment(certifiedFacesByKind, face.kind);
        certifiedPositions += face.mesh.positions.length / 3;
        certifiedTriangles += face.mesh.indices.length / 3;
        const planarMultiLoop =
          face.kind === "planar-sampled" && face.loopTokens.length > 1;
        if (face.kind === "planar-sampled") {
          certifiedPlanarFilledRegions += face.regionCount;
          certifiedPlanarAdditionalFilledRegions += face.regionCount - 1;
          certifiedPlanarHoleLoops += face.holeLoopCount;
        }
        if (planarMultiLoop) {
          certifiedPlanarMultiLoopFaces += 1;
          certifiedPlanarMultiLoopTriangles += face.mesh.indices.length / 3;
        }
        const elementId = Number(certified.value.ownerElementId);
        if (!Number.isSafeInteger(elementId)) {
          increment(failures, "certified owner id is outside safe integer range");
          continue;
        }
        let element = certifiedOwnerElements.get(elementId);
        if (!element) {
          element = {
            faces: 0,
            planarMultiLoopFaces: 0,
            facesByKind: new Map(),
            positions: 0,
            triangles: 0,
            minimum: [Infinity, Infinity, Infinity],
            maximum: [-Infinity, -Infinity, -Infinity],
          };
          certifiedOwnerElements.set(elementId, element);
        }
        element.faces += 1;
        if (planarMultiLoop) element.planarMultiLoopFaces += 1;
        increment(element.facesByKind, face.kind);
        element.positions += face.mesh.positions.length / 3;
        element.triangles += face.mesh.indices.length / 3;
        for (let index = 0; index < face.mesh.positions.length; index += 3) {
          for (let axis = 0; axis < 3; axis += 1) {
            const coordinate = face.mesh.positions[index + axis]!;
            element.minimum[axis] = Math.min(
              element.minimum[axis]!,
              coordinate,
            );
            element.maximum[axis] = Math.max(
              element.maximum[axis]!,
              coordinate,
            );
          }
        }
      }
      for (const issue of certified.value.issues) {
        increment(certifiedIssues, `${issue.path}:${issue.issue.code}`);
      }
      descriptors += replayed.value.descriptors.length;
      spans += replayed.value.spans.length;
      for (const descriptor of replayed.value.descriptors) {
        increment(descriptorStates, descriptor.state);
      }
      for (const span of replayed.value.spans) {
        increment(spansBySlot, span.propertySourceClassSlot);
        increment(
          bodyBytesBySlot,
          `${span.propertySourceClassSlot}:${
            span.endOffset - span.startOffset
          }`,
        );
      }
    }
  }
}

const certifiedInstances = [...instancePlacements.values()]
  .map((placement) => {
    const geometry = certifiedOwnerElements.get(placement.geometryId);
    if (!geometry) return null;
    const corners = instanceCorners(placement, {
      elementId: placement.geometryId,
      min: geometry.minimum,
      max: geometry.maximum,
    });
    const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
    const maximum: [number, number, number] = [
      -Infinity,
      -Infinity,
      -Infinity,
    ];
    for (const corner of corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis]!, corner[axis]!);
        maximum[axis] = Math.max(maximum[axis]!, corner[axis]!);
      }
    }
    return {
      elementId: placement.elementId,
      geometryOwnerId: placement.geometryId,
      faces: geometry.faces,
      planarMultiLoopFaces: geometry.planarMultiLoopFaces,
      facesByKind: entries(geometry.facesByKind),
      positions: geometry.positions,
      triangles: geometry.triangles,
      minimum,
      maximum,
    };
  })
  .filter((value) => value != null)
  .sort((left, right) => left.elementId - right.elementId);

const readerCorpusValid =
  failedChunks === 0 &&
  eligibleOwners > 0 &&
  completedOwners === eligibleOwners &&
  failures.size === 0;
console.log(JSON.stringify({
  modelPath,
  release,
  partitions: partitions.length,
  chunks,
  failedChunks,
  eligibleOwners,
  completedOwners,
  descriptors,
  descriptorStates: entries(descriptorStates),
  spans,
  spansBySlot: entries(spansBySlot),
  bodyBytesBySlot: entries(bodyBytesBySlot),
  sampledPlanarMesh: {
    faceMeshes: planarFaceMeshes,
    positions: planarPositions,
    triangles: planarTriangles,
    issues: entries(planarIssues),
    multiLoopIssueSamples: planarMultiLoopIssueSamples,
    uvLinkIssueSamples: planarUvLinkIssueSamples,
  },
  certifiedBrowserMesh: {
    faceMeshesByKind: entries(certifiedFacesByKind),
    positions: certifiedPositions,
    triangles: certifiedTriangles,
    planarMultiLoopFaces: certifiedPlanarMultiLoopFaces,
    planarFilledRegions: certifiedPlanarFilledRegions,
    planarAdditionalFilledRegions: certifiedPlanarAdditionalFilledRegions,
    planarHoleLoops: certifiedPlanarHoleLoops,
    planarMultiLoopTriangles: certifiedPlanarMultiLoopTriangles,
    issues: entries(certifiedIssues),
    ownerElements: certifiedOwnerElements.size,
    decodedInstancePlacements: instancePlacements.size,
    placedInstancesUsingCertifiedOwners: certifiedInstances.length,
    placedInstanceTriangles: certifiedInstances.reduce(
      (total, instance) => total + instance.triangles,
      0,
    ),
    elements: [...certifiedOwnerElements]
      .sort((left, right) => left[0] - right[0])
      .map(([elementId, value]) => ({
        elementId,
        faces: value.faces,
        planarMultiLoopFaces: value.planarMultiLoopFaces,
        facesByKind: entries(value.facesByKind),
        positions: value.positions,
        triangles: value.triangles,
        minimum: value.minimum,
        maximum: value.maximum,
      })),
    instances: certifiedInstances,
  },
  failures: entries(failures),
  readerCorpusValid,
}, null, 2));

if (!readerCorpusValid) process.exitCode = 1;
