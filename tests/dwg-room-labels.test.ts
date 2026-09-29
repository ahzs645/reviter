/**
 * Room numbers off a survey DWG, on entities shaped the way the UNBC drawing
 * flattens: `room_data` tags whose ROOMNUM and ROOMUSE attributes share a
 * reference handle, a few loose TEXT numbers, and layouts named by building
 * and floor.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { DwgEntity } from "../lib/reviter/dwg-plan.ts";
import {
  assignLabelsToPlans,
  dwgAreaTexts,
  dwgPlanTitles,
  dwgRoomLabels,
  overviewSheets,
  parseRoomNumber,
  parseSheetName,
} from "../lib/reviter/dwg-room-labels.ts";

const attribute = (insert: string, tag: string, text: string, at: [number, number]): DwgEntity => ({
  type: "ATTRIB", layer: "3_Text", tag, text, centre: [at[0] - 400, at[1] - 100], anchor: at,
  height: 230, block: "room_data", insert,
});

test("room numbers carry their building and floor", () => {
  assert.deepEqual(parseRoomNumber("10-2050"), { building: "10", level: "2" });
  assert.deepEqual(parseRoomNumber("04-246"), { building: "04", level: "2" });
  assert.deepEqual(parseRoomNumber("03-S201"), { building: "03", level: "2" });
  assert.deepEqual(parseRoomNumber("10-B510"), { building: "10", level: "B" });
  assert.deepEqual(parseRoomNumber("03-2078B "), { building: "03", level: "2" });
  assert.deepEqual(parseRoomNumber("09-200-1"), { building: "09", level: "2" });
  assert.deepEqual(parseRoomNumber('"04-213,214"'), { building: "04", level: "2" });
  assert.equal(parseRoomNumber("?????????"), null);
  assert.equal(parseRoomNumber("STAIR 4"), null);
  assert.equal(parseRoomNumber("19.0 sqr m"), null);
});

test("a tag's number is paired with its use, and pinned at the tag's centre", () => {
  const labels = dwgRoomLabels([
    attribute("A", "ROOMNUM", "10-2050", [100, 200]),
    attribute("A", "ROOMUSE", "Office", [100, 150]),
    attribute("B", "ROOMNUM", "?????????", [500, 200]),
    attribute("B", "ROOMUSE", '"H,C All Gender"', [500, 150]),
  ]);
  assert.equal(labels.length, 2, "a malformed number in a room tag is still reported");
  assert.deepEqual(labels.map((label) => [label.number, label.name, label.source]), [
    ["10-2050", "Office", "attribute"],
    ["?????????", "H,C All Gender", "attribute"],
  ]);
  assert.deepEqual(labels[0]?.position, [100, 200]);
  assert.deepEqual(labels[0]?.textStart, [-300, 100]);
  assert.equal(labels[1]?.parsed, null);
});

test("loose text counts as a label only when it looks like a room number", () => {
  const labels = dwgRoomLabels([
    { type: "TEXT", layer: "3_Text", text: "07-400", centre: [1, 1], height: 375 },
    { type: "TEXT", layer: "3_Text", text: "STAIR 4", centre: [2, 2], height: 375 },
    { type: "TEXT", layer: "0_text", text: "LEVEL 2", centre: [3, 3], height: 500 },
    // An attribute that is not a number tag is not a number, whatever it says.
    attribute("C", "FIXT_CODE", "10-1234", [4, 4]),
  ]);
  assert.deepEqual(labels.map((label) => [label.number, label.source, label.name]), [["07-400", "text", null]]);
});

test("titles are the plan's largest words, not its labels or notes", () => {
  const entities: DwgEntity[] = [
    { type: "TEXT", layer: "0_text", text: "T&L WEST", centre: [0, 10], height: 500 },
    { type: "TEXT", layer: "0_text", text: "LEVEL 2", centre: [0, 5], height: 500 },
    { type: "TEXT", layer: "0_text", text: "8", centre: [0, 0], height: 231 },
    { type: "TEXT", layer: "3_Text", text: "SEE LIBRARY", centre: [0, 0], height: 600 },
    { type: "TEXT", layer: "0_text", text: "10-2050", centre: [0, 0], height: 900 },
    attribute("A", "ROOMUSE", "Mathematical Academic Centre", [0, 0]),
  ];
  const titles = dwgPlanTitles(entities, { excludeLayers: new Set(["3_Text"]) });
  assert.deepEqual(titles.map((title) => title.text), ["T&L WEST", "LEVEL 2"]);
  assert.deepEqual(dwgAreaTexts([
    { type: "TEXT", layer: "3_Text", text: "19.0 sqr m", centre: [0, 0] },
    { type: "TEXT", layer: "3_Text", text: "12 m2", centre: [0, 0] },
    { type: "TEXT", layer: "3_Text", text: "OFFICE", centre: [0, 0] },
  ]).map((text) => text.text), ["19.0 sqr m", "12 m2"]);
});

test("layout names say which building and floor a sheet shows", () => {
  assert.deepEqual(parseSheetName("02 Plant LVL 1"), { building: "02", levels: ["1"], part: null });
  assert.deepEqual(parseSheetName("04 Res Lab LVL 1S"), { building: "04", levels: ["1"], part: "S" });
  assert.deepEqual(parseSheetName("07 Agora LVL 0 and 2"), { building: "07", levels: ["0", "2"], part: null });
  assert.deepEqual(parseSheetName("10 TandL 2500E"), { building: "10", levels: ["2"], part: "E" });
  assert.deepEqual(parseSheetName("10 TandL 5000"), { building: "10", levels: ["5"], part: null });
  assert.deepEqual(parseSheetName("10 TandL Base and Atrium"), { building: "10", levels: ["B"], part: "Atrium" });
  assert.deepEqual(parseSheetName("10 TandL Atrium LVL 2 and 3"), { building: "10", levels: ["2", "3"], part: "Atrium" });
  assert.deepEqual(parseSheetName("14 NSC Lvl 0"), { building: "14", levels: ["0"], part: null });
  assert.deepEqual(parseSheetName("11 EFL Full"), { building: "11", levels: [], part: "Full" });
  assert.deepEqual(parseSheetName("Full Campus Main Floor"), { building: null, levels: [], part: "Full" });
});

test("a label inside overlapping windows goes to its own building's plan", () => {
  const plans = [
    { id: 0, name: "05 Libr LVL 1", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
    // The Agora sheet crops generously and takes in the library's edge.
    { id: 1, name: "07 Agora LVL 1C", bounds: { minX: 80, minY: 0, maxX: 150, maxY: 100 } },
    { id: 2, name: "07 Agora LVL 1N", bounds: { minX: 80, minY: 0, maxX: 300, maxY: 100 } },
  ];
  const at = (number: string, x: number) => ({ position: [x, 50] as [number, number], parsed: parseRoomNumber(number) });
  assert.deepEqual(assignLabelsToPlans([
    at("05-105", 90),  // library room in the overlap: the library sheet
    at("07-220", 90),  // agora room in the overlap: the tighter agora sheet
    at("07-158", 200), // only one window holds it
    at("07-999", 900), // none does
  ], plans), [0, 1, 2, -1]);
});

test("an overview sheet is one whose window holds several others", () => {
  const box = (x: number) => ({ minX: x, minY: 0, maxX: x + 10, maxY: 10 });
  const plans = [
    { id: 0, name: "Full Campus Main Floor", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 10 } },
    { id: 1, name: "A", bounds: box(0) },
    { id: 2, name: "B", bounds: box(20) },
    { id: 3, name: "C", bounds: box(40) },
  ];
  assert.deepEqual([...overviewSheets(plans)], [0]);
});
