import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";
import { narrowElementIds } from "./element-id-width.ts";
import { MAX_SCANNED_OBJECT_BYTES } from "./element-objects.ts";
import { readsElementRecordLayout } from "./revit-class-tags.ts";
import { createSplitFrameStream, type StreamedFrame } from "./split-frame-stream.ts";

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
  pushPageFrames(page: Uint8Array): readonly StreamedFrame[];
  finishPartition(): void;
  readonly largeWholeFrameDiagnostics: Readonly<{
    admitted: number; rejectedChecksum: number; skippedChecksumBudget: number; checksumBytes: number; checksumLimitPerPartition: number;
  }>;
};

/** Reassemble crossing GElements and checksum-verified complete large frames. */
export function createRevit2027SplitGElementCollector(
  release: number | null | undefined,
  maxWholeChecksumBytesPerPartition = 128 * 1024 * 1024,
): Revit2027SplitGElementCollector {
  const checksumLimitPerPartition = Number.isSafeInteger(maxWholeChecksumBytesPerPartition) && maxWholeChecksumBytesPerPartition >= 0
    ? Math.min(maxWholeChecksumBytesPerPartition, 128 * 1024 * 1024) : 128 * 1024 * 1024;
  const diagnostics = { admitted: 0, rejectedChecksum: 0, skippedChecksumBudget: 0, checksumBytes: 0, checksumLimitPerPartition };
  let partitionChecksumBytes = 0;
  const stream = createSplitFrameStream({
    markers: [GELEMENT_CLASS],
    minObjectLength: MIN_FRAME_BYTES,
    maxFrameBytes: MAX_SPLIT_GELEMENT_BYTES,
    // The wide restated owner ends after byte 29; class + type ends after
    // byte 21. Preserve that extra tail until the next page can supply it.
    minimumHeaderBytes: header => header === 12 ? 18 : 30,
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
    // The broad page scan deliberately stops at 65,535 bytes. A larger frame
    // can still fit on a 128-KiB inflated page and must not fall between the
    // ordinary scanner and a crossing-only reassembler.
    minWholeObjectLength: MAX_SCANNED_OBJECT_BYTES + 1,
    acceptWholeFrame: frame => {
      const header = narrowElementIds() ? 12 : 16;
      if (partitionChecksumBytes + frame.objectLength > checksumLimitPerPartition) {
        diagnostics.skippedChecksumBudget++;
        return false;
      }
      partitionChecksumBytes += frame.objectLength;
      diagnostics.checksumBytes += frame.objectLength;
      // Check a borrowed page view before copying the candidate. The frame's
      // discriminator is Adler-32 over class+payload, ending before the echoed
      // length. Block reduction keeps the integer sums exact and work linear.
      let a = 1, b = 0;
      const end = header + frame.objectLength;
      for (let start = header; start < end; start += 5552) {
        const blockEnd = Math.min(end, start + 5552);
        for (let cursor = start; cursor < blockEnd; cursor++) { a += frame.data[cursor]!; b += a; }
        a %= 65521; b %= 65521;
      }
      const expected = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength).getUint32(header - 8, true);
      if (((b * 65536 + a) >>> 0) !== expected) { diagnostics.rejectedChecksum++; return false; }
      diagnostics.admitted++;
      return true;
    },
  });
  const pushPageFrames = (page: Uint8Array): readonly StreamedFrame[] => readsElementRecordLayout(release) ? stream.push(page) : [];
  return {
    get largeWholeFrameDiagnostics() { return diagnostics; },
    pushPageFrames,
    pushPage: page => pushPageFrames(page).map(frame => frame.data),
    finishPartition: () => { stream.reset(); partitionChecksumBytes = 0; },
  };
}
