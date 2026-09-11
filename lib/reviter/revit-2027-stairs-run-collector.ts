import {
  decodeRevit2027StairsElementAggregate,
  decodeRevit2027StairsRunAndLandingAggregate,
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
  type Revit2027StairsElementAggregate,
  type Revit2027StairsRunAndLandingAggregate,
} from "./revit-2027-stairs-aggregate.ts";

const MAX_FRAME_BYTES = 1024 * 1024;
const HEADER_SCAN_BYTES = 22;
const FRAME_SUFFIX_BYTES = 20;

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
  let buffer = new Uint8Array();
  let bufferStreamOffset = 0;
  let nextScanOffset = 0;
  const pending = new Map<
    number,
    { elementId: number; objectLength: number; marker: number }
  >();
  const knownStairsIds = new Set<number>();
  const stairsAggregates = new Map<number, Revit2027StairsElementAggregate>();
  const runFrames: {
    elementId: number;
    objectLength: number;
    data: Uint8Array;
  }[] = [];

  const finishPartition = (): void => {
    buffer = new Uint8Array();
    bufferStreamOffset = 0;
    nextScanOffset = 0;
    pending.clear();
  };

  return {
    pushPage(page: Uint8Array): void {
      if (release !== 2027) return;
      const combined = new Uint8Array(buffer.byteLength + page.byteLength);
      combined.set(buffer);
      combined.set(page, buffer.byteLength);
      const combinedStart = bufferStreamOffset;
      const combinedEnd = combinedStart + combined.byteLength;
      const view = new DataView(
        combined.buffer,
        combined.byteOffset,
        combined.byteLength,
      );
      const scanStart = Math.max(nextScanOffset, combinedStart);
      const scanEnd = combinedEnd - HEADER_SCAN_BYTES;
      for (
        let streamOffset = scanStart;
        streamOffset <= scanEnd;
        streamOffset += 1
      ) {
        const offset = streamOffset - combinedStart;
        const marker = view.getUint16(offset + 16, true);
        if (
          (marker !== REVIT_2027_STAIRS_RUN_MARKER &&
            marker !== REVIT_2027_STAIRS_ELEMENT_MARKER) ||
          view.getUint32(offset + 4, true) !== 0 ||
          view.getUint32(offset + 18, true) !== 0
        ) {
          continue;
        }
        const elementId = view.getUint32(offset, true);
        const objectLength = view.getUint32(offset + 12, true);
        if (
          elementId === 0 ||
          objectLength < 127 ||
          objectLength + FRAME_SUFFIX_BYTES > MAX_FRAME_BYTES
        ) {
          continue;
        }
        pending.set(streamOffset, { elementId, objectLength, marker });
      }
      nextScanOffset = Math.max(nextScanOffset, scanEnd + 1);

      for (const [streamOffset, target] of pending) {
        const frameEnd =
          streamOffset + target.objectLength + FRAME_SUFFIX_BYTES;
        if (frameEnd > combinedEnd) continue;
        const offset = streamOffset - combinedStart;
        if (
          offset < 0 ||
          view.getUint32(offset + target.objectLength + 16, true) !==
            target.objectLength
        ) {
          pending.delete(streamOffset);
          continue;
        }
        const data = combined.slice(
          offset,
          offset + target.objectLength + FRAME_SUFFIX_BYTES,
        );
        if (target.marker === REVIT_2027_STAIRS_ELEMENT_MARKER) {
          const decoded = decodeRevit2027StairsElementAggregate(
            data,
            0,
            target.objectLength,
            2027,
          );
          if (decoded.ok && decoded.value.elementId === target.elementId) {
            knownStairsIds.add(target.elementId);
            stairsAggregates.set(target.elementId, decoded.value);
          }
        } else {
          runFrames.push({
            elementId: target.elementId,
            objectLength: target.objectLength,
            data,
          });
        }
        pending.delete(streamOffset);
      }

      let retainFrom = nextScanOffset;
      for (const streamOffset of pending.keys()) {
        retainFrom = Math.min(retainFrom, streamOffset);
      }
      retainFrom = Math.max(combinedStart, retainFrom);
      buffer = combined.slice(retainFrom - combinedStart);
      bufferStreamOffset = retainFrom;
    },
    finishPartition,
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
