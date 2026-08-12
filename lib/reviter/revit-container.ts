/**
 * Revit's OLE/CFB stream payloads, checksum pages, and truncated-gzip framing.
 *
 * Structured database streams are first split into 65,249-byte stored pages.
 * A full page carries 64,896 bytes of stream payload followed by 353 bytes of
 * checksum data. After those page tails are removed, the payload is a run of
 * independently compressed chunks. Each chunk starts with a gzip header and is
 * followed by a raw DEFLATE body with no trailer, so chunk boundaries still
 * have to be recovered by scanning for the signature.
 */
import { Inflate, inflateSync } from "fflate";

import { noteLimit } from "./limit-census.ts";

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

/** Bound on gzip FNAME/FCOMMENT scanning; Revit writes neither field. */
const GZIP_OPTIONAL_FIELD_LIMIT = 1_024;

/** Input cap when re-reading a chunk truncated by a false gzip signature. */
const GZIP_RETRY_BYTES = 8 << 20;

/**
 * The most one byte of DEFLATE input can become.
 *
 * A length/distance pair costs as little as two bits and copies up to 258
 * bytes, which is the 1032:1 the format is known for. It is used here only as
 * a proof: a body short enough that even 1032:1 stays inside the ceiling needs
 * no ceiling enforcement at all, and can take the fast one-shot reader.
 */
const DEFLATE_MAX_EXPANSION = 1_032;

/**
 * The most one chunk may inflate to.
 *
 * The input caps above bound what goes in and nothing bounds what comes out,
 * which is the whole of the problem: at 1032:1 about 10 MiB of crafted stream
 * decodes toward 10 GB, and the tab is gone long before anything is decoded
 * from it.
 *
 * A Revit chunk holds about 128 KiB of payload. The reference model's partition
 * stream is 3,666 chunks inflating to 416.5 MB, a mean of 114 KiB, and the
 * chunks the salvage reader was written for are described in terms of "the
 * ~128 KiB a chunk holds". 64 MiB is five hundred times that, so no chunk any
 * real file contains can come near it, while a chunk that does reach it is by
 * that fact not Revit payload — which is why reaching it rejects the chunk
 * rather than keeping the prefix: there is nothing there to salvage.
 */
export const REVIT_MAX_CHUNK_INFLATED_BYTES = 64 << 20;

/**
 * The most one stream may inflate to, across every chunk read from it.
 *
 * A per-chunk ceiling alone is not a bound on a stream: ten thousand chunks
 * each stopping just under 64 MiB is still hundreds of gigabytes of decoding.
 * But a fixed per-stream number cannot be right either, because a bigger model
 * legitimately inflates to more — so the ceiling is expressed against the
 * stored bytes the stream actually occupies, which is the one thing that
 * scales with the model.
 *
 * The reference model's 69 MB partition inflates to 416.5 MB, a ratio of 6.0×,
 * and the README quotes the same stream reading at 6.16× — so 32× is five times
 * the observed ratio, and is 32× below the 1032:1 a crafted stream can reach.
 * The floor keeps a small stream from being held to a small number: 256 MiB is
 * already comfortably past the 270 MB of inflated volume the native-mesh bridge
 * measures across the whole reference model.
 *
 * The budget counts every byte decoded, not only the bytes returned, because
 * work done on a failed read is work all the same — the retry paths below can
 * each decode a prefix before giving up. On the reference model that accounting
 * comes to roughly 500 MB against a 2.2 GB ceiling.
 */
export const REVIT_MAX_STREAM_INFLATION_RATIO = 32;
export const REVIT_MIN_STREAM_INFLATED_BYTES = 256 << 20;

