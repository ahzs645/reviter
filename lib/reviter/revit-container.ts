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

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

/** Bound on gzip FNAME/FCOMMENT scanning; Revit writes neither field. */
const GZIP_OPTIONAL_FIELD_LIMIT = 1_024;

/** Input cap when re-reading a chunk truncated by a false gzip signature. */
const GZIP_RETRY_BYTES = 8 << 20;

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
export function gzipHeaderLength(data: Uint8Array, offset: number): number | null {
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

function tryInflate(body: Uint8Array, dictionary?: Uint8Array): Uint8Array | null {
  try {
    return inflateSync(body, dictionary ? { dictionary } : undefined);
  } catch {
    return null;
  }
}

/**
 * Inflate one Revit chunk. `end` is the start of the next chunk, which bounds
 * both the DEFLATE input and fflate's output allocation. A false signature that
 * survives header validation would truncate a real chunk, so a failed bounded
 * read retries against a capped tail rather than the whole stream.
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
): Uint8Array | null {
  const headerLength = gzipHeaderLength(data, offset);
  if (headerLength == null) return null;
  const start = offset + headerLength;
  if (start >= data.length) return null;
  const limit = Math.min(end ?? data.length, data.length);
  if (limit <= start) return null;

  const bounded = data.subarray(start, limit);
  const bounds = tryInflate(bounded);
  if (bounds) return bounds;

  const tail = limit >= data.length
    ? null
    : data.subarray(start, Math.min(data.length, start + GZIP_RETRY_BYTES));
  const retried = tail ? tryInflate(tail) : null;
  if (retried) return retried;

  if (!window?.length) return null;
  return tryInflate(bounded, window) ?? (tail ? tryInflate(tail, window) : null);
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
 */
export function salvageRevitChunk(
  data: Uint8Array,
  offset: number,
  end?: number,
  window?: Uint8Array | null,
): Uint8Array | null {
  const headerLength = gzipHeaderLength(data, offset);
  if (headerLength == null) return null;
  const start = offset + headerLength;
  const limit = Math.min(end ?? data.length, data.length);
  if (limit <= start) return null;
  const body = data.subarray(start, limit);

  const best = [window?.length ? window : null, null].reduce<Uint8Array | null>(
    (kept, dictionary) => {
      const read = salvageBody(body, dictionary ?? undefined);
      return read && read.length > (kept?.length ?? 0) ? read : kept;
    },
    null,
  );
  return best;
}

function salvageBody(body: Uint8Array, dictionary?: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const stream = new Inflate({ dictionary }, (chunk) => {
      parts.push(chunk);
      total += chunk.length;
    });
    for (let at = 0; at < body.length; at += SALVAGE_PUSH_BYTES) {
      const next = Math.min(body.length, at + SALVAGE_PUSH_BYTES);
      stream.push(body.subarray(at, next), next >= body.length);
    }
  } catch {
    // The desync is the expected outcome here; what came out before it stands.
  }
  if (!total) return null;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
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
