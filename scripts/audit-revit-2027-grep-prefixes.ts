/**
 * Audit the release-gated Revit 2027 GArray and GGroup-prefix readers.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-revit-2027-grep-prefixes.ts model.rvt
 */
import {
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GArray,
  decodeRevit2027GGroupPrefix,
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";

const modelPath = requireModelPath(
  "audit-revit-2027-grep-prefixes.ts model.rvt",
);

const model = openRvt(modelPath);
const release = model.requireRelease(2027);
const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let oneEntryGArrays = 0;
let decodedOneEntryGArrays = 0;
let firstEntryGroups = 0;
let decodedFirstEntryGroups = 0;
let sequentialNestedTokens = 0;
const gArrayFailures = new Map<string, number>();
const gGroupFailures = new Map<string, number>();
const nestedSourceSlots = new Map<number, number>();

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
    const first = root.children[0];

    if (
      root.children.length === 1 &&
      first?.sourceClassSlot === REVIT_2027_GARRAY_SOURCE_CLASS_SLOT
    ) {
      oneEntryGArrays += 1;
      const decoded = decodeRevit2027GArray(
        inflated,
        root.dynamicPayloadOffset,
        root.dynamicPayloadOffset + REVIT_2027_GARRAY_BODY_BYTES,
        release,
      );
      if (decoded.ok) decodedOneEntryGArrays += 1;
      else {
        gArrayFailures.set(
          decoded.error,
          (gArrayFailures.get(decoded.error) ?? 0) + 1,
        );
      }
    }

    if (first?.sourceClassSlot === REVIT_2027_GGROUP_SOURCE_CLASS_SLOT) {
      firstEntryGroups += 1;
      const decoded = decodeRevit2027GGroupPrefix(
        inflated,
        root.dynamicPayloadOffset,
        root.dynamicPayloadEndOffset,
        release,
      );
      if (!decoded.ok) {
        gGroupFailures.set(
          decoded.error,
          (gGroupFailures.get(decoded.error) ?? 0) + 1,
        );
        continue;
      }
      decodedFirstEntryGroups += 1;
      const expectedFirstToken = 3 + root.children.length;
      if (
        decoded.value.children.every(
          (child, index) => child.token === expectedFirstToken + index,
        )
      ) {
        sequentialNestedTokens += 1;
      }
      for (const child of decoded.value.children) {
        if (child.sourceClassSlot == null) continue;
        nestedSourceSlots.set(
          child.sourceClassSlot,
          (nestedSourceSlots.get(child.sourceClassSlot) ?? 0) + 1,
        );
      }
    }
  }

}
console.log(JSON.stringify({
  modelPath,
  release,
  partitions: partitions.length,
  chunks,
  failedChunks,
  gArray: {
    sourceClassSlot: REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
    oneEntryCandidates: oneEntryGArrays,
    decodedExact144ByteBodies: decodedOneEntryGArrays,
    failures: Object.fromEntries(
      [...gArrayFailures].sort((left, right) => right[1] - left[1]),
    ),
  },
  gGroup: {
    sourceClassSlot: REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
    firstEntryCandidates: firstEntryGroups,
    decodedStaticPrefixes: decodedFirstEntryGroups,
    sequentialNestedTokens,
    nestedSourceSlots: Object.fromEntries(
      [...nestedSourceSlots].sort((left, right) => right[1] - left[1]),
    ),
    failures: Object.fromEntries(
      [...gGroupFailures].sort((left, right) => right[1] - left[1]),
    ),
  },
}, null, 2));
