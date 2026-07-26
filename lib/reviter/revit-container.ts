/**
 * Revit's OLE/CFB stream payloads, and the truncated-gzip framing inside them.
 *
 * A Revit stream is a run of independently compressed chunks. Each chunk starts
 * with a gzip header and is followed by a raw DEFLATE body with no trailer, so
 * the chunk boundaries have to be recovered by scanning for the signature.
 */
import { inflateSync } from "fflate";

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

/** Bound on gzip FNAME/FCOMMENT scanning; Revit writes neither field. */
const GZIP_OPTIONAL_FIELD_LIMIT = 1_024;

/** Input cap when re-reading a chunk truncated by a false gzip signature. */
const GZIP_RETRY_BYTES = 8 << 20;

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
