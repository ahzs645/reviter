/**
 * DWG text as it prints, not as it is stored.
 *
 * MTEXT carries inline markup, TEXT carries `%%` control codes, and justified
 * text is pinned somewhere other than where it starts. Room labels read from a
 * survey drawing go through all three.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { convertDwgEntity, plainDwgText, plainMText } from "../lib/reviter/dwg-entities.ts";

test("MTEXT markup is reduced to the characters it prints", () => {
  assert.equal(plainMText("AGORA\\PLEVEL 2"), "AGORA\nLEVEL 2");
  assert.equal(plainMText("{\\fArial|b1|i0|c0|p34;LEVEL 2}"), "LEVEL 2");
  assert.equal(plainMText("\\A1;{\\H1.5x;\\C3;07-400}\\POFFICE"), "07-400\nOFFICE");
  assert.equal(plainMText("\\LUnder\\l and \\Oover\\o"), "Under and over");
  assert.equal(plainMText("Slab 1\\S1^2; thick"), "Slab 1 1/2 thick");
  assert.equal(plainMText("A\\~B \\\\ C \\{x\\}"), "A B \\ C {x}");
  assert.equal(plainMText("90\\U+00B0 turn"), "90° turn");
  assert.equal(plainMText("Temporarily loaned\\Pto the Registrar\\P"), "Temporarily loaned\nto the Registrar");
});

test("TEXT control codes print as their characters", () => {
  assert.equal(plainDwgText("45%%d"), "45°");
  assert.equal(plainDwgText("%%c100"), "⌀100");
  assert.equal(plainDwgText("%%uOFFICE%%u"), "OFFICE");
  assert.equal(plainDwgText("50%%%"), "50%");
  assert.equal(plainDwgText("%%177"), "±");
});

test("an MTEXT entity is read without its formatting", () => {
  const entity = convertDwgEntity({
    type: "MTEXT", layer: "0_text", insertionPoint: { x: 5, y: 6 }, textHeight: 500,
    text: "{\\fArial|b0;CONFERENCE CENTRE MAIN}\\PFLOOR",
  });
  assert.equal(entity?.text, "CONFERENCE CENTRE MAIN\nFLOOR");
  assert.deepEqual(entity?.centre, [5, 6]);
  assert.equal(entity?.height, 500);
  assert.equal(entity?.anchor, undefined, "MTEXT's insertion point already is its anchor");
});

test("left-aligned TEXT has no separate anchor; justified TEXT does", () => {
  const left = convertDwgEntity({
    type: "TEXT", layer: "3_Text", text: "07-400", textHeight: 375,
    startPoint: { x: 10, y: 20 }, endPoint: { x: 0, y: 0 }, halign: 0, valign: 0,
  });
  assert.deepEqual(left?.centre, [10, 20]);
  assert.equal(left?.anchor, undefined, "the unset second point is not an anchor at the origin");

  const centred = convertDwgEntity({
    type: "TEXT", layer: "3_Text", text: "07-400", textHeight: 375,
    startPoint: { x: 10, y: 20 }, endPoint: { x: 50, y: 20 }, halign: 1, valign: 0,
  });
  assert.deepEqual(centred?.anchor, [50, 20]);

  const fitted = convertDwgEntity({
    type: "TEXT", layer: "3_Text", text: "CORRIDOR", textHeight: 375,
    startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 }, halign: 5, valign: 0,
  });
  assert.deepEqual(fitted?.anchor, [50, 0], "fitted text is anchored mid-baseline");
});

test("a multi-line attribute reads its embedded MTEXT", () => {
  const entity = convertDwgEntity({
    type: "ATTRIB", layer: "3_Text", tag: "ROOMUSE", flags: 0,
    text: { text: "", startPoint: { x: 1, y: 2 }, textHeight: 200 },
    mtext: { text: "Research\\POffice" },
  });
  assert.equal(entity?.text, "Research\nOffice");
  assert.equal(entity?.tag, "ROOMUSE");
});
