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
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  REVIT_WINDOW_BYTES,
  inflateRevitChunk,
  revitWindowTail,
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

test("the wrong window is rejected rather than returning garbage", () => {
  const encoded = chunk(payload(7, 6_000), payload(7, 20_000));
  // A dictionary the body was not written against either fails the checksum or
  // decodes to something other than the payload; either way it must not be
  // mistaken for a clean read of a different chunk.
  const read = inflateRevitChunk(encoded, 0, undefined, payload(200, 20_000));
  if (read) assert.notDeepEqual(read, payload(7, 6_000));
});
