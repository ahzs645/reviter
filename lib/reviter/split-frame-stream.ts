/**
 * Reassemble framed objects of a few classes as they stream past, including
 * ones that cross a compressed-page boundary.
 *
 * The ordinary scanners read one inflated page at a time, and most objects fit
 * in one. A handful of classes — a `StairsRun`, a `TopRailType`, a
 * `BaseRailingSym` — write records large enough to cross pages, so their
 * collectors watch the page stream for those classes' frame headers and hold
 * each candidate until its length echo arrives.
 *
 * **Why the pages are held as a list.** Both collectors used to join what they
 * held and the new page into one buffer on every push. A candidate header that
 * never completes — random bytes that happen to spell the class index and a
 * large length — then kept everything after it held, so each push re-copied
 * the partition so far. The 2025 RAC basic sample spent 65 s of a 121 s
 * conversion there and most of the rest in the garbage collector. Held as a
 * list, a push copies the new page and the few header bytes behind it, and a
 * frame's bytes are joined once, when it completes.
 *
 * Class indices are compared as the file writes them: the 2027 classes a
 * collector asks for are looked up once per push, not translated per byte.
 *
 * Where element ids are 32-bit (see `element-id-width.ts`) the frame header is
 * 12 bytes instead of 16: the class sits at `+12`, the length at `+8`, and the
 * echo `length` bytes after the class, as in the wide layout. The width is read
 * once per push, like the class indices.
 */
import { frameHeaderBytes } from "./element-id-width.ts";
import { fileClassTag } from "./revit-class-tags.ts";

/** Bytes a frame header occupies after the class: the class and a type code. */
const HEADER_TAIL_BYTES = 6;

export type StreamedFrame = {
  elementId: number;
  /** The frame's class, in the 2027 numbering the collector asked for. */
  marker: number;
  objectLength: number;
  /** The whole frame, header through echo. */
  data: Uint8Array;
  /** Whether the frame crossed a page, i.e. no per-page scan could see it. */
  crossedPage: boolean;
};

export type SplitFrameStreamOptions = {
  /** Classes to watch for, in the 2027 numbering. */
  markers: readonly number[];
  minObjectLength: number;
  maxFrameBytes: number;
  /** Further header checks a collector's classes guarantee. */
  acceptHeader?: (view: DataView, offset: number) => boolean;
  /**
   * Assemble only frames that cross a page. For a class as common as
   * `GElement`, whose frames the per-page scan already sees whole, copying
   * every one out again would be most of the work.
   */
  crossingOnly?: boolean;
};

export type SplitFrameStream = {
  push(page: Uint8Array): StreamedFrame[];
  reset(): void;
};

