/**
 * Audit release-certified Revit 2027 `Face` bodies owned directly by an
 * otherwise empty Geometry/GGroup replay prefix.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-face-static.ts model.rvt
 */
import {
  FORMATS_LATEST_PATTERN,
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
  decodeRevit2027FaceStatic,
  decodeRevit2027FramedGRepRoot,
  decodeRevit2027GGroupStatic,
  decodeRevit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027FaceStatic,
} from "./lib/revit-2027-decoders.ts";
const SOURCE_LADDER = [
  [1822, "FabricationSettings"],
  [1823, "FabricationSettingsElement"],
  [1824, "FabricationShapeSecondaryData"],
  [1825, "Face"],
  [1826, "GFace"],
] as const;

const GFACE_FIELDS = [
  ["m_pFirstLoop", [0x0e, 0x01, 0x00, 0x00]],
  ["m_faceRegions", [0x0e, 0x51, 0x00, 0x00]],
  ["m_pGFilling", [0x0e, 0x01, 0x00, 0x00]],
  ["m_oBackgroundFilling", [0x0e, 0x01, 0x00, 0x00]],
  ["m_renderStyleId", [0x0e, 0x00, 0x00, 0x00, 0x14, 0x00]],
  ["m_cutType", [0x04, 0x00, 0x00, 0x00]],
  ["m_faceFlags_v9", [0x05, 0x00, 0x00, 0x00]],
] as const;
const FACE_FIELDS = [
  ["m_pSurf", [0x0e, 0x01, 0x00, 0x00]],
] as const;

type SchemaField = {
  name: string;
  descriptor: string;
};

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
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

function findSchemaName(
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

function decodeFields(
  data: Uint8Array,
  byteOffset: number,
  expected: readonly (readonly [string, readonly number[]])[],
): { endOffset: number; fields: SchemaField[] } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = byteOffset;
  const fields: SchemaField[] = [];
  for (const [name, descriptor] of expected) {
    if (cursor > data.byteLength - 4) {
      throw new Error(`schema field ${name} is truncated`);
    }
    const nameLength = view.getUint32(cursor, true);
    cursor += 4;
    if (
      nameLength !== name.length ||
      !matchesAscii(data, cursor, name)
    ) {
      throw new Error(`schema field ${name} is not in declared order`);
    }
    cursor += name.length;
    if (
      cursor > data.byteLength - descriptor.length ||
      descriptor.some((value, index) => data[cursor + index] !== value)
    ) {
      throw new Error(`schema descriptor ${name} changed`);
    }
    fields.push({
      name,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    });
    cursor += descriptor.length;
  }
  return { endOffset: cursor, fields };
}

function certifySchema(data: Uint8Array) {
  let ladderCursor = 0;
  const ladder = SOURCE_LADDER.map(([sourceClassSlot, name]) => {
    const offset = findSchemaName(data, name, ladderCursor);
    if (offset < 0) {
      throw new Error(
        `Formats/Latest source ladder is missing ${sourceClassSlot} ${name}`,
      );
    }
    ladderCursor = offset + 2 + name.length;
    return { sourceClassSlot, name, offset };
  });

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const face = ladder.find(
    (entry) => entry.sourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  )!;
  let cursor = face.offset + 2 + face.name.length;
  const rawFaceClassId = view.getUint16(cursor, true);
  cursor += 2;
  const zeroMarker = view.getUint16(cursor, true);
  cursor += 2;

  const parentNameLength = view.getUint16(cursor, true);
  cursor += 2;
  const parentName = matchesAscii(data, cursor, "GFace")
    ? "GFace"
    : null;
  cursor += parentNameLength;
  const rawGFaceClassId = view.getUint16(cursor, true);
  cursor += 2;
  const gFaceVersion = view.getUint32(cursor, true);
  const gFaceFieldCount = view.getUint32(cursor + 4, true);
  cursor += 8;
  const gFaceFields = decodeFields(data, cursor, GFACE_FIELDS);
  cursor = gFaceFields.endOffset;

  const parentTerminator = view.getUint32(cursor, true);
  cursor += 4;
  const faceVersion = view.getUint32(cursor, true);
  const faceFieldCount = view.getUint32(cursor + 4, true);
  cursor += 8;
  const faceFields = decodeFields(data, cursor, FACE_FIELDS);

  const ok =
    ladder.length === SOURCE_LADDER.length &&
    face.sourceClassSlot === REVIT_2027_FACE_SOURCE_CLASS_SLOT &&
    rawFaceClassId === 0x8722 &&
    zeroMarker === 0 &&
    parentNameLength === "GFace".length &&
    parentName === "GFace" &&
    rawGFaceClassId === 0x0592 &&
    gFaceVersion === 10 &&
    gFaceFieldCount === GFACE_FIELDS.length &&
    parentTerminator === 0 &&
    faceVersion === 6 &&
    faceFieldCount === FACE_FIELDS.length;
  return {
    ok,
    sourceLadder: ladder,
    face: {
      sourceClassSlot: face.sourceClassSlot,
      offset: face.offset,
      rawClassId: `0x${rawFaceClassId.toString(16).padStart(4, "0")}`,
      version: faceVersion,
      fieldCount: faceFieldCount,
      fields: faceFields.fields,
    },
    gFace: {
      rawClassId: `0x${rawGFaceClassId.toString(16).padStart(4, "0")}`,
      version: gFaceVersion,
      fieldCount: gFaceFieldCount,
      fields: gFaceFields.fields,
    },
  };
}

