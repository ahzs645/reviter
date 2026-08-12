/**
 * What a Revit stream is allowed to inflate to.
 *
 * The chunk readers bounded their input and nothing else. `end` says how many
 * compressed bytes are read and `GZIP_RETRY_BYTES` caps the retry at 8 MiB, but
 * DEFLATE turns one input byte into as many as 1,032 — so a crafted body inside
 * every one of those caps decodes toward gigabytes. The salvage reader was the
 * sharpest edge of it: it pushed input in 4 KiB slices, appended every emitted
 * chunk to `parts`, and deliberately swallowed the throw at the end, which is
 * an accumulator with no ceiling and a `catch` over the top of it.
 *
 * The bombs below are real: about 1 MiB of DEFLATE that asks for a full GiB.
 *
 * None of these tests time anything. "It stopped early" is asserted through
 * what the readers leave behind rather than through a clock — the census entry
 * the guard writes, and the stream budget it charges. A stream is given an
 * allowance a little above the ceiling and an ordinary chunk to read after the
 * bomb: that second chunk can only decode if the bomb was charged for what the
 * ceiling allowed rather than for what the file asked for, which is the same
 * claim a stopwatch was making, with none of the flakiness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { constants, deflateRawSync, gzipSync } from "node:zlib";

import {
  REVIT_MAX_CHUNK_INFLATED_BYTES,
  REVIT_MAX_STREAM_INFLATION_RATIO,
  REVIT_MIN_STREAM_INFLATED_BYTES,
  inflateRevitChunk,
  salvageRevitChunk,
} from "../lib/reviter/revit-container.ts";
import { limitCensus, resetLimitCensus } from "../lib/reviter/limit-census.ts";

const MIB = 1 << 20;

/** A Revit chunk: a gzip header, then a raw DEFLATE body with no trailer. */
function chunk(body: Uint8Array): Uint8Array {
  const header = gzipSync(new Uint8Array(0)).subarray(0, 10);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

/**
 * A DEFLATE body that decodes to `mebibytes` MiB of zeros.
 *
 * Built by concatenating one mebibyte's worth of blocks rather than by
 * compressing the whole thing, so asking for a gigabyte costs a megabyte of
 * memory instead of a gigabyte. `Z_SYNC_FLUSH` leaves each piece unterminated
 * and on a byte boundary, so the pieces join into one stream; the last piece is
 * a normal deflate so the stream ends.
 */
function bombBody(mebibytes: number): Uint8Array {
  const unit = new Uint8Array(MIB);
  const open = new Uint8Array(deflateRawSync(unit, { finishFlush: constants.Z_SYNC_FLUSH }));
  const close = new Uint8Array(deflateRawSync(unit));
  const out = new Uint8Array(open.length * (mebibytes - 1) + close.length);
  let at = 0;
  for (let index = 0; index < mebibytes - 1; index += 1) {
    out.set(open, at);
    at += open.length;
  }
  out.set(close, at);
  return out;
}

/** Ordinary payload: a real chunk's ~128 KiB, and not a run of zeros. */
function ordinaryPayload(): Uint8Array {
  const out = new Uint8Array(128 << 10);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = (index * 7 + (index >> 5)) & 0xff;
  }
  return out;
}

const BOMB = chunk(bombBody(1_024));
const ORDINARY = ordinaryPayload();
const ORDINARY_CHUNK = chunk(new Uint8Array(deflateRawSync(ORDINARY)));

/**
 * A stream whose first chunk is a bomb and whose second is an ordinary chunk,
 * with the offset of each. One buffer, because a stream's inflation budget is
 * carried by the buffer it is read from — which is exactly what the second
 * chunk is here to measure.
 */
function bombedStream(): { data: Uint8Array; bomb: number; ordinary: number } {
  const data = new Uint8Array(BOMB.length + ORDINARY_CHUNK.length);
  data.set(BOMB, 0);
  data.set(ORDINARY_CHUNK, BOMB.length);
  return { data, bomb: 0, ordinary: BOMB.length };
}

const census = () => limitCensus().map((entry) => [entry.limit, entry.rejections]);

