#!/usr/bin/env node

/**
 * Exercise the reusable browser-safe GRep FIFO registry and certified owner
 * mesh paths against every certified direct-Geometry owner in a Revit 2027 RVT.
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
  isRevit2027DirectGeometryRoot,
} from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  instanceCorners,
  readInstancePlacement,
  type InstancePlacement,
} from "../lib/reviter/instanced-geometry.ts";
import {
  replayRevit2027GRepFifo,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  collectRevit2027NestedInstances,
  composeRevit2027NestedMesh,
  type Revit2027NestedInstance,
} from "../lib/reviter/revit-2027-nested-instance.ts";
import {
  meshRevit2027PlanarSampledReplay,
} from "../lib/reviter/revit-2027-planar-owner-mesh.ts";
import {
  meshRevit2027CertifiedOwnerReplay,
} from "../lib/reviter/revit-2027-certified-owner-mesh.ts";

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
const eligibleOwnerElementIds = new Set<number>();
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
type CertifiedOwnerElement = {
  faces: number;
  planarMultiLoopFaces: number;
  facesByKind: Map<string, number>;
  positions: number;
  triangles: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
};
const certifiedOwnerElements = new Map<number, CertifiedOwnerElement>();
const certifiedIssueCountByOwner = new Map<number, number>();
const certifiedIssuesByOwner = new Map<number, Map<string, number>>();
const completedOwnerElementIds = new Set<bigint>();
const nestedInstancesByOwner = new Map<
  bigint,
  readonly Revit2027NestedInstance[]
>();
const nestedGRepIds = new Map<number, number>();
const nestedCdaValues = new Map<number, number>();
const nestedHasScale = new Map<string, number>();
const nestedResolveSymbolInView = new Map<string, number>();
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
      if (!root.ok || !isRevit2027DirectGeometryRoot(root.value)) {
        continue;
      }
      eligibleOwners += 1;
      const eligibleOwnerElementId = Number(root.value.ownerElementId);
      if (Number.isSafeInteger(eligibleOwnerElementId)) {
        eligibleOwnerElementIds.add(eligibleOwnerElementId);
      }
      const replayed = replayRevit2027GRepFifo(inflated, root.value);
      if (!replayed.ok) {
        increment(failures, replayed.error);
        continue;
      }
      completedOwners += 1;
      completedOwnerElementIds.add(replayed.value.ownerElementId);
      const nestedInstances = collectRevit2027NestedInstances(replayed.value);
      if (!nestedInstances.ok) {
        increment(failures, `nested instances: ${nestedInstances.error}`);
        continue;
      }
      if (nestedInstancesByOwner.has(replayed.value.ownerElementId)) {
        increment(
          failures,
          `duplicate completed owner ${replayed.value.ownerElementId}`,
        );
        continue;
      }
      nestedInstancesByOwner.set(
        replayed.value.ownerElementId,
        nestedInstances.value,
      );
      for (const instance of nestedInstances.value) {
        increment(nestedGRepIds, instance.gRepId);
        increment(nestedCdaValues, instance.cda);
        increment(nestedHasScale, String(instance.hasScale));
        increment(
          nestedResolveSymbolInView,
          String(instance.resolveSymbolInView),
        );
      }
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
        const issueCode = `${issue.path}:${issue.issue.code}`;
        increment(certifiedIssues, issueCode);
        const ownerElementId = Number(certified.value.ownerElementId);
        const ownerIssues =
          certifiedIssuesByOwner.get(ownerElementId) ?? new Map<string, number>();
        increment(ownerIssues, issueCode);
        certifiedIssuesByOwner.set(ownerElementId, ownerIssues);
        increment(
          certifiedIssueCountByOwner,
          ownerElementId,
        );
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

function includeTransformedBounds(
  minimum: [number, number, number],
  maximum: [number, number, number],
  source: CertifiedOwnerElement,
  matrix: readonly number[],
): void {
  for (const x of [source.minimum[0], source.maximum[0]]) {
    for (const y of [source.minimum[1], source.maximum[1]]) {
      for (const z of [source.minimum[2], source.maximum[2]]) {
        const point: [number, number, number] = [
          matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
          matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
          matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
        ];
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
          maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
        }
      }
    }
  }
}

const nestedSymbolTargetIds = new Set(
  [...nestedInstancesByOwner.values()]
    .flat()
    .map((instance) => Number(instance.symbolElementId))
    .filter(Number.isSafeInteger),
);
const nestedSymbolTargetFrames = new Map<number, Array<{
  marker: number;
  typeCode: number;
  objectLength: number;
  gRepOwnerElementId: number | null;
  gRepChildren: Array<{
    token: number;
    sourceClassSlot: number | null;
  }> | null;
  directGeometryRoot: boolean | null;
  replayError: string | null;
}>>();
const nestedTargetOwnerElements = new Map<number, CertifiedOwnerElement>();
const nestedTargetIssueCountByOwner = new Map<number, number>();
const nestedTargetIssuesByOwner = new Map<number, Map<string, number>>();
const nestedTargetInstancesByOwner = new Map<
  bigint,
  readonly Revit2027NestedInstance[]
>();
const nestedTargetMeshFailures = new Map<string, number>();
const scannedNestedSymbolTargetIds = new Set<number>();
let pendingNestedSymbolTargetIds = new Set(nestedSymbolTargetIds);
let nestedSymbolTargetPasses = 0;
while (pendingNestedSymbolTargetIds.size > 0) {
  nestedSymbolTargetPasses += 1;
  if (nestedSymbolTargetPasses > 32) {
    throw new Error("nested symbol target closure exceeds 32 passes");
  }
  const discoveredNestedSymbolTargetIds = new Set<number>();
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
      for (const frame of scanFramedElementObjects(inflated)) {
        if (!pendingNestedSymbolTargetIds.has(frame.elementId)) continue;
        let gRepOwnerElementId: number | null = null;
        let gRepChildren: Array<{
          token: number;
          sourceClassSlot: number | null;
        }> | null = null;
        let directGeometryRoot: boolean | null = null;
        let replayError: string | null = null;
        if (frame.marker === REVIT_2027_GELEMENT_OBJECT_MARKER) {
          const decoded = decodeRevit2027FramedGRepRoot(
            inflated,
            frame,
            release,
          );
          if (decoded.ok) {
            gRepOwnerElementId = Number(decoded.value.ownerElementId);
            gRepChildren = decoded.value.children.map((child) => ({
              token: child.token,
              sourceClassSlot: child.sourceClassSlot,
            }));
            directGeometryRoot = isRevit2027DirectGeometryRoot(decoded.value);
            const replayed = replayRevit2027GRepFifo(inflated, decoded.value);
            replayError = replayed.ok ? null : replayed.error;
            if (replayed.ok) {
              const targetOwnerElementId = replayed.value.ownerElementId;
              if (
                targetOwnerElementId !== BigInt(frame.elementId) ||
                nestedTargetInstancesByOwner.has(targetOwnerElementId)
              ) {
                increment(
                  nestedTargetMeshFailures,
                  "target GRep owner id is conflicting or duplicated",
                );
              } else {
                const targetInstances =
                  collectRevit2027NestedInstances(replayed.value);
                if (!targetInstances.ok) {
                  increment(
                    nestedTargetMeshFailures,
                    `target nested instances: ${targetInstances.error}`,
                  );
                } else {
                  nestedTargetInstancesByOwner.set(
                    targetOwnerElementId,
                    targetInstances.value,
                  );
                  for (const instance of targetInstances.value) {
                    const symbolElementId = Number(instance.symbolElementId);
                    if (!Number.isSafeInteger(symbolElementId)) continue;
                    nestedSymbolTargetIds.add(symbolElementId);
                    if (
                      !scannedNestedSymbolTargetIds.has(symbolElementId) &&
                      !pendingNestedSymbolTargetIds.has(symbolElementId)
                    ) {
                      discoveredNestedSymbolTargetIds.add(symbolElementId);
                    }
                  }
                  const targetMesh =
                    meshRevit2027CertifiedOwnerReplay(replayed.value);
                  if (!targetMesh.ok) {
                    increment(
                      nestedTargetMeshFailures,
                      `target mesh: ${targetMesh.error}`,
                    );
                  } else if (
                    targetMesh.value.faceMeshes.length === 0 &&
                    targetInstances.value.length === 0
                  ) {
                    increment(
                      nestedTargetMeshFailures,
                      "target replay has neither mesh nor nested instances",
                    );
                  } else if (targetMesh.value.faceMeshes.length > 0) {
                    const summary: CertifiedOwnerElement = {
                      faces: 0,
                      planarMultiLoopFaces: 0,
                      facesByKind: new Map(),
                      positions: 0,
                      triangles: 0,
                      minimum: [Infinity, Infinity, Infinity],
                      maximum: [-Infinity, -Infinity, -Infinity],
                    };
                    for (const face of targetMesh.value.faceMeshes) {
                      summary.faces += 1;
                      increment(summary.facesByKind, face.kind);
                      summary.positions += face.mesh.positions.length / 3;
                      summary.triangles += face.mesh.indices.length / 3;
                      for (
                        let index = 0;
                        index < face.mesh.positions.length;
                        index += 3
                      ) {
                        for (let axis = 0; axis < 3; axis += 1) {
                          const coordinate =
                            face.mesh.positions[index + axis]!;
                          summary.minimum[axis] = Math.min(
                            summary.minimum[axis]!,
                            coordinate,
                          );
                          summary.maximum[axis] = Math.max(
                            summary.maximum[axis]!,
                            coordinate,
                          );
                        }
                      }
                    }
                    nestedTargetOwnerElements.set(frame.elementId, summary);
                    nestedTargetIssueCountByOwner.set(
                      frame.elementId,
                      targetMesh.value.issues.length,
                    );
                    const ownerIssues = new Map<string, number>();
                    for (const issue of targetMesh.value.issues) {
                      increment(
                        ownerIssues,
                        `${issue.path}:${issue.issue.code}`,
                      );
                    }
                    nestedTargetIssuesByOwner.set(
                      frame.elementId,
                      ownerIssues,
                    );
                  }
                }
              }
            }
          } else {
            replayError = decoded.error;
          }
        }
        const frames = nestedSymbolTargetFrames.get(frame.elementId) ?? [];
        frames.push({
          marker: frame.marker,
          typeCode: frame.typeCode,
          objectLength: frame.objectLength,
          gRepOwnerElementId,
          gRepChildren,
          directGeometryRoot,
          replayError,
        });
        nestedSymbolTargetFrames.set(frame.elementId, frames);
      }
    }
  }
  for (const elementId of pendingNestedSymbolTargetIds) {
    scannedNestedSymbolTargetIds.add(elementId);
  }
  pendingNestedSymbolTargetIds = discoveredNestedSymbolTargetIds;
}

const nestedOwnerDefinitionIds = new Set([
  ...completedOwnerElementIds,
  ...nestedTargetInstancesByOwner.keys(),
]);
const nestedOwnerDefinitions = [...nestedOwnerDefinitionIds].map(
  (ownerElementId) => ({
    ownerElementId,
    geometry:
      certifiedOwnerElements.get(Number(ownerElementId)) ??
      nestedTargetOwnerElements.get(Number(ownerElementId)) ??
      null,
    nestedInstances:
      nestedInstancesByOwner.get(ownerElementId) ??
      nestedTargetInstancesByOwner.get(ownerElementId) ??
      [],
  }),
);
const nestedCompositionFailures = new Map<string, number>();
const composedNestedOwnerElements: Array<{
  elementId: number;
  occurrences: number;
  sourceOwnerElementIds: number[];
  sourceIssueCount: number;
  sourceIssues: Record<string, number>;
  complete: boolean;
  faces: number;
  positions: number;
  triangles: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
}> = [];
for (const [rootOwnerElementId, nestedInstances] of nestedInstancesByOwner) {
  if (nestedInstances.length === 0) continue;
  const composed = composeRevit2027NestedMesh(
    rootOwnerElementId,
    nestedOwnerDefinitions,
  );
  if (!composed.ok) {
    increment(nestedCompositionFailures, composed.error);
    continue;
  }
  const elementId = Number(rootOwnerElementId);
  if (!Number.isSafeInteger(elementId)) {
    increment(
      nestedCompositionFailures,
      "nested root owner id is outside safe integer range",
    );
    continue;
  }
  const minimum: [number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
  ];
  const maximum: [number, number, number] = [
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  let faces = 0;
  let positions = 0;
  let triangles = 0;
  let sourceIssueCount = 0;
  const sourceIssues = new Map<string, number>();
  const sourceOwnerElementIds = new Set<number>();
  for (const occurrence of composed.value.occurrences) {
    const sourceOwnerElementId = Number(occurrence.geometryOwnerElementId);
    if (!Number.isSafeInteger(sourceOwnerElementId)) {
      increment(
        nestedCompositionFailures,
        "nested source owner id is outside safe integer range",
      );
      sourceOwnerElementIds.clear();
      break;
    }
    sourceOwnerElementIds.add(sourceOwnerElementId);
    faces += occurrence.geometry.faces;
    positions += occurrence.geometry.positions;
    triangles += occurrence.geometry.triangles;
    sourceIssueCount +=
      certifiedIssueCountByOwner.get(sourceOwnerElementId) ??
      nestedTargetIssueCountByOwner.get(sourceOwnerElementId) ??
      0;
    for (const [issue, count] of
      certifiedIssuesByOwner.get(sourceOwnerElementId) ??
      nestedTargetIssuesByOwner.get(sourceOwnerElementId) ??
      []) {
      sourceIssues.set(issue, (sourceIssues.get(issue) ?? 0) + count);
    }
    includeTransformedBounds(
      minimum,
      maximum,
      occurrence.geometry,
      occurrence.transform,
    );
  }
  if (sourceOwnerElementIds.size === 0) continue;
  composedNestedOwnerElements.push({
    elementId,
    occurrences: composed.value.occurrences.length,
    sourceOwnerElementIds: [...sourceOwnerElementIds].sort(
      (left, right) => left - right,
    ),
    sourceIssueCount,
    sourceIssues: entries(sourceIssues),
    complete: sourceIssueCount === 0,
    faces,
    positions,
    triangles,
    minimum,
    maximum,
  });
}
composedNestedOwnerElements.sort(
  (left, right) => left.elementId - right.elementId,
);
const nestedPartialSourceIssues = new Map<string, number>();
for (const element of composedNestedOwnerElements) {
  if (element.complete) continue;
  for (const [issue, count] of Object.entries(element.sourceIssues)) {
    nestedPartialSourceIssues.set(
      issue,
      (nestedPartialSourceIssues.get(issue) ?? 0) + count,
    );
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
    nestedInstances: {
      ownersWithInstances: [...nestedInstancesByOwner.values()].filter(
        (instances) => instances.length > 0,
      ).length,
      instanceLinks: [...nestedInstancesByOwner.values()].reduce(
        (total, instances) => total + instances.length,
        0,
      ),
      gRepIds: entries(nestedGRepIds),
      cdaValues: entries(nestedCdaValues),
      hasScale: entries(nestedHasScale),
      resolveSymbolInView: entries(nestedResolveSymbolInView),
      composedOwners: composedNestedOwnerElements.length,
      completeOwners: composedNestedOwnerElements.filter(
        (element) => element.complete,
      ).length,
      partialOwners: composedNestedOwnerElements.filter(
        (element) => !element.complete,
      ).length,
      partialSourceIssues: entries(nestedPartialSourceIssues),
      triangles: composedNestedOwnerElements.reduce(
        (total, element) => total + element.triangles,
        0,
      ),
      failures: entries(nestedCompositionFailures),
      symbolTargets: {
        closurePasses: nestedSymbolTargetPasses,
        uniqueIds: nestedSymbolTargetIds.size,
        framedIds: nestedSymbolTargetFrames.size,
        unframedIds: [...nestedSymbolTargetIds].filter(
          (elementId) => !nestedSymbolTargetFrames.has(elementId),
        ).length,
        replayedOwners: nestedTargetInstancesByOwner.size,
        nestedLinks: [...nestedTargetInstancesByOwner.values()].reduce(
          (total, instances) => total + instances.length,
          0,
        ),
        ownersWithCertifiedMesh: nestedTargetOwnerElements.size,
        certifiedTriangles: [...nestedTargetOwnerElements.values()].reduce(
          (total, element) => total + element.triangles,
          0,
        ),
        meshFailures: entries(nestedTargetMeshFailures),
        frames: [...nestedSymbolTargetFrames]
          .sort((left, right) => left[0] - right[0])
          .map(([elementId, frames]) => ({ elementId, frames })),
      },
      elements: composedNestedOwnerElements,
      links: [...nestedInstancesByOwner.values()]
        .flat()
        .map((instance) => ({
          ownerElementId: Number(instance.ownerElementId),
          instanceReplayIndex: instance.instanceReplayIndex,
          path: instance.path,
          symbolElementId: Number(instance.symbolElementId),
          gRepId: instance.gRepId,
          cda: instance.cda,
          transform: instance.transform.matrix,
        }))
        .sort(
          (left, right) =>
            left.ownerElementId - right.ownerElementId ||
            left.instanceReplayIndex - right.instanceReplayIndex,
        ),
    },
  },
  topologyInventory: {
    directGeometryOwnerElementIds: [...eligibleOwnerElementIds].sort(
      (left, right) => left - right,
    ),
    placementLinks: [...instancePlacements.values()]
      .map((placement) => ({
        elementId: placement.elementId,
        geometryOwnerId: placement.geometryId,
      }))
      .sort((left, right) => left.elementId - right.elementId),
  },
  failures: entries(failures),
  readerCorpusValid,
}, null, 2));

if (!readerCorpusValid) process.exitCode = 1;
