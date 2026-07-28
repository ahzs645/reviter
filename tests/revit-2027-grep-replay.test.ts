import assert from "node:assert/strict";
import test from "node:test";

import type { CondInt16QueueEntry } from "../lib/reviter/dynamic-geometry-queue.ts";
import type { Revit2027FramedGRepRoot } from "../lib/reviter/revit-2027-framed-grep-root.ts";
import { REVIT_2027_FACE_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-face-static.ts";
import {
  createRevit2027GRepReplayRegistry,
  replayRevit2027GRepFifo,
  type Revit2027GRepReplayReaderRegistration,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  REVIT_2027_GLINE_BODY_BYTES,
  REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-gline.ts";
import {
  REVIT_2027_GARRAY_BODY_BYTES,
  REVIT_2027_GARRAY_SOURCE_CLASS_SLOT,
  REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-grep-prefixes.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT } from "../lib/reviter/revit-2027-geometry.ts";

const FACE_SLOT = REVIT_2027_FACE_SOURCE_CLASS_SLOT;
const EDGE_SLOT = 1423;
const INSTANCE_INFO_SLOT = 2513;

function descriptor(
  token: number,
  sourceClassSlot: number | null,
  byteOffset: number,
): CondInt16QueueEntry {
  return {
    byteOffset,
    endOffset: byteOffset + (token === 0 ? 4 : 6),
    token,
    sourceClassSlot,
  };
}

function root(
  children: readonly CondInt16QueueEntry[],
  dynamicPayloadOffset: number,
  dynamicPayloadEndOffset: number,
): Revit2027FramedGRepRoot {
  return {
    frameOffset: 0,
    frameEndOffset: dynamicPayloadEndOffset,
    dynamicPayloadOffset,
    dynamicPayloadEndOffset,
    ownerElementId: 400_237n,
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
  view.setInt32(offset + 8, 31, true);
  view.setInt32(offset + 12, 9, true);
  view.setUint32(offset + 16, 0x0008_8004, true);
}

function writeDescriptor(
  view: DataView,
  offset: number,
  token: number,
  sourceClassSlot: number | null,
): number {
  view.setInt32(offset, token, true);
  if (token === 0) return offset + 4;
  view.setInt16(offset + 4, sourceClassSlot!, true);
  return offset + 6;
}

function writeCollection(
  view: DataView,
  offset: number,
  entries: readonly { token: number; sourceClassSlot: number | null }[],
): number {
  view.setInt32(offset, entries.length, true);
  let cursor = offset + 4;
  for (const entry of entries) {
    cursor = writeDescriptor(
      view,
      cursor,
      entry.token,
      entry.sourceClassSlot,
    );
  }
  return cursor;
}

function writeGGroup(
  data: Uint8Array,
  offset: number,
  children: readonly { token: number; sourceClassSlot: number | null }[],
): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  return writeCollection(view, offset + 20, children);
}

function writeGLine(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  [0, 4.5, -27, 56, 0, -1, 0, 0].forEach((value, index) => {
    view.setFloat64(offset + 20 + index * 8, value, true);
  });
  return offset + REVIT_2027_GLINE_BODY_BYTES;
}

function writeGArray(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  writeDescriptor(view, offset + 20, -1, INSTANCE_INFO_SLOT);
  writeDescriptor(view, offset + 26, 0, null);
  data[offset + 42] = 0;
  data[offset + 43] = 0;
  const transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30];
  transform.forEach((value, index) => {
    view.setFloat64(offset + 44 + index * 8, value, true);
  });
  view.setInt32(offset + 140, 7, true);
  return offset + REVIT_2027_GARRAY_BODY_BYTES;
}

function writeGeometry(
  data: Uint8Array,
  offset: number,
  faces: readonly { token: number; sourceClassSlot: number | null }[],
  edges: readonly { token: number; sourceClassSlot: number | null }[],
): number {
  const view = new DataView(data.buffer);
  writeGInfo(view, offset);
  let cursor = writeCollection(view, offset + 20, faces);
  view.setInt32(cursor, 7, true);
  view.setInt32(cursor + 4, 91, true);
  view.setInt32(cursor + 8, 0, true);
  view.setInt32(cursor + 12, 1, true);
  cursor += 16;
  cursor = writeCollection(view, cursor, edges);
  return writeCollection(view, cursor, []);
}

function oneByteReader(id: string): Revit2027GRepReplayReaderRegistration {
  return {
    id,
    read: (_data, context) => ({
      ok: true,
      startOffset: context.byteOffset,
      endOffset: context.byteOffset + 1,
      appendedProperties: [],
      value: id,
    }),
  };
}

test("default registry includes the certified Face reader", () => {
  assert.equal(
    createRevit2027GRepReplayRegistry().get(FACE_SLOT)?.id,
    "Revit2027Face",
  );
});

test("older root siblings replay before children appended by a GGroup", () => {
  const payloadOffset = 16;
  const groupBytes = 30;
  const data = new Uint8Array(
    payloadOffset + groupBytes + REVIT_2027_GLINE_BODY_BYTES * 2,
  );
  assert.equal(
    writeGGroup(data, payloadOffset, [
      { token: 5, sourceClassSlot: REVIT_2027_GLINE_SOURCE_CLASS_SLOT },
    ]),
    payloadOffset + groupBytes,
  );
  assert.equal(
    writeGLine(data, payloadOffset + groupBytes),
    payloadOffset + groupBytes + REVIT_2027_GLINE_BODY_BYTES,
  );
  assert.equal(
    writeGLine(
      data,
      payloadOffset + groupBytes + REVIT_2027_GLINE_BODY_BYTES,
    ),
    data.byteLength,
  );

  const replayed = replayRevit2027GRepFifo(
    data,
    root(
      [
        descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT, 0),
        descriptor(4, REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 6),
      ],
      payloadOffset,
      data.byteLength,
    ),
  );

  assert.equal(replayed.ok, true);
  if (!replayed.ok) return;
  assert.deepEqual(
    replayed.value.spans.map((span) => span.propertySourceClassSlot),
    [
      REVIT_2027_GGROUP_SOURCE_CLASS_SLOT,
      REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
      REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
    ],
  );
  assert.deepEqual(
    replayed.value.spans.map((span) => span.path),
    [[0], [1], [0, 0]],
  );
  assert.deepEqual(
    replayed.value.spans.map((span) => span.parentReplayIndex),
    [null, null, 0],
  );
  assert.deepEqual(
    replayed.value.spans.map((span) => [
      span.startOffset,
      span.endOffset,
    ]),
    [
      [payloadOffset, payloadOffset + groupBytes],
      [
        payloadOffset + groupBytes,
        payloadOffset + groupBytes + REVIT_2027_GLINE_BODY_BYTES,
      ],
      [
        payloadOffset + groupBytes + REVIT_2027_GLINE_BODY_BYTES,
        data.byteLength,
      ],
    ],
  );
});