/**
 * Input slice pushed into the bounded reader at a time.
 *
 * The ceiling can only be checked between pushes, so a push is also the
 * overshoot: at 1032:1 a 64 KiB slice emits up to 64 MiB before anyone looks.
 * Sizing the slice from the ceiling rather than fixing it keeps the overshoot
 * proportional to the ceiling instead of to the largest ceiling: an eighth of
 * it, so a bombed read allocates in eighths rather than doubling one buffer all
 * the way up to the limit before anyone stops it. The lower bound keeps a very
 * small ceiling from turning the read into a byte-at-a-time crawl, and the
 * upper bound keeps a large one from reading in slices so big the check is
 * meaningless.
 *
 * The pushes are not on the hot path. A body short enough that even 1032:1
 * stays inside the ceiling never gets here — that is every chunk of a real
 * stream, whose bodies are about 19 KiB against the 65 KiB threshold the
 * default ceiling implies.
 */
const INFLATE_PUSH_BYTES = 64 << 10;
const MIN_INFLATE_PUSH_BYTES = 1 << 10;
const INFLATE_OVERSHOOT_DIVISOR = 8;

function pushBytesFor(ceiling: number): number {
  return Math.max(
    MIN_INFLATE_PUSH_BYTES,
    Math.min(
      INFLATE_PUSH_BYTES,
      Math.floor(ceiling / (DEFLATE_MAX_EXPANSION * INFLATE_OVERSHOOT_DIVISOR)),
    ),
  );
}

/**
 * How much of its stream's inflation budget is left, and whether the ceiling
 * has already been reported for it.
 *
 * Keyed on the stream buffer itself rather than threaded through the readers'
 * signatures: callers hold one `data` array per stream and pass it to every
 * chunk read, so the buffer *is* the stream's identity. A weak key also means
 * there is no reset to forget — the budget for a stream is collected with the
 * stream, and a second file cannot inherit the first one's tally.
 */
type StreamBudget = { chunkCeiling: number; remaining: number; noted: boolean };

/**
 * Ceilings for one stream's reads. Both default to the constants above; a
 * caller that knows its stream is smaller than a partition can say so, the way
 * `streamCoverage` already bounds what it is willing to inflate.
 *
 * They are read when a stream is first seen, because the budget belongs to the
 * stream rather than to any one chunk read from it.
 */
export type RevitInflationLimits = {
  maxChunkBytes?: number;
  maxStreamBytes?: number;
};

const streamBudgets = new WeakMap<Uint8Array, StreamBudget>();

function streamBudgetFor(data: Uint8Array, limits?: RevitInflationLimits): StreamBudget {
  const known = streamBudgets.get(data);
  if (known) return known;
  const budget: StreamBudget = {
    chunkCeiling: limits?.maxChunkBytes ?? REVIT_MAX_CHUNK_INFLATED_BYTES,
    remaining: limits?.maxStreamBytes ?? Math.max(
      REVIT_MIN_STREAM_INFLATED_BYTES,
      data.length * REVIT_MAX_STREAM_INFLATION_RATIO,
    ),
    noted: false,
  };
  streamBudgets.set(data, budget);
  return budget;
}

/** What this read may produce: the chunk ceiling, or what the stream has left. */
function inflationCeiling(budget: StreamBudget): number {
  return Math.min(budget.chunkCeiling, Math.max(0, budget.remaining));
}

/**
 * Record which of the two ceilings bound.
 *
 * The per-chunk ceiling is a fact about one chunk and is counted once per
 * chunk. The per-stream ceiling is a fact about the stream, and counting it
 * again for every chunk that follows would report thousands of rejections for
 * one exhausted budget.
 */
function noteInflationCeiling(budget: StreamBudget, ceiling: number): void {
  if (ceiling >= budget.chunkCeiling) {
    noteLimit("max-inflated-chunk-bytes");
    return;
  }
  if (budget.noted) return;
  budget.noted = true;
  noteLimit("max-inflated-stream-bytes");
}