/**
 * Compare a read against the ordinary payload without ever handing a failing
 * assertion two 128 KiB typed arrays to diff. `assert.deepEqual` on buffers
 * this size spends minutes in the message formatter and can take the process
 * out with it, which turns a one-line test bug into a hang.
 */
function assertReads(read: Uint8Array | null, what: string): void {
  assert.equal(read?.length ?? null, ORDINARY.length, what);
  assert.ok(Buffer.from(read!).equals(Buffer.from(ORDINARY)), `${what}: same bytes`);
}

function assertRefused(read: Uint8Array | null, what: string): void {
  assert.equal(read?.length ?? null, null, what);
}

test("the fixture really is a bomb", () => {
  // Not a claim about the readers — a claim about the input, so that the tests
  // below mean what they say. A gigabyte of output from a megabyte of DEFLATE
  // is within a couple of percent of the 1032:1 the format tops out at.
  assert.ok(BOMB.length < 2 * MIB, `${BOMB.length} bytes of input`);
  assert.ok((1_024 * MIB) / BOMB.length > 1_000, "asks for a thousand times its size");
});

test("the strict read refuses a chunk that inflates past the chunk ceiling", () => {
  resetLimitCensus();
  const { data, bomb, ordinary } = bombedStream();
  const limits = { maxChunkBytes: MIB, maxStreamBytes: 4 * MIB };

  assertRefused(
    inflateRevitChunk(data, bomb, ordinary, null, limits),
    "a chunk that reaches the ceiling is not Revit payload",
  );
  assert.deepEqual(census(), [["max-inflated-chunk-bytes", 1]], "and says so");

  /*
   * The work bound, without a stopwatch. The bomb asked for 1,024 MiB against a
   * 1 MiB ceiling, and the stream was given 4 MiB in total. If the read had run
   * to what the file asked for, the budget would be gone and nothing after it
   * could decode. This chunk decodes, so the bomb was charged for what the
   * ceiling allowed — under 4 MiB of the 1,024 MiB it asked for.
   */
  assertReads(
    inflateRevitChunk(data, ordinary, undefined, null, limits),
    "the stream still has its budget, so the bomb did not spend it",
  );
  assert.deepEqual(census(), [["max-inflated-chunk-bytes", 1]], "and nothing new is reported");
});

test("the salvage read refuses one too, rather than keeping 64 MiB of it", () => {
  /*
   * Salvage is the forgiving path by design — it keeps whatever a desyncing
   * chunk decoded before it stopped. That is right at 115 KiB of the ~128 KiB a
   * chunk holds and wrong at a million times that: a body still going at the
   * ceiling is not a chunk that desynced, it is a chunk that is not a chunk.
   */
  resetLimitCensus();
  const { data, bomb, ordinary } = bombedStream();
  const limits = { maxChunkBytes: MIB, maxStreamBytes: 4 * MIB };

  assertRefused(salvageRevitChunk(data, bomb, ordinary, null, limits), "refused");
  assert.deepEqual(census(), [["max-inflated-chunk-bytes", 1]]);
  assertReads(
    salvageRevitChunk(data, ordinary, undefined, null, limits),
    "salvage stopped at the ceiling rather than at the gigabyte",
  );
});

test("the ceiling holds at its shipped default, not only when one is passed", () => {
  // The bound that ships is the bound that matters. Only the stream's allowance
  // is named here, so the chunk ceiling under test is the real 64 MiB one, and
  // the ordinary chunk that follows proves the gigabyte was never decoded.
  resetLimitCensus();
  const { data, bomb, ordinary } = bombedStream();
  const limits = { maxStreamBytes: 160 * MIB };

  assertRefused(inflateRevitChunk(data, bomb, ordinary, null, limits), "refused");
  assert.deepEqual(census(), [["max-inflated-chunk-bytes", 1]]);
  assertReads(
    inflateRevitChunk(data, ordinary, undefined, null, limits),
    "1,024 MiB was asked for and under 160 MiB was spent",
  );
});

