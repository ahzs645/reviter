/**
 * Audit the complete Revit 2027 GGroup static boundary and first nested FIFO
 * position in the exact model.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2027-ggroup-fifo.ts model.rvt
 */
import {
  FORMATS_LATEST_PATTERN,
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import {
  increment,
  matchesAscii,
} from "./lib/rvt-harness.ts";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GGroupStatic,
  locateRevit2027FirstGGroupNestedFifo,
} from "./lib/revit-2027-decoders.ts";
/**
 * Certify the recursive 2027 schema layer:
 * GElement -> GRep -> GGroup(version 1, one m_subNodes field) -> GRep fields.
 */
function certifyGGroupSchema(data: Uint8Array): {
  ok: boolean;
  offset: number;
  gGroupVersion?: number;
  gGroupFieldCount?: number;
  gGroupField?: string;
  gRepVersion?: number;
  gRepFieldCount?: number;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset <= data.byteLength - 90; offset += 1) {
    if (
      view.getUint16(offset, true) !== 8 ||
      !matchesAscii(data, offset + 2, "GElement")
    ) {
      continue;
    }
    let cursor = offset + 10;
    const gElementWord = view.getUint16(cursor, true);
    cursor += 4;
    if (
      (gElementWord & 0x8000) === 0 ||
      view.getUint16(cursor, true) !== 4 ||
      !matchesAscii(data, cursor + 2, "GRep")
    ) {
      continue;
    }
    cursor += 6;
    const gRepWord = view.getUint16(cursor, true);
    cursor += 4;
    if (
      (gRepWord & 0x8000) === 0 ||
      view.getUint16(cursor, true) !== 6 ||
      !matchesAscii(data, cursor + 2, "GGroup")
    ) {
      continue;
    }
    cursor += 10;
    const gGroupVersion = view.getUint32(cursor, true);
    const gGroupFieldCount = view.getUint32(cursor + 4, true);
    cursor += 8;
    const fieldNameLength = view.getUint32(cursor, true);
    cursor += 4;
    if (
      fieldNameLength !== 10 ||
      !matchesAscii(data, cursor, "m_subNodes")
    ) {
      continue;
    }
    const gGroupField = "m_subNodes";
    cursor += fieldNameLength;
    const descriptor = data.subarray(cursor, cursor + 8);
    if (
      descriptor.length !== 8 ||
      descriptor[0] !== 0x0e ||
      descriptor[1] !== 0x51 ||
      descriptor.slice(2).some((value) => value !== 0)
    ) {
      continue;
    }
    cursor += 8;
    const gRepVersion = view.getUint32(cursor, true);
    const gRepFieldCount = view.getUint32(cursor + 4, true);
    return {
      ok:
        gGroupVersion === 1 &&
        gGroupFieldCount === 1 &&
        gRepVersion === 6 &&
        gRepFieldCount === 5,
      offset,
      gGroupVersion,
      gGroupFieldCount,
      gGroupField,
      gRepVersion,
      gRepFieldCount,
    };
  }
  return { ok: false, offset: -1 };
}

const modelPath = requireModelPath(
  "audit-revit-2027-ggroup-fifo.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const schema = model.firstInflatedStream(FORMATS_LATEST_PATTERN);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifyGGroupSchema(schema);
if (!schemaEvidence.ok) {
  throw new Error("Formats/Latest does not certify the expected GGroup layer");
}

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let firstGroupCandidates = 0;
let completeStaticBodies = 0;
let completeStaticBodiesWithNoChildren = 0;
let positionedFifos = 0;
let emptyFirstGroups = 0;
let positionedNestedBodies = 0;
const failures = new Map<string, number>();
const rootQueueShapes = new Map<string, number>();
const firstNestedSlots = new Map<number, number>();
const skippedInitialSiblingBytes = new Map<number, number>();

for (const { data: inflated } of iterateInflatedChunks(model, {
  onFailure: () => {
    failedChunks += 1;
  },
})) {
  chunks += 1;

  for (const frame of scanFramedElementObjects(inflated)) {
    if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
    const decodedRoot = decodeRevit2027FramedGRepRoot(
      inflated,
      frame,
      release,
    );
    if (!decodedRoot.ok) continue;
    const root = decodedRoot.value;
    if (
      root.children[0]?.sourceClassSlot !==
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT
    ) {
      continue;
    }
    firstGroupCandidates += 1;
    increment(
      rootQueueShapes,
      root.children
        .map((entry) => entry.sourceClassSlot ?? 0)
        .join(","),
    );

    const complete = decodeRevit2027GGroupStatic(
      inflated,
      root.dynamicPayloadOffset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!complete.ok) {
      increment(failures, complete.error);
      continue;
    }
    completeStaticBodies += 1;
    if (complete.value.children.length === 0) {
      completeStaticBodiesWithNoChildren += 1;
    }

    const located = locateRevit2027FirstGGroupNestedFifo(
      inflated,
      root,
      release,
    );
    if (!located.ok) {
      increment(failures, located.error);
      continue;
    }
    positionedFifos += 1;
    if (
      located.value.firstNestedEntry == null ||
      located.value.nestedFifoOffset == null
    ) {
      emptyFirstGroups += 1;
      continue;
    }
    positionedNestedBodies += 1;
    increment(
      firstNestedSlots,
      located.value.firstNestedEntry.sourceClassSlot!,
    );
    increment(
      skippedInitialSiblingBytes,
      located.value.nestedFifoOffset -
        located.value.firstGroup.endOffset,
    );
  }

}
console.log(JSON.stringify({
  modelPath,
  release,
  schemaEvidence,
  partitions: partitions.length,
  chunks,
  failedChunks,
  sourceClassSlot: REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  firstGroupCandidates,
  completeStaticBodies,
  completeStaticBodiesWithNoChildren,
  positionedFifos,
  emptyFirstGroups,
  positionedNestedBodies,
  coveragePercent:
    firstGroupCandidates === 0
      ? 0
      : Number(
          ((100 * positionedFifos) / firstGroupCandidates).toFixed(4),
        ),
  firstNestedSlots: Object.fromEntries(
    [...firstNestedSlots].sort((left, right) => right[1] - left[1]),
  ),
  skippedInitialSiblingBytes: Object.fromEntries(
    [...skippedInitialSiblingBytes].sort((left, right) => left[0] - right[0]),
  ),
  rootQueueShapes: Object.fromEntries(
    [...rootQueueShapes].sort((left, right) => right[1] - left[1]),
  ),
  failures: Object.fromEntries(
    [...failures].sort((left, right) => right[1] - left[1]),
  ),
}, null, 2));
