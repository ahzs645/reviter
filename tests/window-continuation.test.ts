/**
 * The preset-dictionary continuation read.
 *
 * Revit writes most stream chunks as self-contained DEFLATE bodies, but a
 * minority reference bytes from the previous chunk's output. Those fail outright
 * without the preceding window, so `inflateRevitChunk` retries with it as a
 * preset dictionary. These tests build both shapes with node's zlib and check
 * that the reader handles each without regressing the self-contained case.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { constants, deflateRawSync, gzipSync } from "node:zlib";
import {
  isRevitChecksumPagedStream,
  REVIT_PAGE_CHECKSUM_BYTES,
  REVIT_PAGE_PAYLOAD_BYTES,
  REVIT_STORED_PAGE_BYTES,
  REVIT_WINDOW_BYTES,
  inflateRevitChunk,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

/** A Revit chunk: a gzip header, then a raw DEFLATE body with no trailer. */
function chunk(payload: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  const header = gzipSync(new Uint8Array(0)).subarray(0, 10);
  const body = deflateRawSync(payload, dictionary ? { dictionary } : {});
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

/** Compressible bytes, so the encoder actually emits back-references. */
function payload(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (seed + (i % 61) * 7) & 0xff;
  return out;
}

test("a self-contained chunk still reads with no window", () => {
  const bytes = payload(3, 4_000);
  const read = inflateRevitChunk(chunk(bytes), 0);
  assert.deepEqual(read, bytes);
});

test("a chunk written against the previous window fails without it", () => {
  const previous = payload(11, 20_000);
  const bytes = payload(11, 6_000);
  const encoded = chunk(bytes, previous);
  assert.equal(inflateRevitChunk(encoded, 0), null);
  assert.deepEqual(inflateRevitChunk(encoded, 0, undefined, previous), bytes);
});

test("the window is the trailing 32 KiB of the previous chunk", () => {
  const previous = payload(5, 90_000);
  const tail = revitWindowTail(previous);
  assert.equal(tail.length, REVIT_WINDOW_BYTES);
  assert.deepEqual(tail, previous.subarray(previous.length - REVIT_WINDOW_BYTES));

  const bytes = payload(5, 5_000);
  const encoded = chunk(bytes, tail);
  assert.deepEqual(inflateRevitChunk(encoded, 0, undefined, tail), bytes);
});

test("a short chunk is its own window", () => {
  const short = payload(2, 400);
  assert.deepEqual(revitWindowTail(short), short);
});

test("removes checksum tails from complete Revit database pages", () => {
  assert.equal(REVIT_PAGE_CHECKSUM_BYTES, 353);
  const first = payload(7, REVIT_PAGE_PAYLOAD_BYTES);
  const checksum = payload(201, REVIT_PAGE_CHECKSUM_BYTES);
  const second = payload(31, 1_234);
  const stored = new Uint8Array(REVIT_STORED_PAGE_BYTES + second.length);
  stored.set(first);
  stored.set(checksum, first.length);
  stored.set(second, REVIT_STORED_PAGE_BYTES);

  const clean = stripRevitPageChecksums(stored);
  assert.equal(clean.length, first.length + second.length);
  assert.deepEqual(clean.subarray(0, first.length), first);
  assert.deepEqual(clean.subarray(first.length), second);
  assert.equal(revitStoredPageOffset(REVIT_PAGE_PAYLOAD_BYTES), REVIT_STORED_PAGE_BYTES);
  assert.equal(
    revitStoredPageOffset(REVIT_PAGE_PAYLOAD_BYTES + 17),
    REVIT_STORED_PAGE_BYTES + 17,
  );
  assert.equal(isRevitChecksumPagedStream("Root Entry/Partitions/325"), true);
  assert.equal(isRevitChecksumPagedStream("Global/ElemTable"), true);
  assert.equal(isRevitChecksumPagedStream("ProjectInformation"), false);
});

test("the wrong window is rejected rather than returning garbage", () => {
  const encoded = chunk(payload(7, 6_000), payload(7, 20_000));
  // A dictionary the body was not written against either fails the checksum or
  // decodes to something other than the payload; either way it must not be
  // mistaken for a clean read of a different chunk.
  const read = inflateRevitChunk(encoded, 0, undefined, payload(200, 20_000));
  if (read) assert.notDeepEqual(read, payload(7, 6_000));
});

/**
 * Compressed bytes are what the salvage reader works in, and its resolution is
 * the 4 KiB input slice it pushes, so a fixture has to be several slices long
 * before there is anything "before the desync" to keep. Deterministic
 * pseudo-random bytes barely compress, which is the cheapest way to get one.
 */
function incompressible(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
}

/**
 * A chunk that decodes correctly for a while and then stops making sense, which
 * is what the reference model's 56 unreadable chunks do: they yield 16 KiB to
 * 115 KiB of the ~128 KiB they hold and then desync. The prefix is written with
 * `Z_SYNC_FLUSH` so it ends on a byte boundary, and what follows opens a
 * reserved block type.
 */
function desynced(payload: Uint8Array): Uint8Array {
  const header = gzipSync(new Uint8Array(0)).subarray(0, 10);
  const prefix = deflateRawSync(payload, { finishFlush: constants.Z_SYNC_FLUSH });
  const out = new Uint8Array(header.length + prefix.length + 64);
  out.set(header, 0);
  out.set(prefix, header.length);
  out.fill(0xff, header.length + prefix.length);
  return out;
}

test("a chunk that desyncs partway still yields the prefix in front of it", () => {
  const bytes = incompressible(23, 200_000);
  const encoded = desynced(bytes);
  assert.equal(inflateRevitChunk(encoded, 0), null, "the whole chunk does not read");

  const salvaged = salvageRevitChunk(encoded, 0);
  assert.ok(salvaged, "the prefix decoded before the desync is kept");
  assert.ok(salvaged.length > 0 && salvaged.length < bytes.length, `salvaged ${salvaged?.length}`);
  // What comes back must be the payload's own leading bytes, not a re-decode
  // that happens to land on the right length.
  assert.ok(
    Buffer.from(salvaged).equals(Buffer.from(bytes.subarray(0, salvaged.length))),
    "the salvaged bytes are the payload's own prefix",
  );
});

test("salvaging a clean chunk returns the whole payload", () => {
  const bytes = incompressible(29, 50_000);
  const salvaged = salvageRevitChunk(chunk(bytes), 0);
  assert.ok(salvaged && Buffer.from(salvaged).equals(Buffer.from(bytes)));
});

test("a chunk that decodes nothing salvages nothing", () => {
  const header = gzipSync(new Uint8Array(0)).subarray(0, 10);
  const encoded = new Uint8Array(header.length + 64);
  encoded.set(header, 0);
  // A body of all-ones opens with block type 3, which is not a DEFLATE block.
  encoded.fill(0xff, header.length);
  assert.equal(salvageRevitChunk(encoded, 0), null);
});

test("the salvage read follows the same header validation as the full read", () => {
  const encoded = chunk(incompressible(31, 20_000));
  encoded[3] = 0xe0; // reserved flag bits set: not a Revit chunk header
  assert.equal(salvageRevitChunk(encoded, 0), null);
});
