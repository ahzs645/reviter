import assert from "node:assert/strict";
import test from "node:test";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import type { Revit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import {
  decodeRevit2027GGroupStatic,
  locateRevit2027FirstGGroupNestedFifo,
} from "../lib/reviter/revit-2027-ggroup-fifo.ts";
import {
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";

function descriptor(
  token: number,
  sourceClassSlot: number,
): CondInt16QueueEntry {
  return { byteOffset: 0, endOffset: 6, token, sourceClassSlot };
}

function root(
  children: readonly CondInt16QueueEntry[],
  replayEndOffset: number,
): Revit2027FramedGRepRoot {
  return {
    frameOffset: 0,
    frameEndOffset: replayEndOffset,
    dynamicPayloadOffset: 0,
    dynamicPayloadEndOffset: replayEndOffset,
    ownerElementId: 91n,
    gInfo: {
      gStyleElementId: 0n,
      tag: 0,
      controlCommand: 0,
      flags: 0,
    },
    children,
    localExtents: {
      minimum: [0, 0, 0],
      maximum: [0, 0, 0],
      valid: true,
    },
    worldExtents: {
      minimum: [0, 0, 0],
      maximum: [0, 0, 0],
      valid: true,
    },
    objectType: 0,
    flags: 0,
  };
}

function writeGInfo(view: DataView, offset: number): void {
  view.setBigInt64(offset, 145n, true);
  view.setUint32(offset + 16, 0x0008_8004, true);
}

function writeGGroup(
  data: Uint8Array,
  offset: number,
  children: readonly { token: number; sourceClassSlot: number }[],
): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  view.setInt32(offset + 20, children.length, true);
  let cursor = offset + 24;
  for (const child of children) {
    view.setInt32(cursor, child.token, true);
    view.setInt16(cursor + 4, child.sourceClassSlot, true);
    cursor += 6;
  }
  return cursor;
}

function writeGArray(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  view.setInt32(offset + 20, -1, true);
  view.setInt16(offset + 24, 2513, true);
  view.setInt32(offset + 26, 0, true);
  data[offset + 42] = 1;
  const transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30];
  transform.forEach((value, index) => {
    view.setFloat64(offset + 44 + index * 8, value, true);
  });
  return offset + REVIT_2027_GARRAY_BODY_BYTES;
}

test("GGroup schema-complete static body ends with m_subNodes", () => {
  const data = new Uint8Array(40);
  const endOffset = writeGGroup(data, 4, [
    { token: 3, sourceClassSlot: 2343 },
  ]);
  data.fill(0xaa, endOffset);

  const decoded = decodeRevit2027GGroupStatic(
    data,
    4,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.endOffset, endOffset);
  assert.equal(data[decoded.value.endOffset], 0xaa);
});

test("locates first GGroup nested FIFO after an older GArray sibling", () => {
  const groupBytes = 30;
  const data = new Uint8Array(groupBytes + REVIT_2027_GARRAY_BODY_BYTES);
  assert.equal(
    writeGGroup(data, 0, [{ token: 5, sourceClassSlot: 2343 }]),
    groupBytes,
  );
  assert.equal(writeGArray(data, groupBytes), data.byteLength);
  const decoded = locateRevit2027FirstGGroupNestedFifo(
    data,
    root(
      [
        descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT),
        descriptor(4, REVIT_2027_GARRAY_SOURCE_CLASS_SLOT),
      ],
      data.byteLength,
    ),
    2027,
  );

  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.initialSiblingSpans.length, 1);
  assert.equal(decoded.value.nestedFifoOffset, data.byteLength);
  assert.equal(decoded.value.firstNestedEntry?.sourceClassSlot, 2343);
});

test("keeps later GGroup appends behind the first group's nested FIFO", () => {
  const data = new Uint8Array(60);
  assert.equal(
    writeGGroup(data, 0, [{ token: 5, sourceClassSlot: 2343 }]),
    30,
  );
  assert.equal(
    writeGGroup(data, 30, [{ token: 6, sourceClassSlot: 2215 }]),
    data.byteLength,
  );
  const decoded = locateRevit2027FirstGGroupNestedFifo(
    data,
    root(
      [
        descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT),
        descriptor(4, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT),
      ],
      data.byteLength,
    ),
    2027,
  );

  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.value.nestedFifoOffset, data.byteLength);
  assert.equal(decoded.value.firstNestedEntry?.token, 5);
  assert.equal(decoded.value.initialSiblingSpans[0]?.queuedProperties[0]?.token, 6);
});

test("GGroup FIFO locator rejects another release and unknown siblings", () => {
  const data = new Uint8Array(24);
  writeGGroup(data, 0, []);
  const groupRoot = root(
    [descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT)],
    data.byteLength,
  );
  assert.equal(
    locateRevit2027FirstGGroupNestedFifo(data, groupRoot, 2026).ok,
    false,
  );

  const unknownSibling = root(
    [
      descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT),
      descriptor(4, 2343),
    ],
    data.byteLength,
  );
  const rejected = locateRevit2027FirstGGroupNestedFifo(
    data,
    unknownSibling,
    2027,
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /source slot 2343/);
});
