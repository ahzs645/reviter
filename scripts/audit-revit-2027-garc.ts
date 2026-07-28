/**
 * Certify source-slot 2,213 `GArc` against the exact UNBC model independently
 * of the shared Face-child replay's body accounting.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-garc.ts model.rvt
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

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
  decodeRevit2027GArc,
  REVIT_2027_GARC_BODY_BYTES,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
  type Revit2027GArc,
} from "../lib/reviter/revit-2027-garc.ts";
import {
  decodeRevit2027GeometryStatic,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-geometry.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error("usage: audit-revit-2027-garc.ts model.rvt");
}

const EXACT_OWNER_ELEMENT_ID = 245_109;
const EXACT_BYTES_BEFORE_FIRST_GARC = 9_866;

function firstInflatedSchema(
  cfb: ReturnType<typeof CFB.read>,
): Uint8Array {
  const item = cfb.FileIndex
    .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
    .find(
      ({ entry, path }) =>
        entry.size > 0 && /\/Formats\/Latest$/i.test(path),
    );
  if (!item) throw new Error("RVT has no readable Formats/Latest stream");
  const stored = stripRevitPageChecksums(asBytes(item.entry.content));
  const offset = gzipOffsets(stored, 1)[0];
  if (offset == null) throw new Error("Formats/Latest has no gzip member");
  const inflated = inflateRevitChunk(stored, offset);
  if (!inflated) throw new Error("Formats/Latest gzip member did not inflate");
  return inflated;
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

function findName(
  data: Uint8Array,
  name: string,
  firstOffset = 0,
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
  throw new Error(`Formats/Latest does not contain ${name}`);
}

function sourceNameAtSlot(
  data: Uint8Array,
  sourceClassSlot: number,
): { name: string; offset: number } {
  const candidates: { name: string; offset: number }[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset <= data.byteLength - 4; offset += 1) {
    const length = view.getUint16(offset, true);
    if (length < 2 || length > 100 || offset > data.byteLength - length - 2) {
      continue;
    }
    let ascii = true;
    for (let index = 0; index < length; index += 1) {
      const value = data[offset + 2 + index]!;
      if (value < 0x20 || value > 0x7e) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      candidates.push({
        name: new TextDecoder("ascii").decode(
          data.subarray(offset + 2, offset + 2 + length),
        ),
        offset,
      });
    }
  }
  const candidate = candidates[sourceClassSlot - 12];
  if (!candidate) {
    throw new Error(`Formats/Latest source slot ${sourceClassSlot} is missing`);
  }
  return candidate;
}

function decodeFields(
  data: Uint8Array,
  byteOffset: number,
  expected: readonly (readonly [string, readonly number[]])[],
) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = byteOffset;
  return expected.map(([name, descriptor]) => {
    if (
      cursor > data.byteLength - 4 ||
      view.getUint32(cursor, true) !== name.length ||
      !matchesAscii(data, cursor + 4, name)
    ) {
      throw new Error(`schema field ${name} is not in declared order`);
    }
    const offset = cursor;
    cursor += 4 + name.length;
    if (
      cursor > data.byteLength - descriptor.length ||
      descriptor.some((value, index) => data[cursor + index] !== value)
    ) {
      throw new Error(`schema descriptor ${name} changed`);
    }
    cursor += descriptor.length;
    return {
      name,
      offset,
      descriptor: descriptor
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" "),
    };
  });
}

type FaceReplayReport = {
  release: number;
  ownerScopes: {
    total: number;
    completed: number;
    stoppedAtFirstUncertifiedDescendant: number;
  };
  certifiedDescendantsDecoded: number;
  tokenNamespace: {
    staticReferenceTokens: { count: number; nonFinite: number };
    acceptedSparseGaps: number;
    acceptedSparseIndices: number;
    gapWidths: Record<string, number>;
    reusedPropertyReferences: number;
    materializedReservedTokens: number;
  };
  sourceSlots: Record<
    string,
    {
      decoded: number;
      bodyBytes: Record<string, number>;
      appendedChildSlots: Record<string, number>;
      appendedChildTokenKinds: Record<string, number>;
    }
  >;
  firstUncertifiedDescendants: {
    sourceSlots: Record<string, number>;
    parentToChild: Record<string, number>;
    tokenKinds: Record<string, number>;
    bytesDecodedAfterGeometryBeforeBlocker: Record<string, number>;
  };
  failures: {
    readers: Record<string, number>;
    routes: Record<string, number>;
    boundaries: Record<string, number>;
  };
  readerCorpusValid: boolean;
};

function faceReplayEvidence(): FaceReplayReport {
  const auditPath = fileURLToPath(
    new URL("./audit-revit-2027-face-child-replay.ts", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", auditPath, modelPath!],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "Face-child replay failed");
  }
  return JSON.parse(result.stdout) as FaceReplayReport;
}

function empty(record: Record<string, number>): boolean {
  return Object.keys(record).length === 0;
}

function arcSummary(arc: Revit2027GArc) {
  return {
    byteOffset: arc.byteOffset,
    endOffset: arc.endOffset,
    gInfo: {
      gStyleElementId: arc.gInfo.gStyleElementId.toString(),
      tag: arc.gInfo.tag,
      controlCommand: arc.gInfo.controlCommand,
      flags: arc.gInfo.flags,
    },
    endParameters: arc.endParameters,
    xDirection: arc.xDirection,
    yDirection: arc.yDirection,
    radius: arc.radius,
    center: arc.center,
    isFilled: arc.isFilled,
  };
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const schema = firstInflatedSchema(cfb);
const view = new DataView(schema.buffer, schema.byteOffset, schema.byteLength);
const gCurveOffset = findName(schema, "GCurve");
let cursor = gCurveOffset + 2 + "GCurve".length;
const gCurveRawClassId = view.getUint16(cursor, true);
const gCurveVersion = view.getUint32(cursor + 2, true);
const gCurveFieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const gCurveFields = decodeFields(schema, cursor, [
  ["m_endParams", [0x07, 0x10, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]],
]);

const gArcOffset = findName(schema, "GArc");
cursor = gArcOffset + 2 + "GArc".length;
const gArcRawClassId = view.getUint16(cursor, true);
const gArcVersion = view.getUint32(cursor + 2, true);
const gArcFieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const vector3 = [0x07, 0x10, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00];
const gArcFields = decodeFields(schema, cursor, [
  ["m_xVec", vector3],
  ["m_yVec", vector3],
  ["m_radius", [0x07, 0x00, 0x00, 0x00]],
  ["m_center", vector3],
  ["m_bFilled", [0x01, 0x00, 0x00, 0x00]],
]);
const sourceName = sourceNameAtSlot(
  schema,
  REVIT_2027_GARC_SOURCE_CLASS_SLOT,
);
if (
  gCurveRawClassId !== 0x0592 ||
  gCurveVersion !== 3 ||
  gCurveFieldCount !== 1 ||
  gArcRawClassId !== 1974 ||
  gArcVersion !== 5 ||
  gArcFieldCount !== 5 ||
  sourceName.name !== "GArc"
) {
  throw new Error("GCurve/GArc schema or source-slot mapping changed");
}

const faceReplay = faceReplayEvidence();
const source4283 = faceReplay.sourceSlots["4283"];
const source2213 = faceReplay.sourceSlots["2213"];
const blockers = faceReplay.firstUncertifiedDescendants;
if (
  faceReplay.release !== 2027 ||
  !faceReplay.readerCorpusValid ||
  faceReplay.ownerScopes.total !== 5_996 ||
  faceReplay.ownerScopes.completed !== 5_996 ||
  faceReplay.ownerScopes.stoppedAtFirstUncertifiedDescendant !== 0 ||
  faceReplay.certifiedDescendantsDecoded !== 313 ||
  source4283?.decoded !== 2 ||
  source4283.bodyBytes["135"] !== 2 ||
  source4283.appendedChildSlots["2213"] !== 2 ||
  source4283.appendedChildTokenKinds["2213:numbered"] !== 2 ||
  source2213?.decoded !== 2 ||
  source2213.bodyBytes["117"] !== 2 ||
  !empty(blockers.sourceSlots) ||
  !empty(blockers.parentToChild) ||
  !empty(blockers.tokenKinds) ||
  !empty(blockers.bytesDecodedAfterGeometryBeforeBlocker) ||
  !empty(faceReplay.failures.readers) ||
  !empty(faceReplay.failures.routes) ||
  !empty(faceReplay.failures.boundaries)
) {
  throw new Error("shared fail-closed replay evidence changed");
}
if (
  faceReplay.tokenNamespace.staticReferenceTokens.count !== 664_379 ||
  faceReplay.tokenNamespace.staticReferenceTokens.nonFinite !== 0 ||
  faceReplay.tokenNamespace.acceptedSparseGaps !== 5 ||
  faceReplay.tokenNamespace.acceptedSparseIndices !== 13 ||
  JSON.stringify(faceReplay.tokenNamespace.gapWidths) !==
    JSON.stringify({ "1": 2, "2": 1, "3": 1, "6": 1 }) ||
  faceReplay.tokenNamespace.reusedPropertyReferences !== 0 ||
  faceReplay.tokenNamespace.materializedReservedTokens !== 13
) {
  throw new Error("shared StaticInteger/property-token namespace changed");
}

let exactBodies:
  | {
      partitionPath: string;
      chunkIndex: number;
      frameOffset: number;
      geometryEndOffset: number;
      bodyOffset: number;
      ownerEndOffset: number;
      bodies: readonly [Revit2027GArc, Revit2027GArc];
    }
  | null = null;

const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );
scan: for (const partition of partitions) {
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
    const data =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!data) continue;
    if (read) dictionary = revitWindowTail(read);
    for (const frame of scanFramedElementObjects(data)) {
      if (
        frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER ||
        frame.elementId !== EXACT_OWNER_ELEMENT_ID
      ) {
        continue;
      }
      const root = decodeRevit2027FramedGRepRoot(data, frame, 2027);
      if (
        !root.ok ||
        root.value.children.length !== 1 ||
        root.value.children[0]?.sourceClassSlot !==
          REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
      ) {
        throw new Error("exact GArc owner root changed");
      }
      const geometry = decodeRevit2027GeometryStatic(
        data,
        root.value.dynamicPayloadOffset,
        root.value.dynamicPayloadEndOffset,
        2027,
      );
      if (!geometry.ok) throw new Error(geometry.error);
      const bodyOffset =
        geometry.value.endOffset + EXACT_BYTES_BEFORE_FIRST_GARC;
      const first = decodeRevit2027GArc(
        data,
        bodyOffset,
        root.value.dynamicPayloadEndOffset,
        2027,
      );
      if (!first.ok) throw new Error(first.error);
      const second = decodeRevit2027GArc(
        data,
        first.value.endOffset,
        root.value.dynamicPayloadEndOffset,
        2027,
      );
      if (!second.ok) throw new Error(second.error);
      if (second.value.endOffset !== root.value.dynamicPayloadEndOffset) {
        throw new Error("two exact GArc bodies do not exhaust their owner");
      }
      exactBodies = {
        partitionPath: partition.path,
        chunkIndex,
        frameOffset: frame.offset,
        geometryEndOffset: geometry.value.endOffset,
        bodyOffset,
        ownerEndOffset: root.value.dynamicPayloadEndOffset,
        bodies: [first.value, second.value],
      };
      break scan;
    }
  }
}
if (!exactBodies) {
  throw new Error(`exact GArc owner ${EXACT_OWNER_ELEMENT_ID} was not found`);
}

const summaries = exactBodies.bodies.map(arcSummary);
if (
  exactBodies.ownerEndOffset - exactBodies.bodyOffset !==
    REVIT_2027_GARC_BODY_BYTES * 2 ||
  summaries.some(
    (arc) =>
      arc.gInfo.gStyleElementId !== "-1" ||
      arc.gInfo.tag !== -1 ||
      arc.gInfo.controlCommand !== 0 ||
      arc.gInfo.flags !== 0x01080004 ||
      arc.radius !== 0.01968503937007874 ||
      JSON.stringify(arc.xDirection) !== "[0,0,1]" ||
      JSON.stringify(arc.yDirection) !== "[-1,0,0]" ||
      arc.isFilled,
  ) ||
  JSON.stringify(summaries[0]?.endParameters) !==
    "[3.14159265358979,6.28318530717958]" ||
  JSON.stringify(summaries[1]?.endParameters) !==
    "[0,3.14159265358979]"
) {
  throw new Error(`exact GArc values changed: ${JSON.stringify(summaries)}`);
}

console.log(
  JSON.stringify(
    {
      modelPath,
      sourceClassSlot: REVIT_2027_GARC_SOURCE_CLASS_SLOT,
      schema: {
        byteLength: schema.byteLength,
        sourceName,
        parent: {
          name: "GCurve",
          offset: gCurveOffset,
          rawClassId: `0x${gCurveRawClassId.toString(16).padStart(4, "0")}`,
          version: gCurveVersion,
          fieldCount: gCurveFieldCount,
          fields: gCurveFields,
        },
        derived: {
          name: "GArc",
          offset: gArcOffset,
          rawClassId: gArcRawClassId,
          version: gArcVersion,
          fieldCount: gArcFieldCount,
          fields: gArcFields,
        },
      },
      bodyCorpus: {
        ownerElementId: EXACT_OWNER_ELEMENT_ID,
        partitionPath: exactBodies.partitionPath,
        chunkIndex: exactBodies.chunkIndex,
        frameOffset: exactBodies.frameOffset,
        geometryEndOffset: exactBodies.geometryEndOffset,
        bytesBeforeFirstGArc: EXACT_BYTES_BEFORE_FIRST_GARC,
        firstBodyOffset: exactBodies.bodyOffset,
        ownerEndOffset: exactBodies.ownerEndOffset,
        count: summaries.length,
        bodyBytes: REVIT_2027_GARC_BODY_BYTES,
        bodies: summaries,
        exactSuccessorBoundary: true,
      },
      nativeProof: {
        library: "TB_Format2026Readers.tx",
        readerSourceSlot: 2173,
        reader: "0x10c8372",
        parent:
          "GCurve source 1932 @ call 0x10c879d; GCurve calls GNode " +
          "source 1399 @ 0x10c70c9 and reads fixed endParams[2]",
        derived:
          "x/y Vector3d @ 0x10c8805/0x10c8838; radius double @ " +
          "0x10c8863; center Point3d @ 0x10c888e; strict bool @ 0x10c88b9",
      },
      sharedTokenNamespace: {
        rule:
          "every skipped positive property index is accepted only when an " +
          "earlier StaticInteger reserved it",
        ...faceReplay.tokenNamespace,
        noReaderRouteOrBoundaryFailures: true,
      },
      exactCorpusCertified: true,
      stopBoundary:
        "both queued GArc bodies end exactly at the owner boundary and the " +
        "shared replay completes all 5,996 owner scopes",
    },
    null,
    2,
  ),
);