test("a stream's chunks share one budget, so many small bombs are bounded too", () => {
  /*
   * A per-chunk ceiling is not a bound on a stream: ten thousand chunks each
   * stopping just under the chunk ceiling is still hundreds of gigabytes. The
   * budget is carried by the stream buffer itself, so every chunk read from
   * that buffer spends from the same allowance — and once it is gone, the reads
   * that follow are refused before they decode anything at all.
   *
   * Only the stream's allowance is narrowed here. The chunk ceiling stays at
   * its shipped 64 MiB, so it is the stream's budget doing the refusing.
   */
  resetLimitCensus();
  const { data, bomb, ordinary } = bombedStream();
  const limits = { maxStreamBytes: 2 * MIB };

  assertRefused(inflateRevitChunk(data, bomb, ordinary, null, limits), "the bomb is refused");
  assert.deepEqual(
    census(),
    [["max-inflated-stream-bytes", 1]],
    "the stream's allowance is what bound, and it says so",
  );

  // An ordinary 128 KiB chunk, refused only because the bomb ahead of it spent
  // the stream's allowance — and counted once for the stream, not once more.
  assertRefused(
    inflateRevitChunk(data, ordinary, undefined, null, limits),
    "nothing more is read from a stream that has spent its budget",
  );
  assertRefused(salvageRevitChunk(data, ordinary, undefined, null, limits), "salvage too");
  assert.deepEqual(
    census(),
    [["max-inflated-stream-bytes", 1]],
    "one exhausted budget is one report, not one per chunk that follows",
  );

  // The control: that same chunk, read from a buffer with its own budget, is
  // perfectly good payload. It was the stream's allowance that refused it.
  resetLimitCensus();
  const fresh = new Uint8Array(data);
  assertReads(
    inflateRevitChunk(fresh, ordinary, undefined, null, limits),
    "the chunk itself was never the problem",
  );
  assert.deepEqual(census(), []);
});

test("the shipped ceilings are the documented ones", () => {
  // A chunk holds about 128 KiB — the reference model's partition is 3,666 of
  // them inflating to 416.5 MB. 64 MiB is five hundred times that.
  assert.equal(REVIT_MAX_CHUNK_INFLATED_BYTES, 64 * MIB);
  // The reference partition inflates at 6.0x and the README quotes 6.16x, so
  // 32x is five times the observed ratio; the floor sits above the 270 MB of
  // inflated volume the native-mesh bridge measures for the whole model.
  assert.equal(REVIT_MAX_STREAM_INFLATION_RATIO, 32);
  assert.equal(REVIT_MIN_STREAM_INFLATED_BYTES, 256 * MIB);

  // A 69 MB partition — the reference model's — is allowed 2.2 GB against the
  // 416.5 MB it actually produces, so the limit cannot bind on a real file.
  const ceiling = Math.max(
    REVIT_MIN_STREAM_INFLATED_BYTES,
    69 * MIB * REVIT_MAX_STREAM_INFLATION_RATIO,
  );
  assert.ok(ceiling > 416.5e6 * 5, `${ceiling} bytes for a 416.5 MB stream`);
});

test("an ordinary chunk reads exactly as before, with nothing reported", () => {
  // The regression guard. A real chunk is about 19 KiB stored and 128 KiB
  // inflated, three orders of magnitude inside every bound here — it must not
  // reach the streaming reader, the census, or a different set of bytes.
  resetLimitCensus();
  assertReads(inflateRevitChunk(new Uint8Array(ORDINARY_CHUNK), 0), "strict read");
  assertReads(salvageRevitChunk(new Uint8Array(ORDINARY_CHUNK), 0), "salvage read");
  assert.deepEqual(census(), []);
});

test("a stream that legitimately inflates far past its stored size still reads whole", () => {
  // The limits must not punish compressibility. 8 MiB out of 8 KiB is a far
  // higher ratio than any Revit stream reaches, and it is read in full.
  resetLimitCensus();
  const encoded = chunk(bombBody(8));
  assert.equal(inflateRevitChunk(encoded, 0)?.length, 8 * MIB);
  assert.deepEqual(census(), []);
});
