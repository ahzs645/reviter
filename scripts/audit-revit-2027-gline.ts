/**
 * Audit schema-complete Revit 2027 GLine bodies on certified initial-FIFO
 * routes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2027-gline.ts model.rvt
 */
import {
  FORMATS_LATEST_PATTERN,
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GArray,
  decodeRevit2027GGroupStatic,
  decodeRevit2027GLine,
  decodeRevit2027GPolyLine,
} from "./lib/revit-2027-decoders.ts";
function increment<Key>(map: Map<Key, number>, key: Key): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function record<Key extends string | number | bigint>(
  map: Map<Key, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          String(left[0]).localeCompare(String(right[0])),
      )
      .map(([key, count]) => [String(key), count]),
  );
}

function topRecord<Key extends string | number | bigint>(
  map: Map<Key, number>,
  limit = 20,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort(
        (left, right) =>
          right[1] - left[1] ||
          String(left[0]).localeCompare(String(right[0])),
      )
      .slice(0, limit)
      .map(([key, count]) => [String(key), count]),
  );
}

function asciiAt(data: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset > data.byteLength - text.length) return false;
  return [...text].every(
    (character, index) => data[offset + index] === character.charCodeAt(0),
  );
}

function certifyGLineSchema(data: Uint8Array): {
  ok: boolean;
  offset: number;
  tag?: number;
  parent?: string;
  parentVersion?: number;
  parentFields?: readonly string[];
  version?: number;
  fields?: readonly string[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset <= data.byteLength - 120; offset += 1) {
    if (
      view.getUint16(offset, true) !== 5 ||
      !asciiAt(data, offset + 2, "GLine")
    ) {
      continue;
    }
    const rawTag = view.getUint16(offset + 7, true);
    if ((rawTag & 0x8000) === 0 || view.getUint16(offset + 9, true) !== 0) {
      continue;
    }
    let cursor = offset + 11;
    if (
      view.getUint16(cursor, true) !== 6 ||
      !asciiAt(data, cursor + 2, "GCurve")
    ) {
      continue;
    }
    cursor += 10;
    const parentVersion = view.getUint32(cursor, true);
    const parentFieldCount = view.getUint32(cursor + 4, true);
    cursor += 8;
    const endNameLength = view.getUint32(cursor, true);
    cursor += 4;
    if (
      endNameLength !== 11 ||
      !asciiAt(data, cursor, "m_endParams")
    ) {
      continue;
    }
    cursor += endNameLength;
    const endDescriptor = data.subarray(cursor, cursor + 8);
    if (
      endDescriptor.length !== 8 ||
      endDescriptor[0] !== 0x07 ||
      endDescriptor[1] !== 0x10 ||
      view.getUint32(cursor + 4, true) !== 2 ||
      view.getUint32(cursor + 8, true) !== 0
    ) {
      continue;
    }
    cursor += 12;
    const version = view.getUint32(cursor, true);
    const fieldCount = view.getUint32(cursor + 4, true);
    cursor += 8;
    const fields: string[] = [];
    let valid = true;
    for (const [name, width] of [
      ["m_origin", 3],
      ["m_dirVec", 3],
    ] as const) {
      const nameLength = view.getUint32(cursor, true);
      cursor += 4;
      if (nameLength !== name.length || !asciiAt(data, cursor, name)) {
        valid = false;
        break;
      }
      fields.push(name);
      cursor += nameLength;
      if (
        data[cursor] !== 0x07 ||
        data[cursor + 1] !== 0x10 ||
        view.getUint32(cursor + 4, true) !== width
      ) {
        valid = false;
        break;
      }
      cursor += 8;
    }
    if (!valid) continue;
    return {
      ok:
        (rawTag & 0x7fff) === 1974 &&
        parentVersion === 3 &&
        parentFieldCount === 1 &&
        version === 4 &&
        fieldCount === 2,
      offset,
      tag: rawTag & 0x7fff,
      parent: "GCurve",
      parentVersion,
      parentFields: ["m_endParams"],
      version,
      fields,
    };
  }
  return { ok: false, offset: -1 };
}

