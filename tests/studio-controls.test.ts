/**
 * The two pieces of arithmetic behind the studio's filters and its right-click
 * menu. Everything else about those controls is DOM behaviour and is checked in
 * a real browser, but these two are pure and cheap to pin down.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_MENU_ITEM_HEIGHT,
  CANVAS_MENU_WIDTH,
  canvasMenuPosition,
  matchesFilter,
  propertyClipboardText,
} from "../app/studio/format.ts";

test("properties copy as a labelled, spreadsheet-friendly text block", () => {
  assert.equal(
    propertyClipboardText("Curtain Wall Panels", "Object 1850389", [
      { label: "Native Revit ID", value: "1850389" },
      { label: "Width", value: "4.093 ft" },
    ]),
    [
      "Curtain Wall Panels",
      "Object 1850389",
      "",
      "Native Revit ID\t1850389",
      "Width\t4.093 ft",
    ].join("\n"),
  );
});

test("an untouched filter is the whole list, not an empty one", () => {
  // A filter that matched nothing until you typed would hide every list behind
  // a guess at what is in it.
  assert.equal(matchesFilter("", "Walls"), true);
  assert.equal(matchesFilter("   ", "Walls"), true);
});

test("one filter test serves ids, categories and type names alike", () => {
  // The Objects list offers all three, because what someone types is as likely
  // to be a category as the id they would have to already know.
  const record = { elementId: 1495202, categoryName: "Floors", typeName: "Generic 12\"" };
  const fields = [record.elementId, record.categoryName, record.typeName] as const;
  assert.equal(matchesFilter("1495", ...fields), true);
  assert.equal(matchesFilter("floor", ...fields), true, "the match is case-insensitive");
  assert.equal(matchesFilter(" GENERIC ", ...fields), true, "and the query is trimmed");
  assert.equal(matchesFilter("Ceilings", ...fields), false);
});

test("a missing field is not a match", () => {
  // Most records carry no type name at all; `null` must not read as a hit, and
  // must not be stringified into one either.
  assert.equal(matchesFilter("null", "Floors", null), false);
  assert.equal(matchesFilter("undefined", "Floors", undefined), false);
});

test("the right-click menu opens at the cursor when there is room", () => {
  const at = canvasMenuPosition({ elementId: 1, x: 240, y: 180, width: 1200, height: 700 }, 4);
  assert.deepEqual(at, { left: 240, top: 180 });
});

test("a menu opened at the far corner is pushed back inside the viewport", () => {
  // The viewport clips its overflow, so an unclamped menu loses the entries
  // nearest the cursor — the ones being aimed at.
  const width = 1200;
  const height = 700;
  const corner = canvasMenuPosition({ elementId: 1, x: width - 4, y: height - 4, width, height }, 4);
  assert.equal(corner.left, width - CANVAS_MENU_WIDTH);
  assert.equal(corner.top, height - (4 * CANVAS_MENU_ITEM_HEIGHT + 10));
  assert.ok(corner.left + CANVAS_MENU_WIDTH <= width);
  assert.ok(corner.top + 4 * CANVAS_MENU_ITEM_HEIGHT + 10 <= height);

  // The empty-canvas menu is two entries rather than four, so it can sit lower.
  const shorter = canvasMenuPosition({ elementId: null, x: 0, y: height - 4, width, height }, 2);
  assert.ok(shorter.top > corner.top);
});

test("a viewport too small for the menu still positions it on screen", () => {
  // A 760px-wide layout puts the canvas below 186px in no configuration that
  // ships, but a negative offset would put the menu outside the page entirely.
  const tiny = canvasMenuPosition({ elementId: 1, x: 30, y: 30, width: 120, height: 60 }, 4);
  assert.deepEqual(tiny, { left: 0, top: 0 });
});
