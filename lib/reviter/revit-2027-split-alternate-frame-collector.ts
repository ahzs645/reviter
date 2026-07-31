import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";
import { MAX_SCANNED_OBJECT_BYTES } from "./element-objects.ts";

const HEADER_SCAN_BYTES = 22;
const FRAME_SUFFIX_BYTES = 20;
const MIN_FRAME_BYTES = 40;
const DEFAULT_MAX_FRAME_BYTES = 320 * 1024 * 1024;

type PendingFrame = {
  elementId: number;
  marker: number;
  objectLength: number;
  requiresAlternateScan: boolean;
};

export type Revit2027SplitAlternateFrameCollector = {
  /**
   * Append one consecutive inflated partition page and return only alternate
   * geometry frames that could not have been seen by the ordinary page scan.
   */
  pushPage(page: Uint8Array): readonly Uint8Array[];
  /** Drop incomplete state so bytes from two partition streams never join. */
  finishPartition(): void;
};

/**
 * Recover release-2027 alternate native-geometry frames excluded from the
 * ordinary framed-object scan.
 *
 * The normal framed-object scanner intentionally operates on one inflated page
 * at a time. Most records fit there, but a TopRailType or BaseRailingSym can
 * contain hundreds of persisted curve/instance entries. They can cross several
 * page boundaries, and even a single-page frame can exceed that scanner's
 * deliberate 65,535-byte general-object ceiling. Without its complete outer
 * frame the alternate native reader cannot bind those entries to the referenced
 * symbol id.
 *
 * This collector remains bounded: it recognizes only the two alternate frame
 * markers, retains only incomplete target frames plus the possible split-header
 * tail, validates the independent length echo, and emits only frames proven to
 * span a page boundary or exceed the ordinary scanner's size ceiling. Ordinary
 * complete frames stay on the existing page path and are not decoded twice.
 */
export function createRevit2027SplitAlternateFrameCollector(
  release: number | null | undefined,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
): Revit2027SplitAlternateFrameCollector {
  const boundedMaxFrameBytes =
    Number.isSafeInteger(maxFrameBytes) && maxFrameBytes >= MIN_FRAME_BYTES
      ? maxFrameBytes
      : DEFAULT_MAX_FRAME_BYTES;
  let buffer = new Uint8Array();
  let bufferStreamOffset = 0;
  let nextScanOffset = 0;
  const pending = new Map<number, PendingFrame>();

  const finishPartition = (): void => {
    buffer = new Uint8Array();
    bufferStreamOffset = 0;
    nextScanOffset = 0;
    pending.clear();
  };

  return {
    pushPage(page: Uint8Array): readonly Uint8Array[] {
      if (release !== 2027 || page.byteLength === 0) return [];
      const pageStart = bufferStreamOffset + buffer.byteLength;
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
          (marker !== REVIT_2027_TOP_RAIL_TYPE_MARKER &&
            marker !== REVIT_2027_BASE_RAILING_SYMBOL_MARKER) ||
          view.getUint32(offset + 4, true) !== 0
        ) {
          continue;
        }
        const elementId = view.getUint32(offset, true);
        const objectLength = view.getUint32(offset + 12, true);
        if (
          elementId === 0 ||
          objectLength < MIN_FRAME_BYTES ||
          objectLength + FRAME_SUFFIX_BYTES > boundedMaxFrameBytes
        ) {
          continue;
        }
        const frameEnd = streamOffset + objectLength + FRAME_SUFFIX_BYTES;
        pending.set(streamOffset, {
          elementId,
          marker,
          objectLength,
          requiresAlternateScan:
            streamOffset < pageStart ||
            frameEnd > combinedEnd ||
            objectLength > MAX_SCANNED_OBJECT_BYTES,
        });
      }
      nextScanOffset = Math.max(nextScanOffset, scanEnd + 1);

      const complete: Uint8Array[] = [];
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
        if (target.requiresAlternateScan) {
          complete.push(
            combined.slice(
              offset,
              offset + target.objectLength + FRAME_SUFFIX_BYTES,
            ),
          );
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
      return complete;
    },
    finishPartition,
  };
}
