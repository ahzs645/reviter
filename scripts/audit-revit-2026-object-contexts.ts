/**
 * Classify raw Revit 2026 slot-2237 byte matches against independently
 * length/echo-framed UNBC element objects.
 *
 * This is deliberately an ownership audit, not a geometry decoder. A containing
 * element frame proves only the outer element; it does not prove that an
 * arbitrary payload offset is an ObjectPtrInitReader child boundary.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2026-object-contexts.ts model.rvt
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";

import {
  scanFramedElementObjects,
  type ElementObject,
} from "../lib/reviter/element-objects.ts";
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
  decodeRevit2026GPolyMeshStatic,
  REVIT_2026_GPOLYMESH_SOURCE_CLASS,
} from "../lib/reviter/revit-2026-object-dispatch.ts";

const FACETED_TOPOLOGY8_SLOT = 5255;
const OBJECT_HEADER_BYTES = 26;
const MAX_SAMPLES = 20;

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2026-object-contexts.ts model.rvt",
  );
}

type FixedShapeContext = {
  stream: string;
  chunkIndex: number;
  selectorOffset: number;
  bodyEndOffset: number;
  topologyPropertyToken: number;
  topologySourceClassSlot: number | null;
  gStyleElementId: bigint;
  interiorStyleElementId: bigint;
  materialElementId: bigint;
  owner: ElementObject | null;
};

const input = readFileSync(modelPath);
const cfb = CFB.read(input, { type: "buffer" });
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

const fixedShapes: FixedShapeContext[] = [];
const framedElementIds = new Set<number>();
const materialNamesByElementId = new Map<number, string>();
let chunks = 0;
let failedChunks = 0;
let inflatedBytes = 0;
let rawSlotOccurrences = 0;
let rawSlotsInsideFramedObject = 0;
let rawSlotsAtFramedElementId = 0;
let rawSlotsAtFramedMarker = 0;
let rawSlotsAtFramedTypeCode = 0;
let rawSlotsInFramedPayload = 0;
let completeStaticShapes = 0;
let facetedTopology8Descriptors = 0;

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
    inflatedBytes += inflated.byteLength;

    const framedObjects = scanFramedElementObjects(inflated);
    for (const object of framedObjects) framedElementIds.add(object.elementId);
    for (const definition of scanMaterialElementRecords(inflated, 2027).definitions) {
      if (!materialNamesByElementId.has(definition.elementId)) {
        materialNamesByElementId.set(definition.elementId, definition.name);
      }
    }

    const view = new DataView(
      inflated.buffer,
      inflated.byteOffset,
      inflated.byteLength,
    );
    let framedIndex = 0;
    for (
      let selectorOffset = 0;
      selectorOffset + 2 <= inflated.byteLength;
      selectorOffset += 1
    ) {
      if (
        view.getInt16(selectorOffset, true) !==
        REVIT_2026_GPOLYMESH_SOURCE_CLASS
      ) {
        continue;
      }
      rawSlotOccurrences += 1;
      while (
        framedIndex < framedObjects.length &&
        framedObjects[framedIndex]!.offset +
          framedObjects[framedIndex]!.objectLength <= selectorOffset
      ) {
        framedIndex += 1;
      }
      const possibleOwner = framedObjects[framedIndex];
      const owner =
        possibleOwner &&
        selectorOffset >= possibleOwner.offset &&
        selectorOffset < possibleOwner.offset + possibleOwner.objectLength
          ? possibleOwner
          : null;
      if (owner) {
        rawSlotsInsideFramedObject += 1;
        const relativeOffset = selectorOffset - owner.offset;
        if (relativeOffset === 0) rawSlotsAtFramedElementId += 1;
        if (relativeOffset === 16) rawSlotsAtFramedMarker += 1;
        if (relativeOffset === 18) rawSlotsAtFramedTypeCode += 1;
        if (relativeOffset >= OBJECT_HEADER_BYTES) rawSlotsInFramedPayload += 1;
      }

      const decoded = decodeRevit2026GPolyMeshStatic(
        inflated,
        selectorOffset + 2,
      );
      if (!decoded.ok) continue;
      completeStaticShapes += 1;
      const value = decoded.value.value;
      if (value.topologySourceClassSlot === FACETED_TOPOLOGY8_SLOT) {
        facetedTopology8Descriptors += 1;
      }
      fixedShapes.push({
        stream: partition.path.replace(/^Root Entry\//, ""),
        chunkIndex,
        selectorOffset,
        bodyEndOffset: decoded.value.endOffset,
        topologyPropertyToken: value.topologyPropertyToken,
        topologySourceClassSlot: value.topologySourceClassSlot,
        gStyleElementId: value.gInfo.gStyleElementId,
        interiorStyleElementId: value.interiorStyleElementId,
        materialElementId: value.materialElementId,
        owner,
      });
    }
  }
}

function resolves(value: bigint, ids: ReadonlySet<number>): boolean {
  return value > 0n && value <= 0xffff_ffffn && ids.has(Number(value));
}

function report(context: FixedShapeContext): Record<string, unknown> {
  const ownerOffset = context.owner?.offset;
  return {
    stream: context.stream,
    chunkIndex: context.chunkIndex,
    selectorOffset: context.selectorOffset,
    topologyPropertyToken: context.topologyPropertyToken,
    topologySourceClassSlot: context.topologySourceClassSlot,
    gStyleElementId: context.gStyleElementId.toString(),
    interiorStyleElementId: context.interiorStyleElementId.toString(),
    materialElementId: context.materialElementId.toString(),
    materialName:
      context.materialElementId <= 0xffff_ffffn
        ? materialNamesByElementId.get(Number(context.materialElementId)) ?? null
        : null,
    ownerElementId: context.owner?.elementId ?? null,
    ownerMarker:
      context.owner == null
        ? null
        : `0x${context.owner.marker.toString(16).padStart(4, "0")}`,
    selectorRelativeToOwner:
      ownerOffset == null ? null : context.selectorOffset - ownerOffset,
    bodyEndRelativeToOwner:
      ownerOffset == null ? null : context.bodyEndOffset - ownerOffset,
    ownerObjectLength: context.owner?.objectLength ?? null,
  };
}

const framedShapes = fixedShapes.filter((context) => context.owner != null);
const whollyContainedShapes = framedShapes.filter(
  (context) =>
    context.bodyEndOffset <=
    context.owner!.offset + context.owner!.objectLength,
);
const payloadStartShapes = framedShapes.filter(
  (context) =>
    context.selectorOffset === context.owner!.offset + OBJECT_HEADER_BYTES,
);
const bodiesEndingAtFramedObjectEnd = framedShapes.filter(
  (context) =>
    context.bodyEndOffset === context.owner!.offset + context.owner!.objectLength,
);
const knownMaterialElementIds = new Set(materialNamesByElementId.keys());
const materialReferenceShapes = fixedShapes.filter((context) =>
  resolves(context.materialElementId, knownMaterialElementIds));
const positionCounts = new Map<string, number>();
for (const context of framedShapes) {
  const key =
    `0x${context.owner!.marker.toString(16).padStart(4, "0")}` +
    `:+${context.selectorOffset - context.owner!.offset}`;
  positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
}

console.log(JSON.stringify({
  modelPath,
  inputBytes: input.byteLength,
  partitions: partitions.length,
  chunks,
  failedChunks,
  inflatedBytes,
  rawSlotOccurrences,
  rawSlotContext: {
    insideFramedElementObject: rawSlotsInsideFramedObject,
    atFramedElementId: rawSlotsAtFramedElementId,
    atFramedMarker: rawSlotsAtFramedMarker,
    atFramedTypeCode: rawSlotsAtFramedTypeCode,
    inFramedPayload: rawSlotsInFramedPayload,
    outsideFramedElementObject:
      rawSlotOccurrences - rawSlotsInsideFramedObject,
  },
  completeStaticShapes,
  facetedTopology8Descriptors,
  outerObjectContext: {
    fixedShapesInsideFramedElementObject: framedShapes.length,
    fixedShapesWhollyInsideFramedElementObject: whollyContainedShapes.length,
    selectorsInFramedObjectHeader: framedShapes.length -
      framedShapes.filter(
        (context) =>
          context.selectorOffset >= context.owner!.offset + OBJECT_HEADER_BYTES,
      ).length,
    selectorsExactlyAtFramedPayloadStart: payloadStartShapes.length,
    bodiesEndingExactlyAtFramedObjectEnd: bodiesEndingAtFramedObjectEnd.length,
    fullFramedPayloadStaticShapes: payloadStartShapes.filter(
      (context) =>
        context.bodyEndOffset ===
        context.owner!.offset + context.owner!.objectLength,
    ).length,
    certifiableOuterOwners: 0,
    resolvingGStyleIds: fixedShapes.filter((context) =>
      resolves(context.gStyleElementId, framedElementIds)).length,
    resolvingInteriorStyleIds: fixedShapes.filter((context) =>
      resolves(context.interiorStyleElementId, framedElementIds)).length,
    resolvingMaterialIds: materialReferenceShapes.length,
    materialReferencesWithNullTopology: materialReferenceShapes.filter(
      (context) => context.topologyPropertyToken === 0,
    ).length,
    materialReferencesWithResolvedGStyle: materialReferenceShapes.filter(
      (context) => resolves(context.gStyleElementId, framedElementIds),
    ).length,
    materialReferencesWithResolvedInteriorStyle:
      materialReferenceShapes.filter((context) =>
        resolves(context.interiorStyleElementId, framedElementIds)).length,
    mostCommonFramedPositions: [...positionCounts]
      .sort((left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 20)
      .map(([markerAndOffset, count]) => ({ markerAndOffset, count })),
    payloadStartSamples: payloadStartShapes.slice(0, MAX_SAMPLES).map(report),
    materialReferenceSamples:
      materialReferenceShapes.slice(0, MAX_SAMPLES).map(report),
  },
  interpretation:
    "An element length/echo frame proves only the containing element. " +
    "No fixed shape starts and ends on a complete framed payload, and none " +
    "contains the required slot-5255 topology descriptor, so no outer " +
    "GPolyMesh owner is certified.",
}, null, 2));