export function createSplitFrameStream(options: SplitFrameStreamOptions): SplitFrameStream {
  let held: { start: number; data: Uint8Array }[] = [];
  let streamEnd = 0;
  let nextScanOffset = 0;
  const pending = new Map<
    number,
    { elementId: number; marker: number; objectLength: number; crossedPage: boolean }
  >();

  const bytesBetween = (from: number, to: number): Uint8Array => {
    const out = new Uint8Array(Math.max(0, to - from));
    for (const { start, data } of held) {
      const end = start + data.byteLength;
      if (end <= from || start >= to) continue;
      const copyFrom = Math.max(from, start);
      const copyTo = Math.min(to, end);
      out.set(data.subarray(copyFrom - start, copyTo - start), copyFrom - from);
    }
    return out;
  };

  return {
    reset(): void {
      held = [];
      streamEnd = 0;
      nextScanOffset = 0;
      pending.clear();
    },
    push(page: Uint8Array): StreamedFrame[] {
      if (page.byteLength === 0) return [];
      // Id, discriminator and length in front of the class: 16 bytes, or 12
      // where ids are 32-bit. The frame ends with the echo, four bytes past
      // `header + length`.
      const header = frameHeaderBytes();
      const narrow = header === 12;
      const headerScanBytes = header + HEADER_TAIL_BYTES;
      const frameSuffixBytes = header + 4;
      const fileMarkers = new Map<number, number>();
      for (const marker of options.markers) {
        const fileMarker = fileClassTag(marker);
        if (fileMarker >= 0 && fileMarker <= 0xffff) fileMarkers.set(fileMarker, marker);
      }
      const pageStart = streamEnd;
      held.push({ start: pageStart, data: page });
      streamEnd += page.byteLength;

      // Only the header bytes behind this page not yet scannable need joining
      // to it: normally the last 21 of the previous page.
      const windowStart = Math.max(held[0]!.start, Math.min(nextScanOffset, pageStart));
      const window = bytesBetween(windowStart, streamEnd);
      const view = new DataView(window.buffer, window.byteOffset, window.byteLength);
      const scanStart = Math.max(nextScanOffset, windowStart);
      const scanEnd = streamEnd - headerScanBytes;
      // A header's class sits at +16 (+12), so each class's low byte is found
      // by the native byte search and only those offsets are examined. Offsets
      // are visited in ascending order, as a byte-by-byte walk would.
      const candidates: number[] = [];
      for (const fileMarker of fileMarkers.keys()) {
        const low = fileMarker & 0xff;
        const high = fileMarker >> 8;
        const first = scanStart - windowStart + header;
        const last = scanEnd - windowStart + header;
        for (
          let at = window.indexOf(low, first);
          at >= 0 && at <= last;
          at = window.indexOf(low, at + 1)
        ) {
          if (window[at + 1] === high) candidates.push(at - header);
        }
      }
      if (fileMarkers.size > 1) candidates.sort((left, right) => left - right);
      for (const offset of candidates) {
        const streamOffset = windowStart + offset;
        const marker = fileMarkers.get(view.getUint16(offset + header, true))!;
        const elementId = view.getUint32(offset, true);
        const objectLength = view.getUint32(offset + header - 4, true);
        // The wide id's high word is zero; a narrow id is a non-negative
        // int32 whose hash-like discriminator does not repeat the length.
        if (narrow) {
          if (elementId > 0x7fff_ffff || view.getUint32(offset + 4, true) === objectLength) continue;
        } else if (view.getUint32(offset + 4, true) !== 0) continue;
        if (options.acceptHeader && !options.acceptHeader(view, offset)) continue;
        if (
          elementId === 0 ||
          objectLength < options.minObjectLength ||
          objectLength + frameSuffixBytes > options.maxFrameBytes
        ) {
          continue;
        }
        const crossedPage =
          streamOffset < pageStart ||
          streamOffset + objectLength + frameSuffixBytes > streamEnd;
        if (options.crossingOnly && !crossedPage) continue;
        pending.set(streamOffset, { elementId, marker, objectLength, crossedPage });
      }
      nextScanOffset = Math.max(nextScanOffset, scanEnd + 1);

      const complete: StreamedFrame[] = [];
      for (const [streamOffset, target] of pending) {
        const frameEnd = streamOffset + target.objectLength + frameSuffixBytes;
        if (frameEnd > streamEnd) continue;
        pending.delete(streamOffset);
        if (streamOffset < held[0]!.start) continue;
        const echoAt = streamOffset + target.objectLength + header;
        const echo = new DataView(bytesBetween(echoAt, echoAt + 4).buffer).getUint32(0, true);
        if (echo !== target.objectLength) continue;
        complete.push({
          elementId: target.elementId,
          marker: target.marker,
          objectLength: target.objectLength,
          data: bytesBetween(streamOffset, frameEnd),
          crossedPage: target.crossedPage,
        });
      }

      let retainFrom = nextScanOffset;
      for (const streamOffset of pending.keys()) retainFrom = Math.min(retainFrom, streamOffset);
      while (held.length > 1 && held[0]!.start + held[0]!.data.byteLength <= retainFrom) {
        held.shift();
      }
      return complete;
    },
  };
}
