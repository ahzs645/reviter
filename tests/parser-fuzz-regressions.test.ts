/** Fixed seed, finite campaigns: failures report reproducible case indices. */
import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { gzipOffsets, inflateRevitChunk, salvageRevitChunk, stripRevitPageChecksums } from "../lib/reviter/revit-container.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { formatsLatest } from "./rich-rvt-fixture.ts";

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

/** Use Node zlib as an independent compressor for the fflate decoder. */
function compressed(payload: Uint8Array): Uint8Array {
  return Uint8Array.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 11, ...deflateRawSync(payload)]);
}
const limits = { maxChunkBytes: 4096, maxStreamBytes: 16384 };

test("seed 0x51a7: independent zlib streams decode exactly across sizes and subarray offsets", () => {
  const random = generator(0x51a7);
  for (let index = 0; index < 96; index += 1) {
    const payload = Uint8Array.from({ length: 1 + random() % 2048 }, () => random() & 255);
    if (index % 3 === 0) payload.fill(index);
    const encoded = compressed(payload);
    const backing = new Uint8Array(encoded.length + 23);
    backing.set(encoded, 13);
    const slice = backing.subarray(13, 13 + encoded.length);
    for (const read of [inflateRevitChunk, salvageRevitChunk]) {
      const result = read(new Uint8Array(slice), 0, undefined, null, limits);
      assert.ok(result, `case ${index}: ${read.name}`);
      assert.equal(Buffer.compare(result, payload), 0, `case ${index}: ${read.name}`);
    }
    // Exercise DataView/typed-array offset independence without copying.
    assert.equal(Buffer.compare(inflateRevitChunk(slice, 0, undefined, null, limits)!, payload), 0, `subarray ${index}`);
  }
});

test("seed 0xbad5eed: mutated and truncated headers/bodies never escape configured output bounds", () => {
  const random = generator(0xbad5eed);
  const seed = compressed(Uint8Array.from({ length: 8192 }, (_, i) => i & 15));
  for (let index = 0; index < 256; index += 1) {
    const bytes = seed.slice(0, random() % (seed.length + 1));
    for (let flip = 0; flip < 1 + index % 4 && bytes.length; flip += 1) {
      bytes[random() % bytes.length] ^= 1 << (random() % 8);
    }
    const offsets = gzipOffsets(bytes, 3);
    assert.ok(offsets.length <= 3);
    for (const offset of offsets) assert.ok(Number.isInteger(offset) && offset >= 0 && offset + 10 <= bytes.length);
    for (const read of [inflateRevitChunk, salvageRevitChunk]) {
      const result = read(new Uint8Array(bytes), 0, undefined, null, limits);
      assert.ok(result == null || result.length <= limits.maxChunkBytes, `case ${index}: ${read.name}`);
    }
    const stripped = stripRevitPageChecksums(bytes);
    assert.ok(stripped.length <= bytes.length);
  }
});

test("seed 0xc1a55: schema mutations fail as structured errors or preserve bounded structural invariants", () => {
  const random = generator(0xc1a55);
  const seed = formatsLatest("Element", "Wall", "Floor");
  assert.equal(readSchema(seed).ok, true);
  for (let index = 0; index < 512; index += 1) {
    const bytes = index < seed.length ? seed.slice(0, index) : seed.slice();
    if (index >= seed.length) {
      for (let flip = 0; flip < 1 + index % 4; flip += 1) bytes[random() % bytes.length] = random() & 255;
    }
    const result = readSchema(bytes);
    if (!result.ok) {
      assert.ok(Number.isInteger(result.offset) && result.offset >= 0 && result.offset <= bytes.length, `case ${index}`);
      assert.ok(result.error.length > 0);
    } else {
      const schema = result.schema;
      assert.equal(schema.consumedBytes + schema.terminatorBytes + schema.trailingBytes, bytes.length, `case ${index}`);
      assert.ok(schema.classes.length <= bytes.length);
      assert.equal(schema.classesByIndex.size, schema.classes.length);
      for (const record of schema.classes) assert.equal(record.properties.length, record.propertyCount);
    }
  }
});
