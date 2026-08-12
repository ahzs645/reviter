/**
 * Certify the Revit 2027 `GFilling` schema and inventory every exact-model
 * foreground-filling descriptor reached by the Face audit.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-gfilling.ts model.rvt
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import {
  countsByFrequency,
  decodeSchemaFields,
  increment,
  requireNameOffset,
} from "./lib/rvt-harness.ts";

import { revitVersionFromBasicFileInfo } from "../lib/reviter/basic-file-info.ts";
import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
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
  REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
  REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
  REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT,
  REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT,
  decodeRevit2027AnalyticSurface,
  decodeRevit2027EdgeLoopStatic,
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  decodeRevit2027FaceStatic,
  decodeRevit2027FillGrid,
  decodeRevit2027FillPatternData,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GEdgeStatic,
  decodeRevit2027GFilling,
  decodeRevit2027GGroupStatic,
  decodeRevit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error("usage: audit-revit-2027-gfilling.ts model.rvt");
}

const EXPECTED_GFILLING_DESCRIPTORS = 35_413;
const EXPECTED_PRIMARY_FACE_CHILDREN = 116_844;
const EXPECTED_LOOP_BODIES = 40_470;
const EXPECTED_SURFACE_BODIES = 40_961;
const SOURCE_LADDER = [
  [2250, "GFakeBRep"],
  [2251, "GFillColorOverrider"],
  [2252, "GFillPatternOverrider"],
  [2253, "GFilling"],
  [2254, "GFilter"],
  [2255, "GFlipControl"],
] as const;

function firstInflatedSchema(
  cfb: ReturnType<typeof CFB.read>,
): Uint8Array {
  const item = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && /\/Formats\/Latest$/i.test(path));
  if (!item) throw new Error("RVT has no readable Formats/Latest stream");
  const stored = stripRevitPageChecksums(asBytes(item.entry.content));
  const offset = gzipOffsets(stored, 1)[0];
  if (offset == null) throw new Error("Formats/Latest has no gzip member");
  const inflated = inflateRevitChunk(stored, offset);
  if (!inflated) throw new Error("Formats/Latest gzip member did not inflate");
  return inflated;
}

function requireTokens(
  queue: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  let expectedToken = firstToken;
  for (const entry of queue) {
    if (entry.sourceClassSlot == null || entry.token === 0) {
      return "FIFO append list contains a null property";
    }
    if (entry.token === -1) continue;
    if (entry.token < -1) {
      return `FIFO append list contains unproven sentinel ${entry.token}`;
    }
    if (entry.token !== expectedToken) {
      return (
        `FIFO token mismatch: expected ${expectedToken}, ` +
        `received ${entry.token} for source slot ${entry.sourceClassSlot}`
      );
    }
    expectedToken += 1;
  }
  return null;
}

function numberedPropertyCount(
  queue: readonly CondInt16QueueEntry[],
): number {
  return queue.reduce(
    (count, entry) => count + (entry.token > 0 ? 1 : 0),
    0,
  );
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const schema = firstInflatedSchema(cfb);
let ladderCursor = 0;
const sourceLadder = SOURCE_LADDER.map(([sourceClassSlot, name]) => {
  const offset = requireNameOffset(schema, name, ladderCursor);
  ladderCursor = offset + 2 + name.length;
  return { sourceClassSlot, name, offset };
});

const view = new DataView(schema.buffer, schema.byteOffset, schema.byteLength);
const gFilling = sourceLadder.find(
  ({ sourceClassSlot }) =>
    sourceClassSlot === REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
)!;
let cursor = gFilling.offset + 2 + gFilling.name.length;
const rawGNodeClassId = view.getUint16(cursor, true);
const version = view.getUint32(cursor + 2, true);
const fieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const gFillingFields = decodeSchemaFields(schema, cursor, [
  ["m_pGFace", [0x0e, 0x03, 0x00, 0x00]],
  ["m_placer", [0x0e, 0x00, 0x00, 0x00, 0x2d, 0x08]],
  ["m_data", [0x0e, 0x01, 0x00, 0x00]],
  ["m_patternId", [0x0e, 0x00, 0x00, 0x00, 0x14, 0x00]],
  ["m_fillColor", [0x05, 0x00, 0x00, 0x00]],
  ["m_flags", [0x04, 0x00, 0x00, 0x00]],
]);

const placerOffset = requireNameOffset(schema, "FillPatternPlacer");
let placerCursor = placerOffset + 2 + "FillPatternPlacer".length;
const placerRawClassId = view.getUint16(placerCursor, true);
const placerVersion = view.getUint32(placerCursor + 2, true);
const placerFieldCount = view.getUint32(placerCursor + 6, true);
placerCursor += 10;
const placerFields = decodeSchemaFields(schema, placerCursor, [
  ["m_scale", [0x07, 0x00, 0x00, 0x00]],
  ["m_origin", [0x07, 0x10, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]],
  ["m_dir", [0x07, 0x10, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]],
  ["m_uvScale", [0x0e, 0x00, 0x00, 0x00, 0xf8, 0x00]],
  ["m_isMirrored", [0x01, 0x00, 0x00, 0x00]],
  ["m_placedDraft", [0x01, 0x00, 0x00, 0x00]],
]);

if (
  rawGNodeClassId !== 0x0592 ||
  version !== 6 ||
  fieldCount !== 6 ||
  placerRawClassId !== 0 ||
  placerVersion !== 3 ||
  placerFieldCount !== 6
) {
  throw new Error("GFilling or FillPatternPlacer schema header changed");
}

const faceAuditPath = fileURLToPath(
  new URL("./audit-revit-2027-face-static.ts", import.meta.url),
);
const faceAudit = spawnSync(
  process.execPath,
  ["--experimental-strip-types", faceAuditPath, modelPath],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
if (faceAudit.status !== 0) {
  throw new Error(faceAudit.stderr || "Face audit failed");
}
const faceReport = JSON.parse(faceAudit.stdout) as {
  release: number;
  faces: { declared: number; decoded: number };
  queueOwnership: {
    childSourceClassSlots: Record<string, number>;
    childTokenKinds: Record<string, number>;
  };
  failures: Record<string, number>;
};
const descriptorCount =
  faceReport.queueOwnership.childSourceClassSlots[
    String(REVIT_2027_GFILLING_SOURCE_CLASS_SLOT)
  ] ?? 0;
const numberedCount =
  faceReport.queueOwnership.childTokenKinds[
    `${REVIT_2027_GFILLING_SOURCE_CLASS_SLOT}:numbered`
  ] ?? 0;
if (
  descriptorCount !== EXPECTED_GFILLING_DESCRIPTORS ||
  numberedCount !== descriptorCount
) {
  throw new Error("exact model GFilling descriptor inventory changed");
}

const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/BasicFileInfo$/i.test(path));
if (!basicFileInfo) throw new Error("RVT has no BasicFileInfo stream");
const release = revitVersionFromBasicFileInfo(
  asBytes(basicFileInfo.entry.content),
);
if (release !== 2027) {
  throw new Error(
    `exact body replay requires Revit 2027, received ${release ?? "unknown"}`,
  );
}
const exactRelease: 2027 = release;

let chunks = 0;
let failedChunks = 0;
let decodedOwners = 0;
let decodedFaces = 0;
let decodedEdges = 0;
let decodedPrimaryChildren = 0;
let decodedLoops = 0;
let decodedFillings = 0;
let decodedSurfaces = 0;
let decodedFillPatternData = 0;
let decodedFillGrids = 0;
let nextGenerationDescriptors = 0;
let minimumPlacerScale = Number.POSITIVE_INFINITY;
let maximumPlacerScale = Number.NEGATIVE_INFINITY;
const primaryChildSlots = new Map<number, number>();
const bodyBytes = new Map<number, number>();
const dataSlots = new Map<number, number>();
const dataTokenKinds = new Map<string, number>();
const patternElementIds = new Map<string, number>();
const fillColors = new Map<string, number>();
const fillingFlags = new Map<number, number>();
const faceIdReferences = new Map<number, number>();
const placerFlags = new Map<string, number>();
const nextGenerationSlots = new Map<number, number>();
const nextGenerationTokenKinds = new Map<string, number>();
const replayFailures = new Map<string, number>();
const fillPatternDataBodyBytes = new Map<number, number>();
const fillPatternDataGridCounts = new Map<number, number>();
const fillPatternGridSlots = new Map<number, number>();
const fillPatternGridTokenKinds = new Map<string, number>();
const fillPatternScalarRanges = {
  windowSize: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  lengthPerArea: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  strokesPerArea: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  linesPerLength: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
};
const fillGridBodyBytes = new Map<number, number>();
const fillGridSegmentCounts = new Map<number, number>();
const fillGridScalarRanges = {
  angle: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  originX: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  originY: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  delta0: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  delta1: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  segment: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
};

function includeRange(range: number[], value: number): void {
  range[0] = Math.min(range[0]!, value);
  range[1] = Math.max(range[1]!, value);
}
type ReplayContext = {
  elementId: number;
  frameOffset: number;
  chunkIndex: number;
  partitionPath: string;
};
type FailureSample = ReplayContext & {
  error: string;
  bodyOffset: number;
  faceChildIndex: number;
  sourceClassSlot: number;
  token: number;
  previousFaceChild:
    | { sourceClassSlot: number | null; token: number }
    | null;
  expectedNextPositiveToken: number;
  rawBeforeHex: string;
  rawFromBodyHex: string;
  details?: unknown;
};
const failureSamples: FailureSample[] = [];

function hex(data: Uint8Array, start: number, end: number): string {
  return [...data.subarray(Math.max(0, start), Math.min(data.byteLength, end))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

function recordFailureSample(
  error: string,
  data: Uint8Array,
  bodyOffset: number,
  faceChildIndex: number,
  descriptor: CondInt16QueueEntry,
  previous: CondInt16QueueEntry | null,
  expectedNextPositiveToken: number,
  context: ReplayContext,
  details?: unknown,
): void {
  increment(replayFailures, error);
  if (failureSamples.length >= 64) return;
  failureSamples.push({
    ...context,
    error,
    bodyOffset,
    faceChildIndex,
    sourceClassSlot: descriptor.sourceClassSlot!,
    token: descriptor.token,
    previousFaceChild: previous
      ? {
          sourceClassSlot: previous.sourceClassSlot,
          token: previous.token,
        }
      : null,
    expectedNextPositiveToken,
    rawBeforeHex: hex(data, bodyOffset - 32, bodyOffset),
    rawFromBodyHex: hex(data, bodyOffset, bodyOffset + 128),
    details,
  });
}

function recordNextGeneration(
  queue: readonly CondInt16QueueEntry[],
): void {
  for (const entry of queue) {
    nextGenerationDescriptors += 1;
    increment(nextGenerationSlots, entry.sourceClassSlot!);
    increment(
      nextGenerationTokenKinds,
      `${entry.sourceClassSlot}:${
        entry.token === -1 ? "sentinel" : "numbered"
      }`,
    );
  }
}

function replaySingleGeometryOwner(
  data: Uint8Array,
  root: {
    children: readonly CondInt16QueueEntry[];
    dynamicPayloadOffset: number;
    dynamicPayloadEndOffset: number;
  },
  context: ReplayContext,
): void {
  let geometryOffset: number | null = null;
  let firstGeometryAppendToken = 0;
  if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
  ) {
    const tokenError = requireTokens(root.children, 3);
    if (tokenError) {
      increment(replayFailures, `direct root: ${tokenError}`);
      return;
    }
    geometryOffset = root.dynamicPayloadOffset;
    firstGeometryAppendToken = 4;
  } else if (
    root.children.length === 1 &&
    root.children[0]?.sourceClassSlot ===
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
  ) {
    const rootTokenError = requireTokens(root.children, 3);
    if (rootTokenError) {
      increment(replayFailures, `single group root: ${rootTokenError}`);
      return;
    }
    const group = decodeRevit2027GGroupStatic(
      data,
      root.dynamicPayloadOffset,
      root.dynamicPayloadEndOffset,
      exactRelease,
    );
    if (
      !group.ok ||
      group.value.children.length !== 1 ||
      group.value.children[0]?.sourceClassSlot !==
        REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      return;
    }
    const groupTokenError = requireTokens(group.value.children, 4);
    if (groupTokenError) {
      increment(replayFailures, `single group child: ${groupTokenError}`);
      return;
    }
    geometryOffset = group.value.endOffset;
    firstGeometryAppendToken = 5;
  }
  if (geometryOffset == null) return;

  const geometry = decodeRevit2027GeometryStatic(
    data,
    geometryOffset,
    root.dynamicPayloadEndOffset,
    exactRelease,
  );
  if (!geometry.ok) {
    increment(replayFailures, geometry.error);
    return;
  }
  const geometryTokenError = requireTokens(
    geometry.value.queuedProperties,
    firstGeometryAppendToken,
  );
  if (geometryTokenError) {
    increment(replayFailures, geometryTokenError);
    return;
  }
  if (
    geometry.value.faces.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    ) ||
    geometry.value.edges.entries.some(
      (entry) =>
        entry.sourceClassSlot !== REVIT_2027_GEDGE_SOURCE_CLASS_SLOT,
    ) ||
    geometry.value.sharedSurfaceInfo.count !== 0
  ) {
    increment(
      replayFailures,
      "Geometry child source slot or shared-surface collection changed",
    );
    return;
  }

  let cursor = geometry.value.endOffset;
  let nextAppendToken =
    firstGeometryAppendToken +
    numberedPropertyCount(geometry.value.queuedProperties);
  const faceChildren: CondInt16QueueEntry[] = [];
  for (let index = 0; index < geometry.value.faces.count; index += 1) {
    const face = decodeRevit2027FaceStatic(
      data,
      cursor,
      root.dynamicPayloadEndOffset,
      exactRelease,
    );
    if (!face.ok) {
      increment(replayFailures, face.error);
      return;
    }
    const tokenError = requireTokens(
      face.value.queuedProperties,
      nextAppendToken,
    );
    if (tokenError) {
      increment(replayFailures, tokenError);
      return;
    }
    nextAppendToken += numberedPropertyCount(face.value.queuedProperties);
    faceChildren.push(...face.value.queuedProperties);
    cursor = face.value.endOffset;
    decodedFaces += 1;
  }

  const seenStaticReferences = new Set<number>();
  const retainStaticReference = (value: number): void => {
    if (value > 0) seenStaticReferences.add(value);
  };
  for (let index = 0; index < geometry.value.edges.count; index += 1) {
    const edge = decodeRevit2027GEdgeStatic(
      data,
      cursor,
      root.dynamicPayloadEndOffset,
      exactRelease,
    );
    if (!edge.ok) {
      increment(replayFailures, edge.error);
      return;
    }
    cursor = edge.value.endOffset;
    decodedEdges += 1;
    for (const value of [
      ...edge.value.faceReferences,
      ...edge.value.nextReferences,
      ...edge.value.previousReferences,
    ]) {
      retainStaticReference(value);
    }
  }

  let lastDecodedBody:
    | {
        sourceClassSlot: number;
        token: number;
        startOffset: number;
        endOffset: number;
        queuedProperties: readonly CondInt16QueueEntry[];
        details?: unknown;
      }
    | null = null;
  const descendantQueue: CondInt16QueueEntry[] = [];
  for (
    let faceChildIndex = 0;
    faceChildIndex < faceChildren.length;
    faceChildIndex += 1
  ) {
    const descriptor = faceChildren[faceChildIndex]!;
    const previousDescriptor =
      faceChildIndex === 0 ? null : faceChildren[faceChildIndex - 1]!;
    const sourceClassSlot = descriptor.sourceClassSlot!;
    increment(primaryChildSlots, sourceClassSlot);
    const startOffset = cursor;
    let queuedProperties: readonly CondInt16QueueEntry[] = [];
    let decodedDetails: unknown;

    if (sourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) {
      const loop = decodeRevit2027EdgeLoopStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!loop.ok) {
        recordFailureSample(
          loop.error,
          data,
          cursor,
          faceChildIndex,
          descriptor,
          previousDescriptor,
          nextAppendToken,
          context,
          {
            descriptor,
            lastDecodedBody,
            nextFourAsInt32:
              cursor <= data.byteLength - 4
                ? new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getInt32(cursor, true)
                : null,
          },
        );
        return;
      }
      cursor = loop.value.endOffset;
      queuedProperties = loop.value.queuedProperties;
      const staticReferences = [
        loop.value.faceReference,
        loop.value.nextEdgeReference,
        loop.value.previousEdgeReference,
      ];
      const newStaticReferences = staticReferences.filter(
        (value, index) =>
          value > 0 &&
          staticReferences.indexOf(value) === index &&
          !seenStaticReferences.has(value),
      );
      decodedDetails = {
        staticReferences,
        previouslySeen: staticReferences.map((value) => ({
          value,
          seen: value <= 0 || seenStaticReferences.has(value),
        })),
        newStaticReferences,
      };
      for (const value of staticReferences) retainStaticReference(value);
      decodedLoops += 1;
    } else if (
      sourceClassSlot === REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
    ) {
      const loopRef = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!loopRef.ok) {
        recordFailureSample(
          loopRef.error,
          data,
          cursor,
          faceChildIndex,
          descriptor,
          previousDescriptor,
          nextAppendToken,
          context,
          {
            descriptor,
            lastDecodedBody,
            duplicatePrimaryDescriptors: faceChildren
              .filter(({ token }) => token === descriptor.token)
              .map(({ token, sourceClassSlot }) => ({
                token,
                sourceClassSlot,
              })),
            decodedCountAtBodyStart:
              cursor <= data.byteLength - 4
                ? new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getInt32(cursor, true)
                : null,
            decodedGInfo: cursor <= data.byteLength - 24
              ? {
                  gStyleElementId: new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getBigInt64(cursor, true).toString(),
                  tag: new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getInt32(cursor + 8, true),
                  controlCommand: new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getInt32(cursor + 12, true),
                  flags: new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getUint32(cursor + 16, true),
                  countAfterGInfo: new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  ).getInt32(cursor + 20, true),
                }
              : null,
          },
        );
        return;
      }
      cursor = loopRef.value.endOffset;
      decodedDetails = {
        chainEnvelopeCount: loopRef.value.chains.length,
      };
      queuedProperties = loopRef.value.queuedProperties;
      decodedLoops += 1;
    } else if (sourceClassSlot === REVIT_2027_GFILLING_SOURCE_CLASS_SLOT) {
      const filling = decodeRevit2027GFilling(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!filling.ok) {
        increment(replayFailures, filling.error);
        return;
      }
      cursor = filling.value.endOffset;
      queuedProperties = filling.value.queuedProperties;
      const faceReferenceWasSeen =
        filling.value.faceIdReference <= 0 ||
        seenStaticReferences.has(filling.value.faceIdReference);
      decodedDetails = {
        faceIdReference: filling.value.faceIdReference,
        faceReferenceWasSeen,
      };
      retainStaticReference(filling.value.faceIdReference);
      decodedFillings += 1;
      minimumPlacerScale = Math.min(
        minimumPlacerScale,
        filling.value.placer.scale,
      );
      maximumPlacerScale = Math.max(
        maximumPlacerScale,
        filling.value.placer.scale,
      );
      increment(
        patternElementIds,
        filling.value.patternElementId.toString(),
      );
      increment(
        fillColors,
        `0x${filling.value.fillColor.toString(16).padStart(8, "0")}`,
      );
      increment(fillingFlags, filling.value.flags);
      increment(faceIdReferences, filling.value.faceIdReference);
      increment(
        placerFlags,
        `mirrored=${filling.value.placer.mirrored},` +
          `placedDraft=${filling.value.placer.placedDraft}`,
      );
      if (filling.value.data.sourceClassSlot != null) {
        increment(dataSlots, filling.value.data.sourceClassSlot);
        increment(
          dataTokenKinds,
          filling.value.data.token === -1 ? "sentinel" : "numbered",
        );
      } else {
        increment(dataTokenKinds, "null");
      }
    } else if (
      sourceClassSlot === REVIT_2027_PLANE_SURFACE_SOURCE_CLASS_SLOT ||
      sourceClassSlot === REVIT_2027_CONE_SURFACE_SOURCE_CLASS_SLOT ||
      sourceClassSlot === REVIT_2027_CYLINDER_SURFACE_SOURCE_CLASS_SLOT ||
      sourceClassSlot ===
        REVIT_2027_SURFACE_OF_REVOLUTION_SOURCE_CLASS_SLOT
    ) {
      const surface = decodeRevit2027AnalyticSurface(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
        sourceClassSlot,
      );
      if (!surface.ok) {
        increment(replayFailures, surface.error);
        return;
      }
      cursor = surface.value.endOffset;
      queuedProperties = surface.value.queuedProperties;
      decodedDetails = {
        kind: surface.value.kind,
        queuedProperties,
      };
      decodedSurfaces += 1;
    } else {
      increment(
        replayFailures,
        `no first-generation Face child reader for slot ${sourceClassSlot}`,
      );
      return;
    }

    const tokenError = requireTokens(queuedProperties, nextAppendToken);
    if (tokenError) {
      recordFailureSample(
        tokenError,
        data,
        startOffset,
        faceChildIndex,
        descriptor,
        previousDescriptor,
        nextAppendToken,
        context,
        {
          descriptor,
          decodedBodyBytes: cursor - startOffset,
          queuedProperties,
          decodedDetails,
          lastDecodedBody,
          precedingPrimaryTokenKinds: faceChildren
            .slice(Math.max(0, faceChildIndex - 4), faceChildIndex)
            .map(({ token, sourceClassSlot }) => ({
              token,
              sourceClassSlot,
            })),
        },
      );
      return;
    }
    nextAppendToken += numberedPropertyCount(queuedProperties);
    recordNextGeneration(queuedProperties);
    descendantQueue.push(...queuedProperties);
    decodedPrimaryChildren += 1;
    increment(bodyBytes, cursor - startOffset);
    lastDecodedBody = {
      sourceClassSlot,
      token: descriptor.token,
      startOffset,
      endOffset: cursor,
      queuedProperties,
      details: decodedDetails,
    };
  }

  for (
    let descendantIndex = 0;
    descendantIndex < descendantQueue.length;
    descendantIndex += 1
  ) {
    const descriptor = descendantQueue[descendantIndex]!;
    let queuedProperties: readonly CondInt16QueueEntry[] = [];
    const startOffset = cursor;
    if (
      descriptor.sourceClassSlot === REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT
    ) {
      const loop = decodeRevit2027EdgeLoopStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!loop.ok) {
        increment(replayFailures, `descendant: ${loop.error}`);
        return;
      }
      cursor = loop.value.endOffset;
      queuedProperties = loop.value.queuedProperties;
    } else if (
      descriptor.sourceClassSlot ===
      REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT
    ) {
      const loop = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!loop.ok) {
        increment(replayFailures, `descendant: ${loop.error}`);
        return;
      }
      cursor = loop.value.endOffset;
      queuedProperties = loop.value.queuedProperties;
    } else if (
      descriptor.sourceClassSlot ===
      REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT
    ) {
      const patternData = decodeRevit2027FillPatternData(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!patternData.ok) {
        increment(replayFailures, patternData.error);
        return;
      }
      cursor = patternData.value.endOffset;
      queuedProperties = patternData.value.queuedProperties;
      decodedFillPatternData += 1;
      increment(fillPatternDataBodyBytes, cursor - startOffset);
      increment(
        fillPatternDataGridCounts,
        patternData.value.fillGrids.length,
      );
      includeRange(
        fillPatternScalarRanges.windowSize,
        patternData.value.windowSize,
      );
      includeRange(
        fillPatternScalarRanges.lengthPerArea,
        patternData.value.lengthPerArea,
      );
      includeRange(
        fillPatternScalarRanges.strokesPerArea,
        patternData.value.strokesPerArea,
      );
      includeRange(
        fillPatternScalarRanges.linesPerLength,
        patternData.value.linesPerLength,
      );
      for (const grid of patternData.value.fillGrids) {
        if (grid.sourceClassSlot != null) {
          increment(fillPatternGridSlots, grid.sourceClassSlot);
        }
        increment(
          fillPatternGridTokenKinds,
          grid.token === 0
            ? "null"
            : grid.token === -1
              ? "sentinel"
              : "numbered",
        );
      }
    } else if (
      descriptor.sourceClassSlot ===
      REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT
    ) {
      const grid = decodeRevit2027FillGrid(
        data,
        cursor,
        root.dynamicPayloadEndOffset,
        exactRelease,
      );
      if (!grid.ok) {
        increment(replayFailures, grid.error);
        return;
      }
      cursor = grid.value.endOffset;
      decodedFillGrids += 1;
      increment(fillGridBodyBytes, cursor - startOffset);
      increment(fillGridSegmentCounts, grid.value.segments.length);
      includeRange(fillGridScalarRanges.angle, grid.value.angle);
      includeRange(fillGridScalarRanges.originX, grid.value.origin[0]);
      includeRange(fillGridScalarRanges.originY, grid.value.origin[1]);
      includeRange(fillGridScalarRanges.delta0, grid.value.deltas[0]);
      includeRange(fillGridScalarRanges.delta1, grid.value.deltas[1]);
      for (const segment of grid.value.segments) {
        includeRange(fillGridScalarRanges.segment, segment);
      }
    } else {
      increment(
        replayFailures,
        `no descendant reader for slot ${descriptor.sourceClassSlot}`,
      );
      return;
    }
    if (cursor <= startOffset) {
      increment(replayFailures, "descendant reader did not advance");
      return;
    }
    recordNextGeneration(queuedProperties);
    descendantQueue.push(...queuedProperties);
  }
  decodedOwners += 1;
}

const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );
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
      const decodedRoot = decodeRevit2027FramedGRepRoot(
        inflated,
        frame,
        exactRelease,
      );
      if (!decodedRoot.ok) continue;
      replaySingleGeometryOwner(inflated, decodedRoot.value, {
        elementId: frame.elementId,
        frameOffset: frame.offset,
        chunkIndex,
        partitionPath: partition.path,
      });
    }
  }
}

const exactBodyCounts =
  decodedOwners === 5_996 &&
  decodedFaces === 40_961 &&
  decodedEdges === 84_499 &&
  decodedPrimaryChildren === EXPECTED_PRIMARY_FACE_CHILDREN &&
  decodedLoops === EXPECTED_LOOP_BODIES &&
  decodedFillings === EXPECTED_GFILLING_DESCRIPTORS &&
  decodedSurfaces === EXPECTED_SURFACE_BODIES &&
  replayFailures.size === 0;
if (!exactBodyCounts) {
  throw new Error(
    `exact first-generation Face-child replay changed: ${JSON.stringify({
      chunks,
      failedChunks,
      decodedOwners,
      decodedFaces,
      decodedEdges,
      decodedPrimaryChildren,
      decodedLoops,
      decodedFillings,
      decodedSurfaces,
      decodedFillPatternData,
      decodedFillGrids,
      fillPatternDataBodyBytes: countsByFrequency(fillPatternDataBodyBytes),
      fillPatternDataGridCounts: countsByFrequency(fillPatternDataGridCounts),
      fillPatternGridSlots: countsByFrequency(fillPatternGridSlots),
      fillPatternGridTokenKinds: countsByFrequency(fillPatternGridTokenKinds),
      fillPatternScalarRanges,
      fillGridBodyBytes: countsByFrequency(fillGridBodyBytes),
      fillGridSegmentCounts: countsByFrequency(fillGridSegmentCounts),
      fillGridScalarRanges,
      replayFailures: countsByFrequency(replayFailures),
      failureSamples,
    })}`,
  );
}

console.log(
  JSON.stringify(
    {
      modelPath,
      release: faceReport.release,
      schema: {
        byteLength: schema.byteLength,
        sourceLadder,
        gFilling: {
          sourceClassSlot: REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
          offset: gFilling.offset,
          inheritedRawClassId: "0x0592",
          version,
          fieldCount,
          fields: gFillingFields,
        },
        fillPatternPlacer: {
          offset: placerOffset,
          rawClassId: placerRawClassId,
          version: placerVersion,
          fieldCount: placerFieldCount,
          fields: placerFields,
          bodyBytes: 58,
        },
      },
      faceForegroundFillingDescriptors: {
        declaredFaces: faceReport.faces.declared,
        decodedFaceBodies: faceReport.faces.decoded,
        sourceClassSlot: REVIT_2027_GFILLING_SOURCE_CLASS_SLOT,
        count: descriptorCount,
        numberedCount,
      },
      bodyCoverage: {
        decoded: decodedFillings,
        declared: descriptorCount,
        percent: (decodedFillings * 100) / descriptorCount,
        exactUnbcCountsCertified: exactBodyCounts,
      },
      exactFirstGenerationReplay: {
        chunks,
        failedChunks,
        certifiedOwners: decodedOwners,
        decodedFaces,
        decodedEdges,
        decodedPrimaryChildren,
        primaryChildSlots: countsByFrequency(primaryChildSlots),
        decodedLoops,
        decodedFillings,
        decodedSurfaces,
        decodedFillPatternData,
        decodedFillGrids,
        fillPatternDataBodyBytes: countsByFrequency(fillPatternDataBodyBytes),
        fillPatternDataGridCounts: countsByFrequency(fillPatternDataGridCounts),
        fillPatternGridSlots: countsByFrequency(fillPatternGridSlots),
        fillPatternGridTokenKinds: countsByFrequency(fillPatternGridTokenKinds),
        fillPatternScalarRanges,
        fillGridBodyBytes: countsByFrequency(fillGridBodyBytes),
        fillGridSegmentCounts: countsByFrequency(fillGridSegmentCounts),
        fillGridScalarRanges,
        bodyBytes: countsByFrequency(bodyBytes),
        nextGenerationDescriptors,
        nextGenerationSlots: countsByFrequency(nextGenerationSlots),
        nextGenerationTokenKinds: countsByFrequency(nextGenerationTokenKinds),
        failureSamples,
      },
      fillingValues: {
        bodyBytes: {
          "102": bodyBytes.get(102) ?? 0,
          "104": bodyBytes.get(104) ?? 0,
        },
        dataSourceClassSlots: countsByFrequency(dataSlots),
        dataTokenKinds: countsByFrequency(dataTokenKinds),
        patternElementIds: countsByFrequency(patternElementIds),
        fillColors: countsByFrequency(fillColors),
        flags: countsByFrequency(fillingFlags),
        faceIdReferences: countsByFrequency(faceIdReferences),
        placerFlags: countsByFrequency(placerFlags),
        placerScale: {
          minimum: minimumPlacerScale,
          maximum: maximumPlacerScale,
        },
      },
      nativeProof: {
        reader:
          "TB_Format2026Readers.tx source 2213 GFilling @ 0x10d2630",
        base: "GNode source 1399 @ call 0x10d2a5e",
        faceId:
          "StaticIntegerReader @ 0x10d2b4c; int32 + addIdReference",
        placer:
          "FillPatternPlacer source 2051 @ call 0x10d2bc4; " +
          "scale/origin/direction/uvScale/mirrored/placedDraft",
        data:
          "CondInt16 Data @ 0x10d2cdc; queued FillPatternData property",
        scalars:
          "ElementId @ 0x10d2d4c; uint32 color @ 0x10d2dc9; " +
          "int32 flags @ 0x10d2e17",
      },
      failures: {
        descriptorAudit: faceReport.failures,
        exactBodyReplay: countsByFrequency(replayFailures),
      },
      stopBoundary:
        "after every first-generation Face child; queued next loops, " +
        "FillPatternData, ruled profile curves, exact material binding, " +
        "BRep assembly, and triangles remain",
    },
    null,
    2,
  ),
);
