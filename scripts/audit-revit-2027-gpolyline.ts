/**
 * Audit exact count-bounded Revit 2027 GPolyLine FIFO bodies.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-revit-2027-gpolyline.ts model.rvt
 */
import {
  PARTITION_STREAM_PATTERN,
  iterateInflatedChunks,
  openRvt,
  requireModelPath,
} from "./lib/rvt-harness.ts";

import {
  increment,
} from "./lib/rvt-harness.ts";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GPolyLine,
  REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gpolyline.ts";

const modelPath = requireModelPath(
  "audit-revit-2027-gpolyline.ts model.rvt",
);

function numericRecord(map: Map<number, number>): Record<string, number> {
  return Object.fromEntries(
    [...map].sort((left, right) => left[0] - right[0]),
  );
}

function countRecord<Key extends string | number | bigint>(
  map: Map<Key, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
      .map(([key, count]) => [String(key), count]),
  );
}

const model = openRvt(modelPath);
const release = model.requireRelease(2027);

const partitions = model.streamsMatching(PARTITION_STREAM_PATTERN);

let chunks = 0;
let failedChunks = 0;
let outerDescriptors = 0;
let firstChildCandidates = 0;
let decodedBodies = 0;
let closedBodies = 0;
let filledBodies = 0;
let exactCoordinateExtents = 0;
let lineSegments = 0;
const childShapes = new Map<string, number>();
const pointCounts = new Map<number, number>();
const bodyByteLengths = new Map<number, number>();
const trailingPayloadBytes = new Map<number, number>();
const styles = new Map<bigint, number>();
const tags = new Map<number, number>();
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
    const matchingChildren = root.children.filter(
      (child) =>
        child.sourceClassSlot === REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
    );
    outerDescriptors += matchingChildren.length;
    if (matchingChildren.length === 0) continue;

    increment(
      childShapes,
      root.children
        .map((child) => child.sourceClassSlot ?? 0)
        .join(","),
    );
    if (
      root.children[0]?.sourceClassSlot !==
      REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT
    ) {
      increment(failures, "GPolyLine is not the first queued child");
      continue;
    }
    firstChildCandidates += 1;

    const decoded = decodeRevit2027GPolyLine(
      inflated,
      root.dynamicPayloadOffset,
      root.dynamicPayloadEndOffset,
      release,
    );
    if (!decoded.ok) {
      increment(failures, decoded.error);
      continue;
    }
    decodedBodies += 1;
    const polyline = decoded.value;
    increment(pointCounts, polyline.coordinates.length);
    increment(bodyByteLengths, polyline.endOffset - polyline.byteOffset);
    increment(
      trailingPayloadBytes,
      root.dynamicPayloadEndOffset - polyline.endOffset,
    );
    increment(styles, polyline.gInfo.gStyleElementId);
    increment(tags, polyline.gInfo.tag);
    if (polyline.closed) closedBodies += 1;
    if (polyline.filled) filledBodies += 1;
    if (polyline.extentsMatchCoordinates) exactCoordinateExtents += 1;
    lineSegments += Math.max(0, polyline.coordinates.length - 1);
  }

}
console.log(JSON.stringify({
  modelPath,
  release,
  sourceClassSlot: REVIT_2027_GPOLYLINE_SOURCE_CLASS_SLOT,
  partitions: partitions.length,
  chunks,
  failedChunks,
  outerDescriptors,
  firstChildCandidates,
  decodedBodies,
  closedBodies,
  filledBodies,
  exactCoordinateExtents,
  lineSegments,
  childShapes: countRecord(childShapes),
  pointCounts: numericRecord(pointCounts),
  bodyByteLengths: numericRecord(bodyByteLengths),
  trailingPayloadBytes: numericRecord(trailingPayloadBytes),
  styles: countRecord(styles),
  tags: countRecord(tags),
  failures: countRecord(failures),
}, null, 2));
