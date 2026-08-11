import assert from "node:assert/strict";
import test from "node:test";

import { dwgLayoutSheets, dwgViewportWindow } from "../lib/reviter/dwg-layouts.ts";

/** A viewport 17×11 on paper, looking at a 50,105-unit-tall piece of the model. */
const viewport = (over: Record<string, unknown> = {}) => ({
  type: "VIEWPORT",
  ownerBlockRecordSoftId: "10F021A",
  width: 17,
  height: 11,
  viewHeight: 50105,
  targetPoint: { x: 241844, y: -282787 },
  displayCenter: { x: -106246, y: 291684 },
  viewTwistAngle: 0,
  ...over,
});

test("the model window is the view target plus the display centre", () => {
  const window = dwgViewportWindow(viewport());
  assert.ok(window);
  // Neither term alone is the answer: on the sample drawing displayCenter alone
  // lands 38 of 54 sheets on empty space, and targetPoint alone stacks them all.
  assert.equal(Math.round((window.minX + window.maxX) / 2), 241844 - 106246);
  assert.equal(Math.round((window.minY + window.maxY) / 2), -282787 + 291684);
  // Height comes from the view; width follows the viewport's paper proportions.
  assert.equal(Math.round(window.maxY - window.minY), 50105);
  assert.equal(Math.round(window.maxX - window.minX), Math.round(50105 * (17 / 11)));
});

test("a twisted viewport gives the box that encloses its rotated window", () => {
  const square = { width: 10, height: 10, viewHeight: 100, viewTwistAngle: Math.PI / 4 };
  const window = dwgViewportWindow(viewport({ ...square, targetPoint: null, displayCenter: { x: 0, y: 0 } }));
  assert.ok(window);
  // A square turned 45° needs √2 of its own width. Enclosing rather than
  // cropping means a sheet may show a little of its neighbour, never less of
  // itself.
  assert.equal(Math.round(window.maxX - window.minX), Math.round(100 * Math.SQRT2));
  assert.equal(Math.round(window.maxY - window.minY), Math.round(100 * Math.SQRT2));
});

test("a viewport that does not say where it looks is not guessed at", () => {
  assert.equal(dwgViewportWindow(viewport({ viewHeight: 0 })), null);
  assert.equal(dwgViewportWindow(viewport({ displayCenter: null })), null);
  assert.equal(dwgViewportWindow(viewport({ height: 0 })), null);
  assert.equal(dwgViewportWindow(viewport({ viewHeight: Number.NaN })), null);
});

test("each layout becomes one sheet, taking its largest model window", () => {
  const layouts = [
    { layoutName: "Model", tabOrder: 0, paperSpaceTableId: "22" },
    { layoutName: "03 CJMH LVL 1", tabOrder: 5, paperSpaceTableId: "10F021A" },
    { layoutName: "02 Plant LVL 1", tabOrder: 3, paperSpaceTableId: "82D063" },
  ];
  const viewports = [
    // The sheet's own paper viewport sits alongside the real one; it looks at a
    // window the size of the paper, so "largest" picks the plan.
    viewport({ viewHeight: 11.6, width: 31, height: 12 }),
    viewport(),
    viewport({ ownerBlockRecordSoftId: "82D063", viewHeight: 75766, width: 11, height: 17 }),
  ];
  const sheets = dwgLayoutSheets(layouts, viewports);

  assert.equal(sheets.length, 2, "Model is the shared space, not a sheet");
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["02 Plant LVL 1", "03 CJMH LVL 1"]);
  assert.deepEqual(sheets.map((sheet) => sheet.id), [0, 1]);
  assert.equal(Math.round(sheets[1]!.bounds.maxY - sheets[1]!.bounds.minY), 50105);
});

test("layouts without a viewport, or without a name, produce no sheet", () => {
  const sheets = dwgLayoutSheets([
    { layoutName: "05 Libr LVL 2", tabOrder: 1, paperSpaceTableId: "ABC" },
    { layoutName: "  ", tabOrder: 2, paperSpaceTableId: "10F021A" },
    { tabOrder: 3, paperSpaceTableId: "10F021A" },
  ], [viewport()]);
  assert.deepEqual(sheets, []);
});
