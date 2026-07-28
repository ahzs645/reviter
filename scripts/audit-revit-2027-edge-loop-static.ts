/**
 * Certify the Revit 2027 first-loop source variants and their exact UNBC
 * Face-owned queue census. This audit intentionally stops before loop bodies:
 * other Face-owned children are interleaved in the same FIFO.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-edge-loop-static.ts model.rvt
 */
import { readFileSync } from "node:fs";

import CFB from "cfb";

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
  REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-edge-loop-static.ts";
import {
  decodeRevit2027FaceStatic,
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-face-static.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";
import { decodeRevit2027GGroupStatic } from "../lib/reviter/revit-2027-ggroup-fifo.ts";
import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-grep-prefixes.ts";

const EXPECTED_UNBC = {
  decodedFaces: 40_961,
  firstLoopSet: 40_470,
  firstLoopNull: 491,
  edgeLoop: 40_448,
  edgeLoopRef: 22,
} as const;

const GEDGE_LOOP_FIELDS = [
  ["m_nextLoop", [0x0e, 0x01, 0x00, 0x00]],
  ["m_pFace", [0x0e, 0x03, 0x00, 0x00]],
  ["m_next", [0x0e, 0x03, 0x00, 0x00]],
  ["m_prev", [0x0e, 0x03, 0x00, 0x00]],
  ["m_Envelope", [0x0e, 0x00, 0x00, 0x00, 0x7c, 0x02]],
  ["m_open", [0x01, 0x00, 0x00, 0x00]],
] as const;

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function entries<K extends string | number>(
  map: Map<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map].sort((left, right) => right[1] - left[1]),
  );
}

function firstInflatedStream(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
): Uint8Array | null {
  const item = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(({ entry, path }) => entry.size > 0 && pattern.test(path));
  if (!item) return null;
  const stored = stripRevitPageChecksums(asBytes(item.entry.content));
  const offset = gzipOffsets(stored, 1)[0];
  return offset == null ? null : inflateRevitChunk(stored, offset);
}

