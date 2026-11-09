/**
 * Reviewer assertions over a recovered element: the model, and what the export
 * says about them.
 *
 * The property under test throughout is that an assertion is never able to
 * impersonate a decode. It may change what the file says an element is — a
 * category decides the IFC class — but the export has to carry who said so and
 * what the decoder had said, or a consumer trusting a Reviter file because of
 * its provenance properties is being told a human's claim by the machine.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyElementOverrides,
  assertedFields,
  clearElementOverride,
  emptyElementOverrideState,
  isElementOverride,
  mergeElementOverrides,
  overrideFor,
  redoElementOverrides,
  setElementOverride,
  undoElementOverrides,
} from "../lib/reviter/element-overrides.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import type { ElementOverride } from "../lib/reviter/element-overrides.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import { nativeIfcGlobalId } from "../lib/reviter/ifc-global-id.ts";

const AUTHOR = "reviewer@example.com";
const CURTAIN_PANELS = { id: -2_000_170, name: "Curtain Panels" };

function record(overrides: Partial<ElementBoundsRecord> = {}): ElementBoundsRecord {
  return {
    elementId: 10,
    stream: "Partitions/1",
    chunkIndex: 2,
    rawOffset: 10,
    recordOffset: 20,
    categoryId: -2_000_011,
    categoryName: "Walls",
    categorySource: "record-code-consensus",
    renderGeometryProvenance: "native",
    boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 1, z: 3 } },
    ...overrides,
  } as ElementBoundsRecord;
}

test("setting and clearing an assertion", () => {
  let state = emptyElementOverrideState();
  state = setElementOverride(state, 10, { category: CURTAIN_PANELS }, AUTHOR, "2026-08-19T00:00:00Z");
  assert.equal(state.overrides.length, 1);
  assert.deepEqual(overrideFor(state.overrides, 10)?.category, CURTAIN_PANELS);

  state = clearElementOverride(state, 10);
  assert.equal(state.overrides.length, 0);
});

test("an assertion that sets nothing is not stored", () => {
  // Otherwise the pending-change count in the review dialog counts elements
  // whose override says nothing at all.
  let state = emptyElementOverrideState();
  state = setElementOverride(state, 10, { note: "   " }, AUTHOR);
  assert.equal(state.overrides.length, 0);

  state = setElementOverride(state, 10, { category: CURTAIN_PANELS }, AUTHOR);
  state = setElementOverride(state, 10, { category: null }, AUTHOR);
  assert.equal(state.overrides.length, 0, "clearing the last field removes the override");
});

test("an unchanged patch does not grow the undo stack", () => {
  // An editor firing on every keystroke would otherwise make undo useless.
  let state = emptyElementOverrideState();
  state = setElementOverride(state, 10, { typeName: "Curtain Panel" }, AUTHOR);
  const afterFirst = state;
  state = setElementOverride(state, 10, { typeName: "Curtain Panel" }, AUTHOR);
  assert.equal(state, afterFirst);
});

test("undo and redo walk the assertion history", () => {
  let state = emptyElementOverrideState();
  state = setElementOverride(state, 10, { category: CURTAIN_PANELS }, AUTHOR);
  state = setElementOverride(state, 11, { note: "check on site" }, AUTHOR);
  assert.equal(state.overrides.length, 2);

  state = undoElementOverrides(state);
  assert.equal(state.overrides.length, 1);
  state = undoElementOverrides(state);
  assert.equal(state.overrides.length, 0);
  // Past the beginning is a no-op rather than an error.
  assert.equal(undoElementOverrides(state).overrides.length, 0);

  state = redoElementOverrides(state);
  assert.equal(state.overrides.length, 1);
  state = redoElementOverrides(state);
  assert.equal(state.overrides.length, 2);
});

test("a new assertion abandons the redo branch", () => {
  // Keeping it would let a redo reinstate a value the reviewer has replaced.
  let state = emptyElementOverrideState();
  state = setElementOverride(state, 10, { category: CURTAIN_PANELS }, AUTHOR);
  state = undoElementOverrides(state);
  state = setElementOverride(state, 12, { note: "different call" }, AUTHOR);
  assert.equal(state.future.length, 0);
  assert.equal(redoElementOverrides(state).overrides.length, 1);
});

test("applying an assertion leaves the decoded values retrievable", () => {
  const original = record();
  const override: ElementOverride = {
    elementId: 10,
    category: CURTAIN_PANELS,
    typeName: null,
    note: "",
    author: AUTHOR,
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
  };
  const { records, overridden } = applyElementOverrides([original], [override]);
  assert.equal(records[0]?.categoryName, "Curtain Panels");
  assert.equal(records[0]?.categoryId, -2_000_170);
  // The decoder's own record is untouched — the recovery is evidence.
  assert.equal(original.categoryName, "Walls");
  assert.equal(overridden.get(10)?.decoded.categoryName, "Walls");
  assert.deepEqual(assertedFields(override), ["category"]);
});

test("records with no assertion pass through unchanged", () => {
  const untouched = record({ elementId: 99 });
  const { records, overridden } = applyElementOverrides([untouched], []);
  assert.equal(records[0], untouched);
  assert.equal(overridden.size, 0);
});

test("merging a sidecar keeps the later assertion", () => {
  const early: ElementOverride = {
    elementId: 10, category: CURTAIN_PANELS, typeName: null, note: "",
    author: AUTHOR, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
  };
  const late: ElementOverride = { ...early, note: "revised", updatedAt: "2026-08-19T00:00:00Z" };
  assert.equal(mergeElementOverrides([early], [late])[0]?.note, "revised");
  assert.equal(mergeElementOverrides([late], [early])[0]?.note, "revised");
});

test("a malformed sidecar entry is rejected", () => {
  const valid = { elementId: 10, category: null, typeName: null, note: "", author: "a", createdAt: "2026-08-19T00:00:00Z", updatedAt: "2026-08-19T00:00:00Z" };
  assert.equal(isElementOverride(valid), true);
  assert.equal(isElementOverride({ ...valid, elementId: 0 }), false);
  assert.equal(isElementOverride({ ...valid, updatedAt: "invalid" }), false);
  assert.equal(isElementOverride({ ...valid, category: { id: 1, name: "Walls" } }), false);
  assert.equal(isElementOverride({ elementId: 1.5, category: null, typeName: null, note: "", author: "a", createdAt: "x", updatedAt: "y" }), false);
  assert.equal(isElementOverride({ elementId: 10, category: { id: -1 }, typeName: null, note: "", author: "a", createdAt: "x", updatedAt: "y" }), false);
  assert.equal(isElementOverride(null), false);
});

test("assertion provenance uses the preferred decoded record, not the first duplicate", () => {
  const low = record({ categoryId: undefined, categoryName: undefined, typeName: undefined });
  const best = record({ typeName: "Source type" });
  const state = setElementOverride(emptyElementOverrideState(), 10, { typeName: "Reviewed type" }, AUTHOR);
  const result = applyElementOverrides([low, best], state.overrides);
  assert.equal(result.overridden.get(10)?.decoded.typeName, "Source type");
  assert.equal(result.overridden.get(10)?.decoded.categoryName, "Walls");
});

test("an asserted category changes the IFC class and is flagged in the export", () => {
  const overrides: ElementOverride[] = [{
    elementId: 10,
    category: CURTAIN_PANELS,
    typeName: null,
    note: "Curtain panel misfiled as a wall by the record-code consensus",
    author: AUTHOR,
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T12:00:00Z",
  }];
  const source = makeIfc(ifcExportFixture(), { overrides });

  // The element is emitted as the class the reviewer said it is, not renamed
  // while staying the decoder's class.
  assert.match(source, /IFCPLATE\(/);

  for (const pattern of [
    /'AssertedFields',\$,IFCTEXT\('category,note'\)/,
    /'AssertedBy',\$,IFCTEXT\('reviewer@example.com'\)/,
    /'AssertedAt',\$,IFCTEXT\('2026-08-19T12:00:00Z'\)/,
    /'AssertedNote',\$,IFCTEXT\('Curtain panel misfiled/,
    /'CategoryEvidence',\$,IFCTEXT\('reviewer-assertion'\)/,
    /'DecodedRevitCategory',\$,IFCTEXT\('Walls'\)/,
    /'DecodedRevitCategoryId',\$,IFCINTEGER\(-2000011\)/,
    /'DecodedCategoryEvidence',\$,IFCTEXT\('native-token'\)/,
  ]) assert.match(source, pattern, `expected ${pattern} in the export`);
});

test("an export with no assertions carries no assertion properties", () => {
  // The flag has to mean something, so it must be absent when nothing was
  // asserted rather than present and empty.
  const source = makeIfc(ifcExportFixture());
  for (const absent of ["AssertedFields", "AssertedBy", "AssertedAt", "reviewer-assertion"]) {
    assert.equal(source.includes(absent), false, `${absent} leaked into an unasserted export`);
  }
});

test("assertions preserve authored IFC class overrides and source suppression", () => {
  const result = ifcExportFixture();
  const wall = result.elementBounds[0]!;
  const overrides = setElementOverride(emptyElementOverrideState(), 10, { category: CURTAIN_PANELS }, AUTHOR).overrides;
  wall.parameters = [...(wall.parameters ?? []), { parameterId: -1019014, name: "IfcExportAs", value: "IfcWall" }];
  assert.match(makeIfc(result, { overrides }), /IFCWALL\(/);
  wall.parameters.push({ parameterId: -1019012, name: "Export to IFC", value: 2 });
  const suppressed = makeIfc(result, { overrides });
  assert.doesNotMatch(suppressed, /IFCWALL\(/);
  assert.doesNotMatch(suppressed, /IFCPLATE\(/);
  assert.doesNotMatch(suppressed, /'AssertedFields'/);
});

test("an overlay cannot change which original duplicate supplies exported evidence", () => {
  const result = ifcExportFixture();
  const preferred = result.elementBounds[0]!;
  result.elementBounds.unshift({ ...preferred, typeName: undefined, categoryId: undefined, categoryName: undefined, categorySource: undefined });
  const overrides = setElementOverride(emptyElementOverrideState(), 10, { typeName: "Reviewed" }, AUTHOR).overrides;
  const exported = makeIfc(result, { overrides });
  assert.match(exported, /'DecodedType',\$,IFCTEXT\('Exterior Wall - 200mm'\)/);
  assert.match(exported, /IFCWALL\(/);
  assert.equal(preferred.typeName, "Exterior Wall - 200mm");
});

test("asserted types use derived identities while an unedited shared type keeps its native GUID", () => {
  const result = ifcExportFixture();
  const wall = result.elementBounds[0]!;
  const sourceIdentity = result.nativeIdentity!.identities[0]!;
  const typeIdentity = { ...sourceIdentity, elementId: 20, originalElementId: 20,
    uniqueId: `${sourceIdentity.episodeGuid}-00000014` };
  result.nativeIdentity!.identities.push(typeIdentity);
  result.elementBounds.push({ ...wall, elementId: 12 });
  const unedited = makeIfc(result);
  const nativeType = nativeIfcGlobalId(typeIdentity)!;
  assert.ok(nativeType);
  assert.ok(unedited.includes(`IFCWALLTYPE('${nativeType}'`));
  const overrides = setElementOverride(emptyElementOverrideState(), 10, { typeName: "Reviewed wall" }, AUTHOR).overrides;
  const exported = makeIfc(result, { overrides });
  assert.ok(exported.includes(`IFCWALLTYPE('${nativeType}'`));
  assert.equal([...exported.matchAll(/=IFCWALLTYPE\(/g)].length, 2);
  const nativeTypeLine = exported.split("\n").find(line => line.includes(`IFCWALLTYPE('${nativeType}'`))!;
  assert.doesNotMatch(nativeTypeLine, /Reviewed wall/);
  const oldProductGuid = /IFCWALL\('([^']+)'/.exec(unedited)![1];
  assert.ok(exported.includes(`IFCWALL('${oldProductGuid}'`));
  const roots = [...exported.matchAll(/=IFC[A-Z]+\('([0-3][0-9A-Za-z_$]{21})'/g)].map(match => match[1]);
  assert.equal(new Set(roots).size, roots.length);
});

test("editing the first occurrence cannot change another native type projection's GUID", () => {
  const result = ifcExportFixture();
  const wall = result.elementBounds[0]!;
  const sourceIdentity = result.nativeIdentity!.identities[0]!;
  result.nativeIdentity!.identities.push({ ...sourceIdentity, elementId: 20, originalElementId: 20,
    uniqueId: `${sourceIdentity.episodeGuid}-00000014` });
  Object.assign(result.elementBounds[1]!, { categoryId: -2000032, categoryName: "Floors", typeId: 20,
    familyId: undefined, familyName: undefined, typeName: wall.typeName });
  const unedited = makeIfc(result);
  const overrides = setElementOverride(emptyElementOverrideState(), 10, { typeName: "Reviewed wall" }, AUTHOR).overrides;
  const edited = makeIfc(result, { overrides });
  assert.equal(/IFCSLABTYPE\('([^']+)'/.exec(edited)?.[1], /IFCSLABTYPE\('([^']+)'/.exec(unedited)?.[1]);
});

test("a weaker first duplicate cannot discard preferred source export settings", () => {
  const result = ifcExportFixture();
  const preferred = result.elementBounds[0]!;
  const lower = { ...preferred, categoryId: undefined, categoryName: undefined, typeName: undefined, parameters: [] };
  result.elementBounds.unshift(lower);
  const overrides = setElementOverride(emptyElementOverrideState(), 10, { note: "Reviewed" }, AUTHOR).overrides;
  preferred.parameters!.push({ parameterId: -1019014, name: "IfcExportAs", value: "IfcPlate" });
  assert.match(makeIfc(result, { overrides }), /IFCPLATE\(/);
  preferred.parameters!.push({ parameterId: -1019012, name: "Export to IFC", value: 2 });
  for (const options of [{}, { overrides }]) {
    const exported = makeIfc(result, options);
    assert.doesNotMatch(exported, /IFCWALL\(/);
    assert.doesNotMatch(exported, /IFCPLATE\(/);
    assert.doesNotMatch(exported, /'AssertedFields'/);
  }
});
