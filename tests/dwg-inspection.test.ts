import assert from "node:assert/strict";
import { test } from "node:test";
import { dwgExistingBlocks, dwgRepeatedShapes, dwgHighlightSvg } from "../lib/reviter/dwg-inspection.ts";
import { convertDwgEntity } from "../lib/reviter/dwg-entities.ts";
import { dwgSectionSvg, type DwgEntity } from "../lib/reviter/dwg-plan.ts";
import { dwgPrintSvg } from "../lib/reviter/dwg-print.ts";

const rectangle = (x: number, y: number, width = 10, layer = "Furniture"): DwgEntity => ({
  type: "LWPOLYLINE", layer, closed: true, points: [[x, y], [x + width, y], [x + width, y + 5], [x, y + 5]],
});

test("repeated shapes match translated geometry without conflating layer, orientation or scale", () => {
  const original = rectangle(0, 0), translated = rectangle(100, 200);
  const groups = dwgRepeatedShapes([original, translated, rectangle(400, 0, 11), rectangle(500, 0, 10, "Walls"),
    { type: "LWPOLYLINE", layer: "Furniture", closed: true, points: [[600, 0], [605, 0], [605, 10], [600, 10]] }]);
  assert.equal(groups.length, 1); assert.equal(groups[0]!.instances.length, 2);
  assert.equal(groups[0]!.instances[1]!.bounds.minX, 100);
  assert.deepEqual(original, rectangle(0, 0), "candidate matching preserves source geometry");
});

test("connected primitives form a shape and duplicate overlays are not extra occurrences", () => {
  const corner = (x: number): DwgEntity[] => [
    { type: "LINE", layer: "Furniture", points: [[x, 0], [x + 10, 0]] },
    { type: "LINE", layer: "Furniture", points: [[x + 10, 0], [x + 10, 5]] },
  ];
  const groups = dwgRepeatedShapes([...corner(0), ...corner(100)]);
  assert.equal(groups.length, 1); assert.equal(groups[0]!.entityCount, 2);
  assert.equal(dwgRepeatedShapes([rectangle(0, 0), rectangle(0, 0)]).length, 0);
  assert.equal(dwgRepeatedShapes([{ type: "TEXT", layer: "Furniture", centre: [0, 0], text: "Chair" }]).length, 0);
});

test("native block inspection respects model ownership and preserves nested attribute text", () => {
  const database = { tables: { BLOCK_RECORD: { entries: [] } }, entities: [
    { type: "INSERT", handle: "A", ownerBlockRecordSoftId: "model", name: "room_data", layer: "Labels", insertionPoint: { x: 10, y: 20 },
      attribs: [{ type: "ATTRIB", layer: "Labels", tag: "ROOMNUM", text: { text: "02-110", startPoint: { x: 10, y: 20 }, textHeight: 2 } }] },
    { type: "INSERT", handle: "B", ownerBlockRecordSoftId: "paper", name: "room_data", insertionPoint: { x: 0, y: 0 } },
  ] };
  const groups = dwgExistingBlocks(database, "model");
  assert.equal(groups.length, 1); assert.equal(groups[0]!.instances.length, 1);
  assert.equal(groups[0]!.instances[0]!.handle, "A");
  assert.deepEqual(groups[0]!.instances[0]!.attributes, [{ tag: "ROOMNUM", value: "02-110" }]);
  assert.match(groups[0]!.previewSvg, /02-110/);
  assert.equal(convertDwgEntity({ type: "TEXT", layer: "Labels", startPoint: { x: 1, y: 2 }, text: "Legacy" })?.text, "Legacy");
});

test("print preview fits the recovered view on a real paper size and preserves every path", () => {
  const source = dwgSectionSvg([rectangle(0, 0)], { minX: 0, minY: 0, maxX: 20, maxY: 10 });
  const print = dwgPrintSvg(source, "A4", true);
  assert.match(print, /width="297mm" height="210mm"/);
  assert.match(print, /x="12" y="12" width="273" height="186" viewBox="0 -10 20 10"/);
  assert.deepEqual(print.match(/<path[^>]+>/g), source.match(/<path[^>]+>/g));
  assert.doesNotMatch(print, /data-dwg-highlights/);
  assert.match(dwgHighlightSvg(source, [{ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 } }]), /data-dwg-highlights/);
  assert.doesNotMatch(source, /data-dwg-highlights/);
});