const modelPath = requireModelPath(
  "audit-revit-2027-gline.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const schema = model.firstInflatedStream(FORMATS_LATEST_PATTERN);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifyGLineSchema(schema);
if (!schemaEvidence.ok) {
  throw new Error("Formats/Latest does not certify the expected GLine layers");
}

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let rootsContainingGLine = 0;
let outerGLineDescriptors = 0;
let reachableInitialGLineBodies = 0;
let exactSingleChildBodies = 0;
let unitDirections = 0;
const gInfoStyles = new Map<bigint, number>();
const gInfoTags = new Map<number, number>();
const stopSlots = new Map<number, number>();
const failures = new Map<string, number>();

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
    const lineDescriptors = root.children.filter(
      (child) => child.sourceClassSlot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
    ).length;
    if (lineDescriptors === 0) continue;
    rootsContainingGLine += 1;
    outerGLineDescriptors += lineDescriptors;

    let offset = root.dynamicPayloadOffset;
    for (const child of root.children) {
      const slot = child.sourceClassSlot;
      if (slot === REVIT_2027_GLINE_SOURCE_CLASS_SLOT) {
        const decoded = decodeRevit2027GLine(
          inflated,
          offset,
          offset + REVIT_2027_GLINE_BODY_BYTES,
          release,
        );
        if (!decoded.ok) {
          increment(failures, decoded.error);
          break;
        }
        reachableInitialGLineBodies += 1;
        offset = decoded.value.endOffset;
        increment(gInfoStyles, decoded.value.gInfo.gStyleElementId);
        increment(gInfoTags, decoded.value.gInfo.tag);
        const norm = Math.hypot(...decoded.value.direction);
        if (Math.abs(norm - 1) <= 1e-9) unitDirections += 1;
        continue;
      }
      if (slot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT) {
        const decoded = decodeRevit2027GGroupStatic(
          inflated,
          offset,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (!decoded.ok) {
          increment(failures, decoded.error);
          break;
        }
        offset = decoded.value.endOffset;
        continue;
      }
      if (slot === REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT) {
        const decoded = decodeRevit2027GPolyLine(
          inflated,
          offset,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (!decoded.ok) {
          increment(failures, decoded.error);
          break;
        }
        offset = decoded.value.endOffset;
        continue;
      }
      if (slot === REVIT_2027_GARRAY_SOURCE_CLASS_SLOT) {
        const decoded = decodeRevit2027GArray(
          inflated,
          offset,
          offset + REVIT_2027_GARRAY_BODY_BYTES,
          release,
        );
        if (!decoded.ok) {
          increment(failures, decoded.error);
          break;
        }
        offset = decoded.value.endOffset;
        continue;
      }
      if (slot != null) increment(stopSlots, slot);
      break;
    }
    if (
      root.children.length === 1 &&
      root.children[0]?.sourceClassSlot ===
        REVIT_2027_GLINE_SOURCE_CLASS_SLOT &&
      offset === root.dynamicPayloadEndOffset
    ) {
      exactSingleChildBodies += 1;
    }
  }

}
console.log(JSON.stringify({
  modelPath,
  release,
  schemaEvidence,
  sourceClassSlot: REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
  bodyBytes: REVIT_2027_GLINE_BODY_BYTES,
  partitions: partitions.length,
  chunks,
  failedChunks,
  rootsContainingGLine,
  outerGLineDescriptors,
  reachableInitialGLineBodies,
  exactSingleChildBodies,
  unitDirections,
  reachablePercent:
    outerGLineDescriptors === 0
      ? 0
      : Number(
          ((100 * reachableInitialGLineBodies) / outerGLineDescriptors).toFixed(4),
        ),
  gInfoStyles: record(gInfoStyles),
  gInfoTags: {
    uniqueValues: gInfoTags.size,
    minusOne: gInfoTags.get(-1) ?? 0,
    zero: gInfoTags.get(0) ?? 0,
    positive:
      [...gInfoTags].reduce(
        (sum, [tag, count]) => sum + (tag > 0 ? count : 0),
        0,
      ),
    topValues: topRecord(gInfoTags),
  },
  stopSlots: record(stopSlots),
  failures: record(failures),
}, null, 2));
