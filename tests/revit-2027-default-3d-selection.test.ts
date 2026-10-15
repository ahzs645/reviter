import assert from "node:assert/strict";
import test from "node:test";
import { default3dCutSelection } from "../lib/reviter/revit-2027-default-3d-selection.ts";
import type { Revit2027GRepReplay, Revit2027GRepReplaySpan } from "../lib/reviter/revit-2027-grep-replay.ts";
const span = (index: number, parent: number | null, readerId: string, value: unknown, token = index + 1): Revit2027GRepReplaySpan => ({
  replayIndex: index, queueSequence: index, ownerElementId: 1n, path: [index], parentPath: parent == null ? null : [parent],
  parentReplayIndex: parent, propertyToken: token, propertySourceClassSlot: readerId === "Revit2027GConditionCut" ? 2234 : 0,
  descriptorOffset: 0, descriptorEndOffset: 0, startOffset: 0, endOffset: 0, readerId, value,
});
const filter = { conditions: [{ token: -1, sourceClassSlot: 2234 }] };
function replay(compareMode = 6): Revit2027GRepReplay {
  return { ownerElementId: 1n, startOffset: 0, endOffset: 0, initialTokenCount: 0, finalTokenCount: 0, descriptors: [], spans: [
    span(0, null, "Revit2027GFilter", filter), span(1, null, "Revit2027GFilter", filter),
    span(2, 0, "Revit2027Geometry", {}), span(3, 1, "Revit2027Geometry", {}),
    span(4, 0, "Revit2027GConditionCut", { compareMode, negateDirectionCondition: true }, -1),
    span(5, 1, "Revit2027GConditionCut", { compareMode, negateDirectionCondition: false }, -1),
    span(6, 2, "Revit2027Face", {}), span(7, 3, "Revit2027Face", {}),
  ] };
}
test("normal 3D opposite cut predicates select one source-owned subtree", () => {
  for (const comparison of [6, 7, 8]) {
    const selection = default3dCutSelection(replay(comparison));
    assert.deepEqual([...selection.excludedReplayIndices].sort(), [1, 3, 5, 7]);
    assert.equal(selection.excludedFilters, 1);
  }
});
test("unsupported predicates and non-filter-owned conditions remain unresolved", () => {
  assert.equal(default3dCutSelection(replay(0)).excludedReplayIndices.size, 0);
  const value = replay(); value.spans[1]!.readerId = "Revit2027GGroup";
  assert.equal(default3dCutSelection(value).excludedReplayIndices.size, 0);
  const missingDescriptor = replay(); missingDescriptor.spans[1]!.value = { conditions: [] };
  assert.equal(default3dCutSelection(missingDescriptor).excludedReplayIndices.size, 0);
});
test("a drawable pointer reused outside a false branch cannot be hidden globally", () => {
  const value = replay();
  value.descriptors = [{ descriptorIndex: 0, ownerElementId: 1n, path: [0, 0], parentPath: [0], parentReplayIndex: 0,
    token: 4, sourceClassSlot: 2343, descriptorOffset: 0, descriptorEndOffset: 0, state: "reused", queueSequence: null }];
  const selection = default3dCutSelection(value);
  assert.equal(selection.excludedReplayIndices.size, 0); assert.equal(selection.unresolvedAliasedFilters, 1);
  value.descriptors[0]!.parentReplayIndex = 1;
  assert.equal(default3dCutSelection(value).excludedFilters, 1, "an alias entirely inside the false branch is also excluded");
});
test("nested false filters propagate within their own ancestry only", () => {
  const value = replay();
  value.spans = [...value.spans, span(8, 3, "Revit2027GFilter", filter), span(9, 8, "Revit2027Geometry", {}),
    span(10, 8, "Revit2027GConditionCut", { compareMode: 6, negateDirectionCondition: true }, -1), span(11, 9, "Revit2027Face", {})];
  assert.deepEqual([...default3dCutSelection(value).excludedReplayIndices].sort((a, b) => a - b), [1, 3, 5, 7, 8, 9, 10, 11]);
  value.spans[0]!.parentReplayIndex = 99;
  assert.equal(default3dCutSelection(value).excludedReplayIndices.size, 0);
});
