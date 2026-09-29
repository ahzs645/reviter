import assert from "node:assert/strict";
import test from "node:test";

import type { Revit2027GRepReplaySpan } from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  REVIT_2027_GINFO_UNDRAWN_FLAG,
  revit2027UndrawnReplayIndices,
} from "../lib/reviter/revit-2027-undrawn-geometry.ts";

function gInfo(flags: number) {
  return { gStyleElementId: -1n, tag: -1, controlCommand: 0, flags };
}

function span(
  replayIndex: number,
  parentReplayIndex: number | null,
  readerId: string,
  value: unknown,
): Revit2027GRepReplaySpan {
  return {
    replayIndex,
    queueSequence: replayIndex,
    ownerElementId: 1n,
    path: [],
    parentPath: null,
    parentReplayIndex,
    propertyToken: replayIndex + 1,
    propertySourceClassSlot: 0,
    descriptorOffset: 0,
    descriptorEndOffset: 0,
    startOffset: 0,
    endOffset: 0,
    readerId,
    value,
  };
}

// Flag words as the corpus stores them: a drawn lamp-head group, a head its
// track length leaves out, a wall reference plane, and a drawn face that
// carries 0x20 alone.
const DRAWN_GROUP = 0x88004;
const UNDRAWN_HEAD = 0x880e4;
const REFERENCE_PLANE = 0xa0882a4;
const DRAWN_WITH_0X20 = 0xa088624;

test("a flagged node and everything beneath it are undrawn", () => {
  const spans = [
    span(0, null, "Revit2027GGroup", { gInfo: gInfo(DRAWN_GROUP) }),
    span(1, 0, "Revit2027GGroup", { gInfo: gInfo(UNDRAWN_HEAD) }),
    span(2, 1, "Revit2027Geometry", { gInfo: gInfo(0x8c004) }),
    span(3, 2, "Revit2027Face", { gInfo: gInfo(0x8204) }),
    span(4, 0, "Revit2027Geometry", { gInfo: gInfo(0x8c004) }),
    span(5, 4, "Revit2027Face", { gInfo: gInfo(0x8204) }),
  ];
  assert.deepEqual([...revit2027UndrawnReplayIndices(spans)!].sort(), [1, 2, 3]);
});

test("a filter's flag is read from its group header, and a face's from itself", () => {
  const spans = [
    span(0, null, "Revit2027GFilter", { group: { gInfo: gInfo(REFERENCE_PLANE) } }),
    span(1, 0, "Revit2027Face", { gInfo: gInfo(0x8204) }),
    span(2, null, "Revit2027Geometry", { gInfo: gInfo(0x8c004) }),
    span(3, 2, "Revit2027Face", { gInfo: gInfo(0x882e4) }),
    span(4, 2, "Revit2027Face", { gInfo: gInfo(0x8204) }),
  ];
  assert.deepEqual([...revit2027UndrawnReplayIndices(spans)!].sort(), [0, 1, 3]);
});

test("bit 0x20 alone does not make a node undrawn", () => {
  assert.equal(REVIT_2027_GINFO_UNDRAWN_FLAG, 0x80);
  const spans = [
    span(0, null, "Revit2027GGroup", { gInfo: gInfo(DRAWN_WITH_0X20) }),
    span(1, 0, "Revit2027Face", { gInfo: gInfo(0x4088204) }),
    span(2, null, "Revit2027GLine", undefined),
  ];
  assert.equal(revit2027UndrawnReplayIndices(spans)!.size, 0);
});

test("a replay whose parent links leave its own spans fails closed", () => {
  assert.equal(
    revit2027UndrawnReplayIndices([
      span(0, null, "Revit2027GGroup", { gInfo: gInfo(DRAWN_GROUP) }),
      span(1, 7, "Revit2027Face", { gInfo: gInfo(0x8204) }),
    ]),
    null,
  );
  assert.equal(
    revit2027UndrawnReplayIndices([
      span(0, 1, "Revit2027GGroup", { gInfo: gInfo(DRAWN_GROUP) }),
      span(1, 0, "Revit2027GGroup", { gInfo: gInfo(DRAWN_GROUP) }),
    ]),
    null,
  );
  assert.equal(
    revit2027UndrawnReplayIndices([
      span(1, null, "Revit2027GGroup", { gInfo: gInfo(DRAWN_GROUP) }),
    ]),
    null,
  );
});
