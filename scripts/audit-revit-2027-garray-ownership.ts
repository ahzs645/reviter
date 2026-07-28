#!/usr/bin/env node

/**
 * Audit whether exact Revit 2027 GArray transforms can be joined to current
 * element/shared-shape ownership without category or IFC-class inference.
 *
 * IFC and the current conversion JSON are comparison oracles only. They are
 * never consulted while locating or decoding RVT GArray bodies.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import CFB from "cfb";

import { readTruthBoxes, type Box } from "./overlay-diff.ts";
import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  readLocalBounds,
  readLocalShape,
  readInstancePlacement,
  type InstancePlacement,
  type LocalBounds,
} from "../lib/reviter/instanced-geometry.ts";
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
  decodeRevit2027GArray,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  type Revit2027GArray,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";

const argv = process.argv.slice(2);

function requiredOption(name: string): string {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]!);
  throw new Error(`Missing ${name}.`);
}

const paths = {
  rvt: requiredOption("--rvt"),
  ifc: requiredOption("--ifc"),
  json: requiredOption("--json"),
};

type Extents = {
  minimum: readonly [number, number, number];
  maximum: readonly [number, number, number];
  valid: boolean;
};

type GArrayRecord = {
  ownerElementId: number;
  localExtents: Extents;
  worldExtents: Extents;
  gArray: Revit2027GArray;
};

type ManifestElement = {
  elementId: number;
  geometry?: {
    source?: string;
    boundsFeet?: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    };
  };
};

type Matrix = readonly number[];

function transformPoint(
  matrix: Matrix,
  point: readonly [number, number, number],
): [number, number, number] {
  const [x, y, z] = point;
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ];
}

function placementMatrix(placement: InstancePlacement): number[] {
  const m = placement.basis;
  return [
    m[0]!, m[3]!, m[6]!, 0,
    m[1]!, m[4]!, m[7]!, 0,
    m[2]!, m[5]!, m[8]!, 0,
    placement.origin[0], placement.origin[1], placement.origin[2], 1,
  ];
}

function multiply(outer: Matrix, inner: Matrix): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let innerIndex = 0; innerIndex < 4; innerIndex += 1) {
        result[column * 4 + row] +=
          outer[innerIndex * 4 + row]! *
          inner[column * 4 + innerIndex]!;
      }
    }
  }
  return result;
}

function inverseRigid(matrix: Matrix): number[] {
  const output = [
    matrix[0]!, matrix[4]!, matrix[8]!, 0,
    matrix[1]!, matrix[5]!, matrix[9]!, 0,
    matrix[2]!, matrix[6]!, matrix[10]!, 0,
    0, 0, 0, 1,
  ];
  const origin: [number, number, number] = [
    matrix[12]!,
    matrix[13]!,
    matrix[14]!,
  ];
  const translated = transformPoint(output, [
    -origin[0],
    -origin[1],
    -origin[2],
  ]);
  output[12] = translated[0];
  output[13] = translated[1];
  output[14] = translated[2];
  return output;
}

function boxFromExtents(extents: Extents): Box | null {
  return extents.valid
    ? [
        extents.minimum[0],
        extents.minimum[1],
        extents.minimum[2],
        extents.maximum[0],
        extents.maximum[1],
        extents.maximum[2],
      ]
    : null;
}

function transformedBox(box: Box, matrix: Matrix): Box {
  const output: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const x of [box[0], box[3]]) {
    for (const y of [box[1], box[4]]) {
      for (const z of [box[2], box[5]]) {
        const point = transformPoint(matrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis += 1) {
          output[axis] = Math.min(output[axis]!, point[axis]!);
          output[axis + 3] = Math.max(output[axis + 3]!, point[axis]!);
        }
      }
    }
  }
  return output;
}

function boxError(left: Box, right: Box): { centre: number; size: number } {
  let centre = 0;
  let size = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    centre = Math.max(
      centre,
      Math.abs(
        (left[axis]! + left[axis + 3]!) / 2 -
          (right[axis]! + right[axis + 3]!) / 2,
      ),
    );
    size = Math.max(
      size,
      Math.abs(
        (left[axis + 3]! - left[axis]!) -
          (right[axis + 3]! - right[axis]!),
      ),
    );
  }
  return { centre, size };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function maximum(values: readonly number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function errorSummary(values: readonly { centre: number; size: number }[]) {
  const centres = values.map((value) => value.centre);
  const sizes = values.map((value) => value.size);
  return {
    compared: values.length,
    within1e6Feet:
      values.filter((value) => value.centre <= 1e-6 && value.size <= 1e-6).length,
    withinHalfFoot:
      values.filter((value) => value.centre <= 0.5 && value.size <= 0.5).length,
    medianCentreErrorFeet: median(centres),
    medianSizeErrorFeet: median(sizes),
    maximumCentreErrorFeet: maximum(centres),
    maximumSizeErrorFeet: maximum(sizes),
  };
}

const container = CFB.read(readFileSync(paths.rvt), { type: "buffer" });
const basicFileInfo = container.FileIndex
  .map((entry, index) => ({
    entry,
    path: container.FullPaths[index] ?? "",
  }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(
    `audit requires a Revit 2027 file, received ${release ?? "unknown"}`,
  );
}
const records: GArrayRecord[] = [];
const placements = new Map<number, InstancePlacement>();
const localBounds = new Map<number, LocalBounds>();
let chunks = 0;
let failedChunks = 0;
let gArrayCandidates = 0;
let failedGArrayBodies = 0;

for (let entryIndex = 0; entryIndex < container.FileIndex.length; entryIndex += 1) {
  const path = container.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(
    asBytes(container.FileIndex[entryIndex]!.content),
  );
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
    for (const frame of scanFramedElementObjects(inflated)) {
      const local = readLocalBounds(inflated, frame) ??
        readLocalShape(inflated, frame);
      if (local) localBounds.set(local.elementId, local);
      const placement = readInstancePlacement(inflated, frame);
      if (placement && !placements.has(placement.elementId)) {
        placements.set(placement.elementId, placement);
      }
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const decodedRoot = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        release,
      );
      if (!decodedRoot.ok) continue;
      const root = decodedRoot.value;
      if (
        root.children.length !== 1 ||
        root.children[0]?.sourceClassSlot !==
          REVIT_2027_GARRAY_SOURCE_CLASS_SLOT
      ) continue;
      gArrayCandidates += 1;
      const decodedArray = decodeRevit2027GArray(
        inflated,
        root.dynamicPayloadOffset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decodedArray.ok) {
        failedGArrayBodies += 1;
        continue;
      }
      records.push({
        ownerElementId: Number(root.ownerElementId),
        localExtents: root.localExtents,
        worldExtents: root.worldExtents,
        gArray: decodedArray.value,
      });
    }
  }
}

const manifest = JSON.parse(readFileSync(paths.json, "utf8")) as {
  elementManifest: { elements: ManifestElement[] };
};
const manifestById = new Map(
  manifest.elementManifest.elements.map((element) => [
    element.elementId,
    element,
  ]),
);
const truth = await readTruthBoxes(paths.ifc);
const placementsByGeometry = new Map<number, InstancePlacement[]>();
for (const placement of placements.values()) {
  const values = placementsByGeometry.get(placement.geometryId) ?? [];
  values.push(placement);
  placementsByGeometry.set(placement.geometryId, values);
}

const uniqueOwners = new Set(records.map((record) => record.ownerElementId));
const uniqueTags = new Set(
  records
    .map((record) => Number(record.gArray.tagElementId))
    .filter((value) => Number.isSafeInteger(value) && value > 0),
);
const ownerMultiplicity = new Map<number, number>();
for (const record of records) {
  ownerMultiplicity.set(
    record.ownerElementId,
    (ownerMultiplicity.get(record.ownerElementId) ?? 0) + 1,
  );
}

const localToWorldErrors: Array<{ centre: number; size: number }> = [];
const localToManifestErrors: Array<{ centre: number; size: number }> = [];
const worldToManifestErrors: Array<{ centre: number; size: number }> = [];
const localToIfcErrors: Array<{ centre: number; size: number }> = [];
const worldToIfcErrors: Array<{ centre: number; size: number }> = [];
const composedPlacementToIfcErrors: Array<{ centre: number; size: number }> = [];
const currentPlacementToManifestErrors: Array<{ centre: number; size: number }> = [];
const gArrayPlacementToManifestErrors: Array<{ centre: number; size: number }> = [];
const currentPlacementToIfcErrors: Array<{ centre: number; size: number }> = [];
const gArrayPlacementToIfcErrors: Array<{ centre: number; size: number }> = [];
const currentThenGArrayToIfcErrors: Array<{ centre: number; size: number }> = [];
const gArrayThenCurrentToIfcErrors: Array<{ centre: number; size: number }> = [];
let validExtents = 0;
let identityTransforms = 0;
let ownerPlacementElements = 0;
let ownersUsedAsSharedGeometry = 0;
let placementsUsingOwners = 0;
let exactPlacementTransformMatches = 0;
let inversePlacementTransformMatches = 0;
let placementsWithSharedBounds = 0;
let differingPlacementsWithSharedBounds = 0;
let gArrayImprovesManifestCentre = 0;
let gArrayImprovesIfcCentre = 0;
let currentImprovesManifestCentre = 0;
let currentImprovesIfcCentre = 0;

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
for (const record of records) {
  const local = boxFromExtents(record.localExtents);
  const world = boxFromExtents(record.worldExtents);
  if (local && world) {
    validExtents += 1;
    localToWorldErrors.push(
      boxError(
        transformedBox(local, record.gArray.stepTransform.matrix),
        world,
      ),
    );
  }
  const isIdentity = identity.every(
    (value, index) =>
      Math.abs(
        value -
          [
            ...record.gArray.stepTransform.xAxis,
            ...record.gArray.stepTransform.yAxis,
            ...record.gArray.stepTransform.zAxis,
            ...record.gArray.stepTransform.origin,
          ][index]!,
      ) <= 1e-12,
  );
  if (isIdentity) identityTransforms += 1;

  const ownerPlacement = placements.get(record.ownerElementId);
  if (ownerPlacement) {
    ownerPlacementElements += 1;
    if (
      placementMatrix(ownerPlacement).every(
        (value, index) =>
          Math.abs(value - record.gArray.stepTransform.matrix[index]!) <= 1e-12,
      )
    ) {
      exactPlacementTransformMatches += 1;
    }
    if (
      placementMatrix(ownerPlacement).every(
        (value, index) =>
          Math.abs(
            value -
              inverseRigid(record.gArray.stepTransform.matrix)[index]!,
          ) <= 1e-12,
      )
    ) {
      inversePlacementTransformMatches += 1;
    }
    const shape = localBounds.get(ownerPlacement.geometryId);
    if (shape) {
      placementsWithSharedBounds += 1;
      const shapeBox: Box = [
        shape.min[0], shape.min[1], shape.min[2],
        shape.max[0], shape.max[1], shape.max[2],
      ];
      const currentBox = transformedBox(
        shapeBox,
        placementMatrix(ownerPlacement),
      );
      const gArrayBox = transformedBox(
        shapeBox,
        record.gArray.stepTransform.matrix,
      );
      const transformsDiffer = placementMatrix(ownerPlacement).some(
        (value, index) =>
          Math.abs(value - record.gArray.stepTransform.matrix[index]!) > 1e-12,
      );
      if (transformsDiffer) differingPlacementsWithSharedBounds += 1;
      const manifestBounds =
        manifestById.get(record.ownerElementId)?.geometry?.boundsFeet;
      if (manifestBounds) {
        const manifestBox: Box = [
          manifestBounds.min.x, manifestBounds.min.y, manifestBounds.min.z,
          manifestBounds.max.x, manifestBounds.max.y, manifestBounds.max.z,
        ];
        const currentError = boxError(currentBox, manifestBox);
        const gArrayError = boxError(gArrayBox, manifestBox);
        currentPlacementToManifestErrors.push(currentError);
        gArrayPlacementToManifestErrors.push(gArrayError);
        if (gArrayError.centre + 1e-9 < currentError.centre) {
          gArrayImprovesManifestCentre += 1;
        } else if (currentError.centre + 1e-9 < gArrayError.centre) {
          currentImprovesManifestCentre += 1;
        }
      }
      const ifcBox = truth.get(record.ownerElementId)?.box;
      if (ifcBox) {
        const currentError = boxError(currentBox, ifcBox);
        const gArrayError = boxError(gArrayBox, ifcBox);
        currentPlacementToIfcErrors.push(currentError);
        gArrayPlacementToIfcErrors.push(gArrayError);
        if (transformsDiffer) {
          currentThenGArrayToIfcErrors.push(
            boxError(
              transformedBox(
                shapeBox,
                multiply(
                  placementMatrix(ownerPlacement),
                  record.gArray.stepTransform.matrix,
                ),
              ),
              ifcBox,
            ),
          );
          gArrayThenCurrentToIfcErrors.push(
            boxError(
              transformedBox(
                shapeBox,
                multiply(
                  record.gArray.stepTransform.matrix,
                  placementMatrix(ownerPlacement),
                ),
              ),
              ifcBox,
            ),
          );
        }
        if (gArrayError.centre + 1e-9 < currentError.centre) {
          gArrayImprovesIfcCentre += 1;
        } else if (currentError.centre + 1e-9 < gArrayError.centre) {
          currentImprovesIfcCentre += 1;
        }
      }
    }
  }
  const usingOwner = placementsByGeometry.get(record.ownerElementId) ?? [];
  if (usingOwner.length) {
    ownersUsedAsSharedGeometry += 1;
    placementsUsingOwners += usingOwner.length;
  }

  const manifestBounds = manifestById.get(record.ownerElementId)?.geometry?.boundsFeet;
  const manifestBox: Box | null = manifestBounds
    ? [
        manifestBounds.min.x,
        manifestBounds.min.y,
        manifestBounds.min.z,
        manifestBounds.max.x,
        manifestBounds.max.y,
        manifestBounds.max.z,
      ]
    : null;
  const ifcBox = truth.get(record.ownerElementId)?.box;
  if (manifestBox && local) {
    localToManifestErrors.push(
      boxError(
        transformedBox(local, record.gArray.stepTransform.matrix),
        manifestBox,
      ),
    );
  }
  if (manifestBox && world) worldToManifestErrors.push(boxError(world, manifestBox));
  if (ifcBox && local) {
    localToIfcErrors.push(
      boxError(
        transformedBox(local, record.gArray.stepTransform.matrix),
        ifcBox,
      ),
    );
  }
  if (ifcBox && world) worldToIfcErrors.push(boxError(world, ifcBox));

  if (local) {
    for (const placement of usingOwner) {
      const placedIfc = truth.get(placement.elementId)?.box;
      if (!placedIfc) continue;
      composedPlacementToIfcErrors.push(
        boxError(
          transformedBox(
            local,
            multiply(
              placementMatrix(placement),
              record.gArray.stepTransform.matrix,
            ),
          ),
          placedIfc,
        ),
      );
    }
  }
}

console.log(JSON.stringify({
  paths,
  release,
  scope: {
    ifcUse: "audit-only geometry boxes",
    jsonUse: "audit-only current manifest boxes and geometry-source joins",
    rvtOwnership:
      "GRep owner id must equal its independently framed element id",
  },
  scan: {
    chunks,
    failedChunks,
    gArrayCandidates,
    failedGArrayBodies,
    exactGArrayBodies: records.length,
    uniqueOwners: uniqueOwners.size,
    uniquePositiveTagElementIds: uniqueTags.size,
    ownersWithMultipleBodies:
      [...ownerMultiplicity.values()].filter((count) => count > 1).length,
    maximumBodiesPerOwner: Math.max(...ownerMultiplicity.values()),
    validLocalAndWorldExtents: validExtents,
    identityTransforms,
  },
  joins: {
    ownersInCurrentManifest:
      [...uniqueOwners].filter((id) => manifestById.has(id)).length,
    ownersInIfc:
      [...uniqueOwners].filter((id) => truth.has(id)).length,
    tagElementIdsInCurrentManifest:
      [...uniqueTags].filter((id) => manifestById.has(id)).length,
    tagElementIdsInIfc:
      [...uniqueTags].filter((id) => truth.has(id)).length,
    ownerPlacementElements,
    exactPlacementTransformMatches,
    inversePlacementTransformMatches,
    ownersUsedAsSharedGeometry,
    placementsUsingOwners,
    placementsWithSharedBounds,
    differingPlacementsWithSharedBounds,
    gArrayImprovesManifestCentre,
    currentImprovesManifestCentre,
    gArrayImprovesIfcCentre,
    currentImprovesIfcCentre,
  },
  extentsComparisons: {
    gArrayLocalThroughStepTransformToRootWorld:
      errorSummary(localToWorldErrors),
    gArrayLocalThroughStepTransformToCurrentManifest:
      errorSummary(localToManifestErrors),
    rootWorldToCurrentManifest: errorSummary(worldToManifestErrors),
    gArrayLocalThroughStepTransformToIfc: errorSummary(localToIfcErrors),
    rootWorldToIfc: errorSummary(worldToIfcErrors),
    placementTimesGArrayLocalToPlacedIfc:
      errorSummary(composedPlacementToIfcErrors),
    currentPlacementTimesSharedBoundsToManifest:
      errorSummary(currentPlacementToManifestErrors),
    gArrayTimesSharedBoundsToManifest:
      errorSummary(gArrayPlacementToManifestErrors),
    currentPlacementTimesSharedBoundsToIfc:
      errorSummary(currentPlacementToIfcErrors),
    gArrayTimesSharedBoundsToIfc:
      errorSummary(gArrayPlacementToIfcErrors),
    currentThenGArrayTimesSharedBoundsToIfcForDifferingTransforms:
      errorSummary(currentThenGArrayToIfcErrors),
    gArrayThenCurrentTimesSharedBoundsToIfcForDifferingTransforms:
      errorSummary(gArrayThenCurrentToIfcErrors),
  },
}, null, 2));
