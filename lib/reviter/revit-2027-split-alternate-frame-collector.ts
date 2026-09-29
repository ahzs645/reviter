import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { MAX_SCANNED_OBJECT_BYTES } from "./element-objects.ts";
import { readsElementRecordLayout } from "./revit-class-tags.ts";
import { createSplitFrameStream } from "./split-frame-stream.ts";

const MIN_FRAME_BYTES = 40;
const DEFAULT_MAX_FRAME_BYTES = 320 * 1024 * 1024;

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
  const stream = createSplitFrameStream({
    markers: [REVIT_2027_TOP_RAIL_TYPE_MARKER, REVIT_2027_BASE_RAILING_SYMBOL_MARKER],
    minObjectLength: MIN_FRAME_BYTES,
    maxFrameBytes: boundedMaxFrameBytes,
  });
  return {
    pushPage(page: Uint8Array): readonly Uint8Array[] {
      if (!readsElementRecordLayout(release)) return [];
      // A frame that fits one page within the ordinary scanner's ceiling is
      // already seen there, and must not be decoded twice.
      return stream
        .push(page)
        .filter((frame) => frame.crossedPage || frame.objectLength > MAX_SCANNED_OBJECT_BYTES)
        .map((frame) => frame.data);
    },
    finishPartition: () => stream.reset(),
  };
}

/** `GElement` in the 2027 numbering. */
const GELEMENT_CLASS = 0x08c6;

/**
 * A family symbol's geometry lives in its `GElement`, and a symbol with real
 * geometry writes one of tens of kilobytes (38,488 bytes for the RAC sample's
 * bar-chair symbol). Pages are 64 KiB inflated, so some cross a boundary, and
 * the per-page scan never frames those at all. Reassembled, they bring 14
 * more UNBC elements within half a foot of Autodesk's geometry. The largest
 * one seen is well under this bound, which keeps a candidate header that never
 * completes from holding pages for long.
 */
const MAX_SPLIT_GELEMENT_BYTES = 8 * 1024 * 1024;

export type Revit2027SplitGElementCollector = {
  pushPage(page: Uint8Array): readonly Uint8Array[];
  finishPartition(): void;
};

/** Reassemble the `GElement` frames that cross a page boundary. */
export function createRevit2027SplitGElementCollector(
  release: number | null | undefined,
): Revit2027SplitGElementCollector {
  const stream = createSplitFrameStream({
    markers: [GELEMENT_CLASS],
    minObjectLength: MIN_FRAME_BYTES,
    maxFrameBytes: MAX_SPLIT_GELEMENT_BYTES,
    // The frame restates its element id at +26, as every GElement does: its
    // `GInfo.m_tag`. Where ids are 32-bit the tag leads a 16-byte `GInfo`
    // right after the class, at +14.
    acceptHeader: (view, offset) => {
      const restated = offset + (narrowElementIds() ? 14 : 26);
      return (
        restated + 4 <= view.byteLength &&
        view.getUint32(restated, true) === view.getUint32(offset, true)
      );
    },
    crossingOnly: true,
  });
  return {
    pushPage(page: Uint8Array): readonly Uint8Array[] {
      if (!readsElementRecordLayout(release)) return [];
      return stream.push(page).map((frame) => frame.data);
    },
    finishPartition: () => stream.reset(),
  };
}
