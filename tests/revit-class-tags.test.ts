import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIT_2027_CLASS_NAMES,
  REVIT_2027_FIRST_CLASS_INDEX,
} from "../lib/reviter/revit-2027-class-names.data.ts";
import {
  buildClassTagTranslation,
  canonicalClassTag,
  fileClassTag,
  setActiveClassTagTranslation,
  usesRevit2027RecordLayout,
} from "../lib/reviter/revit-class-tags.ts";

const index2027 = (name: string) =>
  REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.indexOf(name);

/** The 2027 schema itself, as a file's `SchemaSummary` would list it. */
const schema2027 = REVIT_2027_CLASS_NAMES.map((name, position) => ({
  name,
  tag: REVIT_2027_FIRST_CLASS_INDEX + position,
}));

/**
 * A release schema with the same classes renumbered the way an older release
 * numbers them: one 2027 class dropped near the front shifts everything after
 * it down, and one class the 2027 schema lacks is added at the end.
 */
function olderSchema(): { name: string; tag: number }[] {
  const dropped = REVIT_2027_CLASS_NAMES[5]!;
  const names = REVIT_2027_CLASS_NAMES.filter((name) => name !== dropped);
  names.push("OnlyInTheOlderRelease");
  return names.map((name, position) => ({ name, tag: REVIT_2027_FIRST_CLASS_INDEX + position }));
}

test("the canonical table is the dense 2027 numbering the decoders were written in", () => {
  assert.equal(index2027("GElement"), 0x08c6);
  assert.equal(index2027("FamilyInstance"), 0x07ef);
  assert.equal(index2027("CellList"), 0x0310);
  assert.equal(index2027("Face"), 1825);
});

test("a 2027 schema translates to itself", () => {
  const translation = buildClassTagTranslation(schema2027);
  assert.equal(translation.identity, true);
  assert.equal(translation.movedClasses, 0);
});

test("a schema too small to be a release's is read as written", () => {
  const toy = buildClassTagTranslation([
    { name: "Wall", tag: 12 },
    { name: "Element", tag: 13 },
    { name: "Floor", tag: 14 },
  ]);
  assert.equal(toy.identity, true);
});

test("an older release's indices translate by class name, both ways", () => {
  const schema = olderSchema();
  const translation = buildClassTagTranslation(schema);
  assert.equal(translation.identity, false);
  assert.equal(translation.unmatchedFileClasses, 1);
  assert.equal(translation.missingCanonicalClasses, 1);

  const fileIndex = (name: string) => schema.find((entry) => entry.name === name)!.tag;
  setActiveClassTagTranslation(translation);
  try {
    // A class that moved reads back as its 2027 index, and a 2027 index is
    // searched for under the file's own.
    assert.equal(fileIndex("GElement"), 0x08c6 - 1);
    assert.equal(canonicalClassTag(fileIndex("GElement")), 0x08c6);
    assert.equal(fileClassTag(0x08c6), fileIndex("GElement"));
    // A class the file lacks cannot be searched for.
    assert.equal(fileClassTag(REVIT_2027_FIRST_CLASS_INDEX + 5), -1);
    // A class 2027 lacks never aliases a real 2027 index, and still
    // round-trips to the file's number when it is searched for again.
    const extra = canonicalClassTag(fileIndex("OnlyInTheOlderRelease"));
    assert.ok(extra > 0xffff);
    assert.equal(fileClassTag(extra), fileIndex("OnlyInTheOlderRelease"));
    // Negatives and the reserved low indices pass through.
    assert.equal(canonicalClassTag(-1), -1);
    assert.equal(canonicalClassTag(3), 3);
  } finally {
    setActiveClassTagTranslation(null);
  }
  // With no translation installed every index is read as written.
  assert.equal(canonicalClassTag(fileIndex("GElement")), fileIndex("GElement"));
});

test("the 2027 record decoders cover 2024 through 2027 and nothing else", () => {
  for (const release of [2024, 2025, 2026, 2027]) assert.equal(usesRevit2027RecordLayout(release), true);
  for (const release of [2014, 2023, 2028, null, undefined, 2025.5]) {
    assert.equal(usesRevit2027RecordLayout(release), false);
  }
});
