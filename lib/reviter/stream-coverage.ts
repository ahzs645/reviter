/**
 * A complete account of what is inside a Revit file and how much of it Reviter
 * understands.
 *
 * Every CFB stream is listed, whether or not anything is decoded from it, with
 * its compressed size, chunk count, inflated size, and the decoder that claims
 * it. Streams with no decoder are reported as undecoded rather than omitted:
 * the point of the table is to make the remaining gap measurable instead of
 * invisible.
 */
import {
  gzipOffsets,
  inflateRevitChunk,
  isRevitChecksumPagedStream,
  revitWindowTail,
  stripRevitPageChecksums,
} from "./revit-container.ts";

/**
 * How much of a stream is understood.
 *
 * `full` means the stream's content is read in its entirety. `partial` means a
 * decoder reads some of it and the rest is undecoded — the partition stream is
 * the extreme case, where element envelopes and category tokens are recovered
 * from a payload that inflates to hundreds of megabytes. Counting a `partial`
 * stream as covered because a decoder claims it would overstate the result, so
 * the summary counts streams by depth rather than weighing them by bytes.
 */
export type CoverageDepth = "full" | "partial" | "none";

/** What Reviter extracts from a stream, or `none` when nothing is decoded. */
export type StreamDecoder =
  | "metadata"
  | "thumbnail"
  | "schema"
  | "element-index"
  | "partition-names"
  | "element-records"
  | "none";

export type StreamCoverage = {
  /** Stream path with the CFB root prefix stripped. */
  path: string;
  /** Bytes as stored in the container. */
  storedBytes: number;
  /** Truncated-gzip chunks found in the stream. */
  chunks: number;
  /**
   * Bytes after decompression. `undefined` when the stream was too large to
   * inflate a second time — the conversion pass already walks it.
   */
  inflatedBytes?: number;
  decoder: StreamDecoder;
  depth: CoverageDepth;
  /** What is decoded, or what is known about the stream but not decoded. */
  note: string;
};

type StreamRule = {
  pattern: RegExp;
  decoder: StreamDecoder;
  depth: CoverageDepth;
  note: string;
};

/**
 * Notes describe the stream, not Reviter's ambition for it. Where a stream is
 * understood but not decoded, the note says so.
 */
const STREAM_RULES: StreamRule[] = [
  { pattern: /(^|\/)BasicFileInfo$/i, decoder: "metadata", depth: "full", note: "Revit release, build, locale, and document identity" },
  { pattern: /(^|\/)RevitPreview/i, decoder: "thumbnail", depth: "full", note: "Embedded preview image" },
  { pattern: /(^|\/)Formats\/Latest$/i, decoder: "schema", depth: "partial", note: "Serializable class inventory with tags and base classes; field lists not walked" },
  { pattern: /(^|\/)Global\/ElemTable$/i, decoder: "element-index", depth: "partial", note: "Native element-ID index; the remaining record fields are not decoded" },
  { pattern: /(^|\/)Global\/PartitionTable$/i, decoder: "partition-names", depth: "partial", note: "Workset or family partition names" },
  { pattern: /(^|\/)Partitions\/[^/]+$/i, decoder: "element-records", depth: "partial", note: "Element bounds records and BuiltInCategory tokens; element shapes, materials, and parameters are not decoded" },
  { pattern: /(^|\/)Global\/Latest$/i, decoder: "none", depth: "none", note: "Document-level object graph; wire format not decoded" },
  { pattern: /(^|\/)Global\/ContentDocuments$/i, decoder: "none", depth: "none", note: "Structured content index on a different ID space; 0.8% of recovered element IDs appear in it, at chance level" },
  { pattern: /(^|\/)Global\/History$/i, decoder: "none", depth: "none", note: "Document edit history; not decoded" },
  { pattern: /(^|\/)Global\/DocumentIncrementTable$/i, decoder: "none", depth: "none", note: "Incremental save table; not decoded" },
  { pattern: /(^|\/)ProjectInformation$/i, decoder: "metadata", depth: "full", note: "PKZip Atom metadata: project identity, design file, and property groups" },
  { pattern: /(^|\/)TransmissionData$/i, decoder: "none", depth: "none", note: "eTransmit link data; not decoded" },
  { pattern: /(^|\/)PartAtom$/i, decoder: "metadata", depth: "full", note: "Family/type title, category, parameters, and taxonomies from PartAtom XML" },
  { pattern: /(^|\/)Contents$/i, decoder: "none", depth: "none", note: "Container contents record; not decoded" },
];

function classify(path: string): StreamRule {
  return (
    STREAM_RULES.find((rule) => rule.pattern.test(path)) ?? {
      pattern: /.^/,
      decoder: "none" as const,
      depth: "none" as const,
      note: "Not recognised",
    }
  );
}

/**
 * Measure one stream. `inflate` is skipped for streams above `inflateLimit`,
 * because the partition stream inflates to hundreds of megabytes and is already
 * walked by the conversion pass.
 */
export function measureStream(
  path: string,
  data: Uint8Array,
  inflateLimit = 8 << 20,
): StreamCoverage {
  const rule = classify(path);
  const payload = isRevitChecksumPagedStream(path)
    ? stripRevitPageChecksums(data)
    : data;
  // Chunk counting is a byte scan and always affordable; inflating a second
  // time is not, for the partition stream that expands to hundreds of MB.
  const offsets = gzipOffsets(payload);
  let inflatedBytes: number | undefined;
  if (payload.byteLength <= inflateLimit) {
    inflatedBytes = 0;
    let window: Uint8Array | null = null;
    for (let index = 0; index < offsets.length; index += 1) {
      const inflated = inflateRevitChunk(
        payload,
        offsets[index]!,
        offsets[index + 1],
        window,
      );
      if (!inflated) continue;
      window = revitWindowTail(inflated);
      inflatedBytes += inflated.byteLength;
    }
    if (!offsets.length) inflatedBytes = payload.byteLength;
  }
  return {
    path,
    storedBytes: data.byteLength,
    chunks: offsets.length,
    inflatedBytes,
    decoder: rule.decoder,
    depth: rule.depth,
    note: rule.note,
  };
}

export type CoverageSummary = {
  streams: StreamCoverage[];
  /** Streams read in their entirety. */
  fullStreams: number;
  /** Streams a decoder reads part of. */
  partialStreams: number;
  /** Streams nothing decodes. */
  undecodedStreams: number;
};

export function summariseCoverage(streams: StreamCoverage[]): CoverageSummary {
  const count = (depth: CoverageDepth) => streams.filter((s) => s.depth === depth).length;
  return {
    streams: [...streams].sort((a, b) => b.storedBytes - a.storedBytes),
    fullStreams: count("full"),
    partialStreams: count("partial"),
    undecodedStreams: count("none"),
  };
}
