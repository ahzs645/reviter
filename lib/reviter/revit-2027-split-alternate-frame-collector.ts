import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";
import { MAX_SCANNED_OBJECT_BYTES } from "./element-objects.ts";
import { usesRevit2027RecordLayout } from "./revit-class-tags.ts";
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
      if (!usesRevit2027RecordLayout(release)) return [];
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