function matchesAscii(
  data: Uint8Array,
  byteOffset: number,
  value: string,
): boolean {
  if (byteOffset < 0 || byteOffset > data.byteLength - value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (data[byteOffset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function findName16(
  data: Uint8Array,
  name: string,
  firstOffset: number,
): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = firstOffset;
    offset <= data.byteLength - name.length - 2;
    offset += 1
  ) {
    if (
      view.getUint16(offset, true) === name.length &&
      matchesAscii(data, offset + 2, name)
    ) {
      return offset;
    }
  }
  return -1;
}

function readFields(
  data: Uint8Array,
  byteOffset: number,
  expected: readonly (readonly [string, readonly number[]])[],
): {
  endOffset: number;
  fields: { name: string; descriptor: string }[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = byteOffset;
  const fields: { name: string; descriptor: string }[] = [];
  for (const [name, descriptor] of expected) {
    if (cursor > data.byteLength - 4) {
      throw new Error(`Formats/Latest field ${name} is truncated`);
    }
    const nameLength = view.getUint32(cursor, true);
    cursor += 4;
    if (
      nameLength !== name.length ||
      !matchesAscii(data, cursor, name)
    ) {
      throw new Error(`Formats/Latest field ${name} changed order`);
    }
    cursor += name.length;
    if (
      cursor > data.byteLength - descriptor.length ||
      descriptor.some((value, index) => data[cursor + index] !== value)
    ) {
      throw new Error(`Formats/Latest descriptor ${name} changed`);
    }
    cursor += descriptor.length;
    fields.push({
      name,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    });
  }
  return { endOffset: cursor, fields };
}

function certifySchema(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const edgeLoopOffset = findName16(data, "EdgeLoop", 0);
  if (edgeLoopOffset < 0) {
    throw new Error("Formats/Latest has no EdgeLoop definition");
  }
  let cursor = edgeLoopOffset + 2 + "EdgeLoop".length;
  const rawEdgeLoopClassId = view.getUint16(cursor, true);
  cursor += 2;
  const zeroMarker = view.getUint16(cursor, true);
  cursor += 2;
  const parentLength = view.getUint16(cursor, true);
  cursor += 2;
  const parentName =
    parentLength === "GEdgeLoop".length &&
    matchesAscii(data, cursor, "GEdgeLoop")
      ? "GEdgeLoop"
      : null;
  cursor += parentLength;
  const rawParentClassId = view.getUint16(cursor, true);
  cursor += 2;
  const parentVersion = view.getUint32(cursor, true);
  const parentFieldCount = view.getUint32(cursor + 4, true);
  cursor += 8;
  const parentFields = readFields(data, cursor, GEDGE_LOOP_FIELDS);
  cursor = parentFields.endOffset;
  const parentTerminator = view.getUint32(cursor, true);
  const edgeLoopVersion = view.getUint32(cursor + 4, true);
  const edgeLoopFieldCount = view.getUint32(cursor + 8, true);

  const edgeLoopRefOffset = findName16(
    data,
    "EdgeLoopRef",
    edgeLoopOffset + 1,
  );
  if (edgeLoopRefOffset < 0) {
    throw new Error("Formats/Latest has no EdgeLoopRef definition");
  }
  cursor = edgeLoopRefOffset + 2 + "EdgeLoopRef".length;
  const rawEdgeLoopRefClassId = view.getUint16(cursor, true);
  const edgeLoopRefVersion = view.getUint32(cursor + 2, true);
  const edgeLoopRefFieldCount = view.getUint32(cursor + 6, true);
  cursor += 10;
  const edgeLoopRefFields = readFields(data, cursor, [
    ["m_sortedTagArr", [0x04, 0x50, 0x00, 0x00, 0, 0, 0, 0]],
  ]);

  const ok =
    rawEdgeLoopClassId === 0x859b &&
    (rawEdgeLoopClassId & 0x7fff) - 1 ===
      REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT &&
    zeroMarker === 0 &&
    parentName === "GEdgeLoop" &&
    rawParentClassId === 0x0591 &&
    parentVersion === 2 &&
    parentFieldCount === GEDGE_LOOP_FIELDS.length &&
    parentTerminator === 0 &&
    edgeLoopVersion === 2 &&
    edgeLoopFieldCount === 0 &&
    rawEdgeLoopRefClassId === 0 &&
    edgeLoopRefVersion === 1 &&
    edgeLoopRefFieldCount === 1;
  return {
    ok,
    edgeLoop: {
      sourceClassSlot: REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
      offset: edgeLoopOffset,
      rawClassId: `0x${rawEdgeLoopClassId.toString(16).padStart(4, "0")}`,
      version: edgeLoopVersion,
      fieldCount: edgeLoopFieldCount,
      parent: {
        name: parentName,
        rawClassId: `0x${rawParentClassId.toString(16).padStart(4, "0")}`,
        version: parentVersion,
        fieldCount: parentFieldCount,
        fields: parentFields.fields,
      },
    },
    edgeLoopRef: {
      sourceClassSlot: REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT,
      offset: edgeLoopRefOffset,
      rawClassId: `0x${rawEdgeLoopRefClassId.toString(16).padStart(4, "0")}`,
      version: edgeLoopRefVersion,
      fieldCount: edgeLoopRefFieldCount,
      fields: edgeLoopRefFields.fields,
    },
  };
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

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-2027-edge-loop-static.ts model.rvt",
  );
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const basicFileInfo = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
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
const schema = firstInflatedStream(cfb, /\/Formats\/Latest$/i);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifySchema(schema);
if (!schemaEvidence.ok) {
  throw new Error("Formats/Latest EdgeLoop grammar changed");
}

const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

let chunks = 0;
let failedChunks = 0;
let decodedOwners = 0;
let decodedFaces = 0;
let firstLoopNull = 0;
let firstLoopSet = 0;
let firstLoopNumbered = 0;
let firstLoopSentinel = 0;
const firstLoopSlots = new Map<number, number>();
const failures = new Map<string, number>();

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
        release,
      );
      if (!decodedRoot.ok) continue;
      const root = decodedRoot.value;

      let geometryOffset: number | null = null;
      let firstGeometryAppendToken = 0;
      if (
        root.children.length === 1 &&
        root.children[0]?.sourceClassSlot ===
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
      ) {
        const tokenError = requireTokens(root.children, 3);
        if (tokenError) {
          increment(failures, `direct root: ${tokenError}`);
          continue;
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
          increment(failures, `single group root: ${rootTokenError}`);
          continue;
        }
        const group = decodeRevit2027GGroupStatic(
          inflated,
          root.dynamicPayloadOffset,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (
          !group.ok ||
          group.value.children.length !== 1 ||
          group.value.children[0]?.sourceClassSlot !==
            REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
        ) {
          continue;
        }
        const groupTokenError = requireTokens(group.value.children, 4);
        if (groupTokenError) {
          increment(failures, `single group child: ${groupTokenError}`);
          continue;
        }
        geometryOffset = group.value.endOffset;
        firstGeometryAppendToken = 5;
      }
      if (geometryOffset == null) continue;

      const geometry = decodeRevit2027GeometryStatic(
        inflated,
        geometryOffset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!geometry.ok) {
        increment(failures, geometry.error);
        continue;
      }
      const geometryTokenError = requireTokens(
        geometry.value.queuedProperties,
        firstGeometryAppendToken,
      );
      if (geometryTokenError) {
        increment(failures, geometryTokenError);
        continue;
      }
      if (
        geometry.value.faces.entries.some(
          (entry) =>
            entry.sourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT,
        )
      ) {
        increment(failures, "Geometry face descriptor is not source slot 1825");
        continue;
      }

      let cursor = geometry.value.endOffset;
      let nextAppendToken =
        firstGeometryAppendToken +
        numberedPropertyCount(geometry.value.queuedProperties);
      const ownerFirstLoops: CondInt16QueueEntry[] = [];
      let ownerFailure: string | null = null;
      for (let index = 0; index < geometry.value.faces.count; index += 1) {
        const face = decodeRevit2027FaceStatic(
          inflated,
          cursor,
          root.dynamicPayloadEndOffset,
          release,
        );
        if (!face.ok) {
          ownerFailure = face.error;
          break;
        }
        const faceTokenError = requireTokens(
          face.value.queuedProperties,
          nextAppendToken,
        );
        if (faceTokenError) {
          ownerFailure = faceTokenError;
          break;
        }
        nextAppendToken += numberedPropertyCount(
          face.value.queuedProperties,
        );
        cursor = face.value.endOffset;
        ownerFirstLoops.push(face.value.firstLoop);
      }
      if (ownerFailure) {
        increment(failures, ownerFailure);
        continue;
      }

      decodedOwners += 1;
      decodedFaces += ownerFirstLoops.length;
      for (const firstLoop of ownerFirstLoops) {
        if (firstLoop.token === 0) {
          firstLoopNull += 1;
          continue;
        }
        firstLoopSet += 1;
        if (firstLoop.token === -1) {
          firstLoopSentinel += 1;
        } else {
          firstLoopNumbered += 1;
        }
        increment(firstLoopSlots, firstLoop.sourceClassSlot!);
      }
    }
  }
}

