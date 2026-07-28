/**
 * Audit the common DynamicQueue subset at proven GRep roots.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-grep-queue-replay.ts model.rvt
 */
import { readFileSync } from "node:fs";
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
  certifyRevitGRepInitialQueue,
  GREP_QUEUE_INITIAL_TOKEN_COUNT,
} from "../lib/reviter/revit-grep-queue-replay.ts";
import {
  REVIT_2026_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2026-grep-root.ts";

const NUMERIC_COINCIDENCE_SLOTS = new Set([2215, 2248]);
const MAX_REPORTED_SEQUENCES = 20;

function percentiles(values: number[]): Record<string, number> {
  values.sort((left, right) => left - right);
  const at = (ratio: number) =>
    values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0;
  return {
    min: values[0] ?? 0,
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: values[values.length - 1] ?? 0,
  };
}

const modelPath = process.argv[2];
if (!modelPath) {
  throw new Error(
    "usage: node --experimental-strip-types scripts/audit-revit-grep-queue-replay.ts model.rvt",
  );
}

const cfb = CFB.read(readFileSync(modelPath), { type: "buffer" });
const partitions = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .filter(
    ({ entry, path }) =>
      entry.size > 0 && /\/Partitions\/[^/]+$/i.test(path),
  );

let chunks = 0;
let failedChunks = 0;
let decodedPlans = 0;
let oneEntryPlans = 0;
let multiEntryPlans = 0;
let numericCoincidencePlans = 0;
let numericCoincidenceOneEntryPlans = 0;
let numericCoincidenceMultiEntryPlans = 0;
let nonSequentialTokenPlans = 0;
let duplicateTokens = 0;
let zeroOrOneTokens = 0;
let negativeTokens = 0;
const oneEntryPayloadBytes: number[] = [];
const multiEntryPayloadBytes: number[] = [];
const childCountHistogram = new Map<number, number>();
const sourceSlotSequenceCounts = new Map<string, number>();
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
      if (frame.marker !== REVIT_2026_GELEMENT_OBJECT_MARKER) continue;
      const planned = certifyRevitGRepInitialQueue(inflated, frame);
      if (!planned.ok) {
        failures.set(planned.error, (failures.get(planned.error) ?? 0) + 1);
        if (/append-only/.test(planned.error)) nonSequentialTokenPlans += 1;
        continue;
      }
      decodedPlans += 1;
      const plan = planned.value;
      const childCount = plan.entries.length;
      childCountHistogram.set(
        childCount,
        (childCountHistogram.get(childCount) ?? 0) + 1,
      );
      const payloadBytes = plan.replayEndOffset - plan.replayOffset;
      if (childCount === 1) {
        oneEntryPlans += 1;
        oneEntryPayloadBytes.push(payloadBytes);
      } else {
        multiEntryPlans += 1;
        multiEntryPayloadBytes.push(payloadBytes);
      }

      const seenTokens = new Set<number>();
      for (const entry of plan.entries) {
        if (seenTokens.has(entry.propertyToken)) duplicateTokens += 1;
        seenTokens.add(entry.propertyToken);
        if (entry.propertyToken < 0) negativeTokens += 1;
        if (entry.propertyToken === 0 || entry.propertyToken === 1) {
          zeroOrOneTokens += 1;
        }
      }

      const sourceSequence = plan.entries
        .map((entry) => entry.propertySourceClassSlot)
        .join(",");
      sourceSlotSequenceCounts.set(
        sourceSequence,
        (sourceSlotSequenceCounts.get(sourceSequence) ?? 0) + 1,
      );
      const numericCoincidence = plan.entries.every((entry) =>
        NUMERIC_COINCIDENCE_SLOTS.has(entry.propertySourceClassSlot)
      );
      if (numericCoincidence) {
        numericCoincidencePlans += 1;
        if (childCount === 1) numericCoincidenceOneEntryPlans += 1;
        else numericCoincidenceMultiEntryPlans += 1;
      }
    }
  }
}

console.log(JSON.stringify({
  modelPath,
  partitions: partitions.length,
  chunks,
  failedChunks,
  initialTokenCount: GREP_QUEUE_INITIAL_TOKEN_COUNT,
  decodedPlans,
  oneEntryPlans,
  multiEntryPlans,
  tokenAudit: {
    nonSequentialTokenPlans,
    duplicateTokens,
    zeroOrOneTokens,
    negativeTokens,
  },
  numericCoincidenceSlots: [...NUMERIC_COINCIDENCE_SLOTS],
  numericCoincidencePlans,
  numericCoincidenceOneEntryPlans,
  numericCoincidenceMultiEntryPlans,
  completeExactModelReplays: 0,
  completeReplayBoundary:
    "The exact model is Revit 2027. Numeric source-slot coincidences with a Revit 2026 table do not authorize stream consumption.",
  dynamicPayloadBytes: {
    oneEntry: percentiles(oneEntryPayloadBytes),
    multiEntry: percentiles(multiEntryPayloadBytes),
  },
  childCountHistogram: Object.fromEntries(
    [...childCountHistogram].sort((left, right) => left[0] - right[0]),
  ),
  topSourceSlotSequences: [...sourceSlotSequenceCounts]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_REPORTED_SEQUENCES)
    .map(([slots, count]) => ({ slots, count })),
  failures: Object.fromEntries(
    [...failures].sort((left, right) => right[1] - left[1]),
  ),
}, null, 2));