type BoundedRead = {
  /**
   * Everything emitted before the reader stopped, or null when nothing was —
   * and null when the ceiling bound, because a read that reaches the ceiling is
   * refused by both callers and joining its pieces would only be a second copy
   * of what is about to be dropped.
   */
  bytes: Uint8Array | null;
  /** The body decoded to its end without error and without hitting `ceiling`. */
  complete: boolean;
  truncated: boolean;
  /** Bytes actually decoded, which is the work the stream is charged for. */
  decoded: number;
};

/**
 * Inflate `body`, stopping at `ceiling` rather than at whatever it asks for.
 *
 * `inflateSync` sizes and grows its own output buffer from the data, so there
 * is no point at which it can be told to stop; the streaming reader emits as it
 * goes, so the total is known between pushes and the pushes can simply stop.
 * That bounds the memory and the decoding time together, which a fixed output
 * buffer would not — an over-long buffer write is silently dropped by a typed
 * array and the decoder carries on to the end of its input regardless.
 */
function boundedInflate(
  body: Uint8Array,
  dictionary: Uint8Array | undefined,
  ceiling: number,
  pushBytes: number,
): BoundedRead {
  let parts: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let complete = false;
  try {
    const stream = new Inflate({ dictionary }, (chunk) => {
      parts.push(chunk);
      total += chunk.length;
    });
    for (let at = 0; at < body.length; at += pushBytes) {
      const next = Math.min(body.length, at + pushBytes);
      stream.push(body.subarray(at, next), next >= body.length);
      if (total > ceiling) {
        truncated = true;
        break;
      }
      complete = next >= body.length;
    }
  } catch {
    // A desync raises; what came out in front of it stands. See below.
  }
  if (truncated || !total) {
    parts = [];
    return { bytes: null, complete: false, truncated, decoded: total };
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out, complete, truncated, decoded: total };
}

/** Stored bytes in a full checksum page (`PagedStreamImplReader<..., 65249>`). */
export const REVIT_STORED_PAGE_BYTES = 65_249;

/** Original payload bytes recovered from a full checksum page. */
export const REVIT_PAGE_PAYLOAD_BYTES = 64_896;

export const REVIT_PAGE_CHECKSUM_BYTES =
  REVIT_STORED_PAGE_BYTES - REVIT_PAGE_PAYLOAD_BYTES;

/**
 * Bytes of a chunk's output kept as the preset dictionary for the next chunk.
 * 32 KiB is the DEFLATE window, so this is everything a chunk can reference
 * from behind its own start.
 */
export const REVIT_WINDOW_BYTES = 32 << 10;