test("token -1 is queued in FIFO order without advancing positive tokens", () => {
  const payloadOffset = 16;
  const nestedBytes = 1;
  const data = new Uint8Array(
    payloadOffset +
      REVIT_2027_GARRAY_BODY_BYTES +
      REVIT_2027_GLINE_BODY_BYTES +
      nestedBytes,
  );
  let cursor = writeGArray(data, payloadOffset);
  cursor = writeGLine(data, cursor);
  data[cursor] = 0x55;

  const registry = createRevit2027GRepReplayRegistry();
  registry.set(INSTANCE_INFO_SLOT, oneByteReader("InstanceInfo"));
  const replayed = replayRevit2027GRepFifo(
    data,
    root(
      [
        descriptor(3, REVIT_2027_GARRAY_SOURCE_CLASS_SLOT, 0),
        descriptor(4, REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 6),
      ],
      payloadOffset,
      data.byteLength,
    ),
    registry,
  );

  assert.equal(replayed.ok, true);
  if (!replayed.ok) return;
  assert.deepEqual(
    replayed.value.spans.map((span) => [
      span.propertySourceClassSlot,
      span.propertyToken,
      span.path,
    ]),
    [
      [REVIT_2027_GARRAY_SOURCE_CLASS_SLOT, 3, [0]],
      [REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 4, [1]],
      [INSTANCE_INFO_SLOT, -1, [0, 0]],
    ],
  );
  assert.equal(replayed.value.finalTokenCount, 5);
  assert.deepEqual(
    replayed.value.descriptors
      .filter((entry) => entry.parentReplayIndex === 0)
      .map((entry) => [entry.token, entry.state, entry.queueSequence]),
    [
      [-1, "queued", 2],
      [0, "null", null],
    ],
  );
});