function requireTokens(
  entries: readonly CondInt16QueueEntry[],
  firstToken: number,
): string | null {
  let expectedToken = firstToken;
  for (const entry of entries) {
    if (entry.sourceClassSlot == null || entry.token === 0) {
      return "FIFO append list contains a null property";
    }
    if (entry.token === -1) continue;
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
  entries: readonly CondInt16QueueEntry[],
): number {
  return entries.reduce(
    (count, entry) => count + (entry.token > 0 ? 1 : 0),
    0,
  );
}

function recordFace(
  face: Revit2027FaceStatic,
  bodyBytes: Map<number, number>,
  regionCounts: Map<number, number>,
  childSlots: Map<number, number>,
  childTokenKinds: Map<string, number>,
  renderStyleIds: Map<string, number>,
  cutTypes: Map<number, number>,
  faceFlags: Map<number, number>,
  optionalPresence: Map<string, number>,
): void {
  increment(bodyBytes, face.endOffset - face.byteOffset);
  increment(regionCounts, face.faceRegions.count);
  increment(renderStyleIds, face.renderStyleElementId.toString());
  increment(cutTypes, face.cutType);
  increment(faceFlags, face.faceFlags);
  const optionals = [
    ["firstLoop", face.firstLoop],
    ["foregroundFilling", face.foregroundFilling],
    ["backgroundFilling", face.backgroundFilling],
    ["surface", face.surface],
  ] as const;
  for (const [name, entry] of optionals) {
    increment(optionalPresence, `${name}:${entry.token === 0 ? "null" : "set"}`);
  }
  for (const entry of face.queuedProperties) {
    increment(childSlots, entry.sourceClassSlot!);
    increment(
      childTokenKinds,
      `${entry.sourceClassSlot}:${entry.token === -1 ? "sentinel" : "numbered"}`,
    );
  }
}

function entries<K extends string | number>(
  map: Map<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map].sort((left, right) => right[1] - left[1]),
  );
}

const modelPath = requireModelPath(
  "audit-revit-2027-face-static.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const schema = model.firstInflatedStream(FORMATS_LATEST_PATTERN);
if (!schema) throw new Error("RVT has no readable Formats/Latest stream");
const schemaEvidence = certifySchema(schema);
if (!schemaEvidence.ok) {
  throw new Error("Formats/Latest does not certify source slot 1825 Face");
}

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let directGeometryRoots = 0;
let singleGroupGeometryRoots = 0;
let decodedGeometryOwners = 0;
let declaredFaces = 0;
let decodedFaces = 0;
let ownersWithFaces = 0;
let ownersWithoutFaces = 0;
const failures = new Map<string, number>();
const bodyBytes = new Map<number, number>();
const regionCounts = new Map<number, number>();
const childSlots = new Map<number, number>();
const childTokenKinds = new Map<string, number>();
const renderStyleIds = new Map<string, number>();
const cutTypes = new Map<number, number>();
const faceFlags = new Map<number, number>();
const optionalPresence = new Map<string, number>();

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

    let geometryOffset: number | null = null;
    let firstGeometryAppendToken = 0;
    if (
      root.children.length === 1 &&
      root.children[0]?.sourceClassSlot ===
        REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      directGeometryRoots += 1;
      const rootTokenError = requireTokens(root.children, 3);
      if (rootTokenError) {
        increment(failures, `direct root: ${rootTokenError}`);
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
      singleGroupGeometryRoots += 1;
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

    decodedGeometryOwners += 1;
    declaredFaces += geometry.value.faces.count;
    if (geometry.value.faces.count === 0) {
      ownersWithoutFaces += 1;
    } else {
      ownersWithFaces += 1;
    }
    let cursor = geometry.value.endOffset;
    let nextAppendToken =
      firstGeometryAppendToken +
      numberedPropertyCount(geometry.value.queuedProperties);
    let ownerFailure: string | null = null;
    const ownerFaces: Revit2027FaceStatic[] = [];
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
      ownerFaces.push(face.value);
    }
    if (ownerFailure) {
      increment(failures, ownerFailure);
      continue;
    }
    decodedFaces += ownerFaces.length;
    for (const face of ownerFaces) {
      recordFace(
        face,
        bodyBytes,
        regionCounts,
        childSlots,
        childTokenKinds,
        renderStyleIds,
        cutTypes,
        faceFlags,
        optionalPresence,
      );
    }
  }

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
      certifiedOwnerScopes: {
        directGeometryRoots,
        singleGroupGeometryRoots,
        decodedGeometryOwners,
        ownersWithFaces,
        ownersWithoutFaces,
      },
      faces: {
        declared: declaredFaces,
        decoded: decodedFaces,
        coveragePercent:
          declaredFaces === 0
            ? 100
            : Number(((decodedFaces * 100) / declaredFaces).toFixed(4)),
        bodyBytes: entries(bodyBytes),
        faceRegionCounts: entries(regionCounts),
        cutTypes: entries(cutTypes),
        faceFlags: entries(faceFlags),
        optionalPresence: entries(optionalPresence),
      },
      queueOwnership: {
        childSourceClassSlots: entries(childSlots),
        childTokenKinds: entries(childTokenKinds),
        appendedChildDescriptors: [...childSlots.values()].reduce(
          (sum, count) => sum + count,
          0,
        ),
      },
      renderStyles: {
        distinctElementIds: renderStyleIds.size,
        mostFrequentElementIds: Object.fromEntries(
          [...renderStyleIds]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 20),
        ),
      },
      failures: entries(failures),
      stopBoundary:
        "after the final owned Face static body and before Geometry edge bodies; queued loops, regions, fillings, surfaces, edges, BRep assembly, and triangles are not decoded",
    },
    null,
    2,
  ),
);
