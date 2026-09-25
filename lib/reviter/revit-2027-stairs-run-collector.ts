import {
  decodeRevit2027StairsElementAggregate,
  decodeRevit2027StairsRunAndLandingAggregate,
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
  type Revit2027StairsElementAggregate,
  type Revit2027StairsRunAndLandingAggregate,
} from "./revit-2027-stairs-aggregate.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";

const MAX_FRAME_BYTES = 1024 * 1024;

/** The smallest `StairsRun` or `Stairs` frame the aggregate readers accept. */
const MIN_OBJECT_LENGTH = 127;

export type Revit2027StairsRunCollector = {
  pushPage(page: Uint8Array): void;
  finishPartition(): void;
  snapshot(): ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate>;
  /**
   * The decoded `Stairs` element aggregates, keyed by stair element id.
   *
   * The element frame was already being decoded here to learn which ids are
   * stairs, and everything else it carries -- the registered railings, the
   * runs and landings, the supports -- was discarded a line later. That is the
   * assembly tree, and a consumer that has to know a stringer from a mullion,
   * or which flights share a stairwell, cannot reconstruct it from geometry.
   */
  stairsSnapshot(): ReadonlyMap<number, Revit2027StairsElementAggregate>;
};

/**
 * Reassemble only split Revit 2027 `StairsRun` frames.
 *
 * Large run records cross compressed page boundaries (the UNBC spiral run is
 * 128,873 bytes), while the ordinary per-page object scanner deliberately
 * cannot see them. This bounded collector retains an incomplete target frame
 * and the split-header tail only; it never joins a whole partition.
 */
export function createRevit2027StairsRunCollector(
  release: number | null | undefined,
): Revit2027StairsRunCollector {
  const stream = createSplitFrameStream({
    markers: [REVIT_2027_STAIRS_RUN_MARKER, REVIT_2027_STAIRS_ELEMENT_MARKER],
    minObjectLength: MIN_OBJECT_LENGTH,
    maxFrameBytes: MAX_FRAME_BYTES,
    // Both classes write a zero type code.
    acceptHeader: (view, offset) => view.getUint32(offset + 18, true) === 0,
  });
  const knownStairsIds = new Set<number>();
  const stairsAggregates = new Map<number, Revit2027StairsElementAggregate>();
  const runFrames: {
    elementId: number;
    objectLength: number;
    data: Uint8Array;
  }[] = [];

  return {
    pushPage(page: Uint8Array): void {
      if (!usesRevit2027RecordLayout(release)) return;
      for (const frame of stream.push(page)) {
        if (frame.marker === REVIT_2027_STAIRS_ELEMENT_MARKER) {
          const decoded = decodeRevit2027StairsElementAggregate(
            frame.data,
            0,
            frame.objectLength,
            2027,
          );
          if (decoded.ok && decoded.value.elementId === frame.elementId) {
            knownStairsIds.add(frame.elementId);
            stairsAggregates.set(frame.elementId, decoded.value);
          }
        } else {
          runFrames.push({
            elementId: frame.elementId,
            objectLength: frame.objectLength,
            data: frame.data,
          });
        }
      }
    },
    finishPartition: () => stream.reset(),
    snapshot(): ReadonlyMap<number, Revit2027StairsRunAndLandingAggregate> {
      const runs = new Map<number, Revit2027StairsRunAndLandingAggregate>();
      for (const frame of runFrames) {
        const decoded = decodeRevit2027StairsRunAndLandingAggregate(
          frame.data,
          0,
          frame.objectLength,
          2027,
          { knownStairsElementIds: knownStairsIds },
        );
        if (
          decoded.ok &&
          decoded.value.elementId === frame.elementId &&
          decoded.value.runProperties
        ) {
          runs.set(frame.elementId, decoded.value);
        }
      }
      return new Map(runs);
    },
    stairsSnapshot(): ReadonlyMap<number, Revit2027StairsElementAggregate> {
      return new Map(stairsAggregates);
    },
  };
}
