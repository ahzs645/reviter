import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027EdgeLoopWithChainEnvelopesStatic,
  decodeRevit2027EdgeLoopStatic,
  REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
  REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-edge-loop-static.ts";

function makeEdgeLoop(
  token: number,
  sourceClassSlot = REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT,
): Uint8Array {
  const descriptorBytes = token === 0 ? 4 : 6;
  const data = new Uint8Array(20 + descriptorBytes + 12 + 32 + 1);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, -41n, true);
  view.setInt32(8, 72, true);
  view.setInt32(12, -9, true);
  view.setUint32(16, 0xfedcba98, true);
  view.setInt32(20, token, true);
  if (token !== 0) view.setInt16(24, sourceClassSlot, true);
  const scalarOffset = 20 + descriptorBytes;
  view.setInt32(scalarOffset, -101, true);
  view.setInt32(scalarOffset + 4, 202, true);
  view.setInt32(scalarOffset + 8, -303, true);
  view.setFloat64(scalarOffset + 12, -4.5, true);
  view.setFloat64(scalarOffset + 20, -3.25, true);
  view.setFloat64(scalarOffset + 28, 7.75, true);
  view.setFloat64(scalarOffset + 36, 8.5, true);
  data[data.length - 1] = 1;
  return data;
}

function makeEdgeLoopWithChains(
  chains: readonly {
    startEdgeReference: number;
    envelope: readonly [number, number, number, number];
  }[],
): Uint8Array {
  const loop = makeEdgeLoop(0);
  const data = new Uint8Array(loop.length + 4 + chains.length * 36);
  data.set(loop);
  const view = new DataView(data.buffer);
  view.setInt32(loop.length, chains.length, true);
  chains.forEach((chain, index) => {
    const offset = loop.length + 4 + index * 36;
    view.setInt32(offset, chain.startEdgeReference, true);
    chain.envelope.forEach((value, scalarIndex) => {
      view.setFloat64(offset + 4 + scalarIndex * 8, value, true);
    });
  });
  return data;
}

test("publishes the exact Revit 2027 first-loop source slots", () => {
  assert.equal(REVIT_2027_EDGE_LOOP_SOURCE_CLASS_SLOT, 1434);
  assert.equal(
    REVIT_2027_EDGE_LOOP_WITH_CHAIN_ENVELOPES_SOURCE_CLASS_SLOT,
    1437,
  );
});

test("decodes a null EdgeLoop descriptor and exact scalar boundary", () => {
  const data = makeEdgeLoop(0);
  const result = decodeRevit2027EdgeLoopStatic(
    data,
    0,
    data.length,
    2027,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.endOffset, 69);
  assert.deepEqual(result.value.gInfo, {
    gStyleElementId: -41n,
    tag: 72,
    controlCommand: -9,
    flags: 0xfedcba98,
  });
  assert.deepEqual(result.value.nextLoop, {
    byteOffset: 20,
    endOffset: 24,
    token: 0,
    sourceClassSlot: null,
  });
  assert.deepEqual(result.value.queuedProperties, []);
  assert.equal(result.value.faceReference, -101);
  assert.equal(result.value.nextEdgeReference, 202);
  assert.equal(result.value.previousEdgeReference, -303);
  assert.deepEqual(result.value.envelope, {
    minimum: [-4.5, -3.25],
    maximum: [7.75, 8.5],
  });
  assert.equal(result.value.open, true);
});

test("preserves positive and -1 next-loop descriptors in FIFO order", () => {
  for (const token of [17, -1]) {
    const data = makeEdgeLoop(token, 1437);
    const result = decodeRevit2027EdgeLoopStatic(
      data,
      0,
      data.length,
      2027,
    );
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.value.endOffset, 71);
    assert.deepEqual(result.value.queuedProperties, [
      {
        byteOffset: 20,
        endOffset: 26,
        token,
        sourceClassSlot: 1437,
      },
    ]);
  }
});

test("rejects unproven negative next-loop sentinels", () => {
  const data = makeEdgeLoop(-2);
  const result = decodeRevit2027EdgeLoopStatic(
    data,
    0,
    data.length,
    2027,
  );
  assert.deepEqual(result, {
    ok: false,
    error: "EdgeLoop next-loop token is an unproven negative sentinel",
  });
});

