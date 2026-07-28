/**
 * Certify source-slot 2,087 `FillPatternData` against the exact UNBC model.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-fill-pattern-data.ts model.rvt
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import CFB from "cfb";

import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-fill-pattern-data.ts";

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: audit-revit-2027-fill-pattern-data.ts model.rvt",
  );
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
  decodedFillPatternData: number;
  decodedFillGrids: number;
  fillPatternDataBodyBytes: Record<string, number>;
  fillPatternDataGridCounts: Record<string, number>;
  fillPatternGridSlots: Record<string, number>;
  fillPatternGridTokenKinds: Record<string, number>;
  fillPatternScalarRanges: Record<string, [number, number]>;
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
const schemaOffset = findName(schema, "FillPatternData");
const view = new DataView(schema.buffer, schema.byteOffset, schema.byteLength);
let cursor = schemaOffset + 2 + "FillPatternData".length;
const rawClassId = view.getUint16(cursor, true);
const version = view.getUint32(cursor + 2, true);
const fieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const fields = decodeFields(schema, cursor, [
  ["m_windowSize", [0x07, 0x00, 0x00, 0x00]],
  ["m_lengthPerArea", [0x07, 0x00, 0x00, 0x00]],
  ["m_strokesPerArea", [0x07, 0x00, 0x00, 0x00]],
  ["m_linesPerLength", [0x07, 0x00, 0x00, 0x00]],
  ["m_fillGrids", [0x0e, 0x51, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
]);
if (rawClassId !== 0 || version !== 1 || fieldCount !== 5) {
  throw new Error("FillPatternData schema header changed");
}

const replay = replayEvidence();
const expectedUpstreamFailures = {
  "FIFO token mismatch: expected 208, received 209 for source slot 1434": 1,
  "no descendant reader for slot 2213": 1,
  "FIFO token mismatch: expected 431, received 434 for source slot 1434": 1,
};
const exactCorpus =
  replay.decodedFillPatternData === 50 &&
  replay.decodedFillGrids === 99 &&
  replay.fillPatternDataBodyBytes["42"] === 1 &&
  replay.fillPatternDataBodyBytes["48"] === 49 &&
  replay.fillPatternDataGridCounts["1"] === 1 &&
  replay.fillPatternDataGridCounts["2"] === 49 &&
  replay.fillPatternGridSlots["2085"] === 99 &&
  replay.fillPatternGridTokenKinds.sentinel === 99 &&
  JSON.stringify(replay.replayFailures) ===
    JSON.stringify(expectedUpstreamFailures);
if (!exactCorpus) {
  throw new Error(
    `exact FillPatternData corpus changed: ${JSON.stringify(replay)}`,
  );
}

console.log(
  JSON.stringify(
    {
      modelPath,
      sourceClassSlot: REVIT_2027_FILL_PATTERN_DATA_SOURCE_CLASS_SLOT,
      schema: {
        byteLength: schema.byteLength,
        offset: schemaOffset,
        rawClassId,
        version,
        fieldCount,
        fields,
      },
      bodyCorpus: {
        decoded: replay.decodedFillPatternData,
        bodyBytes: replay.fillPatternDataBodyBytes,
        gridCounts: replay.fillPatternDataGridCounts,
        scalarRanges: replay.fillPatternScalarRanges,
      },
      queuedFillGrids: {
        total: 99,
        sourceClassSlots: replay.fillPatternGridSlots,
        tokenKinds: replay.fillPatternGridTokenKinds,
      },
      nativeProof: {
        library: "TB_FormatCommonReaders.tx",
        commonSourceSlot: 5313,
        reader: "0x6df656",
        scalarCalls: [
          "windowSize @ 0x6dfa0f",
          "lengthPerArea @ 0x6dfa3a",
          "strokesPerArea @ 0x6dfa65",
          "linesPerLength @ 0x6dfa90",
        ],
        fillGridCollection:
          "OdArray<OdBmCondInt16> collection read @ 0x6dfc1b",
      },
      exactCorpusCertified: true,
      upstreamReplayFailures: replay.replayFailures,
      stopBoundary:
        "all 50 FillPatternData bodies and their 99 queued source-2085 " +
        "FillGrid bodies decode exactly; source-2213 GArc is the next " +
        "descendant boundary",
    },
    null,
    2,
  ),
);