const exactCounts =
  decodedFaces === EXPECTED_UNBC.decodedFaces &&
  firstLoopSet === EXPECTED_UNBC.firstLoopSet &&
  firstLoopNull === EXPECTED_UNBC.firstLoopNull &&
  firstLoopNumbered === EXPECTED_UNBC.firstLoopSet &&
  firstLoopSentinel === 0 &&
  firstLoopSlots.size === 2 &&
  firstLoopSlots.get(REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT) ===
    EXPECTED_UNBC.edgeLoop &&
  firstLoopSlots.get(REVIT_2027_EDGE_LOOP_REF_SOURCE_CLASS_SLOT) ===
    EXPECTED_UNBC.edgeLoopRef;
if (!exactCounts) {
  throw new Error(
    "exact UNBC first-loop queue census changed; refusing certification",
  );
}

console.log(
  JSON.stringify(
    {
      modelPath,
      release,
      schemaEvidence,
      partitions: partitions.length,
      chunks,
      failedChunks,
      certifiedOwnerScopes: decodedOwners,
      faces: {
        decoded: decodedFaces,
        firstLoopSet,
        firstLoopNull,
      },
      firstLoopQueue: {
        sourceClassSlots: entries(firstLoopSlots),
        numbered: firstLoopNumbered,
        sentinelMinusOne: firstLoopSentinel,
        exactUnbcCountsCertified: exactCounts,
      },
      tokenSemantics:
        "token 0 is null; token -1 is queued without advancing the positive namespace; tokens below -1 fail closed",
      failures: entries(failures),
      stopBoundary:
        "queue descriptors certified only; loop bodies remain behind Geometry edges and interleaved Face children, so this audit does not scan forward or claim body replay",
    },
    null,
    2,
  ),
);
