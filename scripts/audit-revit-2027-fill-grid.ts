/**
 * Certify source-slot 2,085 `FillGrid` against the exact UNBC model.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-fill-grid.ts model.rvt
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import {
  decodeSchemaFields,
  requireNameOffset,
} from "./lib/rvt-harness.ts";

import { REVIT_2027_FILL_GRID_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-fill-grid.ts";
const modelPath = requireModelPath(
  "audit-revit-2027-fill-grid.ts model.rvt",
);

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

const model = openRvt(modelPath);
const schema = model.requireSchema();
const schemaOffset = requireNameOffset(schema, "FillGrid");
const view = new DataView(schema.buffer, schema.byteOffset, schema.byteLength);
let cursor = schemaOffset + 2 + "FillGrid".length;
const rawClassId = view.getUint16(cursor, true);
const version = view.getUint32(cursor + 2, true);
const fieldCount = view.getUint32(cursor + 6, true);
cursor += 10;
const fields = decodeSchemaFields(schema, cursor, [
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