test("Geometry appends all faces before edges to the shared FIFO", () => {
  const payloadOffset = 8;
  const data = new Uint8Array(96);
  const geometryEnd = writeGeometry(
    data,
    payloadOffset,
    [
      { token: 4, sourceClassSlot: FACE_SLOT },
      { token: 5, sourceClassSlot: FACE_SLOT },
    ],
    [{ token: 6, sourceClassSlot: EDGE_SLOT }],
  );
  const replayEnd = geometryEnd + 3;
  const registry = createRevit2027GRepReplayRegistry();
  registry.set(FACE_SLOT, oneByteReader("SyntheticFace"));
  registry.set(EDGE_SLOT, oneByteReader("SyntheticEdge"));

  const replayed = replayRevit2027GRepFifo(
    data,
    root(
      [descriptor(3, REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT, 0)],
      payloadOffset,
      replayEnd,
    ),
    registry,
  );

  assert.equal(replayed.ok, true);
  if (!replayed.ok) return;
  assert.deepEqual(
    replayed.value.spans.map((span) => span.propertySourceClassSlot),
    [REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT, FACE_SLOT, FACE_SLOT, EDGE_SLOT],
  );
  assert.deepEqual(
    replayed.value.spans.map((span) => span.path),
    [[0], [0, 0], [0, 1], [0, 2]],
  );
  assert.deepEqual(
    replayed.value.spans.slice(1).map((span) => span.startOffset),
    [geometryEnd, geometryEnd + 1, geometryEnd + 2],
  );
});

test("unknown slots and invalid negative or sparse tokens fail closed", () => {
  const unknownData = new Uint8Array(7);
  const unknown = replayRevit2027GRepFifo(
    unknownData,
    root([descriptor(3, 9999, 0)], 6, 7),
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /source slot 9999/);

  for (const token of [-2, 5]) {
    const payloadOffset = 6;
    const data = new Uint8Array(payloadOffset + 30);
    writeGGroup(data, payloadOffset, [
      { token, sourceClassSlot: REVIT_2027_GLINE_SOURCE_CLASS_SLOT },
    ]);
    const replayed = replayRevit2027GRepFifo(
      data,
      root(
        [descriptor(3, REVIT_2027_GGROUP_SOURCE_CLASS_SLOT, 0)],
        payloadOffset,
        data.byteLength,
      ),
    );
    assert.equal(replayed.ok, false);
    if (!replayed.ok) {
      assert.match(
        replayed.error,
        token < 0 ? /unsupported negative.*-2/ : /not append-only index 4/,
      );
    }
  }
});

test("boundary gaps, overruns, and non-contiguous plugin spans fail closed", () => {
  const payloadOffset = 6;
  const gapData = new Uint8Array(
    payloadOffset + REVIT_2027_GLINE_BODY_BYTES + 1,
  );
  writeGLine(gapData, payloadOffset);
  const gap = replayRevit2027GRepFifo(
    gapData,
    root(
      [
        descriptor(
          3,
          REVIT_2027_GLINE_SOURCE_CLASS_SLOT,
          0,
        ),
      ],
      payloadOffset,
      gapData.byteLength,
    ),
  );
  assert.equal(gap.ok, false);
  if (!gap.ok) assert.match(gap.error, /boundary gap/);

  const overrunData = new Uint8Array(
    payloadOffset + REVIT_2027_GLINE_BODY_BYTES,
  );
  writeGLine(overrunData, payloadOffset);
  const overrun = replayRevit2027GRepFifo(
    overrunData,
    root(
      [descriptor(3, REVIT_2027_GLINE_SOURCE_CLASS_SLOT, 0)],
      payloadOffset,
      payloadOffset + REVIT_2027_GLINE_BODY_BYTES - 1,
    ),
  );
  assert.equal(overrun.ok, false);
  if (!overrun.ok) assert.match(overrun.error, /exceeds.*boundary/);

  const pluginData = new Uint8Array(7);
  const registry = createRevit2027GRepReplayRegistry();
  registry.set(9998, {
    id: "GapReader",
    read: (_data, context) => ({
      ok: true,
      startOffset: context.byteOffset + 1,
      endOffset: context.replayEndOffset,
      appendedProperties: [],
    }),
  });
  const pluginGap = replayRevit2027GRepFifo(
    pluginData,
    root([descriptor(3, 9998, 0)], 6, 7),
    registry,
  );
  assert.equal(pluginGap.ok, false);
  if (!pluginGap.ok) assert.match(pluginGap.error, /non-contiguous body span/);
});
