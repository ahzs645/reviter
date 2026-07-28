/**
 * Certify source-slot 2,085 `FillGrid` against the exact UNBC model.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-fill-grid.ts model.rvt
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import { REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-fill-grid.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error("usage: audit-revit-2027-fill-grid.ts model.rvt");
}

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

function findName(data: Uint8Array, name: string): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (
    let offset = 0;
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

type ReplayEvidence = {
  certifiedOwners?: number;
  decodedOwners?: number;
  decodedFillPatternData: number;
  decodedFillGrids: number;
  fillGridBodyBytes: Record<string, number>;
  fillGridSegmentCounts: Record<string, number>;
  fillGridScalarRanges: Record<string, [number | null, number | null]>;
  replayFailures: Record<string, number>;
};

function replayEvidence(): ReplayEvidence {
  const replayPath = fileURLToPath(
    new URL("./audit-revit-2027-gfilling.ts", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", replayPath, modelPath!],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status === 0) {
    return JSON.parse(result.stdout).exactFirstGenerationReplay;
  }
  const marker = "exact first-generation Face-child replay changed: ";
  const start = result.stderr.indexOf(marker);
  const endMarker = "\n    at ";
  const end = result.stderr.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(result.stderr || "GFilling replay did not return evidence");
  }
  return JSON.parse(
    result.stderr.slice(start + marker.length, end),
  ) as ReplayEvidence;
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const schema = firstInflatedSchema(cfb);
const schemaOffset = findName(schema, "FillGrid");
const view = new DataView(schema.buffer, schema.byteOffset, schema.byteLength);
let cursor = schemaOffset + 2 + "FillGrid".length;
const rawClassId = view.getUint16(cursor, true);
const version = view.getUint32(cursor + 2, true);
const fieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const fields = decodeFields(schema, cursor, [
  ["m_angle", [0x07, 0x00, 0x00, 0x00]],
  ["m_origin", [0x07, 0x10, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]],
  ["m_deltas", [0x07, 0x10, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]],
  ["m_segs", [0x07, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
]);
if (rawClassId !== 0 || version !== 1 || fieldCount !== 4) {
  throw new Error("FillGrid schema header changed");
}

const replay = replayEvidence();
const expectedRemainingFailures = {
  "FIFO token mismatch: expected 208, received 209 for source slot 1434": 1,
  "no descendant reader for slot 2213": 1,
  "FIFO token mismatch: expected 431, received 434 for source slot 1434": 1,
};
const exactCorpus =
  (replay.certifiedOwners ?? replay.decodedOwners) === 5_993 &&
  replay.decodedFillPatternData === 50 &&
  replay.decodedFillGrids === 99 &&
  replay.fillGridBodyBytes["44"] === 99 &&
  replay.fillGridSegmentCounts["0"] === 99 &&
  Object.keys(replay.fillGridBodyBytes).length === 1 &&
  Object.keys(replay.fillGridSegmentCounts).length === 1 &&
  JSON.stringify(replay.replayFailures) ===
    JSON.stringify(expectedRemainingFailures);
if (!exactCorpus) {
  throw new Error(`exact FillGrid corpus changed: ${JSON.stringify(replay)}`);
}

console.log(
  JSON.stringify(
    {
      modelPath,
      sourceClassSlot: REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT,
      schema: {
        byteLength: schema.byteLength,
        offset: schemaOffset,
        rawClassId,
        version,
        fieldCount,
        fields,
      },
      bodyCorpus: {
        decoded: replay.decodedFillGrids,
        bodyBytes: replay.fillGridBodyBytes,
        segmentCounts: replay.fillGridSegmentCounts,
        scalarRanges: replay.fillGridScalarRanges,
      },
      nativeProof: {
        library: "TB_FormatCommonReaders.tx",
        commonSourceSlot: 5312,
        reader: "0x6dcea2",
        angle: "doubleReader @ 0x6dd250; setAngle @ 0x6dd258",
        origin:
          "OdGePoint2dReader<double> @ 0x6dd275; setOrigin @ 0x6dd297",
        deltas:
          "fixed two-double collection @ 0x6dd2b6..0x6dd3c6; " +
          "setDeltas @ 0x6dd3f6",
        segments:
          "OdArray<double> collection read @ 0x6dd4fe; " +
          "setSegments @ 0x6dd50e",
      },
      exactCorpusCertified: true,
      remainingReplayFailures: replay.replayFailures,
      stopBoundary:
        "all 99 FillGrid bodies decode exactly; one queued source-2213 " +
        "GArc profile and two static-reference token transitions remain",
    },
    null,
    2,
  ),
);