export function asBytes(value: number[] | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * Whether a CFB path uses the checksum-paged loader route.
 *
 * `ProjectInformation` is deliberately absent: the native loader routes that
 * PKZip stream through `PageReader<false>`. Metadata, previews, and arbitrary
 * attachments must not be trimmed merely because they happen to be large.
 */
export function isRevitChecksumPagedStream(path: string): boolean {
  const clean = path.replace(/^Root Entry\//i, "");
  return (
    /^Partitions\/[^/]+$/i.test(clean) ||
    /^Formats\/Latest$/i.test(clean) ||
    /^Global\/(?:ContentDocuments|DocumentIncrementTable|ElemTable|History|Latest|PartitionTable)$/i
      .test(clean)
  );
}

/**
 * Remove each complete stored page's checksum tail.
 *
 * The last partial page is intentionally retained in full. Its trailing
 * checksum follows the final DEFLATE stream and is ignored by the inflater,
 * while its encoded payload length varies with the short page size.
 */
export function stripRevitPageChecksums(data: Uint8Array): Uint8Array {
  const fullPages = Math.floor(data.byteLength / REVIT_STORED_PAGE_BYTES);
  if (!fullPages) return data;
  const remainder = data.byteLength - fullPages * REVIT_STORED_PAGE_BYTES;
  const output = new Uint8Array(fullPages * REVIT_PAGE_PAYLOAD_BYTES + remainder);
  let outputOffset = 0;
  for (let page = 0; page < fullPages; page += 1) {
    const storedOffset = page * REVIT_STORED_PAGE_BYTES;
    output.set(
      data.subarray(storedOffset, storedOffset + REVIT_PAGE_PAYLOAD_BYTES),
      outputOffset,
    );
    outputOffset += REVIT_PAGE_PAYLOAD_BYTES;
  }
  output.set(data.subarray(fullPages * REVIT_STORED_PAGE_BYTES), outputOffset);
  return output;
}

/** Map a checksum-clean payload offset back to its stored CFB stream offset. */
export function revitStoredPageOffset(payloadOffset: number): number {
  if (!Number.isFinite(payloadOffset) || payloadOffset <= 0) return 0;
  const offset = Math.floor(payloadOffset);
  const page = Math.floor(offset / REVIT_PAGE_PAYLOAD_BYTES);
  return page * REVIT_STORED_PAGE_BYTES + (offset % REVIT_PAGE_PAYLOAD_BYTES);
}

/**
 * Length of the gzip header at `offset`, or `null` when the signature is not a
 * usable header.
 *
 * The three-byte gzip signature also occurs by chance inside DEFLATE payloads.
 * Those false positives previously reached `inflateSync` with the entire
 * remaining stream as input, and fflate sizes its output buffer from the input
 * length — so a single false signature in a 69 MB partition allocated and
 * decoded hundreds of megabytes of garbage. Rejecting headers whose reserved
 * flag bits are set removes every false signature observed in the corpus, and
 * the optional-field scans are bounded so a surviving one stays cheap.
 */
function gzipHeaderLength(data: Uint8Array, offset: number): number | null {
  if (
    offset + 10 > data.length ||
    data[offset] !== GZIP_MAGIC[0] ||
    data[offset + 1] !== GZIP_MAGIC[1] ||
    data[offset + 2] !== GZIP_MAGIC[2]
  ) {
    return null;
  }

  const flags = data[offset + 3] ?? 0;
  if (flags & 0xe0) return null;
  let cursor = offset + 10;

  if (flags & 0x04) {
    if (cursor + 2 > data.length) return null;
    const extraLength = (data[cursor] ?? 0) | ((data[cursor + 1] ?? 0) << 8);
    cursor += 2 + extraLength;
  }

  for (const flag of [0x08, 0x10]) {
    if (!(flags & flag)) continue;
    const scanLimit = Math.min(data.length, cursor + GZIP_OPTIONAL_FIELD_LIMIT);
    while (cursor < scanLimit && data[cursor] !== 0) cursor += 1;
    if (cursor >= scanLimit) return null;
    cursor += 1;
  }

  if (flags & 0x02) cursor += 2;
  return cursor <= data.length ? cursor - offset : null;
}

/** Offsets of every candidate gzip signature that also carries a usable header. */
export function gzipOffsets(data: Uint8Array, limit = 10_000): number[] {
  const result: number[] = [];
  for (let i = 0; i + 3 <= data.length && result.length < limit; i += 1) {
    if (
      data[i] === GZIP_MAGIC[0] &&
      data[i + 1] === GZIP_MAGIC[1] &&
      data[i + 2] === GZIP_MAGIC[2]
    ) {
      if (gzipHeaderLength(data, i) != null) result.push(i);
      i += 9;
    }
  }
  return result;
}

/** The trailing DEFLATE window of an inflated chunk. */
export function revitWindowTail(page: Uint8Array): Uint8Array {
  return page.length <= REVIT_WINDOW_BYTES
    ? page
    : page.subarray(page.length - REVIT_WINDOW_BYTES);
}

/**
 * One strict read of a chunk body, bounded by what the stream has left to give.
 *
 * Short bodies keep the one-shot reader. That is not a shortcut around the
 * ceiling but a proof that the ceiling cannot be reached: a body of `ceiling /
 * 1032` bytes cannot emit `ceiling` bytes even if every symbol in it is a
 * maximum-length back-reference. Every chunk a real Revit stream contains is
 * far inside that — the reference model's are about 19 KiB stored — so the path
 * this runs on in practice is exactly the path it ran on before, and the
 * streaming reader is reserved for the bodies that could actually overrun.
 */
function tryInflate(
  body: Uint8Array,
  dictionary: Uint8Array | undefined,
  budget: StreamBudget,
): { bytes: Uint8Array | null; overCeiling: boolean } {
  const ceiling = inflationCeiling(budget);
  if (ceiling <= 0) {
    noteInflationCeiling(budget, ceiling);
    return { bytes: null, overCeiling: true };
  }
  if (body.length * DEFLATE_MAX_EXPANSION <= ceiling) {
    try {
      const read = inflateSync(body, dictionary ? { dictionary } : undefined);
      budget.remaining -= read.length;
      return { bytes: read, overCeiling: false };
    } catch {
      return { bytes: null, overCeiling: false };
    }
  }
  const read = boundedInflate(body, dictionary, ceiling, pushBytesFor(ceiling));
  budget.remaining -= read.decoded;
  if (read.truncated) {
    noteInflationCeiling(budget, ceiling);
    return { bytes: null, overCeiling: true };
  }
  return { bytes: read.complete ? read.bytes : null, overCeiling: false };
}

/**
 * Inflate one Revit chunk. `end` is the start of the next chunk, which bounds
 * both the DEFLATE input and fflate's output allocation. A false signature that
 * survives header validation would truncate a real chunk, so a failed bounded
 * read retries against a capped tail rather than the whole stream.
 *
 * Bounding the input is not bounding the output: `end` and `GZIP_RETRY_BYTES`
 * say how many compressed bytes are read, and DEFLATE turns each of those into
 * up to 1,032. Every read here therefore also passes through the stream's
 * inflation budget, and a chunk that overruns it is refused and counted rather
 * than allowed to allocate its way through the tab. See `tryInflate`.
 *
 * `window` is the previous chunk's output tail, from `revitWindowTail`. Most
 * chunks are self-contained, but a minority carry back-references past their own
 * start and fail outright with `invalid distance too far back`; supplying the
 * preceding window as a preset dictionary reads them. In the reference model 273
 * of 332 otherwise unreadable chunks recover this way, 32.4 MB of payload that
 * was being dropped. Passing no window keeps the old stateless behaviour, which
 * is what a strided sample wants.
 */
export function inflateRevitChunk(
  data: Uint8Array,
  offset: number,
  end?: number,
  window?: Uint8Array | null,
  limits?: RevitInflationLimits,
): Uint8Array | null {
  const headerLength = gzipHeaderLength(data, offset);
  if (headerLength == null) return null;
  const start = offset + headerLength;
  if (start >= data.length) return null;
  const limit = Math.min(end ?? data.length, data.length);
  if (limit <= start) return null;

  const budget = streamBudgetFor(data, limits);
  const bounded = data.subarray(start, limit);
  const bounds = tryInflate(bounded, undefined, budget);
  if (bounds.bytes) return bounds.bytes;
  // Every retry below reads the same body, or a longer one, and a body that
  // already passed the ceiling can only pass it again. Retrying would decode
  // the same overrun three more times and report it three more times, so a
  // read stopped by the ceiling ends the chunk rather than restarting it.
  if (bounds.overCeiling) return null;

  const tail = limit >= data.length
    ? null
    : data.subarray(start, Math.min(data.length, start + GZIP_RETRY_BYTES));
  const retried = tail ? tryInflate(tail, undefined, budget) : null;
  if (retried?.bytes) return retried.bytes;
  if (retried?.overCeiling) return null;

  if (!window?.length) return null;
  const windowed = tryInflate(bounded, window, budget);
  if (windowed.bytes || windowed.overCeiling || !tail) return windowed.bytes;
  return tryInflate(tail, window, budget).bytes;
}

/**
 * Input slice pushed into the salvage reader at a time.
 *
 * `inflateSync` throws before handing back anything at all, so a chunk that
 * desyncs partway through loses the megabytes it had already decoded correctly.
 * A streaming read keeps whatever was emitted before the throw, and emission is
 * driven by pushes, so the slice size is the resolution of the salvage. 4 KiB
 * recovers 2.69 MB from the reference model's 56 desyncing chunks.
 */
const SALVAGE_PUSH_BYTES = 4 << 10;

/**
 * Everything a chunk decodes before it desyncs, or `null` when it decodes
 * nothing.
 *
 * 56 chunks of the reference model's 3,666 are neither self-contained nor
 * continuations: they carry the same byte-identical canonical gzip header as
 * every other chunk (`1f 8b 08 00 00000000 00 0b`, so not a false signature),
 * they begin with a well-formed dynamic-Huffman block, and they decode 16 KiB
 * to 115 KiB of correct payload out of the ~128 KiB a chunk holds before the
 * bit stream stops making sense — `invalid block type`, `invalid length/literal`
 * and friends, at input offsets with no structure to them. Whatever that
 * discontinuity is, it is not at the start, so the prefix in front of it is
 * ordinary readable payload and throwing it away costs real elements.
 *
 * **It is verified as payload rather than assumed.** The prefixes hold 213
 * duplicated-bounds records no other read reaches; the paired export names 181
 * of them and **168 land within 0.5 ft of the export's own box, against 0 for a
 * null pairing**, median error 0.000 ft.
 *
 * The prefix must not seed the next chunk's window: it is short of that chunk's
 * true trailing 32 KiB, so a continuation read against it would decode against
 * the wrong bytes. Callers keep the previous window instead.
 *
 * **A read that reaches the inflation ceiling is refused rather than kept.**
 * Salvaging is deliberately forgiving — it accumulated every emitted chunk and
 * swallowed the throw at the end — and that is precisely what a decompression
 * bomb needs: nothing here was comparing the running total against anything, so
 * ~10 MiB of crafted stream accumulated toward ~10 GB in `parts`. Keeping the
 * prefix is right for a chunk that desyncs at 115 KiB of 128 KiB and wrong for
 * one still going at 64 MiB, because the second is not a Revit chunk at all;
 * the format's own chunking says so. Both outcomes are recorded in the census.
 */
export function salvageRevitChunk(
  data: Uint8Array,
  offset: number,
  end?: number,
  window?: Uint8Array | null,
  limits?: RevitInflationLimits,
): Uint8Array | null {
  const headerLength = gzipHeaderLength(data, offset);
  if (headerLength == null) return null;
  const start = offset + headerLength;
  const limit = Math.min(end ?? data.length, data.length);
  if (limit <= start) return null;
  const body = data.subarray(start, limit);
  const budget = streamBudgetFor(data, limits);

  let best: Uint8Array | null = null;
  for (const dictionary of [window?.length ? window : null, null]) {
    const ceiling = inflationCeiling(budget);
    if (ceiling <= 0) {
      noteInflationCeiling(budget, ceiling);
      break;
    }
    const read = boundedInflate(
      body,
      dictionary ?? undefined,
      ceiling,
      Math.min(SALVAGE_PUSH_BYTES, pushBytesFor(ceiling)),
    );
    budget.remaining -= read.decoded;
    if (read.truncated) {
      // As above: the other dictionary reads the same body against the same
      // ceiling, so there is nothing to learn from running it too.
      noteInflationCeiling(budget, ceiling);
      break;
    }
    if (read.bytes && read.bytes.length > (best?.length ?? 0)) best = read.bytes;
  }
  return best;
}

/** Leading little-endian `u32` of an inflated chunk, used as record evidence. */
export function leadingU32(data: Uint8Array): number | null {
  if (data.length < 4) return null;
  return (
    ((data[0] ?? 0) |
      ((data[1] ?? 0) << 8) |
      ((data[2] ?? 0) << 16) |
      ((data[3] ?? 0) << 24)) >>> 0
  );
}