test("EdgeLoop reader is release-gated and bounded by its envelope", () => {
  const data = makeEdgeLoop(8);
  assert.equal(
    decodeRevit2027EdgeLoopStatic(data, 0, data.length, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027EdgeLoopStatic(data, 0, data.length - 1, 2027).ok,
    false,
  );
  assert.equal(
    decodeRevit2027EdgeLoopStatic(data.subarray(0, 23), 0, 23, 2027).ok,
    false,
  );
  const badSlot = makeEdgeLoop(8, -4);
  assert.equal(
    decodeRevit2027EdgeLoopStatic(
      badSlot,
      0,
      badSlot.length,
      2027,
    ).ok,
    false,
  );
  const nonBoolean = makeEdgeLoop(0);
  nonBoolean[nonBoolean.length - 1] = 2;
  assert.equal(
    decodeRevit2027EdgeLoopStatic(
      nonBoolean,
      0,
      nonBoolean.length,
      2027,
    ).ok,
    false,
  );
  const nonFinite = makeEdgeLoop(0);
  new DataView(nonFinite.buffer).setFloat64(36, Number.NaN, true);
  assert.equal(
    decodeRevit2027EdgeLoopStatic(
      nonFinite,
      0,
      nonFinite.length,
      2027,
    ).ok,
    false,
  );
});

test("decodes EdgeLoopWithChainEnvelopes at the exact boundary", () => {
  const data = makeEdgeLoopWithChains([
    {
      startEdgeReference: -9,
      envelope: [-4.5, -2.25, 7.75, 8.5],
    },
    {
      startEdgeReference: 14,
      envelope: [0, 1, 2, 3],
    },
  ]);
  const result = decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
    data,
    0,
    data.length,
    2027,
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      byteOffset: 0,
      endOffset: 145,
      loop: {
        byteOffset: 0,
        endOffset: 69,
        gInfo: {
          gStyleElementId: -41n,
          tag: 72,
          controlCommand: -9,
          flags: 0xfedcba98,
        },
        nextLoop: {
          byteOffset: 20,
          endOffset: 24,
          token: 0,
          sourceClassSlot: null,
        },
        faceReference: -101,
        nextEdgeReference: 202,
        previousEdgeReference: -303,
        staticReferences: [-101, 202, -303],
        envelope: {
          minimum: [-4.5, -3.25],
          maximum: [7.75, 8.5],
        },
        open: true,
        queuedProperties: [],
      },
      chains: [
        {
          startEdgeReference: -9,
          envelope: {
            minimum: [-4.5, -2.25],
            maximum: [7.75, 8.5],
          },
        },
        {
          startEdgeReference: 14,
          envelope: {
            minimum: [0, 1],
            maximum: [2, 3],
          },
        },
      ],
      staticReferences: [-101, 202, -303, -9, 14],
      queuedProperties: [],
    },
  });
});

test("chain-envelope reader rejects release, count, option, extent, and non-finite values", () => {
  const data = makeEdgeLoopWithChains([
    { startEdgeReference: 1, envelope: [0, 1, 2, 3] },
    { startEdgeReference: 2, envelope: [4, 5, 6, 7] },
  ]);
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      data,
      0,
      data.length,
      2026,
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      data,
      0,
      data.length,
      2027,
      { maxChains: 1 },
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      data,
      0,
      data.length,
      2027,
      { maxChains: -1 },
    ).ok,
    false,
  );
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      data,
      0,
      data.length - 1,
      2027,
    ).ok,
    false,
  );
  const negative = makeEdgeLoopWithChains([]);
  new DataView(negative.buffer).setInt32(69, -1, true);
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      negative,
      0,
      negative.length,
      2027,
    ).ok,
    false,
  );
  const nonFinite = makeEdgeLoopWithChains([
    { startEdgeReference: 1, envelope: [0, 1, 2, 3] },
  ]);
  new DataView(nonFinite.buffer).setFloat64(77, Number.NaN, true);
  assert.equal(
    decodeRevit2027EdgeLoopWithChainEnvelopesStatic(
      nonFinite,
      0,
      nonFinite.length,
      2027,
    ).ok,
    false,
  );
});
