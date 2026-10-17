import assert from "node:assert/strict";
import test from "node:test";
import { originalDefault3dDirectionSelection } from "../lib/reviter/native-source-direction-selection.ts";
import { mergeDefault3dCutSelection } from "../lib/reviter/revit-2027-default-3d-selection.ts";
import type {
  Revit2027GRepReplay,
  Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function replay(slot = 2235, compareMode = 6): Revit2027GRepReplay {
  const span = (
    index: number,
    parent: number | null,
    readerId: string,
    value: unknown,
    token = index + 1,
  ): Revit2027GRepReplaySpan => ({
    replayIndex: index,
    queueSequence: index,
    ownerElementId: 1n,
    path: [index],
    parentPath: parent === null ? null : [parent],
    parentReplayIndex: parent,
    propertyToken: token,
    propertySourceClassSlot: readerId.startsWith("Revit2027GCondition")
      ? slot
      : 0,
    descriptorOffset: 100 + index,
    descriptorEndOffset: 106 + index,
    startOffset: 1000 + index,
    endOffset: 1100 + index,
    readerId,
    value,
  });
  const filter = (index: number) => ({
    conditions: [
      {
        token: -1,
        sourceClassSlot: slot,
        byteOffset: 100 + index,
        endOffset: 106 + index,
      },
    ],
  });
  return {
    ownerElementId: 1n,
    startOffset: 0,
    endOffset: 0,
    initialTokenCount: 0,
    finalTokenCount: 0,
    descriptors: [],
    spans: [
      span(0, null, "Revit2027GFilter", filter(4)),
      span(1, null, "Revit2027GFilter", filter(5)),
      span(2, 0, "Revit2027Geometry", {}),
      span(3, 1, "Revit2027Geometry", {}),
      span(
        4,
        0,
        slot === 2235 ? "Revit2027GConditionDir" : "Revit2027GConditionCut",
        { compareMode, direction: [0, 0, 1], negateDirectionCondition: true },
        -1,
      ),
      span(
        5,
        1,
        slot === 2235 ? "Revit2027GConditionDir" : "Revit2027GConditionCut",
        { compareMode, direction: [0, 0, 1], negateDirectionCondition: false },
        -1,
      ),
      span(6, 2, "Revit2027Face", {}),
      span(7, 3, "Revit2027Face", {}),
    ],
  };
}
test("original normal-3D rule selects source direction and cut predicates identically", () => {
  for (const slot of [2234, 2235])
    for (const comparison of [6, 7, 8]) {
      const value = replay(slot, comparison),
        before = structuredClone(value);
      const selected = originalDefault3dDirectionSelection(value);
      assert.deepEqual(
        [...selected.excludedReplayIndices].sort(),
        [1, 3, 5, 7],
      );
      assert.equal(selected.sourceFalseFilters.length, 1);
      assert.equal(selected.originalSourceAuthorityGranted, false);
      assert.equal(selected.routeApproved, false);
      assert.deepEqual(value, before);
    }
});
test("unsupported direction, parameter or mismatched source descriptor cannot hide material", () => {
  assert.equal(
    originalDefault3dDirectionSelection(replay(2235, 10)).excludedReplayIndices
      .size,
    0,
  );
  for (const change of [
    (r: Revit2027GRepReplay) => {
      r.spans[5]!.readerId = "Revit2027GConditionInt";
    },
    (r: Revit2027GRepReplay) => {
      r.spans[5]!.propertySourceClassSlot = 2234;
    },
    (r: Revit2027GRepReplay) => {
      r.spans[5]!.descriptorOffset++;
    },
    (r: Revit2027GRepReplay) => {
      (r.spans[5]!.value as { direction: number[] }).direction = [0, 0, NaN];
    },
    (r: Revit2027GRepReplay) => {
      r.spans[1]!.readerId = "Revit2027GGroup";
    },
  ]) {
    const r = replay();
    change(r);
    assert.equal(
      originalDefault3dDirectionSelection(r).excludedReplayIndices.size,
      0,
    );
  }
});
test("a reused drawable occurrence outside a false filter remains unresolved", () => {
  const r = replay();
  r.descriptors = [
    {
      descriptorIndex: 0,
      ownerElementId: 1n,
      path: [0, 0],
      parentPath: [0],
      parentReplayIndex: 0,
      token: 4,
      sourceClassSlot: 2343,
      descriptorOffset: 0,
      descriptorEndOffset: 0,
      state: "reused",
      queueSequence: null,
    },
  ];
  assert.equal(
    originalDefault3dDirectionSelection(r).excludedReplayIndices.size,
    0,
  );
  assert.equal(
    originalDefault3dDirectionSelection(r).unresolvedAliasedFilters,
    1,
  );
  r.descriptors[0]!.parentReplayIndex = 1;
  assert.equal(
    originalDefault3dDirectionSelection(r).sourceFalseFilters.length,
    1,
  );
});
test("invalid ancestry or foreign owner refuses every omission", () => {
  for (const change of [
    (r: Revit2027GRepReplay) => {
      r.spans[0]!.parentReplayIndex = 99;
    },
    (r: Revit2027GRepReplay) => {
      r.spans[5]!.ownerElementId = 2n;
    },
  ]) {
    const r = replay();
    change(r);
    assert.equal(
      originalDefault3dDirectionSelection(r).excludedReplayIndices.size,
      0,
    );
  }
});
test("isolated converter visibility merge retains saved exclusions and applies original direction rule", () => {
  assert.deepEqual([...mergeDefault3dCutSelection(replay(), new Set([0]))].sort(), [0, 1, 3, 5, 7]);
});
